import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

// Exercise the real Player with the browser-only HLS transport replaced.
class FakeHls {
  static Events = { MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', FRAG_LOADED: 'fragment', ERROR: 'error', LEVEL_LOADING: 'loading', LEVEL_UPDATED: 'updated' }
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' }
  static instances = []
  levels = []
  handlers = new Map()
  destroyed = false
  starts = []
  stops = 0
  bufferingEnabled = true
  constructor() { FakeHls.instances.push(this) }
  on(event, handler) { this.handlers.set(event, handler) }
  once(event, handler) { this.handlers.set(event, (...args) => { this.handlers.delete(event); handler(...args) }) }
  loadSource() {}
  attachMedia() {}
  destroy() { this.destroyed = true }
  stopLoad() { this.stops++ }
  startLoad(...args) {
    this.bufferingEnabled = true
    this.starts.push(args)
    // Like HLS, a future poll deadline defers LEVEL_LOADING past the initial tick.
    if (this.levels.every((level) => level.details.requestScheduled <= performance.now())) {
      this.handlers.get(FakeHls.Events.LEVEL_LOADING)?.()
    }
  }
  pauseBuffering() { this.bufferingEnabled = false }
  resumeBuffering() { this.bufferingEnabled = true }
}
globalThis.__refreshTestHls = FakeHls
const result = await build({
  entryPoints: ['src/renderer/src/player/hls.ts'], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'fake-hls', setup(b) {
    b.onResolve({ filter: /^hls\.js\/light$/ }, () => ({ path: 'hls', namespace: 'fake' }))
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export default globalThis.__refreshTestHls' }))
  } }]
})
const { Player } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)

const variant = (group, url) => `#EXT-X-STREAM-INF:BANDWIDTH=3000000,VIDEO="${group}",CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000\n${url}`
function setup(onStale = () => {}) {
  const video = { currentTime: 75, paused: true, buffered: { length: 1 } }
  const player = new Player(video, { onLevels() {}, onLevelSwitch() {}, onError() {}, onStale })
  player.load('#EXTM3U')
  const hls = FakeHls.instances.at(-1)
  hls.levels = ['720p60', 'chunked'].map((VIDEO) => ({
    attrs: { VIDEO, CODECS: 'avc1.64002A,mp4a.40.2', RESOLUTION: '1280x720', 'FRAME-RATE': '60.000' },
    url: [`https://old.example/${VIDEO}.m3u8`], details: { timeline: 'retained', requestScheduled: Infinity }
  }))
  return { player, video, hls }
}

test('renewing live URLs retains the player, DVR buffer, position, pause and rendition timelines', () => {
  const { player, video, hls } = setup()
  const buffer = video.buffered
  const details = hls.levels[0].details
  const manifest = '#EXTM3U\n' + variant('chunked', 'https://new.example/source.m3u8') + '\n' + variant('720p60', 'https://new.example/720.m3u8')
  assert.equal(player.renewLiveUrls(manifest), true)
  assert.equal(hls.levels[0].url[0], 'https://new.example/720.m3u8')
  assert.equal(hls.levels[1].url[0], 'https://new.example/source.m3u8')
  assert.equal(hls.destroyed, false)
  assert.equal(video.currentTime, 75)
  assert.equal(video.paused, true)
  assert.equal(video.buffered, buffer)
  assert.equal(hls.levels[0].details, details)
  assert.deepEqual(hls.starts, [[75, true]])
  player.destroy()
})

test('a missing or changed rendition refuses renewal before changing any URLs', () => {
  const { player, hls } = setup()
  assert.equal(player.renewLiveUrls('#EXTM3U\n' + variant('720p60', 'https://new.example/720.m3u8')), false)
  assert.equal(hls.levels[0].url[0], 'https://old.example/720p60.m3u8')
  assert.equal(hls.stops, 0)
  player.destroy()
})

test('a stopped player cannot renew an old stream', () => {
  const { player } = setup()
  player.destroy()
  assert.equal(player.renewLiveUrls('#EXTM3U'), false)
})

test('renewal re-arms expiry recovery without starting duplicate refreshes', () => {
  let refreshes = 0
  const { player, hls, video } = setup(() => refreshes++)
  const expired = () => hls.handlers.get(FakeHls.Events.ERROR)(null, { response: { code: 403 } })
  expired()
  expired()
  assert.equal(refreshes, 1)
  const manifest = '#EXTM3U\r\n' + ['720p60', 'chunked'].map((group) => variant(group, `https://new.example/${group}.m3u8`)).join('\r\n')
  video.paused = false
  assert.equal(player.renewLiveUrls(manifest), true)
  assert.equal(video.paused, false)
  expired()
  assert.equal(refreshes, 2)
  player.destroy()
})

test('renewal rejects incompatible codecs even when the Twitch quality name matches', () => {
  const { player, hls } = setup()
  const manifest = '#EXTM3U\n' + ['720p60', 'chunked'].map((group) => variant(group, `https://new.example/${group}.m3u8`)).join('\n')
  assert.equal(player.renewLiveUrls(manifest.replaceAll('avc1.64002A', 'hvc1.1.6.L120.B0')), false)
  assert.equal(hls.destroyed, false)
  assert.equal(hls.stops, 0)
  player.destroy()
})

test('renewal waits for fresh playlist fragments before allowing segment downloads', () => {
  const { player, hls } = setup()
  const manifest = '#EXTM3U\n' + ['720p60', 'chunked'].map((group) => variant(group, `https://new.example/${group}.m3u8`)).join('\n')
  assert.equal(player.renewLiveUrls(manifest), true)
  assert.equal(hls.bufferingEnabled, false)
  hls.handlers.get(FakeHls.Events.LEVEL_UPDATED)?.()
  assert.equal(hls.bufferingEnabled, true)
  player.destroy()
})
