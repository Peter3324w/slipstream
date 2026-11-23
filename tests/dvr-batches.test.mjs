import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TemporaryDvr } from '../src/main/dvr.ts'

const epoch = Date.parse('2026-11-22T12:00:00Z')
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,VIDEO="source"\nhttps://archive.test/video.m3u8\n'
const media = (count, { ended = false, dated = true, first = 0, discontinuity = -1, shift = 0 } = {}) => '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:' + first + '\n' + Array.from({ length: count }, (_, i) => `${discontinuity === i ? '#EXT-X-DISCONTINUITY\n' : ''}${dated ? '#EXT-X-PROGRAM-DATE-TIME:' + new Date(epoch + (first + i) * 10000 + shift).toISOString() + '\n' : ''}#EXTINF:10,\nhttps://archive.test/${first + i}.ts\n`).join('') + (ended ? '#EXT-X-ENDLIST\n' : '')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await wait(5) } assert.fail('condition timed out') }
const url = result => result.masterPlaylist.split('\n').find(line => line.startsWith('http:'))
async function fixture(t, source, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'slipstream-batches-'))
  const root = join(parent, 'media')
  const requests = []
  const dvr = new TemporaryDvr(root, { pollMs: 5, initialWaitMs: 45, ...options, fetch: async (input, init) => { requests.push(String(input)); return source(String(input), init) } })
  t.after(async () => { await dvr.dispose(); await rm(parent, { recursive: true, force: true }) })
  await dvr.initialize()
  return { dvr, root, requests, start: paused => dvr.start(master, 'source', epoch + paused * 1000, { originDate: epoch }) }
}

test('five minutes beyond the exact paused frame stop all source requests during a 49 minute pause and refill at one minute remaining', async t => {
  let published = 400
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? 'saved' : media(published)))
  const result = await f.start(12.5)
  assert.equal(result.startAt, 2.5)
  const segments = f.requests.filter(s => s.endsWith('.ts'))
  assert.equal(segments.length, 31)
  assert.match(segments[0], /\/1.ts$/)
  const full = f.requests.length
  published += 294 // Archive grows by 49 minutes while playback stays paused.
  await wait(65)
  assert.equal(f.requests.length, full)
  f.dvr.updatePosition(249.9)
  await wait(20)
  assert.equal(f.requests.length, full)
  f.dvr.updatePosition(250)
  await until(() => f.requests.filter(s => s.endsWith('.ts')).length === 61)
  const filled = f.requests.length
  await wait(35)
  assert.equal(f.requests.length, filled)
  assert.equal(f.dvr.status().error, null)
})

test('ended archive stays refillable for multiple batches and ENDLIST appears only when its real end is cached', async t => {
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? 'saved' : media(85, { ended: true })))
  const result = await f.start(0)
  assert.equal(f.requests.filter(s => s.endsWith('.ts')).length, 30)
  assert.doesNotMatch(await (await fetch(url(result))).text(), /ENDLIST/)
  f.dvr.updatePosition(240)
  await until(() => f.requests.filter(s => s.endsWith('.ts')).length === 60)
  assert.doesNotMatch(await (await fetch(url(result))).text(), /ENDLIST/)
  f.dvr.updatePosition(540)
  await until(() => !f.dvr.status().active)
  assert.equal(f.requests.filter(s => s.endsWith('.ts')).length, 85)
  assert.match(await (await fetch(url(result))).text(), /ENDLIST/)
})

test('growing archive fills the pending five minute goal then suspends playlist requests', async t => {
  let count = 2
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? 'saved' : media(count)))
  await f.start(5)
  assert.equal(f.requests.filter(s => s.endsWith('.ts')).length, 2)
  count = 35
  await until(() => f.requests.filter(s => s.endsWith('.ts')).length === 31)
  const full = f.requests.length
  await wait(40)
  assert.equal(f.requests.length, full)
})

test('initial archive publication lag waits for the exact frame with no earlier media downloads', async t => {
  let polls = 0
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? 'saved' : media(++polls < 3 ? 2 : 40)))
  const result = await f.start(25)
  assert.equal(result.startAt, 5)
  assert.match(f.requests.find(s => s.endsWith('.ts')), /\/2.ts$/)
})

test('publication lag has a bounded deadline and stop cancels the wait and deletes its session', async t => {
  const f = await fixture(t, async () => new Response(media(2)))
  await assert.rejects(f.start(25), /archive|published|available/i)
  assert.equal(f.requests.some(s => s.endsWith('.ts')), false)
  const pending = f.start(25)
  const rejected = assert.rejects(pending, /cancel|abort/i)
  await wait(10)
  await f.dvr.stop()
  await rejected
  assert.deepEqual(await readdir(f.root), [])
})

test('undated continuous sequence-zero archive maps origin and preserves exact segment bytes', async t => {
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? input : media(40, { dated: false })))
  const result = await f.start(12.5)
  assert.equal(result.startAt, 2.5)
  assert.equal(await (await fetch(new URL('1.ts', url(result)))).text(), 'https://archive.test/1.ts')
  assert.match(await (await fetch(url(result))).text(), /2026-11-22T12:00:10.000Z/)
})

for (const [name, options] of [['sliding undated', { dated: false, first: 1 }], ['undated discontinuity', { dated: false, discontinuity: 2 }], ['wrong rendition dates', { shift: 60000 }]]) {
  test(`rejects ${name} before downloading media`, async t => {
    const f = await fixture(t, async () => new Response(media(40, options)))
    await assert.rejects(f.start(65), /timeline|origin|discontinuity/i)
    assert.equal(f.requests.some(s => s.endsWith('.ts')), false)
  })
}

test('malformed explicit program dates cannot be replaced with the archive origin', async t => {
  const f = await fixture(t, async () => new Response(media(40).replace(/#EXT-X-PROGRAM-DATE-TIME:[^\n]+/, '#EXT-X-PROGRAM-DATE-TIME:invalid')))
  await assert.rejects(f.start(5), /timeline|date/i)
  assert.equal(f.requests.some(s => s.endsWith('.ts')), false)
})

test('initial publication deadline also bounds a stalled playlist request', async t => {
  const f = await fixture(t, async (_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })), { initialWaitMs: 25 })
  let error
  const pending = f.start(25).catch(reason => { error = reason })
  await wait(100)
  assert.match(error?.message ?? 'still waiting', /archive|published|available/i)
  await pending
})

test('whitespace cannot hide a nonzero sequence or discontinuity from origin validation', async t => {
  for (const options of [{ first: 1 }, { discontinuity: 2 }]) {
    const f = await fixture(t, async () => new Response(media(40, { dated: false, ...options }).split('\n').map(line => '  ' + line).join('\n')))
    await assert.rejects(f.start(25), /timeline/i)
    assert.equal(f.requests.some(s => s.endsWith('.ts')), false)
  }
})

test('explicitly dated discontinuities map the paused frame regardless of tag order', async t => {
  const source = media(40, { discontinuity: 2 }).replace(/#EXT-X-DISCONTINUITY\n(#EXT-X-PROGRAM-DATE-TIME:[^\n]+\n)/, '$1#EXT-X-DISCONTINUITY\n')
  const f = await fixture(t, async input => new Response(input.endsWith('.ts') ? 'saved' : source))
  const result = await f.start(25)
  assert.equal(result.startAt, 5)
  assert.match(f.requests.find(s => s.endsWith('.ts')), /\/2.ts$/)
})
