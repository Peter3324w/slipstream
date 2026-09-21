import type { Emote } from '@shared/types'

export type EmoteTable = Record<string, Emote>

const EMOTE_HOSTS = [
  'https://cdn.7tv.app/',
  'https://cdn.betterttv.net/',
  'https://cdn.frankerfacez.com/'
]

/**
 * One emote image.
 *
 * The format is already decided per provider in main/emotes.ts, on measurements
 * rather than a house style: 7TV serves AVIF at a third of its WebP, while BTTV
 * animated emotes are about 3x smaller as GIF than the WebP its content
 * negotiation would otherwise hand an <img>. `altUrl` is a per-image fallback
 * for a decoder that refuses the first choice - simpler than a capability probe,
 * and it cannot be wrong.
 */
export function emoteImg(emote: Emote): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'emote emote-3p'
  img.alt = emote.name
  img.title = `${emote.name}  (${emote.provider.toUpperCase()})`
  img.loading = 'lazy'
  img.decoding = 'async'

  // Intrinsic size up front, so a slow emote does not shove the line around.
  // BTTV reports none, so those are left to CSS.
  if (emote.width && emote.height) {
    img.width = emote.width
    img.height = emote.height
  }

  img.src = emote.url
  if (emote.altUrl) {
    const fallback = (): void => {
      img.removeEventListener('error', fallback)
      img.src = emote.altUrl as string
    }
    img.addEventListener('error', fallback)
  }
  return img
}

/**
 * How many bytes emotes have actually cost.
 *
 * transferSize is 0 for anything served from cache, which is the behaviour we
 * want: a re-shown emote is free, and the number should say so. It counts the
 * compressed size over the wire, not the decoded image.
 */
export class EmoteTraffic {
  private bytes = 0
  private observer: PerformanceObserver | null = null

  start(): void {
    if (this.observer) return
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const r = entry as PerformanceResourceTiming
        if (EMOTE_HOSTS.some((h) => r.name.startsWith(h))) this.bytes += r.transferSize || 0
      }
    })
    this.observer.observe({ type: 'resource', buffered: true })
  }

  get total(): number {
    return this.bytes
  }

  reset(): void {
    this.bytes = 0
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}
