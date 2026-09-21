import { useCallback, useRef, useState } from 'react'

interface Props {
  /** Oldest point still in the buffer, in media seconds. */
  start: number
  /** The live edge. */
  end: number
  current: number
  disabled: boolean
  onSeek: (time: number) => void
  onJumpLive: () => void
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The DVR scrubber.
 *
 * Unlike a VOD bar there is no duration to scrub against - the track spans the
 * rewind buffer, whose floor keeps moving forward as hls.js trims it. So the
 * left label is how far back you can still go, and the right end is always now.
 *
 * Dragging previews rather than seeking continuously: a seek per pointermove
 * would have the demuxer re-buffering the whole way across the bar.
 */
export function DvrBar({ start, end, current, disabled, onSeek, onJumpLive }: Props): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)

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
    if (preview === null) return
    setPreview(timeAt(e.clientX))
  }

  const commit = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (preview === null) return
    const target = timeAt(e.clientX)
    setPreview(null)
    onSeek(target)
  }

  const behind = end - position

  return (
    <div className={`dvr ${disabled ? 'is-disabled' : ''}`}>
      <span className="dvr-time">{disabled ? '--:--' : `-${clock(end - start)}`}</span>

      <div
        ref={track}
        className={`dvr-track ${preview !== null ? 'is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={commit}
        onPointerCancel={() => setPreview(null)}
        role="slider"
        aria-label="Seek within the rewind buffer"
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(position - start)}
      >
        <div className="dvr-fill" style={{ width: `${fraction * 100}%` }} />
        <div className="dvr-thumb" style={{ left: `${fraction * 100}%` }} />
        {preview !== null && (
          <div className="dvr-bubble" style={{ left: `${fraction * 100}%` }}>
            {behind < 1 ? 'live' : `-${clock(behind)}`}
          </div>
        )}
      </div>

      <button
        className={`dvr-time dvr-live ${behind < 5 ? 'is-live' : ''}`}
        onClick={onJumpLive}
        disabled={disabled || behind < 5}
        title="Jump to the live edge  (L)"
      >
        {disabled ? '--:--' : behind < 5 ? 'LIVE' : `-${clock(behind)}`}
      </button>
    </div>
  )
}
