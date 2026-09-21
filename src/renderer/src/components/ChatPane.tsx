import type { RefObject } from 'react'
import type { ChatState } from '@/chat/irc'
import { Power } from './Icons'

interface Props {
  logRef: RefObject<HTMLDivElement | null>
  state: ChatState
  channel: string | null
  showJump: boolean
  onJump: () => void
  /** Closed means the socket is gone, not merely off screen. */
  closed: boolean
  bytes: number
  onClose: () => void
  onConnect: () => void
  emotesOn: boolean
  emoteBytes: number
  emoteCount: number
  onToggleEmotes: () => void
}

const LABEL: Record<ChatState, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'connected',
  closed: 'offline'
}

function data(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ChatPane(props: Props): React.JSX.Element {
  return (
    <aside className="chat">
      <div className="chat-head">
        <span>{props.channel ? `#${props.channel}` : 'Chat'}</span>

        {!props.closed && props.bytes > 0 && (
          <span className="chat-data" title="Payload received since connecting">
            {data(props.bytes)}
          </span>
        )}

        <button
          className={`chat-7tv ${props.emotesOn ? 'is-on' : ''}`}
          onClick={props.onToggleEmotes}
          title={
            props.emotesOn
              ? `7TV emotes on${props.emoteCount ? ` - ${props.emoteCount} available` : ''}` +
                `${props.emoteBytes ? `, ${data(props.emoteBytes)} downloaded` : ''}.` +
                ' Turn off to stop downloading emote images.'
              : '7TV emotes off - emote names render as plain text and nothing is downloaded.'
          }
        >
          7TV
          {props.emotesOn && props.emoteBytes > 0 && (
            <span className="chat-7tv-data">{data(props.emoteBytes)}</span>
          )}
        </button>

        <span className={`chat-state is-${props.closed ? 'idle' : props.state}`}>
          {props.closed ? 'closed' : LABEL[props.state]}
        </span>

        {!props.closed && (
          <button
            className="chat-close"
            onClick={props.onClose}
            title="Close chat - drops the connection and stops the data. Hiding it does not."
          >
            <Power />
          </button>
        )}
      </div>

      <div className="chat-body">
        {/* Always mounted: the message list binds to this node once, at startup. */}
        <div className="chat-log" ref={props.logRef} />

        {props.closed && (
          <div className="chat-closed">
            <p className="chat-closed-title">Chat is closed</p>
            <p>
              The connection is dropped and nothing is being downloaded. Reconnecting starts from
              an empty log &mdash; Twitch sends no backlog, so nothing said while it was closed
              can be recovered.
            </p>
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
    </aside>
  )
}
