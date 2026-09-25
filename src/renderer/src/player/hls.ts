import Hls from 'hls.js/light'

export interface QualityLevel {
  /** Index into hls.levels. */
  index: number
  /** Twitch's own name where we can recover it: "720p60", "audio_only". */
  label: string
  height: number | null
  bitrate: number
}

export interface PlayerEvents {
  onLevels: (levels: QualityLevel[]) => void
  onLevelSwitch: (index: number) => void
  onError: (message: string) => void
  /** The signed URLs inside the manifest expired; the caller should re-resolve. */
  onStale: () => void
}

/**
 * Seconds of already-played video hls.js keeps around for rewinding.
 *
 * This is the ceiling on the DVR for Path A, and it is a real ceiling: MSE keeps
 * the back buffer in RAM and Chromium throws QuotaExceededError past a few minutes
 * at 1080p60. Raising this is not free — it is the memory number this project is
 * being judged on. A disk-backed buffer needs mpv, which is the Path B question.
 */
export const BACK_BUFFER_SECONDS = 120

/**
 * Twitch names its renditions on the EXT-X-MEDIA lines, not on EXT-X-STREAM-INF,
 * so hls.js does not surface them. Join them back via the VIDEO group id, which
 * appears on both. Falls back to height when a channel serves something unusual.
 */
function namesByGroup(master: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of master.split('\n')) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue
    const group = /GROUP-ID="([^"]*)"/.exec(line)?.[1]
    const name = /NAME="([^"]*)"/.exec(line)?.[1]
    if (group && name) out.set(group, name)
  }
  return out
}

export class Player {
  private hls: Hls | null = null
  private objectUrl: string | null = null
  private staleReported = false

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly events: PlayerEvents
  ) {}

  static get supported(): boolean {
    return Hls.isSupported()
  }

  load(masterPlaylist: string): void {
    this.destroy()
    this.staleReported = false

    const hls = new Hls({
      enableWorker: true,
      backBufferLength: BACK_BUFFER_SECONDS,
      // Twitch is plain HLS, not LL-HLS; asking for low-latency mode only adds work.
      lowLatencyMode: false,
      // Start on the highest rendition rather than ramping up from 160p.
      startLevel: -1,
      capLevelToPlayerSize: false
    })
    this.hls = hls

    const names = namesByGroup(masterPlaylist)

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const levels: QualityLevel[] = data.levels.map((lvl, index) => {
        const group = (lvl.attrs as Record<string, string> | undefined)?.VIDEO
        const label =
          (group && names.get(group)) ||
          (lvl.height ? `${lvl.height}p${lvl.attrs?.['FRAME-RATE'] ? Math.round(Number(lvl.attrs['FRAME-RATE'])) : ''}` : 'audio only')
        return { index, label, height: lvl.height ?? null, bitrate: lvl.bitrate }
      })
      this.events.onLevels(levels)
      void this.video.play().catch(() => {
        /* autoplay can be refused; the play button is still there */
      })
    })

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => this.events.onLevelSwitch(data.level))

    hls.on(Hls.Events.ERROR, (_e, data) => {
      // 403/404 on a playlist means the signed token aged out. streamlink has to
      // do the token dance again; hls.js cannot recover from this on its own.
      const status = data.response?.code
      if ((status === 403 || status === 404) && !this.staleReported) {
        this.staleReported = true
        this.events.onStale()
        return
      }
      if (!data.fatal) return

      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad()
          break
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError()
          break
        default:
          this.events.onError(data.details || 'Playback failed.')
          this.destroy()
      }
    })

    const blob = new Blob([masterPlaylist], { type: 'application/vnd.apple.mpegurl' })
    this.objectUrl = URL.createObjectURL(blob)
    hls.loadSource(this.objectUrl)
    hls.attachMedia(this.video)
  }

  /** -1 restores automatic bitrate selection. */
  setLevel(index: number): void {
    if (this.hls) this.hls.currentLevel = index
  }

  get currentLevel(): number {
    return this.hls?.currentLevel ?? -1
  }

  /**
   * The scrubbable window: everything still held in the SourceBuffer.
   *
   * `start` is not zero and does not stay put - hls.js trims to backBufferLength,
   * so the floor crawls forward as the stream runs. The bar has to be drawn
   * against this moving window, not against a fixed duration.
   */
  seekableWindow(): { start: number; end: number; current: number } {
    const s = this.video.seekable
    const b = this.video.buffered
    const start = s.length ? s.start(0) : b.length ? b.start(0) : 0
    const end = s.length ? s.end(s.length - 1) : b.length ? b.end(b.length - 1) : 0
    return { start, end, current: this.video.currentTime }
  }

  seekTo(time: number): void {
    const { start, end } = this.seekableWindow()
    // Clamp inside the window; seeking past the live edge stalls the demuxer.
    this.video.currentTime = Math.min(end, Math.max(start, time))
  }

  /**
   * Wall-clock ms of the frame on screen, from the segments'
   * EXT-X-PROGRAM-DATE-TIME. Null before the first dated segment, or with none.
   */
  playingDate(): number | null {
    return this.hls?.playingDate?.getTime() ?? null
  }

  seekToLive(): void {
    const seekable = this.video.seekable
    if (seekable.length) this.video.currentTime = seekable.end(seekable.length - 1)
  }

  /**
   * Stop and let go of everything the stream holds: the hls.js instance, its
   * buffered segments and the decoder. Leaves a black, empty element behind.
   */
  stop(): void {
    this.destroy()
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
  }

  destroy(): void {
    this.hls?.destroy()
    this.hls = null
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }
}
