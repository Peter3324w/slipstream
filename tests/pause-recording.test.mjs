import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const output = await build({ entryPoints: ['src/renderer/src/player/pauseRecording.ts'], bundle: true, write: false, format: 'esm' })
const { PauseRecording } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const flush = () => new Promise((resolve) => setImmediate(resolve))
function setup() {
  let resolve, reject
  const pending = new Promise((yes, no) => { resolve = yes; reject = no })
  const calls = []
  const api = { start: async (...args) => { calls.push(['start', ...args]); return pending }, stop: async () => { calls.push(['stop']) } }
  const coordinator = new PauseRecording(api, {
    suspend: () => calls.push(['suspend']),
    restore: (play) => calls.push(['restore', play]),
    load: (result, play) => calls.push(['load', result.startAt, play]),
    changed: () => {}
  })
  return { coordinator, calls, resolve, reject }
}
test('resume before preparation completes waits for recorded playback', async () => {
  const { coordinator, calls, resolve } = setup()
  coordinator.pause({ rendition: '720p60', programDateTime: 1000 })
  assert.equal(coordinator.resume(), true)
  assert.equal(calls.some(([name]) => name === 'play'), false)
  resolve({ masterPlaylist: 'local', startAt: 4 }); await flush()
  assert.deepEqual(calls.at(-1), ['load', 4, true])
})

test('two play-button toggles during preparation retract requested resume', async () => {
  const { coordinator, calls, resolve } = setup()
  coordinator.pause({ rendition: '720p60', programDateTime: 1000 })
  assert.equal(coordinator.togglePreparing(), true)
  assert.equal(coordinator.state.resumeRequested, true)
  assert.equal(coordinator.togglePreparing(), true)
  assert.equal(coordinator.state.resumeRequested, false)
  resolve({ masterPlaylist: 'local', startAt: 4 }); await flush()
  assert.deepEqual(calls.at(-1), ['load', 4, false])
})

test('Jump Live remains actionable at the recording edge and during preparation', async () => {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {DvrBar} from './src/renderer/src/components/DvrBar'; export const render=(props)=>renderToStaticMarkup(React.createElement(DvrBar,props));`, resolveDir: process.cwd() }, bundle: true, platform: 'node', packages: 'external', write: false, format: 'cjs' })
  const module = { exports: {} }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', 'React', output.outputFiles[0].text)(require, module, module.exports, require('react'))
  const { render } = module.exports
  const base = { start: 0, end: 10, current: 10, vod: false, onSeek() {}, onJumpLive() {} }
  for (const disabled of [false, true]) {
    const markup = render({ ...base, disabled, recording: true })
    const button = markup.match(/<button[^>]*>Jump Live<\/button>/)?.[0]
    assert.ok(button, 'recording exposes explicit Jump Live button')
    assert.equal(button.includes('disabled='), false)
  }
  assert.match(render({ ...base, disabled: false }), /disabled=""[^>]*>LIVE<\/button>/)
})
test('stop or channel change invalidates a pending start and resume', async () => {
  const { coordinator, calls, resolve } = setup()
  coordinator.pause({ rendition: 'source', programDateTime: 1000 })
  coordinator.resume(); coordinator.cancel()
  resolve({ masterPlaylist: 'old', startAt: 3 }); await flush()
  assert.equal(calls.some(([name]) => name === 'load'), false)
  assert.equal(coordinator.state.kind, 'idle')
  assert.equal(calls.filter(([name]) => name === 'stop').length, 1)
})
test('repeated pause keeps the same recording and updates resume intent', async () => {
  const { coordinator, calls, resolve } = setup()
  const snapshot = { rendition: 'source', programDateTime: 1000 }
  coordinator.pause(snapshot); coordinator.resume(); coordinator.pause(snapshot)
  resolve({ masterPlaylist: 'local', startAt: 0 }); await flush()
  assert.deepEqual(calls.at(-1), ['load', 0, false])
  coordinator.pause(snapshot)
  assert.equal(calls.filter(([name]) => name === 'start').length, 1)
})
test('start failure keeps the original paused playback and reports the error', async () => {
  const { coordinator, calls, reject } = setup()
  coordinator.pause({ rendition: 'source', programDateTime: 1000 })
  reject(new Error('Disk full')); await flush()
  assert.equal(coordinator.state.error, 'Could not save this pause: Disk full')
  assert.deepEqual(calls.at(-1), ['restore', false])
})
test('failure after requested resume restores original loading and playback', async () => {
  const { coordinator, calls, reject } = setup()
  coordinator.pause({ rendition: 'source', programDateTime: 1000 }); coordinator.resume()
  reject(new Error('Unavailable')); await flush()
  assert.deepEqual(calls.at(-1), ['restore', true])
})

for (const resume of [false, true]) {
  test(`no archive restores ordinary loading with play intent ${resume} and never retries until reset`, async () => {
    const { coordinator, calls, resolve } = setup()
    const snapshot = { rendition: 'source', programDateTime: 1000 }
    coordinator.pause(snapshot)
    if (resume) coordinator.resume()
    resolve(null); await flush()
    assert.equal(coordinator.state.kind, 'unavailable')
    assert.equal(coordinator.state.error, null)
    assert.equal(coordinator.retained, false)
    assert.equal(coordinator.busy, false)
    assert.equal(calls.some(([name]) => name === 'load'), false)
    assert.deepEqual(calls.at(-1), ['restore', resume])
    coordinator.pause(snapshot)
    assert.equal(coordinator.resume(), false)
    assert.equal(calls.filter(([name]) => name === 'start').length, 1)
    await coordinator.cancel()
    coordinator.pause(snapshot); await flush()
    assert.equal(calls.filter(([name]) => name === 'start').length, 2)
  })
}

test('cancel invalidates a pending no-archive response without restoring old playback', async () => {
  const { coordinator, calls, resolve } = setup()
  coordinator.pause({ rendition: 'source', programDateTime: 1000 })
  await flush()
  coordinator.resume()
  await coordinator.cancel()
  resolve(null); await flush()
  assert.equal(coordinator.state.kind, 'idle')
  assert.equal(calls.some(([name]) => name === 'restore' || name === 'load'), false)
})

test('controls show neutral no-VOD status without claiming a temporary buffer or fixed quality', async () => {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Controls} from './src/renderer/src/components/Controls'; export const render=(props)=>renderToStaticMarkup(React.createElement(Controls,props));`, resolveDir: process.cwd() }, bundle: true, platform: 'node', packages: 'external', write: false, format: 'cjs' })
  const module = { exports: {} }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', 'React', output.outputFiles[0].text)(require, module, module.exports, require('react'))
  const base = { fullscreenTarget: { current: null }, ready: true, canStop: true, playing: false, dvr: { start: 0, end: 10, current: 10 }, vod: false, volume: 0.5, muted: false, levels: [{ index: 0, label: '720p60', bitrate: 3000000 }], activeLevel: 0, pinnedLabel: null }
  const unavailable = module.exports.render({ ...base, recording: { kind: 'unavailable', error: null } })
  assert.match(unavailable, /Live only · No VOD/)
  assert.doesNotMatch(unavailable, /Temporary buffer|Fixed|>Jump Live</)
  assert.doesNotMatch(unavailable, /Saved temporarily/)
  assert.match(unavailable, /disabled=""[^>]*>LIVE<\/button>/)
  const recording = module.exports.render({ ...base, recording: { kind: 'recording', error: null } })
  assert.match(recording, /Temporary buffer/)
  assert.match(recording, /Fixed/)
  assert.match(recording, />Jump Live</)
  const preparing = module.exports.render({ ...base, recording: { kind: 'preparing', error: null } })
  assert.match(preparing, /Preparing temporary buffer/)
  assert.match(preparing, />Jump Live</)
})

test('cancel and start another channel rejects old preparation without stopping the new recording', async () => {
  const { coordinator, calls, resolve } = setup()
  coordinator.pause({ rendition: 'old', programDateTime: 1000 }); await flush()
  await coordinator.cancel()
  coordinator.pause({ rendition: 'new', programDateTime: 2000 }); await flush()
  resolve({ masterPlaylist: 'local', startAt: 5 }); await flush()
  assert.deepEqual(calls.filter(([name]) => name === 'start'), [['start', 'old', 1000], ['start', 'new', 2000]])
  assert.equal(calls.filter(([name]) => name === 'load').length, 1)
  assert.equal(calls.filter(([name]) => name === 'stop').length, 1)
})

test('recorded status errors retain playable recording state', async () => {
  const { coordinator, resolve } = setup()
  coordinator.pause({ rendition: 'source', programDateTime: 1000 })
  resolve({ masterPlaylist: 'local', startAt: 0 }); await flush()
  coordinator.reportError('Storage limit reached')
  assert.equal(coordinator.retained, true)
  assert.equal(coordinator.state.error, 'Storage limit reached')
})

test('Player recorded load honors zero offset, pause, selected rendition and original dated frame', async () => {
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', FRAG_LOADED: 'fragment', ERROR: 'error' }
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' }
    static instances = []
    handlers = new Map()
    levels = [{ attrs: { VIDEO: '720p60' }, height: 720, bitrate: 3000000 }]
    currentLevel = 0
    playingDate = new Date(1234000)
    constructor(options) { this.options = options; FakeHls.instances.push(this) }
    on(name, handler) { this.handlers.set(name, handler) }
    loadSource() {}
    attachMedia() {}
    stopLoad() { this.stopped = true }
    startLoad(...args) { this.started = args }
    destroy() { this.destroyed = true }
  }
  globalThis.__pauseTestHls = FakeHls
  const output = await build({ entryPoints: ['src/renderer/src/player/hls.ts'], bundle: true, write: false, format: 'esm',
    plugins: [{ name: 'fake-hls', setup(b) {
      b.onResolve({ filter: /^hls\.js\/light$/ }, () => ({ path: 'hls', namespace: 'fake' }))
      b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export default globalThis.__pauseTestHls' }))
    } }] })
  const { Player } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
  let plays = 0
  const player = new Player({ currentTime: 200, seekable: { length: 1, start: () => 0, end: () => 600 }, buffered: { length: 0 }, play: async () => plays++ }, { onLevels() {}, onLevelSwitch() {}, onError() {}, onStale() {} })
  player.load('#EXTM3U', 0, { autoplay: false, recorded: true })
  const hls = FakeHls.instances.at(-1)
  hls.handlers.get('manifest')(null, { levels: hls.levels })
  assert.equal(plays, 0)
  assert.equal(hls.options.startPosition, 0)
  assert.deepEqual(player.pauseSnapshot(), { rendition: '720p60', programDateTime: 1234000 })
  player.suspendLoading()
  assert.equal(hls.stopped, true)
  hls.latestLevelDetails = { fragmentStart: 120, edge: 600 }
  assert.deepEqual(player.seekableWindow(), { start: 120, end: 600, current: 200 })
  hls.handlers.get('error')(null, { fatal: true, type: 'network', details: 'fragment failed', response: { code: 404 } })
  player.seekTo(210)
  assert.deepEqual(hls.started, [210, true])
  assert.equal(hls.destroyed, undefined)
  player.destroy()
})
