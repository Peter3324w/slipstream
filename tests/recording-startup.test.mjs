import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'

async function launch(t, cleanupFails = false) {
  const context = { handlers: new Map(), windows: [], quits: 0, disposed: 0 }
  t.mock.method(console, 'error', () => {})
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, setAppUserModelId() {}, commandLine: { appendSwitch() {} },
    requestSingleInstanceLock: () => true, getPath: () => resolve('cache/startup-test'),
    whenReady: () => ({ then(fn) { context.startup = Promise.resolve().then(fn); context.startup.catch(() => {}); return context.startup } }),
    quit: () => { context.quits++ }
  })
  class Window extends EventEmitter {
    static getAllWindows() { return context.windows }
    constructor() {
      super(); context.windows.push(this)
      this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {} })
    }
    loadFile() {} loadURL() {} isDestroyed() { return false } isVisible() { return true }
  }
  context.electron = {
    app, BrowserWindow: Window, Menu: { setApplicationMenu() {} }, shell: {}, safeStorage: {},
    ipcMain: { handle: (name, fn) => context.handlers.set(name, fn) },
    session: { defaultSession: { webRequest: { onHeadersReceived() {}, onBeforeRequest() {} } } }
  }
  context.Recorder = class {
    origin = ''
    async initialize() { throw new Error('Recording directory access denied') }
    async stop() {}
    async dispose() { context.disposed++; if (cleanupFails) throw new Error('Recording directory still locked') }
    status() { return { active: false, bytes: 0, error: null } }
  }
  globalThis.__recordingStartupTest = context
  t.after(() => { for (const win of context.windows) win.emit('closed'); delete globalThis.__recordingStartupTest })
  const result = await build({
    entryPoints: ['src/main/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    alias: { '@shared': resolve('src/shared') },
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve('src/main/index.ts')).href) },
    plugins: [{ name: 'startup-boundaries', setup(b) {
      b.onResolve({ filter: /^(electron|\.\/dvr|\.\/auth|\.\/streamlink)$/ }, ({path}) => ({ path, namespace: 'startup' }))
      b.onLoad({ filter: /.*/, namespace: 'startup' }, ({path}) => ({ contents: path === 'electron'
        ? `const e=globalThis.__recordingStartupTest.electron; export const {app,BrowserWindow,Menu,shell,safeStorage,ipcMain,session}=e`
        : path === './dvr' ? 'export const TemporaryDvr=globalThis.__recordingStartupTest.Recorder'
        : path === './auth' ? 'export const accessToken=()=>null,beginDeviceFlow=()=>null,cancelDeviceFlow=()=>null,initAuth=()=>{},loadClientId=async()=>{},restoreSession=async()=>{},setClientId=()=>null,signOut=()=>null,status=()=>null'
        : `export const resolveChannel=async()=>({ok:true,stream:{kind:'live',masterPlaylist:'#EXTM3U'}}),resolveVod=async()=>({ok:true,stream:{kind:'vod',masterPlaylist:'#EXTM3U'}}),streamlinkVersion=async()=>null` }))
    } }]
  })
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`)
  await context.startup.catch(() => {})
  return context
}

test('unavailable recording storage still opens ordinary playback and reports the actual recording error', async t => {
  const context = await launch(t)
  assert.equal(context.windows.length, 1)
  assert.equal((await context.handlers.get('stream:resolve')({}, 'example')).ok, true)
  await assert.rejects(context.handlers.get('dvr:start')({}, 'source', Date.now()), /directory access denied/)
  assert.match(context.handlers.get('dvr:status')().error, /directory access denied/)
  const event = { preventDefault() {} }
  context.electron.app.emit('before-quit', event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.disposed, 1)
  assert.equal(context.quits, 1)
})

test('an unavailable recorder does not trap app exit if its inaccessible old directory remains locked', async t => {
  const context = await launch(t, true)
  assert.equal(context.windows.length, 1)
  context.electron.app.emit('before-quit', { preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.quits, 1)
})
