import type { ReactNode, RefObject } from 'react'
import type { ChatState } from '@/chat/irc'
import type { VodChatState } from '@/chat/vodChat'
import { ChatInput } from './ChatInput'
import { ChevronLeft, ChevronRight } from './Icons'

interface Props {
  menu: ReactNode
  logRef: RefObject<HTMLDivElement | null>
  state: ChatState
  channel: string | null
  /**
   * Collapsed is a slim strip, and still connected - the same trade as hiding,
   * but the panel stays where you can see it is there and open it again.
   */
  collapsed: boolean
  onToggleCollapsed: () => void
  showJump: boolean
  onJump: () => void
  /** Closed means the socket is gone, not merely off screen. */
  closed: boolean
  onConnect: () => void
  /** A VOD is replay, not a room: no sync toggle, no sending, its own states. */
  vod: boolean
  vodState: VodChatState
  signedIn: boolean
  showSignIn: boolean
  canSend: boolean
  onSend: (text: string) => boolean
  onSignIn: () => void
}

const LABEL: Record<ChatState, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'connected',
  closed: 'offline'
}

const VOD_LABEL: Record<VodChatState, string> = {
  idle: 'idle',
  loading: 'loading',
  replaying: 'replay',
  ended: 'end of vod',
  failed: 'failed'
}


export function ChatPane(props: Props): React.JSX.Element {
  const label = props.closed ? 'closed' : props.vod ? VOD_LABEL[props.vodState] : LABEL[props.state]

  /** Green while it runs, amber while it fetches, grey when it is neither. */
  const dot = props.closed
    ? 'idle'
    : props.vod
      ? props.vodState === 'replaying'
        ? 'open'
        : props.vodState === 'loading'
          ? 'connecting'
          : 'idle'
      : props.state

  // A connected live room needs only its dot. VOD replay and inactive states
  // keep their labels; actions and traffic readings live in the options popup.
  const showState = props.vod
    ? props.vodState !== 'loading'
    : props.closed || props.state === 'idle' || props.state === 'closed'

  return (
    <aside className="chat glass-panel">
      <div className="chat-head">
        <button className="panel-toggle" type="button" onClick={props.onToggleCollapsed}
          onKeyDown={(event) => event.stopPropagation()}
          title={props.collapsed ? 'Expand chat' : 'Collapse chat'}
          aria-label={props.collapsed ? 'Expand chat' : 'Collapse chat'}
          aria-expanded={!props.collapsed}>
          {props.collapsed ? <ChevronLeft /> : <ChevronRight />}
        </button>
        {!props.collapsed && (
          <>
            <span className="chat-name" title={props.channel ? `#${props.channel}` : undefined}>
              {props.channel ? `#${props.channel}` : 'Chat'}
            </span>
            <span className={`chat-state is-${dot}`} title={`Chat ${label}`}>
              {showState && label}
            </span>
          </>
        )}
        {props.menu}
      </div>

      <div className="chat-body">
        {/* Always mounted: the message list binds to this node once, at startup. */}
        <div className="chat-log" ref={props.logRef} />

        {props.closed && (
          <div className="chat-closed">
            <p className="chat-closed-title">Chat is closed</p>
            {props.vod ? (
              <p>
                Nothing is being downloaded. Starting it again picks up wherever the video is
                &mdash; replay can go back, because Twitch kept what was said.
              </p>
            ) : (
              <p>
                The connection is dropped and nothing is being downloaded. Reconnecting starts from
                an empty log &mdash; Twitch sends no backlog, so nothing said while it was closed
                can be recovered.
              </p>
            )}
            <button className="btn btn-primary" onClick={props.onConnect}>
              Connect
            </button>
          </div>
        )}

        {props.showJump && !props.closed && (
          <button className="chat-jump" onClick={props.onJump}>
            Jump to latest
          </button>
        )}
      </div>

      {/* With sign-in put away there is nothing to offer here: reading needs no
          account, and a prompt you cannot act on is worse than no prompt. */}
      {/* Nothing to send to: the broadcast is over. */}
      {!props.closed && !props.collapsed && !props.vod && (props.signedIn || props.showSignIn) && (
        <ChatInput
          signedIn={props.signedIn}
          canSend={props.canSend}
          onSend={props.onSend}
          onSignIn={props.onSignIn}
        />
      )}
    </aside>
  )
}
