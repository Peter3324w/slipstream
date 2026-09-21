import { useState } from 'react'
import type { ChannelSummary } from '@shared/types'
import { parseChannelInput } from '@shared/channel'

interface Props {
  channels: ChannelSummary[]
  current: string | null
  onPick: (login: string) => void
  onRemove: (login: string) => void
  onAdd: (login: string) => void
}

function viewers(n: number | null): string {
  if (n === null) return ''
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/**
 * Live first, by audience; everyone else alphabetically underneath. A list that
 * keeps its stored order buries the one fact you opened it for.
 */
function order(channels: ChannelSummary[]): ChannelSummary[] {
  return channels.slice().sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    if (a.live && b.live) return (b.viewers ?? 0) - (a.viewers ?? 0)
    return a.display.localeCompare(b.display)
  })
}

export function Favourites(props: Props): React.JSX.Element {
  const [adding, setAdding] = useState('')
  const sorted = order(props.channels)
  const liveCount = sorted.filter((c) => c.live).length

  return (
    <nav className="rail">
      <div className="rail-head">
        <span>Favourites</span>
        {props.channels.length > 0 && (
          <span className="rail-count">
            {liveCount}/{props.channels.length}
          </span>
        )}
      </div>

      <div className="rail-list">
        {sorted.map((c) => (
          <div
            key={c.login}
            className={`rail-item ${c.live ? 'is-live' : ''} ${c.login === props.current ? 'is-current' : ''}`}
            onClick={() => props.onPick(c.login)}
            role="button"
            title={c.live ? `${c.title ?? ''}` : c.exists ? 'Offline' : 'No such channel'}
          >
            {/* Avatars are not lazy: this list is short and always on screen, so
                deferring only delays them. Lazy loading earns its keep in chat,
                where hundreds of emotes scroll past. */}
            {c.avatar ? (
              <img className="rail-avatar" src={c.avatar} alt="" decoding="async" />
            ) : (
              <span className="rail-avatar rail-avatar-blank" />
            )}

            <span className="rail-text">
              <span className="rail-name">{c.display}</span>
              <span className="rail-sub">
                {c.live ? (c.game ?? 'Live') : c.exists ? 'Offline' : 'Unknown channel'}
              </span>
            </span>

            {c.live && <span className="rail-viewers">{viewers(c.viewers)}</span>}

            <button
              className="rail-remove"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation()
                props.onRemove(c.login)
              }}
            >
              &times;
            </button>
          </div>
        ))}

        {props.channels.length === 0 && (
          <p className="rail-empty">
            Nothing here yet. Add a channel below, or star the one you are watching.
          </p>
        )}
      </div>

      <form
        className="rail-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!parseChannelInput(adding)) return
          props.onAdd(adding)
          setAdding('')
        }}
      >
        <input
          className="rail-input"
          placeholder="Add a channel"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </form>
    </nav>
  )
}
