import { useEffect, useState } from 'react'
import type { AuthStatus } from '@shared/types'

interface Props {
  status: AuthStatus
  onClose: () => void
  onSetClientId: (value: string) => void
  onBegin: () => void
  onCancel: () => void
  onSignOut: () => void
}

function countdown(expiresAt: number | null): string {
  if (!expiresAt) return ''
  const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

export function SignIn(props: Props): React.JSX.Element {
  const { status } = props
  const [clientId, setClientId] = useState('')
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)

  // Only to redraw the expiry countdown.
  useEffect(() => {
    if (status.state !== 'pending') return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [status.state])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(id)
  }, [copied])

  return (
    <div className="scrim" onMouseDown={props.onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        {status.state === 'needs_client_id' && (
          <>
            <h2>Connect a Twitch application</h2>
            <p>
              Signing in needs a Client ID from your own Twitch app registration. It takes a minute
              and is a one-off. Slipstream cannot ship one: a Client ID identifies a specific
              registered application, and this is a public repository.
            </p>
            <ol className="steps">
              <li>
                Open <code>dev.twitch.tv/console/apps</code> and choose <b>Register Your Application</b>
              </li>
              <li>
                Name it anything. Set <b>OAuth Redirect URLs</b> to <code>http://localhost</code> &mdash;
                the device flow never uses it, but the field is required
              </li>
              <li>
                Category <b>Application Integration</b>, and Client Type <b>Public</b>. Public is the
                part that matters &mdash; the device flow is refused otherwise
              </li>
              <li>Create, then copy the Client ID and paste it below</li>
            </ol>
            <div className="row">
              <input
                className="channel-input wide"
                placeholder="Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="btn btn-primary"
                disabled={!clientId.trim()}
                onClick={() => props.onSetClientId(clientId)}
              >
                Save
              </button>
            </div>
            <p className="fine">
              Stored in this app&rsquo;s data directory, never in the project.
              <code>SLIPSTREAM_TWITCH_CLIENT_ID</code> overrides it.
            </p>
          </>
        )}

        {(status.state === 'signed_out' || status.state === 'error') && (
          <>
            <h2>Sign in to Twitch</h2>
            <p>
              Opens Twitch in your browser to approve a code. Slipstream never sees your password.
              Signing in enables sending chat messages and reading who you follow.
            </p>
            {status.message && <p className="warn">{status.message}</p>}
            <div className="row">
              <button className="btn btn-primary" onClick={props.onBegin}>
                Sign in with Twitch
              </button>
              <button className="btn" onClick={props.onClose}>
                Not now
              </button>
            </div>
          </>
        )}

        {status.state === 'pending' && (
          <>
            <h2>Enter this code on Twitch</h2>
            <button
              className="code"
              title="Copy"
              onClick={() => {
                void navigator.clipboard.writeText(status.userCode ?? '')
                setCopied(true)
              }}
            >
              {status.userCode}
            </button>
            <p className="fine">{copied ? 'Copied.' : 'Click the code to copy it.'}</p>
            <p>
              Expires in <b>{countdown(status.expiresAt)}</b>. Slipstream is waiting &mdash; this
              page updates itself once you approve.
            </p>
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={() => window.open(status.verificationUri ?? '', '_blank')}
              >
                Open Twitch
              </button>
              <button className="btn" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status.state === 'signed_in' && status.user && (
          <>
            <h2>Signed in as {status.user.display}</h2>
            <p>
              Scopes granted: <code>{status.scopes.join(' ') || 'none reported'}</code>
            </p>
            {!status.persistent && (
              <p className="warn">
                This system offers no secure storage, so the token is kept in memory only and you
                will sign in again next launch. It is not written to disk in the clear.
              </p>
            )}
            <p className="fine">
              Signing in does not remove ads &mdash; that is Turbo or a channel subscription, and it
              is decided on Twitch&rsquo;s side.
            </p>
            <div className="row">
              <button className="btn" onClick={props.onSignOut}>
                Sign out
              </button>
              <button className="btn btn-primary" onClick={props.onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
