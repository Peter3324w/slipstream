import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/main/live-archive.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { archiveOrigin, LiveArchiveBuffer } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const epoch = Date.parse('2026-11-22T12:00:00Z')
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,VIDEO="audio_only"\nhttps://example.test/audio/index.m3u8\n'

test('archive origin subtracts durations before the first date and checks later dates', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10,\na.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:10Z\n#EXTINF:10,\nb.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:20Z\n#EXTINF:10,\nc.ts\n'))
  assert.equal(await archiveOrigin(master), epoch)
})

test('unusable or contradictory archive clocks never fall back to creation time', async t => {
  let media
  t.mock.method(globalThis, 'fetch', async () => new Response(media))
  for (const invalid of [
    '#EXTM3U\n#EXTINF:10,\na.ts\n',
    '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:00Z\n#EXTINF:10,\na.ts\n',
    '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:00Z\n#EXTINF:10,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\nb.ts\n',
    '#EXTM3U\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:00Z\n#EXTINF:10,\na.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:01:00Z\n#EXTINF:10,\nb.ts\n'
  ]) {
    media = invalid
    assert.equal(await archiveOrigin(master), null)
  }
})

function setup(options = {}) {
  const calls = []
  const recorder = { start: async (...args) => { calls.push(['start', ...args]); return { masterPlaylist: 'local', startAt: 1 } }, stop: async () => { calls.push(['stop']) } }
  const service = new LiveArchiveBuffer(recorder, {
    lookup: async () => ({ id: '123', masterPlaylist: master }), origin: async () => epoch,
    renew: async id => { calls.push(['renew', id]); return 'renewed-master' }, ...options
  })
  return { calls, recorder, service }
}

test('missing current archive or usable clock makes zero recorder starts', async () => {
  for (const options of [{ lookup: async () => null }, { origin: async () => null }]) {
    const { calls, service } = setup(options)
    assert.equal(await service.start({ login: 'faide', streamId: 'live' }, 'source', epoch), null)
    assert.equal(calls.some(call => call[0] === 'start'), false)
  }
})

test('only selected VOD master reaches the recorder and renewal stays pinned to that VOD', async () => {
  const { calls, service } = setup()
  await service.start({ login: 'agurin', streamId: 'live' }, 'source', epoch + 1000)
  assert.deepEqual(calls.find(call => call[0] === 'start'), ['start', master, 'source', epoch + 1000, { originDate: epoch }])
  // The stream may end after start. Renewal must not ask for another ongoing archive.
  assert.equal(await service.renewMaster(), 'renewed-master')
  assert.deepEqual(calls.at(-1), ['renew', '123'])
})

test('stop during metadata lookup prevents late disk work on the same channel', async () => {
  let release
  const lookup = new Promise(resolve => { release = resolve })
  const { calls, service } = setup({ lookup: () => lookup })
  const pending = service.start({ login: 'agurin', streamId: 'live' }, 'source', epoch)
  await new Promise(resolve => setImmediate(resolve))
  await service.stop()
  release({ id: '123', masterPlaylist: master })
  await assert.rejects(pending, /cancel/i)
  assert.equal(calls.some(call => call[0] === 'start'), false)
})

test('an old renewal result cannot be installed after source cancellation', async () => {
  let release
  const { service } = setup({ renew: () => new Promise(resolve => { release = resolve }) })
  await service.start({ login: 'agurin', streamId: 'live' }, 'source', epoch)
  const renewal = service.renewMaster()
  await service.stop()
  release('old master')
  await assert.rejects(renewal, /cancel/i)
})

test('stop during archive clock lookup does not start any media work', async () => {
  let release
  const { calls, service } = setup({ origin: () => new Promise(resolve => { release = resolve }) })
  const pending = service.start({ login: 'agurin', streamId: 'live' }, 'source', epoch)
  await new Promise(resolve => setImmediate(resolve))
  await service.stop()
  release(epoch)
  await assert.rejects(pending, /cancel/i)
  assert.equal(calls.some(call => call[0] === 'start'), false)
})

test('stop during disk preparation prevents a late result from reaching the player', async () => {
  let release
  const { recorder, service } = setup()
  recorder.start = () => new Promise(resolve => { release = resolve })
  const pending = service.start({ login: 'agurin', streamId: 'live' }, 'source', epoch)
  await new Promise(resolve => setImmediate(resolve))
  await service.stop()
  release({ masterPlaylist: 'old', startAt: 0 })
  await assert.rejects(pending, /cancel/i)
})
