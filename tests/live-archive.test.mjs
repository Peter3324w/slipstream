import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as twitch from '../src/main/twitch.ts'

function setup(t) {
  const context = {
    stream: { id: 'live-123', archiveVideo: { id: '456', status: 'RECORDING', broadcastType: 'ARCHIVE', owner: { login: 'agurin' }, self: { isRestricted: false } } },
    tokens: 0
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://usher.ttvnw.net/')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:VIDEO="chunked",BANDWIDTH=1000000\nhttps://cdn.test/source.m3u8\n')
    const body = JSON.parse(options.body)
    if (body.query.includes('videoPlaybackAccessToken')) {
      context.tokens++
      return Response.json({ data: { videoPlaybackAccessToken: { value: '{}', signature: 'test-signature' } } })
    }
    assert.match(body.query, /archiveVideo/)
    assert.equal(body.variables.login, 'agurin')
    return Response.json({ data: { user: { stream: context.stream } } })
  })
  return context
}

test('uses the current stream archiveVideo rather than guessing from the latest video', async t => {
  const context = setup(t)
  const result = await twitch.ongoingArchive('agurin', 'live-123')
  assert.equal(result.id, '456')
  assert.match(result.masterPlaylist, /#EXTM3U/)
  assert.equal(context.tokens, 1)
})

test('no current archive, changed stream, foreign owner or restricted VOD resolves no video token', async t => {
  const context = setup(t)
  const original = structuredClone(context.stream)
  for (const mutate of [
    stream => { stream.archiveVideo = null },
    stream => { stream.id = 'a-new-broadcast' },
    stream => { stream.archiveVideo.owner.login = 'another-channel' },
    stream => { stream.archiveVideo.self.isRestricted = true },
    stream => { stream.archiveVideo.status = 'RECORDED' },
    stream => { stream.archiveVideo.broadcastType = 'HIGHLIGHT' }
  ]) {
    context.stream = structuredClone(original)
    mutate(context.stream)
    assert.equal(await twitch.ongoingArchive('agurin', 'live-123'), null)
  }
  context.stream = null
  assert.equal(await twitch.ongoingArchive('agurin', 'live-123'), null)
  assert.equal(context.tokens, 0)
})
