import { useEffect, useState } from 'react'
import type { ResolveFailure } from '@shared/types'
import { Alert, Satellite } from './Icons'

interface Props {
  kind: 'idle' | 'resolving' | 'error'
  channel?: string
  reason?: ResolveFailure
  message?: string
  onCancel?: () => void
  onRetry?: () => void
}

/** Measured: streamlink takes roughly 8s on a live channel from a warm cache. */
const EXPECTED_SECONDS = 8

function Resolving({ channel, onCancel }: { channel?: string; onCancel?: () => void }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="placeholder">
      <div className="spinner" />
      <p>
        Asking streamlink about <strong>{channel}</strong>...
      </p>
      <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {elapsed > EXPECTED_SECONDS * 2
          ? `${elapsed}s - longer than the usual ${EXPECTED_SECONDS}s.`
          : `${elapsed}s`}
      </p>
      {onCancel && (
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  )
}

export function Placeholder(props: Props): React.JSX.Element {
  if (props.kind === 'resolving')
    return <Resolving channel={props.channel} onCancel={props.onCancel} />

  if (props.kind === 'error') {
    return (
      <div className="placeholder is-error">
        <div className="glyph">
          <Alert />
        </div>
        <h2>
          {props.reason === 'offline'
            ? 'Not live'
            : props.reason === 'not_found'
              ? 'No such channel'
              : 'Could not start'}
        </h2>
        <p>{props.message}</p>
        {props.reason === 'streamlink_missing' && (
          <p>
            <code>winget install --id Streamlink.Streamlink --source winget</code>
          </p>
        )}
        {props.onRetry && (
          <button className="btn" onClick={props.onRetry}>
            Try again
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="placeholder">
      <div className="glyph">
        <Satellite />
      </div>
      <h2>Pick a channel</h2>
      <p>
        Type a name or paste a twitch.tv link up top. streamlink resolves the stream, hls.js
        plays it, and chat joins anonymously &mdash; no account, no ads before the stream.
      </p>
    </div>
  )
}
