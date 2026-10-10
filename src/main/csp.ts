/**
 * The renderer's content security policy.
 *
 * A constant, and it has to be: a document's policy is whatever arrived with the
 * document. This used to be rebuilt per response with the current VOD's host
 * appended, which changed nothing - the page had been loaded long before any VOD
 * was picked, so its connect-src never grew, every VOD request was refused, and
 * the player retried in silence. It did not fail in dev, where the policy is not
 * applied at all; it failed in the packaged build, in front of the user.
 *
 * So the policy names the whole VOD CDN, and the narrowing to the one directory
 * being watched is done where it can actually change: the request guard in
 * index.ts, driven by vod-access.ts.
 *
 * - media/connect blob:  the master playlist is handed over as a Blob (see types.ts)
 * - *.ttvnw.net          playlists and live video segments
 * - *.cloudfront.net     VOD playlists and segments; the host differs per VOD
 * - static-cdn.jtvnw.net first-party emote images
 * - irc-ws.chat          anonymous chat
 */

/** Where Twitch serves VODs from. Ten channels sampled, archives to uploads: all here. */
export const VOD_CDN = 'https://*.cloudfront.net'

export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://static-cdn.jtvnw.net https://cdn.7tv.app https://cdn.betterttv.net https://cdn.frankerfacez.com",
    "media-src 'self' blob:",
    `connect-src 'self' blob: https://*.ttvnw.net ${VOD_CDN} wss://irc-ws.chat.twitch.tv`,
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; ')
}
