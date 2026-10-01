/**
 * The renderer's content security policy.
 *
 * A function of its extra connect sources rather than a constant, because a VOD
 * streams from a per-VOD CloudFront host that cannot be known in advance (see
 * vod-access.ts). It lives apart from index.ts so it can be checked without
 * starting Electron: getting this wrong does not fail in dev, where the policy is
 * not applied at all - it fails in the packaged build, in front of the user.
 *
 * - media/connect blob:  the master playlist is handed over as a Blob (see types.ts)
 * - *.ttvnw.net          playlists and video segments
 * - static-cdn.jtvnw.net first-party emote images
 * - irc-ws.chat          anonymous chat
 */
export function contentSecurityPolicy(extraConnect: string[] = []): string {
  const extra = extraConnect.length ? ' ' + extraConnect.join(' ') : ''
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com",
    "media-src 'self' blob:",
    `connect-src 'self' blob: https://*.ttvnw.net wss://irc-ws.chat.twitch.tv${extra}`,
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; ')
}
