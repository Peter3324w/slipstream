import { app, shell, BrowserWindow, Menu, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppInfo, MemorySample, ResolveResult } from '@shared/types'
import { resolveChannel, streamlinkVersion } from './streamlink'

const __dirname_ = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

// This is a video player. Chromium's gesture requirement exists for web pages that
// ambush you with sound; here the user pressed Watch, which IS the gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/** Colours here must track --bg / --text in the renderer's tokens.css. */
const TITLEBAR = { color: '#0B0B0F', symbolColor: '#9A9AA8', height: 40 }

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 780,
    minHeight: 460,
    show: false,
    backgroundColor: TITLEBAR.color,
    title: 'Slipstream',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: TITLEBAR } : {}),
    webPreferences: {
      preload: join(__dirname_, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // No text inputs worth checking, and the dictionary is a few MB we would
      // rather not pay for in a project whose entire premise is the memory number.
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // This app never navigates. Anything that tries is either a mistake or hostile.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname_, '../renderer/index.html'))
  }
  return win
}

/**
 * Locks the renderer down to exactly the origins this app needs. Applied only to a
 * packaged build: the Vite dev server needs inline scripts and its own websocket,
 * and weakening the policy to accommodate that would defeat the point of having one.
 *
 * - media/connect blob:  the master playlist is handed over as a Blob (see types.ts)
 * - *.ttvnw.net          playlists and video segments
 * - static-cdn.jtvnw.net first-party emote images
 * - irc-ws.chat          anonymous chat
 */
function applyCsp(): void {
  if (isDev) return
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://static-cdn.jtvnw.net",
    "media-src 'self' blob:",
    "connect-src 'self' blob: https://*.ttvnw.net wss://irc-ws.chat.twitch.tv",
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] }
    })
  })
}

function registerIpc(): void {
  ipcMain.handle('stream:resolve', async (_e, channel: unknown): Promise<ResolveResult> => {
    if (typeof channel !== 'string')
      return { ok: false, reason: 'invalid_channel', message: 'Expected a channel name.' }
    return resolveChannel(channel)
  })

  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    streamlink: await streamlinkVersion()
  }))

  /**
   * The measurement the README promises: per process, not one summary number.
   * workingSetSize is reported in kilobytes.
   */
  ipcMain.handle('app:memory', (): MemorySample[] =>
    app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      bytes: (m.memory?.workingSetSize ?? 0) * 1024
    }))
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    applyCsp()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
