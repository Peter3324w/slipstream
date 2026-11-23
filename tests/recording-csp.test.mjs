import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentSecurityPolicy } from '../src/main/csp.ts'

test('recording connections allow only the server origin chosen before the window opens', () => {
  const policy = contentSecurityPolicy('http://127.0.0.1:43210')
  assert.match(policy, /connect-src[^;]* http:\/\/127\.0\.0\.1:43210(?:;|$)/)
  assert.doesNotMatch(policy, /127\.0\.0\.1:\*/)
  for (const invalid of ['http://localhost:43210', 'https://example.com', 'http://127.0.0.1:12; script-src *']) {
    assert.equal(contentSecurityPolicy(invalid), contentSecurityPolicy())
  }
})
