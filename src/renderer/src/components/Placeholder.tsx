import type { ResolveFailure } from '@shared/types'
import { Alert, Satellite } from './Icons'

interface Props {
  kind: 'idle' | 'resolving' | 'error'
  channel?: string
  reason?: ResolveFailure
  message?: string
}

export function Placeholder(props: Props): React.JSX.Element {
  if (props.kind === 'resolving') {
    return (
      <div className="placeholder">
        <div className="spinner" />
        <p>
          Asking streamlink about <strong>{props.channel}</strong>...
        </p>
      </div>
    )
  }

  if (props.kind === 'error') {
    return (
      <div className="placeholder is-error">
        <div className="glyph">
          <Alert />
        </div>
        <h2>{props.reason === 'offline' ? 'Not live' : 'Could not start'}</h2>
        <p>{props.message}</p>
        {props.reason === 'streamlink_missing' && (
          <p>
            <code>winget install --id Streamlink.Streamlink --source winget</code>
          </p>
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
