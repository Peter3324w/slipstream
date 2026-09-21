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

export type EmoteProvider = '7tv' | 'bttv' | 'ffz'

export const EMOTE_PROVIDERS: EmoteProvider[] = ['7tv', 'bttv', 'ffz']

/** One third-party emote, trimmed to what it takes to draw it. */
export interface Emote {
  name: string
  provider: EmoteProvider
  /** Ready to use. Format already chosen per provider - see emotes.ts. */
  url: string
  /** Tried first where it is smaller; falls back to `url` on a decode error. */
  altUrl?: string
  animated: boolean
  /** 0 when the provider does not report it (BTTV). */
  width: number
  height: number
}

export interface EmoteSet {
  emotes: Record<string, Emote>
  counts: Record<EmoteProvider, number>
  /** Non-fatal problems worth surfacing, e.g. a provider being unreachable. */
  errors: string[]
}

/** Scopes requested at sign-in. Read chat, send chat, list who you follow. */
export const AUTH_SCOPES = ['chat:read', 'chat:edit', 'user:read:follows'] as const

export interface TwitchUser {
  id: string
  login: string
  display: string
}

export type AuthState =
  /** No client id configured yet — the app cannot ask Twitch anything. */
  | 'needs_client_id'
  | 'signed_out'
  /** Device flow running: show the code and wait. */
  | 'pending'
  | 'signed_in'
  | 'error'

export interface AuthStatus {
  state: AuthState
  user: TwitchUser | null
  scopes: string[]
  /** Populated while `pending`. */
  userCode: string | null
  verificationUri: string | null
  expiresAt: number | null
  message: string | null
  /** False when the OS gave us no way to encrypt at rest; see auth.ts. */
  persistent: boolean
}
