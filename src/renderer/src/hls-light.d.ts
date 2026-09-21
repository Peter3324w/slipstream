/**
 * hls.js exports a "light" build (no DRM, no subtitle rendering, no alternate
 * audio tracks) but ships typings only for the full one. Twitch uses none of the
 * three, so we take the smaller build and reuse the published types, which
 * describe the same public API.
 */
declare module 'hls.js/light' {
  import Hls from 'hls.js'
  export * from 'hls.js'
  export default Hls
}
