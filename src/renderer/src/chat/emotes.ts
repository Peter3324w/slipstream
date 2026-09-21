import type { Emote } from '@shared/types'

export type EmoteTable = Record<string, Emote>

/**
 * One emote image.
 *
 * AVIF first: measured on a real 7TV emote, the 1x AVIF is 28KB against 72KB for
 * the same thing as WebP, and this feature exists for people on a bad line. There
 * is no capability check because a per-image fallback is both simpler and more
 * honest than guessing - if the decoder refuses it, we swap to WebP and move on.
 *
 * 1x only. 2x is roughly three times the bytes for something drawn at 26px.
 */
export function emoteImg(emote: Emote): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'emote emote-3p'
  img.alt = emote.name
  img.title = emote.name
  img.loading = 'lazy'
  img.decoding = 'async'
  // Intrinsic size up front, so a slow emote does not shove the line around.
  img.width = emote.width
  img.height = emote.height

  if (emote.hasAvif) {
    img.src = `${emote.url}.avif`
    const fallback = (): void => {
      img.removeEventListener('error', fallback)
      if (emote.hasWebp) img.src = `${emote.url}.webp`
    }
    img.addEventListener('error', fallback)
  } else {
    img.src = `${emote.url}.webp`
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
        if (r.name.startsWith('https://cdn.7tv.app/')) this.bytes += r.transferSize || 0
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
