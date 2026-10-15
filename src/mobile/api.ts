import type { SlipstreamApi } from '../preload/index'
import type { AuthStatus, ResolveResult } from '@shared/types'
import { parseChannelInput, parseWatchInput } from '@shared/channel'
import { channelSummaries, channelVods, liveMaster, vodComments, vodInfo, vodMaster, vodStoryboard } from '../main/twitch'
import { fetchEmotes } from '../main/emotes'

/**
 * The preload bridge, for Android: the same surface the renderer already calls,
 * answered by the same modules main uses, minus everything that needs a desktop.
 *
 * - No streamlink: live and VOD both resolve straight from Twitch, which on the
 *   desktop is only the first try. A failure here has no fallback to fall to.
 * - No vod-access grant: MainActivity serves the VOD CDN with the CORS header
 *   itself, for every request, since a WebView has no per-response hook.
 * - No sign-in yet: chat stays anonymous, as it is on the desktop by default.
 */

const FAVOURITES_KEY = 'slipstream:favourites'

function readFavourites(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeFavourites(next: string[]): string[] {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next))
  } catch {
    // Keep going; the list is still right for this session.
  }
  return next
}

const UNREACHABLE: ResolveResult = {
  ok: false,
  reason: 'error',
  message: 'Could not reach Twitch. Check the connection and try again.'
}

async function resolve(input: string): Promise<ResolveResult> {
  const target = parseWatchInput(input)
  if (!target)
    return { ok: false, reason: 'invalid_channel', message: 'That does not look like a channel name or a VOD link.' }

  if (target.kind === 'channel') {
    const { login } = target
    const live = await liveMaster(login)
    if (!live) return UNREACHABLE
    if (live.state !== 'live')
      return live.state === 'missing'
        ? { ok: false, reason: 'not_found', message: `There is no channel called "${login}".` }
        : { ok: false, reason: 'offline', message: `${login} is not live right now.` }
    return {
      ok: true,
      stream: { kind: 'live', channel: live.meta, masterPlaylist: live.master, resolvedAt: Date.now() }
    }
  }

  const { id } = target
  const [master, info] = await Promise.all([vodMaster(id), vodInfo(id)])
  if (!master) {
    if (info?.restricted)
      return {
        ok: false,
        reason: 'restricted',
        message: 'That VOD is subscriber-only, so Twitch will not serve it to an anonymous viewer.'
      }
    return info ? UNREACHABLE : { ok: false, reason: 'not_found', message: 'There is no such VOD.' }
  }
  const storyboard = info?.seekPreviews ? await vodStoryboard(info.seekPreviews) : null

  return {
    ok: true,
    stream: {
      kind: 'vod',
      video: {
        id,
        durationSeconds: info?.lengthSeconds ?? null,
        recordedAt: info?.recordedAt ?? null,
        storyboard
      },
      channel: {
        id,
        login: info?.login ?? '',
        author: info?.display ?? '',
        title: info?.title ?? '',
        category: info?.category ?? ''
      },
      masterPlaylist: master,
      resolvedAt: Date.now()
    }
  }
}

const SIGNED_OUT: AuthStatus = {
  state: 'needs_client_id',
  user: null,
  scopes: [],
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: 'Signing in is not in the Android build yet. Chat works anonymously.',
  persistent: false
}
const authStatus = (): Promise<AuthStatus> => Promise.resolve(SIGNED_OUT)

export const mobileApi: SlipstreamApi = {
  resolve,
  release: () => Promise.resolve(),
  vodComments,
  vods: (login) => {
    const parsed = parseChannelInput(login)
    return parsed ? channelVods(parsed) : Promise.resolve([])
  },
  fetchEmotes: (channel, providers) =>
    fetchEmotes(channel, providers).catch((err: Error) => ({
      emotes: {},
      counts: { '7tv': 0, bttv: 0, ffz: 0 },
      errors: [err.message]
    })),
  favourites: {
    list: () => Promise.resolve(readFavourites()),
    add: (raw) => {
      const login = parseChannelInput(raw)
      const current = readFavourites()
      return Promise.resolve(login && !current.includes(login) ? writeFavourites([...current, login]) : current)
    },
    remove: (raw) => {
      const login = parseChannelInput(raw)
      return Promise.resolve(writeFavourites(readFavourites().filter((c) => c !== login)))
    },
    summaries: (logins) => channelSummaries(logins.slice(0, 200))
  },
  appInfo: () =>
    Promise.resolve({ version: __APP_VERSION__, electron: '', chrome: '', node: '', streamlink: null }),
  auth: {
    status: authStatus,
    begin: authStatus,
    cancel: authStatus,
    signOut: authStatus,
    setClientId: authStatus,
    chatCredentials: () => Promise.resolve(null),
    onChanged: () => () => {}
  },
  memory: () => Promise.resolve([])
}
