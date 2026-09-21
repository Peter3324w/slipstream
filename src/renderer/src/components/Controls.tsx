import { useEffect, useRef, useState } from 'react'
import type { QualityLevel } from '@/player/hls'
import { Layers, Pause, Play, Volume, VolumeOff } from './Icons'
import { DvrBar } from './DvrBar'

interface Props {
  ready: boolean
  playing: boolean
  onPlayPause: () => void
  onSeek: (delta: number) => void
  /** The scrubbable window, in media seconds. */
  dvr: { start: number; end: number; current: number }
  onSeekTo: (time: number) => void
  onJumpLive: () => void
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  levels: QualityLevel[]
  /** What the viewer asked for. null means "let ABR decide". */
  pinnedLabel: string | null
  /** What hls.js is actually playing right now, which ABR may keep changing. */
  activeLevel: number
  onPick: (label: string | null) => void
}

export function Controls(props: Props): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      if (!anchor.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const active = props.levels.find((l) => l.index === props.activeLevel)
  const behindLive = props.dvr.end - props.dvr.current >= 5

  // Auto has to say what it actually picked, or it looks like the control is
  // being ignored: the label would read "720p60" while ABR quietly moved you.
  const qualityLabel = props.pinnedLabel ?? (active ? `Auto · ${active.label}` : 'Auto')

  return (
    <div className="controls">
      <button
        className="ctl"
        onClick={props.onPlayPause}
        disabled={!props.ready}
        title={props.playing ? 'Pause  (Space)' : 'Play  (Space)'}
      >
        {props.playing ? <Pause /> : <Play />}
      </button>

      <button className="ctl" onClick={() => props.onSeek(-10)} disabled={!props.ready} title="Back 10s  (Left)">
        &minus;10s
      </button>
      <button
        className="ctl"
        onClick={() => props.onSeek(10)}
        disabled={!props.ready || !behindLive}
        title="Forward 10s  (Right)"
      >
        +10s
      </button>

      <DvrBar
        start={props.dvr.start}
        end={props.dvr.end}
        current={props.dvr.current}
        disabled={!props.ready}
        onSeek={props.onSeekTo}
        onJumpLive={props.onJumpLive}
      />


      <div className="volume">
        <button className="ctl" onClick={props.onToggleMute} title="Mute  (M)">
          {props.muted || props.volume === 0 ? <VolumeOff /> : <Volume />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={props.muted ? 0 : props.volume}
          onChange={(e) => props.onVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>

      <div className="menu-anchor" ref={anchor}>
        <button
          className={`ctl ${props.pinnedLabel ? 'is-pinned' : ''}`}
          onClick={() => setMenu((v) => !v)}
          disabled={!props.levels.length}
          title="Quality"
        >
          <Layers />
          {qualityLabel}
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button
              className={`menu-item ${props.pinnedLabel === null ? 'is-active' : ''}`}
              onClick={() => {
                props.onPick(null)
                setMenu(false)
              }}
            >
              <span>Auto</span>
              {active && <span className="hint">{active.label}</span>}
            </button>
            <div className="menu-sep" />
            {props.levels
              .slice()
              .sort((a, b) => b.bitrate - a.bitrate)
              .map((l) => (
                <button
                  key={l.index}
                  className={`menu-item ${l.label === props.pinnedLabel ? 'is-active' : ''}`}
                  onClick={() => {
                    props.onPick(l.label)
                    setMenu(false)
                  }}
                >
                  <span>{l.label}</span>
                  <span className="hint">{(l.bitrate / 1_000_000).toFixed(1)} Mbps</span>
                </button>
              ))}
          </div>
        )}
      </div>

    </div>
  )
}
