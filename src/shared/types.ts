/** Contract between the main process and the renderer. Keep it serialisable. */

export interface ChannelMeta {
  /** Twitch stream id, not the user id. */
  id: string
  /** Lowercased channel name, as typed. */
  login: string
  /** Display name, e.g. "xQc". */
  author: string
  title: string
  category: string
}

export interface ResolvedStream {
  channel: ChannelMeta
  /**
   * The raw master playlist. The renderer turns this into a Blob URL for hls.js.
   *
   * Why the text and not the URL: usher.ttvnw.net serves the master WITHOUT an
   * `access-control-allow-origin` header, so the renderer cannot fetch it. The
   * per-quality media playlists and the segments DO send `ACAO: *`, and every URI
   * inside the master is absolute, so once hls.js has the manifest body everything
   * downstream loads normally. Main fetches it; Node has no CORS.
   */
  masterPlaylist: string
  /** Epoch ms. The signed URLs inside the manifest expire; we re-resolve on error. */
  resolvedAt: number
}

export type ResolveFailure =
  | 'offline'
  | 'not_found'
  | 'streamlink_missing'
  | 'invalid_channel'
  | 'error'

export type ResolveResult =
  | { ok: true; stream: ResolvedStream }
  | { ok: false; reason: ResolveFailure; message: string }

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  streamlink: string | null
}

/** Per-process memory, for the measurement this whole project exists to make. */
export interface MemorySample {
  pid: number
  type: string
  /** Resident set size in bytes. */
  bytes: number
}
