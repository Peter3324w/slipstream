import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Emote, EmoteSet } from '@shared/types'
import { lookupChannel } from './twitch'

const GLOBAL_SET = 'https://7tv.io/v3/emote-sets/global'
const USER_SET = (twitchId: string): string => `https://7tv.io/v3/users/twitch/${twitchId}`

/**
 * A busy channel's emote index is 2.4MB of JSON - 287KB over the wire once the
 * server's zstd is accounted for, but still several seconds on a poor line. The
 * whole reason for a 7TV switch is that emotes cost data, so refetching this on
 * every channel change would undercut the feature it belongs to.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface SevenTvFile {
  name: string
  format: string
  width: number
  height: number
}

interface SevenTvEmote {
  id: string
  name: string
  data?: {
    animated?: boolean
    host?: { files?: SevenTvFile[] }
  }
}

/**
 * Set once at startup. Injected rather than read from `app` so this module can be
 * exercised under plain node - which is how the 7TV response shape was checked
 * against a real channel instead of trusted from documentation.
 */
let cacheRoot = ''

export function setEmoteCacheDir(dir: string): void {
  cacheRoot = dir
}

function cacheDir(): string {
  return join(cacheRoot, 'emote-cache')
}

async function readCache(key: string): Promise<Emote[] | null> {
  if (!cacheRoot) return null
  try {
    const raw = await readFile(join(cacheDir(), `${key}.json`), 'utf8')
    const parsed = JSON.parse(raw) as { at: number; emotes: Emote[] }
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null
    return parsed.emotes
  } catch {
    return null
  }
}

async function writeCache(key: string, emotes: Emote[]): Promise<void> {
  if (!cacheRoot) return
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(join(cacheDir(), `${key}.json`), JSON.stringify({ at: Date.now(), emotes }))
  } catch {
    // A cache that cannot be written is not a reason to fail the fetch.
  }
}

/**
 * Keep only what the renderer needs to draw one. The raw payload is mostly
 * ownership, tags and moderation flags we have no use for, and shipping all of
 * it across IPC for a thousand emotes would be gratuitous.
 */
function compact(list: SevenTvEmote[]): Emote[] {
  const out: Emote[] = []
  for (const e of list) {
    const files = e.data?.host?.files ?? []
    // 1x only: 2x is three times the bytes for something drawn at 22px.
    const webp = files.find((f) => f.name === '1x.webp')
    const avif = files.find((f) => f.name === '1x.avif')
    const base = webp ?? avif
    if (!e.id || !e.name || !base) continue
    out.push({
      name: e.name,
      // Built by the renderer once it knows which format it can decode.
      url: `https://cdn.7tv.app/emote/${e.id}/1x`,
      animated: e.data?.animated === true,
      width: base.width,
      height: base.height,
      hasAvif: Boolean(avif),
      hasWebp: Boolean(webp)
    })
  }
  return out
}

async function fetchSet(url: string, key: string): Promise<Emote[]> {
  const cached = await readCache(key)
  if (cached) return cached

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Slipstream' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`7TV responded ${res.status}`)

  const body = (await res.json()) as {
    emotes?: SevenTvEmote[]
    emote_set?: { emotes?: SevenTvEmote[] }
  }
  const emotes = compact(body.emotes ?? body.emote_set?.emotes ?? [])
  await writeCache(key, emotes)
  return emotes
}

/**
 * Global set plus the channel's own. Fails soft in halves: a channel with no
 * 7TV account (a 404) should still get the global emotes, and 7TV being down
 * entirely should not stop chat working.
 */
export async function fetchEmotes(login: string): Promise<EmoteSet> {
  const errors: string[] = []

  const globals = await fetchSet(GLOBAL_SET, '7tv-global').catch((e: Error) => {
    errors.push(`global: ${e.message}`)
    return [] as Emote[]
  })

  let channel: Emote[] = []
  const { userId } = await lookupChannel(login)
  if (userId) {
    channel = await fetchSet(USER_SET(userId), `7tv-${userId}`).catch((e: Error) => {
      // 404 just means this channel has not linked a 7TV account.
      if (!e.message.includes('404')) errors.push(`channel: ${e.message}`)
      return [] as Emote[]
    })
  }

  // Channel emotes win: a channel deliberately overriding a global name means it.
  const byName: Record<string, Emote> = {}
  for (const e of globals) byName[e.name] = e
  for (const e of channel) byName[e.name] = e

  return {
    emotes: byName,
    globalCount: globals.length,
    channelCount: channel.length,
    errors
  }
}
