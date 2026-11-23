import { ongoingArchive, vodMaster, type OngoingArchive } from './twitch'
import type { TemporaryDvr } from './dvr'
import type { DvrStartResult } from '@shared/types'

/** The exact wall clock of archive media time zero, never its approximate creation date. */
function datedOrigin(text: string): number | null {
  if (!text.trimStart().startsWith('#EXTM3U')) return null
  let elapsed = 0
  let duration = 0
  let date: number | null = null
  let origin: number | null = null
  let count = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '#EXT-X-DISCONTINUITY' || /^#EXT-X-(GAP|SKIP|BYTERANGE)(:|$)/.test(line)) return null
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:') && Number(line.slice(22)) !== 0) return null
    if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:') && Number(line.slice(30)) !== 0) return null
    if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0])
    else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      date = Date.parse(line.slice(25))
      if (!Number.isFinite(date)) return null
    } else if (line && !line.startsWith('#')) {
      if (!Number.isFinite(duration) || duration <= 0) return null
      if (date !== null) {
        const candidate = date - elapsed * 1000
        if (origin !== null && Math.abs(candidate - origin) > 250) return null
        origin ??= candidate
      }
      elapsed += duration
      duration = 0
      date = null
      count++
    }
  }
  return count ? origin : null
}

/** Video VOD variants can omit PDT; Twitch's audio rendition supplies the shared clock. */
export async function archiveOrigin(masterPlaylist: string): Promise<number | null> {
  const lines = masterPlaylist.split('\n').map(line => line.trim())
  const variants: { audio: boolean; url: string }[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue
    const uri = lines[index + 1]
    if (uri && /^https?:\/\//i.test(uri)) variants.push({ audio: /VIDEO="audio_only"/.test(lines[index]), url: uri })
  }
  variants.sort((a, b) => Number(b.audio) - Number(a.audio))
  for (const variant of variants) {
    try {
      const response = await fetch(variant.url, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) { await response.body?.cancel(); continue }
      const origin = datedOrigin(await response.text())
      if (origin !== null) return origin
    } catch {
      // Another muxed variant may provide dates when this one is unavailable.
    }
  }
  return null
}

interface Target { login: string; streamId: string }
interface Dependencies {
  lookup: (login: string, streamId: string) => Promise<OngoingArchive | null>
  origin: (masterPlaylist: string) => Promise<number | null>
  renew: (id: string) => Promise<string | null>
}

/** Keeps asynchronous source selection and token renewal tied to one archive. */
export class LiveArchiveBuffer {
  private recorder: Pick<TemporaryDvr, 'start' | 'stop'>
  private dependencies: Dependencies
  private generation = 0
  private source: OngoingArchive | null = null

  constructor(recorder: Pick<TemporaryDvr, 'start' | 'stop'>, dependencies: Partial<Dependencies> = {}) {
    this.recorder = recorder
    this.dependencies = { lookup: ongoingArchive, origin: archiveOrigin, renew: vodMaster, ...dependencies }
  }

  async start(target: Target, rendition: string, pausedDate: number): Promise<DvrStartResult | null> {
    const generation = ++this.generation
    this.source = null
    await this.recorder.stop()
    const check = (): void => { if (generation !== this.generation) throw new Error('Archive buffer cancelled') }
    check()
    const source = await this.dependencies.lookup(target.login, target.streamId)
    check()
    if (!source) return null
    const originDate = await this.dependencies.origin(source.masterPlaylist)
    check()
    if (originDate === null) return null
    this.source = source
    try {
      const result = await this.recorder.start(source.masterPlaylist, rendition, pausedDate, { originDate })
      check()
      return result
    } catch (error) {
      if (generation === this.generation) {
        this.source = null
        await this.recorder.stop()
      }
      throw error
    }
  }

  async renewMaster(): Promise<string> {
    const source = this.source
    if (!source) throw new Error('Archive buffer cancelled')
    const master = await this.dependencies.renew(source.id)
    if (source !== this.source) throw new Error('Archive buffer cancelled')
    if (!master) throw new Error('Could not renew this archive')
    return master
  }

  stop(): Promise<void> {
    ++this.generation
    this.source = null
    return this.recorder.stop()
  }
}
