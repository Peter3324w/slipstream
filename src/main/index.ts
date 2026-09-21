import { app, shell, BrowserWindow, Menu, ipcMain, safeStorage, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppInfo, AuthStatus, EmoteProvider, EmoteSet, MemorySample, ResolveResult } from '@shared/types'
import { EMOTE_PROVIDERS } from '@shared/types'
import { resolveChannel, streamlinkVersion } from './streamlink'
import { fetchEmotes, setEmoteCacheDir } from './emotes'
import {
  accessToken,
  beginDeviceFlow,
  cancelDeviceFlow,
  initAuth,
  loadClientId,
  restoreSession,
  setClientId,
  signOut,
  status as authStatus
} from './auth'

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
    "img-src 'self' data: https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com",
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

function registerAuthIpc(): void {
  ipcMain.handle('auth:status', (): AuthStatus => authStatus())
  ipcMain.handle('auth:begin', (): Promise<AuthStatus> => beginDeviceFlow())
  ipcMain.handle('auth:cancel', (): AuthStatus => {
    cancelDeviceFlow()
    return authStatus()
  })
  ipcMain.handle('auth:signOut', (): Promise<AuthStatus> => signOut())
  ipcMain.handle('auth:setClientId', (_e, value: unknown): Promise<AuthStatus> => {
    if (typeof value !== 'string') return Promise.resolve(authStatus())
    return setClientId(value)
  })

  /**
   * The chat socket lives in the renderer, so the token has to cross once per
   * connect. It is fetched fresh each time and never kept there, which keeps the
   * long-lived copy in main behind the OS keystore. Moving the IRC connection
   * itself into main would remove the crossing entirely; noted, not done.
   */
  ipcMain.handle('auth:chatCredentials', () => accessToken())
}

function registerIpc(): void {
  ipcMain.handle('stream:resolve', async (_e, channel: unknown): Promise<ResolveResult> => {
    if (typeof channel !== 'string')
      return { ok: false, reason: 'invalid_channel', message: 'Expected a channel name.' }
    return resolveChannel(channel)
  })

  ipcMain.handle(
    'emotes:fetch',
    async (_e, channel: unknown, providers: unknown): Promise<EmoteSet> => {
      const empty: EmoteSet = { emotes: {}, counts: { '7tv': 0, bttv: 0, ffz: 0 }, errors: [] }
      if (typeof channel !== 'string') return { ...empty, errors: ['bad channel'] }

      // Never trust the renderer's list; take only names we know.
      const wanted = Array.isArray(providers)
        ? EMOTE_PROVIDERS.filter((p) => providers.includes(p))
        : EMOTE_PROVIDERS
      if (!wanted.length) return empty

      try {
        return await fetchEmotes(channel, wanted as EmoteProvider[])
      } catch (err) {
        // Emotes are a nicety; chat must keep working without them.
        return { ...empty, errors: [(err as Error).message] }
      }
    }
  )

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

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    setEmoteCacheDir(app.getPath('userData'))

    initAuth(
      app.getPath('userData'),
      (status) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('auth:changed', status)
      },
      {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (plain) => safeStorage.encryptString(plain),
        decrypt: (data) => safeStorage.decryptString(data)
      }
    )
    await loadClientId()
    await restoreSession()

    applyCsp()
    registerIpc()
    registerAuthIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
