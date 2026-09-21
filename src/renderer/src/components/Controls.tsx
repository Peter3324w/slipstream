import { useEffect, useRef, useState } from 'react'
import type { QualityLevel } from '@/player/hls'
import { ChatBubble, Gauge, Layers, Live, Pause, Play, Volume, VolumeOff } from './Icons'

interface Props {
  ready: boolean
  playing: boolean
  onPlayPause: () => void
  onSeek: (delta: number) => void
  behind: number
  onJumpLive: () => void
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  levels: QualityLevel[]
  currentLevel: number
  onLevel: (index: number) => void
  chatVisible: boolean
  onToggleChat: () => void
  hudVisible: boolean
  onToggleHud: () => void
}

/** Under five seconds is as live as HLS gets; do not pretend to more precision. */
function formatBehind(seconds: number): string {
  if (seconds < 5) return 'LIVE'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `-${m}:${String(s).padStart(2, '0')}`
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

  const active = props.levels.find((l) => l.index === props.currentLevel)
  const behindLive = props.behind >= 5

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

      <button
        className="ctl"
        onClick={() => props.onSeek(-10)}
        disabled={!props.ready}
        title="Back 10s  (Left)"
      >
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

      <button
        className={`ctl behind ${behindLive ? 'is-behind' : ''}`}
        onClick={props.onJumpLive}
        disabled={!props.ready || !behindLive}
        title="Jump to the live edge  (L)"
      >
        {behindLive ? <Live size={13} /> : null}
        {props.ready ? formatBehind(props.behind) : '--:--'}
      </button>

      <div className="spacer" />

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
          className="ctl"
          onClick={() => setMenu((v) => !v)}
          disabled={!props.levels.length}
          title="Quality"
        >
          <Layers />
          {active ? active.label : 'auto'}
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button
              className={`menu-item ${props.currentLevel === -1 ? 'is-active' : ''}`}
              onClick={() => {
                props.onLevel(-1)
                setMenu(false)
              }}
            >
              Auto
            </button>
            <div className="menu-sep" />
            {props.levels
              .slice()
              .sort((a, b) => b.bitrate - a.bitrate)
              .map((l) => (
                <button
                  key={l.index}
                  className={`menu-item ${l.index === props.currentLevel ? 'is-active' : ''}`}
                  onClick={() => {
                    props.onLevel(l.index)
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

      <button
        className={`ctl ${props.hudVisible ? 'is-active' : ''}`}
        onClick={props.onToggleHud}
        title="Memory readout  (F2)"
        style={props.hudVisible ? { color: 'var(--accent)' } : undefined}
      >
        <Gauge />
      </button>

      <button
        className="ctl"
        onClick={props.onToggleChat}
        title="Toggle chat  (C)"
        style={props.chatVisible ? { color: 'var(--text)' } : undefined}
      >
        <ChatBubble />
      </button>
    </div>
  )
}
