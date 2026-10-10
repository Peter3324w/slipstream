import { useCallback, useRef, useState } from 'react'
import type { Storyboard } from '@shared/types'

interface Props {
  /** Oldest point still in the buffer, in media seconds. */
  start: number
  /** The live edge. */
  end: number
  current: number
  disabled: boolean
  /**
   * A finished broadcast: the track spans a real duration, every second of it is
   * seekable, and there is no live edge to be behind.
   */
  vod: boolean
  /** Twitch's preview frames for this VOD, when it has them. */
  storyboard?: Storyboard | null
  onSeek: (time: number) => void
  onJumpLive: () => void
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  // Hours only when there are hours: a 14h VOD needs them, a 2 minute buffer does not.
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${Number(mm)}:${ss}`
}

/** Which sheet, and where on it, the frame for a moment of the VOD sits. */
function frameAt(board: Storyboard, seconds: number): { sheet: string; x: number; y: number } | null {
  const index = Math.min(board.count - 1, Math.max(0, Math.floor(seconds / board.interval)))
  const perSheet = board.cols * board.rows
  const sheet = board.sheets[Math.floor(index / perSheet)]
  if (!sheet) return null
  const onSheet = index % perSheet
  return {
    sheet,
    x: (onSheet % board.cols) * board.width,
    y: Math.floor(onSheet / board.cols) * board.height
  }
}

/**
 * The DVR scrubber.
 *
 * Live has no duration to scrub against: the track spans the rewind buffer, whose
 * floor keeps moving forward as hls.js trims it, so the left label is how far back
 * you can still go and the right end is always now. A VOD is the ordinary case -
 * elapsed on the left, total on the right - because its playlist ends.
 *
 * Dragging previews rather than seeking continuously: a seek per pointermove
 * would have the demuxer re-buffering the whole way across the bar.
 *
 * On a VOD, pointing at the bar shows the time under the pointer and, where
 * Twitch made a storyboard, the frame from around then. Live has neither: its
 * buffer is two minutes long and nobody drew pictures of it.
 */
export function DvrBar({
  start,
  end,
  current,
  disabled,
  vod,
  storyboard,
  onSeek,
  onJumpLive
}: Props): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  /** Where the pointer is resting on a VOD's bar, when it is not dragging. */
  const [hover, setHover] = useState<number | null>(null)
  /** The storyboard whose sheets have been asked for, so it happens once. */
  const warmed = useRef<Storyboard | null>(null)

  const span = Math.max(0.001, end - start)
  const position = preview ?? current
  const fraction = Math.min(1, Math.max(0, (position - start) / span))

  const timeAt = useCallback(
    (clientX: number): number => {
      const rect = track.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return current
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return start + f * span
    },
    [start, span, current]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setPreview(timeAt(e.clientX))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (preview !== null) {
      setPreview(timeAt(e.clientX))
      return
    }
    if (disabled || !vod) return
    setHover(timeAt(e.clientX))

    // Fetch every sheet on the first touch of the bar, not on load: it is a few
    // hundred KB that only someone scrubbing wants, and having them all means
    // the picture does not blank each time the pointer crosses onto a new sheet.
    if (storyboard && warmed.current !== storyboard) {
      warmed.current = storyboard
      for (const sheet of storyboard.sheets) new Image().src = sheet
    }
  }

  const commit = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (preview === null) return
    const target = timeAt(e.clientX)
    setPreview(null)
    onSeek(target)
  }

  const behind = end - position

  // What the pointer is pointing at: the drag if there is one, else the hover.
  const pointed = preview ?? (vod && !disabled ? hover : null)
  const pointedFraction =
    pointed === null ? 0 : Math.min(1, Math.max(0, (pointed - start) / span))
  const frame = pointed !== null && vod && storyboard ? frameAt(storyboard, pointed - start) : null
  // Keep the picture inside the bar's ends rather than hanging off them.
  const half = frame && storyboard ? storyboard.width / 2 + 1 : 0

  return (
    <div className={`dvr ${disabled ? 'is-disabled' : ''}`}>
      <span className="dvr-time">
        {disabled ? '--:--' : vod ? clock(position - start) : `-${clock(end - start)}`}
      </span>

      <div
        ref={track}
        className={`dvr-track ${preview !== null ? 'is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={commit}
        onPointerCancel={() => setPreview(null)}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label={vod ? 'Seek within the VOD' : 'Seek within the rewind buffer'}
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(position - start)}
      >
        <div className="dvr-fill" style={{ width: `${fraction * 100}%` }} />
        <div className="dvr-thumb" style={{ left: `${fraction * 100}%` }} />
        {pointed !== null && (
          <div
            className="dvr-preview"
            style={{
              left: half
                ? `clamp(${half}px, ${pointedFraction * 100}%, calc(100% - ${half}px))`
                : `${pointedFraction * 100}%`
            }}
          >
            {frame && storyboard && (
              <div
                className="dvr-frame"
                style={{
                  width: storyboard.width,
                  height: storyboard.height,
                  backgroundImage: `url("${frame.sheet}")`,
                  backgroundPosition: `-${frame.x}px -${frame.y}px`
                }}
              />
            )}
            <div className="dvr-bubble">
              {vod ? clock(pointed - start) : behind < 1 ? 'live' : `-${clock(behind)}`}
            </div>
          </div>
        )}
      </div>

      {vod ? (
        <span className="dvr-time" title="Total length">
          {disabled ? '--:--' : clock(end - start)}
        </span>
      ) : (
        <button
          className={`dvr-time dvr-live ${behind < 5 ? 'is-live' : ''}`}
          onClick={onJumpLive}
          disabled={disabled || behind < 5}
          title="Jump to the live edge  (L)"
        >
          {disabled ? '--:--' : behind < 5 ? 'LIVE' : `-${clock(behind)}`}
        </button>
      )}
    </div>
  )
}
