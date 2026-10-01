import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { promisify } from 'node:util'
import type { ResolveResult, ResolvedStream } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { channelExistence, vodInfo } from './twitch'
import { allowVod } from './vod-access'

const run = promisify(execFile)

const IS_WIN = process.platform === 'win32'
const EXE = IS_WIN ? 'streamlink.exe' : 'streamlink'

/** Resolution can take a while on a cold DNS cache; it is not a hung process. */
const RESOLVE_TIMEOUT_MS = 30_000

let cachedBin: string | null | undefined

/**
 * Find streamlink without ever hardcoding a user directory — this repo is public.
 *   1. SLIPSTREAM_STREAMLINK override
 *   2. anything on PATH
 *   3. the winget install location, derived from %LOCALAPPDATA%
 *
 * Note we cannot just pass "streamlink" to execFile: on Windows, execFile without
 * a shell does not apply PATHEXT, so a bare name never resolves to the .exe.
 */
export function findStreamlink(): string | null {
  if (cachedBin !== undefined) return cachedBin

  const override = process.env.SLIPSTREAM_STREAMLINK
  if (override && existsSync(override)) return (cachedBin = override)

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, EXE)
    if (existsSync(candidate)) return (cachedBin = candidate)
  }

  if (IS_WIN && process.env.LOCALAPPDATA) {
    const winget = join(process.env.LOCALAPPDATA, 'Programs', 'Streamlink', 'bin', EXE)
    if (existsSync(winget)) return (cachedBin = winget)
  }

  return (cachedBin = null)
}

export async function streamlinkVersion(): Promise<string | null> {
  const bin = findStreamlink()
  if (!bin) return null
  try {
    const { stdout } = await run(bin, ['--version'], { timeout: 10_000 })
    return stdout.trim().replace(/^streamlink\s+/i, '')
  } catch {
    return null
  }
}

interface StreamlinkStream {
  type: string
  url: string
  master?: string
  headers?: Record<string, string>
}

interface StreamlinkJson {
  error?: string
  plugin?: string
  metadata?: { id?: string; author?: string; title?: string; category?: string }
  streams?: Record<string, StreamlinkStream>
}

/**
 * streamlink says "No playable streams found on this URL" for an offline channel
 * AND for one that does not exist, so that one message has to be disambiguated
 * elsewhere. If the lookup cannot answer, we say so rather than guessing.
 */
async function classify(message: string, login: string): Promise<ResolveResult & { ok: false }> {
  const m = message.toLowerCase()

  if (m.includes('no playable streams') || m.includes('unable to find channel') || m.includes('404')) {
    switch (await channelExistence(login)) {
      case 'missing':
        return { ok: false, reason: 'not_found', message: `There is no channel called "${login}".` }
      case 'live':
      case 'offline':
        return { ok: false, reason: 'offline', message: `${login} is not live right now.` }
      default:
        return {
          ok: false,
          reason: 'offline',
          message: `${login} is not live right now - or there is no such channel.`
        }
    }
  }

  return { ok: false, reason: 'error', message }
}

/** The one streamlink call, with its JSON recovered from a non-zero exit. */
async function askStreamlink(bin: string, url: string): Promise<StreamlinkJson | Error> {
  try {
    const { stdout } = await run(bin, ['--json', url], {
      timeout: RESOLVE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    return JSON.parse(stdout) as StreamlinkJson
  } catch (err) {
    // streamlink exits non-zero for an offline channel but still prints its JSON.
    const stdout = (err as { stdout?: string }).stdout
    if (stdout) {
      try {
        return JSON.parse(stdout) as StreamlinkJson
      } catch {
        /* fall through to the error */
      }
    }
    return err as Error
  }
}

/** Every stream entry carries the same master URL; take the first that has one. */
async function fetchMaster(streams: Record<string, StreamlinkStream>): Promise<string | Error> {
  const withMaster = Object.values(streams).find((s) => typeof s.master === 'string' && s.master)
  if (!withMaster?.master) return new Error('streamlink returned no master playlist.')
  try {
    const res = await fetch(withMaster.master, {
      headers: withMaster.headers ?? {},
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`master playlist responded ${res.status}`)
    return await res.text()
  } catch (err) {
    return new Error(`Could not fetch the playlist: ${(err as Error).message}`)
  }
}

/**
 * A finished broadcast. Same resolve as a channel - streamlink takes the video URL
 * and returns a master the same way - but the renderer cannot read what that master
 * points at until the CDN directory is allowed, which is why this registers it.
 * See vod-access.ts for the measurement behind that.
 */
export async function resolveVod(id: string): Promise<ResolveResult> {
  const bin = findStreamlink()
  if (!bin)
    return {
      ok: false,
      reason: 'streamlink_missing',
      message: 'streamlink was not found. Install it with:  winget install --id Streamlink.Streamlink'
    }

  // Asked for in parallel: it is only metadata, and streamlink is the slow half.
  const [parsed, info] = await Promise.all([
    askStreamlink(bin, `https://www.twitch.tv/videos/${id}`),
    vodInfo(id)
  ])

  if (parsed instanceof Error) return classifyVod(parsed.message, info?.restricted === true)
  if (parsed.error) return classifyVod(parsed.error, info?.restricted === true)

  const master = await fetchMaster(parsed.streams ?? {})
  if (master instanceof Error) return { ok: false, reason: 'error', message: master.message }

  allowVod(master)

  const meta = parsed.metadata ?? {}
  return {
    ok: true,
    stream: {
      kind: 'vod',
      video: {
        id,
        durationSeconds: info?.lengthSeconds ?? null,
        recordedAt: info?.recordedAt ?? null
      },
      channel: {
        id: meta.id ?? id,
        // streamlink reports a display name; only the lookup knows the login.
        login: info?.login ?? '',
        author: info?.display ?? meta.author ?? '',
        title: info?.title || meta.title || '',
        category: info?.category || meta.category || ''
      },
      masterPlaylist: master,
      resolvedAt: Date.now()
    }
  }
}

function classifyVod(message: string, restricted: boolean): ResolveResult & { ok: false } {
  const m = message.toLowerCase()
  if (restricted || m.includes('403') || m.includes('forbidden') || m.includes('unauthorized'))
    return {
      ok: false,
      reason: 'restricted',
      message: 'That VOD is subscriber-only, so Twitch will not serve it to an anonymous viewer.'
    }
  if (m.includes('no playable streams') || m.includes('unable to find') || m.includes('404'))
    return {
      ok: false,
      reason: 'not_found',
      message: 'There is no such VOD. Twitch deletes them after 7, 14 or 60 days depending on the channel.'
    }
  return { ok: false, reason: 'error', message }
}

/**
 * Ask streamlink for everything it knows about a channel, then fetch the master
 * playlist body here in main (see the note on ResolvedStream.masterPlaylist).
 */
export async function resolveChannel(input: string): Promise<ResolveResult> {
  const login = parseChannelInput(input)
  if (!login)
    return { ok: false, reason: 'invalid_channel', message: 'That does not look like a channel name.' }

  const bin = findStreamlink()
  if (!bin)
    return {
      ok: false,
      reason: 'streamlink_missing',
      message: 'streamlink was not found. Install it with:  winget install --id Streamlink.Streamlink'
    }

  const parsed = await askStreamlink(bin, `https://twitch.tv/${login}`)
  if (parsed instanceof Error) return classify(parsed.message, login)
  if (parsed.error) return classify(parsed.error, login)

  const masterPlaylist = await fetchMaster(parsed.streams ?? {})
  if (masterPlaylist instanceof Error)
    return { ok: false, reason: 'error', message: masterPlaylist.message }

  const meta = parsed.metadata ?? {}
  const stream: ResolvedStream = {
    kind: 'live',
    channel: {
      id: meta.id ?? '',
      login,
      author: meta.author ?? login,
      title: meta.title ?? '',
      category: meta.category ?? ''
    },
    masterPlaylist,
    resolvedAt: Date.now()
  }
  return { ok: true, stream }
}
