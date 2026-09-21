import { useState } from 'react'

interface Props {
  canSend: boolean
  signedIn: boolean
  onSend: (text: string) => boolean
  onSignIn: () => void
}

/** Twitch's own limit. Past it the message is dropped server side, silently. */
const MAX = 500

export function ChatInput(props: Props): React.JSX.Element {
  const [text, setText] = useState('')

  if (!props.signedIn) {
    return (
      <div className="chat-foot">
        <button className="btn chat-signin" onClick={props.onSignIn}>
          Sign in to chat
        </button>
      </div>
    )
  }

  const submit = (): void => {
    if (!text.trim()) return
    if (props.onSend(text)) setText('')
  }

  const left = MAX - text.length

  return (
    <form
      className="chat-foot"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        className="chat-entry"
        placeholder={props.canSend ? 'Send a message' : 'Connecting...'}
        value={text}
        maxLength={MAX}
        disabled={!props.canSend}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {left < 100 && <span className={`chat-left ${left < 20 ? 'is-low' : ''}`}>{left}</span>}
      <button className="btn btn-primary" type="submit" disabled={!props.canSend || !text.trim()}>
        Send
      </button>
    </form>
  )
}
