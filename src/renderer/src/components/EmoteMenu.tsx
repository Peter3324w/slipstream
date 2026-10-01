import { useEffect, useRef, useState } from 'react'
import { EMOTE_PROVIDERS, type EmoteProvider } from '@shared/types'

interface Props {
  enabled: EmoteProvider[]
  counts: Record<EmoteProvider, number>
  bytes: number
  onToggle: (provider: EmoteProvider) => void
  /** Twitch's own emotes: globals and sub emotes, delivered in the message tags. */
  twitch: boolean
  onToggleTwitch: () => void
  /** Every source at once - "no emotes" should not cost four clicks. */
  onSetAll: (on: boolean) => void
}

const NAME: Record<EmoteProvider, string> = { '7tv': '7TV', bttv: 'BTTV', ffz: 'FFZ' }

/** Rough guidance, from measuring real channels - see the README. */
const WEIGHT: Record<EmoteProvider, string> = {
  '7tv': '~290 KB index',
  bttv: 'small',
  ffz: 'small'
}

export function data(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Per provider rather than one switch, because they are not equivalent: 7TV is
 * around a thousand emotes behind a 290KB index, while BTTV and FFZ together are
 * a couple of hundred and cost almost nothing. On a bad line that is a real
 * choice, not a preference.
 */
export function EmoteMenu({
  enabled,
  counts,
  bytes,
  onToggle,
  twitch,
  onToggleTwitch,
  onSetAll
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const anyOn = twitch || enabled.length > 0
  const sources = [...(twitch ? ['Twitch'] : []), ...enabled.map((p) => NAME[p])]

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        className={`chat-7tv ${anyOn ? 'is-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={
          anyOn
            ? `Emotes from ${sources.join(', ')}. ${data(bytes)} downloaded.`
            : 'Emotes off - every emote renders as its name, and nothing is downloaded.'
        }
      >
        {/* The byte count stays in the tooltip and the menu's foot - in the
            header it cost 44px of a budget that had none to give. */}
        EMOTES
      </button>

      {open && (
        <div className="menu menu-down" role="menu">
          <button className="menu-item menu-action" onClick={() => onSetAll(!anyOn)}>
            {anyOn ? 'Turn all off' : 'Turn all on'}
          </button>

          <div className="menu-sep" />

          {/* Twitch's own come first: they are what a channel actually uses, and
              the third-party sets are an addition on top. There is no index to
              drop here - switching them off stops a download per emote image. */}
          <button className={`menu-item ${twitch ? 'is-active' : ''}`} onClick={onToggleTwitch}>
            <span>Twitch</span>
            <span className="hint">{twitch ? 'no index' : 'names only'}</span>
          </button>

          {EMOTE_PROVIDERS.map((p) => {
            const on = enabled.includes(p)
            return (
              <button
                key={p}
                className={`menu-item ${on ? 'is-active' : ''}`}
                onClick={() => onToggle(p)}
              >
                <span>{NAME[p]}</span>
                <span className="hint">{on ? (counts[p] || '...') : WEIGHT[p]}</span>
              </button>
            )
          })}
          <div className="menu-sep" />
          <div className="menu-foot">
            <span>downloaded</span>
            <span className="hint">{data(bytes)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
