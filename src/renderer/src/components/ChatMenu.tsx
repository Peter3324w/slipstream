import { useEffect, useId, useRef, useState } from 'react'
import { ThemePicker } from './ThemePicker'
import { data } from './EmoteToggle'
import { ChevronLeft, ChevronRight, Clock, Gauge, Palette, Power, Rail, Smile, Star, User } from './Icons'

interface Props {
  channel: string | null
  favourite: boolean
  onFavourite: () => void
  railVisible: boolean
  onRail: () => void
  showSignIn: boolean
  canSignIn: boolean
  accountLabel: string
  onSignIn: () => void
  hudVisible: boolean
  onHud: () => void
  collapsed: boolean
  onCollapse: () => void
  vod: boolean
  synced: boolean
  onSync: () => void
  emotesOn: boolean
  onEmotes: () => void
  emoteBytes: number
  bytes: number
  closed: boolean
  onConnection: () => void
}

export function ChatMenu(props: Props): React.JSX.Element {
  const id = useId()
  const popup = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const close = (): void => popup.current?.hidePopover()
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [expanded])

  const position = (): void => {
    const menu = popup.current
    const button = trigger.current
    if (!menu || !button) return
    const rect = button.getBoundingClientRect()
    menu.style.top = `${rect.bottom + 8}px`
    menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`
  }

  const action = (run: () => void): void => {
    popup.current?.hidePopover()
    run()
  }

  return (
    <div className="chat-menu-anchor">
      <button className="panel-toggle chat-menu-trigger" ref={trigger} onClick={position}
        popoverTarget={id} popoverTargetAction="toggle"
        onKeyDown={(event) => event.stopPropagation()}
        title="Chat and app options" aria-label="Chat and app options"
        aria-haspopup="dialog" aria-controls={id} aria-expanded={expanded}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="9" r="1.5" /><circle cx="9" cy="9" r="1.5" /><circle cx="14" cy="9" r="1.5" />
        </svg>
      </button>
      <div className="chat-options" id={id} ref={popup} popover="auto" role="dialog"
        aria-label="Chat and app options"
        onToggle={() => {
          const isOpen = popup.current?.matches(':popover-open') ?? false
          setExpanded(isOpen)
          if (isOpen) popup.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            popup.current?.hidePopover()
            trigger.current?.focus()
          }
        }}>
        <div className="chat-options-heading">Chat options</div>
        {!props.vod && (
          <button className="chat-option" role="switch" aria-label="Sync chat to video" aria-checked={props.synced} onClick={props.onSync}>
            <span className="chat-option-icon" aria-hidden="true"><Clock size={16} /></span>
            <span>Sync chat to video</span><span className="chat-option-state">{props.synced ? 'On' : 'Off'}</span>
          </button>
        )}
        <button className="chat-option" role="switch" aria-label="Show emotes" aria-checked={props.emotesOn} onClick={props.onEmotes}
          title={`Emote images downloaded: ${data(props.emoteBytes)}`}>
          <span className="chat-option-icon" aria-hidden="true"><Smile /></span>
          <span>Show emotes</span><span className="chat-option-state">{props.emotesOn ? 'On' : 'Off'}</span>
        </button>
        <button className="chat-option" onClick={() => action(props.onConnection)}>
          <span className="chat-option-icon" aria-hidden="true"><Power size={16} /></span>
          <span>{props.closed ? 'Connect chat' : 'Disconnect chat'}</span>
        </button>
        <button className="chat-option" onClick={() => action(props.onCollapse)}>
          <span className="chat-option-icon" aria-hidden="true">{props.collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</span>
          <span>{props.collapsed ? 'Expand chat' : 'Collapse chat'}</span>
        </button>
        <div className="chat-options-data">Chat {data(props.bytes)} · Emotes {data(props.emoteBytes)}</div>
        <div className="chat-options-separator" />
        {props.channel && (
          <button className="chat-option" onClick={() => action(props.onFavourite)}>
            <span className="chat-option-icon" aria-hidden="true"><Star /></span>
            <span>{props.favourite ? 'Remove channel from favourites' : 'Add channel to favourites'}</span>
          </button>
        )}
        <button className="chat-option" role="switch" aria-label="Show favourites" aria-checked={props.railVisible} onClick={props.onRail}>
          <span className="chat-option-icon" aria-hidden="true"><Rail /></span>
          <span>Show favourites</span><span className="chat-option-state">{props.railVisible ? 'On' : 'Off'}</span>
        </button>
        {props.showSignIn && (
          <button className="chat-option" disabled={!props.canSignIn} onClick={() => action(props.onSignIn)}>
            <span className="chat-option-icon" aria-hidden="true"><User /></span>
            <span>{props.accountLabel}</span>
          </button>
        )}
        <button className="chat-option" role="switch" aria-label="Memory readout" aria-checked={props.hudVisible} onClick={props.onHud}>
          <span className="chat-option-icon" aria-hidden="true"><Gauge /></span>
          <span>Memory readout</span><span className="chat-option-state">{props.hudVisible ? 'On' : 'Off'}</span>
        </button>
        <details className="chat-appearance">
          <summary>
            <span className="chat-option-icon" aria-hidden="true"><Palette /></span>
            <span>Appearance</span>
            <span className="chat-appearance-arrow" aria-hidden="true"><ChevronRight /></span>
          </summary>
          <ThemePicker inline />
        </details>
      </div>
    </div>
  )
}
