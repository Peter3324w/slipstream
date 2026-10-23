import { useEffect, useState } from 'react'
import type { VodSummary } from '@shared/types'

interface Props {
  login: string
  onPick: (id: string) => void
}

function length(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(Math.floor(seconds % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
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

/** A channel's broadcasts and newer highlights, with shared cards on both layouts. */
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
    return <div className="vods"><h2 className="vods-head">Past broadcasts</h2><p className="vods-note">No past broadcasts available.</p></div>

  const archives = state.rows.filter((v) => v.kind === 'archive')
  const highlights = state.rows.filter((v) => v.kind === 'highlight')

  const rows = (list: VodSummary[]): React.JSX.Element => (
    <div className="vods-list">
      {list.map((v) => (
        <button
          key={v.id}
          className="vod-row"
          onClick={() => onPick(v.id)}
          // Twitch will not serve these to an anonymous viewer, so offering the
          // click and failing afterwards would be worse than saying so here.
          disabled={v.restricted}
          title={v.restricted ? `${v.title} - subscribers only` : v.title}
        >
          <span className="vod-thumbnail">
            <span className="vod-thumbnail-fallback" aria-hidden="true">▶</span>
            {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
            <span className="vod-len">{length(v.length)}</span>
            <span className="vod-views">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v.views)} views</span>
            <span className="vod-date">{ago(v.createdAt)}</span>
          </span>
          <span className="vod-title">{v.title || 'Untitled broadcast'}</span>
          {v.game && <span className="vod-game">{v.game}</span>}
          {v.restricted && <span className="vod-sub">Subscribers only</span>}
        </button>
      ))}
    </div>
  )

  return (
    <div className="vods">
      {/* Highlights lead only because main hands them over only when they are
          newer than every archive, which makes this plain newest-first. They
          keep their own heading rather than being mixed in: an edit should
          never be mistaken for the broadcast it was cut from. */}
      {highlights.length > 0 && (
        <>
          <h2 className="vods-head">
            {archives.length > 0 ? 'Newer highlights' : 'Highlights'}
          </h2>
          {rows(highlights)}
        </>
      )}
      {archives.length > 0 && (
        <>
          <h2 className="vods-head">Past broadcasts</h2>
          {rows(archives)}
        </>
      )}
    </div>
  )
}
