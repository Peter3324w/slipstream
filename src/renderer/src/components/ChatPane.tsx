import type { RefObject } from 'react'
import type { ChatState } from '@/chat/irc'
import type { VodChatState } from '@/chat/vodChat'
import type { EmoteProvider } from '@shared/types'
import { ChevronLeft, ChevronRight, Clock, Power } from './Icons'
import { EmoteMenu, data } from './EmoteMenu'
import { ChatInput } from './ChatInput'

interface Props {
  logRef: RefObject<HTMLDivElement | null>
  state: ChatState
  channel: string | null
  /**
   * Collapsed is a slim strip, and still connected - the same trade as hiding,
   * but the panel stays where you can see it is there and open it again.
   */
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Chat follows the video: pausing freezes it, rewinding replays it. */
  synced: boolean
  onToggleSync: () => void
  showJump: boolean
  onJump: () => void
  /** Closed means the socket is gone, not merely off screen. */
  closed: boolean
  bytes: number
  onClose: () => void
  onConnect: () => void
  emoteProviders: EmoteProvider[]
  emoteCounts: Record<EmoteProvider, number>
  emoteBytes: number
  onToggleProvider: (provider: EmoteProvider) => void
  /** Twitch's own emotes, switchable like any other source. */
  /** A VOD is replay, not a room: no sync toggle, no sending, its own states. */
  vod: boolean
  vodState: VodChatState
  twitchEmotes: boolean
  onToggleTwitchEmotes: () => void
  onSetAllEmotes: (on: boolean) => void
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

  /*
   * Live rides on the dot alone - connecting pulses amber, connected is a steady
   * green - which buys back the 62px the word "connected" was taking out of a
   * header that has no room to spare. Idle and offline keep their word: those are
   * the two you might have to do something about.
   *
   * A VOD keeps its word instead, because "replay" is the one thing a viewer has
   * to know about this chat. The sync pill is gone on a VOD, which pays for it.
   */
  const showState = props.vod
    ? props.vodState !== 'loading'
    : props.closed || props.state === 'idle' || props.state === 'closed'

  return (
    <aside className="chat">
      <div className="chat-head">
        <button
          className="panel-toggle"
          onClick={props.onToggleCollapsed}
          title={props.collapsed ? 'Expand chat' : 'Collapse chat - stays connected'}
        >
          {props.collapsed ? <ChevronLeft /> : <ChevronRight />}
        </button>

        {props.collapsed ? (
          <span
            className={`chat-state chat-state-dot is-${props.closed ? 'idle' : props.state}`}
            title={`Chat ${label}`}
          />
        ) : (
          <>
            <span className="chat-name" title={props.channel ? `#${props.channel}` : undefined}>
              {props.channel ? `#${props.channel}` : 'Chat'}
            </span>

            {/* Only while the socket is actually open: once chat drops, the word
                "offline" is what matters, and it needs the room a stale total was
                holding - the name was squeezing to "#su..." to pay for both. */}
            {!props.closed &&
              (props.vod
                ? props.vodState !== 'idle' && props.vodState !== 'failed'
                : props.state === 'open') &&
              props.bytes > 0 && (
                <span
                  className="chat-data"
                  title={props.vod ? 'Replay fetched since this VOD started' : 'Payload received since connecting'}
                >
                  {data(props.bytes)}
                </span>
              )}

            {/* Replay is synced by construction - a comment's offset is where it
                belongs - so there is nothing here to switch. */}
            {!props.vod && (
              <button
                className={`chat-7tv ${props.synced ? 'is-on' : ''}`}
                onClick={props.onToggleSync}
                title={
                  props.synced
                    ? 'Chat is synced to the video - pausing freezes it, rewinding replays it. Click for real-time chat.'
                    : 'Chat is real-time. Click to sync it to the video.'
                }
              >
                <Clock size={11} />
                sync
              </button>
            )}

            <EmoteMenu
              enabled={props.emoteProviders}
              counts={props.emoteCounts}
              bytes={props.emoteBytes}
              onToggle={props.onToggleProvider}
              twitch={props.twitchEmotes}
              onToggleTwitch={props.onToggleTwitchEmotes}
              onSetAll={props.onSetAllEmotes}
            />

            <span className={`chat-state is-${dot}`} title={`Chat ${label}`}>
              {showState && label}
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
          </>
        )}
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
