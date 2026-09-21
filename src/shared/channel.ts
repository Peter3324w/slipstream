/**
 * Twitch login rules: 4-25 chars, alphanumeric + underscore. We accept 1 char
 * because a handful of legacy channels are shorter than the current minimum.
 *
 * This runs before the name reaches a URL or an argv entry. `execFile` without a
 * shell already makes injection a non-issue, but a bad name should fail here with
 * a clear message rather than deeper down as a confusing network error.
 */
const LOGIN = /^[A-Za-z0-9_]{1,25}$/

/** Accepts a bare name, a twitch.tv URL, or something pasted with whitespace. */
export function parseChannelInput(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null

  // strip a URL down to its first path segment
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([^/?#]+)/i)
  if (m) s = m[1]

  s = s.replace(/^@/, '')
  if (!LOGIN.test(s)) return null
  return s.toLowerCase()
}
