import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Emote, EmoteProvider, EmoteSet } from '@shared/types'
import { lookupChannel } from './twitch'

/**
 * A busy channel's 7TV index alone is 2.4MB of JSON - 287KB over the wire once
 * the server's zstd is accounted for, but still several seconds on a poor line.
 * The whole reason for an emote switch is that emotes cost data, so refetching
 * on every channel change would undercut the feature it belongs to.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Bump when the shape of a cached Emote changes. Without this, adding a field
 * leaves day-old cache entries silently missing it - which is exactly what
 * happened when `provider` was introduced: a cached channel contributed 1045
 * emotes and none of them survived the merge, on one channel but not another.
 */
const CACHE_SCHEMA = 2

let cacheRoot = ''

/** Injected rather than read from `app`, so this module runs under plain node. */
export function setEmoteCacheDir(dir: string): void {
  cacheRoot = dir
}

const cacheDir = (): string => join(cacheRoot, 'emote-cache')

async function cached(key: string, load: () => Promise<Emote[]>): Promise<Emote[]> {
  if (cacheRoot) {
    try {
      const raw = await readFile(join(cacheDir(), `${key}.json`), 'utf8')
      const parsed = JSON.parse(raw) as { v?: number; at: number; emotes: Emote[] }
      if (parsed.v === CACHE_SCHEMA && Date.now() - parsed.at <= CACHE_TTL_MS) return parsed.emotes
    } catch {
      // miss
    }
  }

  const emotes = await load()

  if (cacheRoot) {
    try {
      await mkdir(cacheDir(), { recursive: true })
      await writeFile(
        join(cacheDir(), `${key}.json`),
        JSON.stringify({ v: CACHE_SCHEMA, at: Date.now(), emotes })
      )
    } catch {
      // A cache that cannot be written is not a reason to fail the fetch.
    }
  }
  return emotes
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Slipstream' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return (await res.json()) as T
}

// ------------------------------------------------------------------- 7TV

interface SevenTvEmote {
  id: string
  name: string
  data?: { animated?: boolean; host?: { files?: { name: string; width: number; height: number }[] } }
}

/**
 * AVIF first: measured on a real emote, 1x AVIF is 28KB against 72KB for the
 * same thing as WebP, and every one of 1003 emotes checked had an AVIF. WebP is
 * the per-image fallback rather than a capability probe - letting the decoder
 * answer is simpler and cannot be wrong.
 */
function from7tv(list: SevenTvEmote[]): Emote[] {
  const out: Emote[] = []
  for (const e of list) {
    const files = e.data?.host?.files ?? []
    const webp = files.find((f) => f.name === '1x.webp')
    const avif = files.find((f) => f.name === '1x.avif')
    const base = webp ?? avif
    if (!e.id || !e.name || !base) continue
    const root = `https://cdn.7tv.app/emote/${e.id}/1x`
    out.push({
      name: e.name,
      provider: '7tv',
      url: avif ? `${root}.avif` : `${root}.webp`,
      altUrl: avif && webp ? `${root}.webp` : undefined,
      animated: e.data?.animated === true,
      width: base.width,
      height: base.height
    })
  }
  return out
}

// ------------------------------------------------------------------ BTTV

interface BttvEmote {
  id: string
  code: string
  imageType: string
  animated?: boolean
}

/**
 * BTTV content-negotiates on Accept, so an <img> element gets WebP by default -
 * and for animated emotes that is a bad deal. Measured across eight of them,
 * WebP ran about 3x the GIF and as much as 920KB against 296KB for SourPls. So
 * animated emotes ask for .gif explicitly, while static ones keep .webp, which
 * is the smaller of the two there.
 *
 * BTTV reports no dimensions, hence the zeroes; CSS sizes these by height.
 */
function fromBttv(list: BttvEmote[]): Emote[] {
  return list
    .filter((e) => e.id && e.code)
    .map((e) => {
      const animated = e.animated === true || e.imageType === 'gif'
      return {
        name: e.code,
        provider: 'bttv' as const,
        url: `https://cdn.betterttv.net/emote/${e.id}/1x.${animated ? 'gif' : 'webp'}`,
        animated,
        width: 0,
        height: 0
      }
    })
}

// ------------------------------------------------------------------- FFZ

interface FfzEmote {
  name: string
  width: number
  height: number
  urls: Record<string, string>
  animated?: Record<string, string>
}

interface FfzSet {
  emoticons?: FfzEmote[]
}

/** FFZ rejects format suffixes outright, so take the URLs it gives. Animated
 *  emotes carry a separate `animated` map, which is WebP; the plain one is PNG. */
function fromFfz(sets: Record<string, FfzSet>, only?: number[]): Emote[] {
  const out: Emote[] = []
  for (const [id, set] of Object.entries(sets)) {
    if (only && !only.includes(Number(id))) continue
    for (const e of set.emoticons ?? []) {
      const animated = e.animated?.['1']
      const src = animated ?? e.urls?.['1']
      if (!e.name || !src) continue
      out.push({
        name: e.name,
        provider: 'ffz',
        url: src.startsWith('http') ? src : `https:${src}`,
        animated: Boolean(animated),
        width: e.width ?? 0,
        height: e.height ?? 0
      })
    }
  }
  return out
}

// ------------------------------------------------------------------ fetch

async function providerEmotes(
  provider: EmoteProvider,
  userId: string | null
): Promise<{ globals: Emote[]; channel: Emote[] }> {
  switch (provider) {
    case '7tv': {
      const globals = await cached('7tv-global', async () =>
        from7tv((await json<{ emotes?: SevenTvEmote[] }>('https://7tv.io/v3/emote-sets/global')).emotes ?? [])
      )
      const channel = userId
        ? await cached(`7tv-${userId}`, async () =>
            from7tv(
              (
                await json<{ emote_set?: { emotes?: SevenTvEmote[] } }>(
                  `https://7tv.io/v3/users/twitch/${userId}`
                )
              ).emote_set?.emotes ?? []
            )
          )
        : []
      return { globals, channel }
    }

    case 'bttv': {
      const globals = await cached('bttv-global', async () =>
        fromBttv(await json<BttvEmote[]>('https://api.betterttv.net/3/cached/emotes/global'))
      )
      const channel = userId
        ? await cached(`bttv-${userId}`, async () => {
            const body = await json<{ channelEmotes?: BttvEmote[]; sharedEmotes?: BttvEmote[] }>(
              `https://api.betterttv.net/3/cached/users/twitch/${userId}`
            )
            return fromBttv([...(body.channelEmotes ?? []), ...(body.sharedEmotes ?? [])])
          })
        : []
      return { globals, channel }
    }

    case 'ffz': {
      const globals = await cached('ffz-global', async () => {
        const body = await json<{ default_sets?: number[]; sets?: Record<string, FfzSet> }>(
          'https://api.frankerfacez.com/v1/set/global'
        )
        // `sets` carries more than the globals; default_sets says which count.
        return fromFfz(body.sets ?? {}, body.default_sets)
      })
      const channel = userId
        ? await cached(`ffz-${userId}`, async () =>
            fromFfz(
              (await json<{ sets?: Record<string, FfzSet> }>(
                `https://api.frankerfacez.com/v1/room/id/${userId}`
              )).sets ?? {}
            )
          )
        : []
      return { globals, channel }
    }
  }
}

/**
 * Fails soft, per provider and per half: one service being down, or a channel
 * having no account with it, must not cost you the others. A 404 is not an
 * error - it just means this channel has not linked that service.
 */
export async function fetchEmotes(login: string, providers: EmoteProvider[]): Promise<EmoteSet> {
  const errors: string[] = []
  const counts: Record<EmoteProvider, number> = { '7tv': 0, bttv: 0, ffz: 0 }
  const byName: Record<string, Emote> = {}

  const { userId } = await lookupChannel(login)

  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        return { p, ...(await providerEmotes(p, userId)) }
      } catch (err) {
        const message = (err as Error).message
        if (message !== '404') errors.push(`${p}: ${message}`)
        return { p, globals: [] as Emote[], channel: [] as Emote[] }
      }
    })
  )

  // Globals first, then channel sets: a channel deliberately reusing a global
  // name means it. Provider order follows the caller's list.
  for (const r of results) for (const e of r.globals) byName[e.name] = e
  for (const r of results) for (const e of r.channel) byName[e.name] = e

  // Count what survived the merge rather than what was fetched. A provider whose
  // every name was overridden contributes nothing, and the UI should say so.
  for (const e of Object.values(byName)) counts[e.provider]++

  return { emotes: byName, counts, errors }
}
