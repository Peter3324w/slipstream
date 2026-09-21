import type { RefObject } from 'react'
import type { ChatState } from '@/chat/irc'

interface Props {
  logRef: RefObject<HTMLDivElement | null>
  state: ChatState
  channel: string | null
  showJump: boolean
  onJump: () => void
}

const LABEL: Record<ChatState, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'connected',
  closed: 'offline'
}

export function ChatPane(props: Props): React.JSX.Element {
  return (
    <aside className="chat">
      <div className="chat-head">
        <span>{props.channel ? `#${props.channel}` : 'Chat'}</span>
        <span className={`chat-state is-${props.state}`}>{LABEL[props.state]}</span>
      </div>
      <div className="chat-body">
        <div className="chat-log" ref={props.logRef} />
        {props.showJump && (
          <button className="chat-jump" onClick={props.onJump}>
            Jump to latest
          </button>
        )}
      </div>
    </aside>
  )
}
