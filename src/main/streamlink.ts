import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { promisify } from 'node:util'
import type { ResolveResult, ResolvedStream } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { channelExistence } from './twitch'

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

  let parsed: StreamlinkJson
  try {
    const { stdout } = await run(bin, ['--json', `https://twitch.tv/${login}`], {
      timeout: RESOLVE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    })
    parsed = JSON.parse(stdout)
  } catch (err) {
    // streamlink exits non-zero for an offline channel but still prints its JSON.
    const stdout = (err as { stdout?: string }).stdout
    if (stdout) {
      try {
        parsed = JSON.parse(stdout)
      } catch {
        return classify(String((err as Error).message), login)
      }
    } else {
      return classify(String((err as Error).message), login)
    }
  }

  if (parsed.error) return classify(parsed.error, login)

  const streams = parsed.streams ?? {}
  // Every entry carries the same master URL; take the first that has one.
  const withMaster = Object.values(streams).find((s) => typeof s.master === 'string' && s.master)
  if (!withMaster?.master)
    return {
      ok: false,
      reason: 'error',
      message: 'streamlink returned no master playlist for this channel.'
    }

  let masterPlaylist: string
  try {
    const res = await fetch(withMaster.master, {
      headers: withMaster.headers ?? {},
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`master playlist responded ${res.status}`)
    masterPlaylist = await res.text()
  } catch (err) {
    return { ok: false, reason: 'error', message: `Could not fetch the playlist: ${(err as Error).message}` }
  }

  const meta = parsed.metadata ?? {}
  const stream: ResolvedStream = {
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
