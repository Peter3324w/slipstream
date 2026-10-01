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

/** A VOD id as Twitch writes it: digits, and plenty of room to grow. */
const VIDEO_ID = /^\d{1,15}$/

/**
 * What the user asked to watch. A VOD is a different resolve, a different CORS
 * story and a different player mode, so the two are separated once, here, rather
 * than being guessed at further in.
 */
export type WatchTarget = { kind: 'channel'; login: string } | { kind: 'vod'; id: string }

/**
 * Accepts everything parseChannelInput does, plus a VOD: `twitch.tv/videos/123`,
 * or a bare `videos/123`.
 *
 * Deliberately NOT a bare number: Twitch logins may be all digits, so "123456"
 * is a channel and there is no way to tell it from a video id without asking.
 */
export function parseWatchInput(raw: string): WatchTarget | null {
  const s = raw.trim()

  const video = s.match(/^(?:(?:https?:\/\/)?(?:www\.)?twitch\.tv\/)?videos\/(\d+)(?:[?#].*)?$/i)
  if (video) return VIDEO_ID.test(video[1]) ? { kind: 'vod', id: video[1] } : null

  const login = parseChannelInput(s)
  return login ? { kind: 'channel', login } : null
}
