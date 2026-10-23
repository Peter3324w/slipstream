import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelVods } from '../src/main/twitch.ts'

test('broadcast cards receive thumbnails and game metadata without mixing older highlights', async (t) => {
  const node = { id: '123', title: 'An evening stream', lengthSeconds: 3600, createdAt: '2026-10-20T12:00:00Z', viewCount: 1200,
    previewThumbnailURL: 'https://example.com/preview.jpg', game: { displayName: 'Chess' }, self: { isRestricted: true } }
  let query
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    query = JSON.parse(options.body).query
    return new Response(JSON.stringify({ data: { user: {
      archive: { edges: [{ node }] },
      highlight: { edges: [{ node: { ...node, id: 'old', createdAt: '2026-10-19T12:00:00Z' } }] }
    } } }))
  })
  const result = await channelVods('example')
  assert.match(query, /previewThumbnailURL/)
  assert.match(query, /game\s*\{\s*displayName/)
  assert.equal(result.length, 1)
  assert.equal(result[0].thumbnail, node.previewThumbnailURL)
  assert.equal(result[0].game, 'Chess')
  assert.equal(result[0].restricted, true)
  assert.equal(result[0].kind, 'archive')
})
