import { useEffect, useState } from 'react'
import type { VodSummary } from '@shared/types'

interface Props {
  login: string
  onPick: (id: string) => void
}

function length(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function ago(ms: number): string {
  if (!ms) return ''
  const hours = (Date.now() - ms) / 3_600_000
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.round(hours)}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

type State = { kind: 'loading' } | { kind: 'ready'; rows: VodSummary[] } | { kind: 'failed' }

/**
 * What you can watch, on the screen that just told you that you cannot.
 *
 * "Not live" used to be a dead end with a Try again button, which sent you to
 * the Twitch website to find a video id and paste it back - the exact errand
 * this app exists to save. One GQL call already knows the answer.
 */
export function VodList({ login, onPick }: Props): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })

    if (typeof window.slipstream?.vods !== 'function') {
      setState({ kind: 'failed' })
      return
    }
    window.slipstream
      .vods(login)
      .then((rows) => live && setState({ kind: 'ready', rows }))
      .catch(() => live && setState({ kind: 'failed' }))

    return () => {
      live = false
    }
  }, [login])

  if (state.kind === 'loading') return <p className="vods-note">Looking for past broadcasts...</p>
  if (state.kind === 'failed')
    return <p className="vods-note">Could not ask Twitch about past broadcasts.</p>
  if (!state.rows.length)
    return <p className="vods-note">No past broadcasts either - this channel keeps none.</p>

  return (
    <div className="vods">
      <p className="vods-head">Watch a past broadcast</p>
      <div className="vods-list">
        {state.rows.map((v) => (
          <button
            key={v.id}
            className="vod-row"
            onClick={() => onPick(v.id)}
            // Twitch will not serve these to an anonymous viewer, so offering the
            // click and failing afterwards would be worse than saying so here.
            disabled={v.restricted}
            title={v.restricted ? `${v.title} - subscribers only` : v.title}
          >
            <span className="vod-title">{v.title || 'Untitled broadcast'}</span>
            <span className="vod-meta">
              <span className="vod-len">{length(v.length)}</span>
              <span>{ago(v.createdAt)}</span>
              {v.restricted && <span className="vod-sub">subs only</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
