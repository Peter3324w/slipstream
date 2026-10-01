/**
 * The one place VOD playback needs the app to bend, and how far it bends.
 *
 * Measured against a live VOD (summit1g 2888339949, 14h):
 *
 * |                | master            | media playlist     | segments           |
 * | live           | no ACAO           | `*`                | `*`                |
 * | VOD            | no ACAO           | **none**           | **none**, 403 OPTIONS |
 *
 * Live works because `*.playlist.ttvnw.net` and `*.hls.ttvnw.net` both send
 * `access-control-allow-origin: *`, so main only has to fetch the master (see
 * ResolvedStream.masterPlaylist) and the renderer reads everything below it
 * directly. VODs come off a plain CloudFront distribution - the host differs per
 * VOD - that sends no CORS headers at all, so the renderer cannot read a single
 * segment it fetched itself. The master trick is not enough one level down.
 *
 * The alternatives were relaying every segment through main over IPC, or a custom
 * protocol doing the same: both put megabytes a second of copying on the hot path
 * of the one app whose whole point is not doing that. So instead the response gets
 * the header it is missing - for exactly one directory, the one the VOD being
 * watched lives in, revoked as soon as another is resolved.
 *
 * Nothing here opens a door the renderer did not already have: it can request
 * these URLs today, it just cannot read the answer. The scope is the narrow part.
 */

/** Absolute URL prefixes - the directory each media playlist sits in. */
let allowed: string[] = []

/**
 * Register the CDN directory this VOD streams from, read off its master playlist.
 *
 * Every media playlist URI in a Twitch master is absolute, and the segments sit
 * beside their playlist as relative names (`0.mp4`), so the directory covers the
 * whole VOD and nothing else.
 */
export function allowVod(masterPlaylist: string): void {
  const next = new Set<string>()
  for (const line of masterPlaylist.split('\n')) {
    const uri = line.trim()
    if (!uri.startsWith('https://')) continue
    try {
      const url = new URL(uri)
      next.add(url.origin + url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1))
    } catch {
      // A line that is not a URL is not our business.
    }
  }
  allowed = [...next]
}

/** Called when playback stops, so the grant does not outlive what needed it. */
export function clearVodAccess(): void {
  allowed = []
}

export function vodRequestAllowed(url: string): boolean {
  return allowed.some((prefix) => url.startsWith(prefix))
}

/** Origins to add to the CSP's connect-src while a VOD is loaded. */
export function vodConnectSources(): string[] {
  const origins = new Set<string>()
  for (const prefix of allowed) {
    try {
      origins.add(new URL(prefix).origin)
    } catch {
      /* unreachable: these came from a URL */
    }
  }
  return [...origins]
}
