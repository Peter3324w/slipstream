interface Props {
  on: boolean
  /** Emote data fetched so far. Lives in the tooltip, not in the header. */
  bytes: number
  onToggle: (on: boolean) => void
}

export function data(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * One switch: chat drawn with emotes, or chat as plain names.
 *
 * This was four checkboxes - Twitch, 7TV, BTTV, FFZ - on the argument that on a
 * bad line, dropping 7TV's 290KB index while keeping the two cheap ones is a real
 * choice. It is, but it is not a choice anyone wants to make while reading chat,
 * and four rows signalled by a tint could not even say which were on. The
 * decision people actually have is binary: pictures, or words.
 *
 * The per-provider machinery is all still there behind it - main fetches by
 * provider and this turns them on together - so the finer control is a UI change
 * away if it is ever wanted back.
 */
export function EmoteToggle({ on, bytes, onToggle }: Props): React.JSX.Element {
  return (
    <button
      className={`chat-7tv chat-emotes ${on ? 'is-on' : ''}`}
      onClick={() => onToggle(!on)}
      role="switch"
      aria-checked={on}
      title={
        on
          ? `Emotes are drawn as images${bytes ? `. ${data(bytes)} downloaded so far` : ''}. Click to read chat as plain names instead.`
          : 'Emotes read as their names - LUL stays LUL - and nothing is downloaded for them. Click to draw them.'
      }
    >
      {/*
        * The label is the state, not the action. A tick box would say it too, but
        * measured it costs 20px of a header with 48px to spare, and the channel
        * name pays - whereas one word says which of the two modes chat is in and
        * costs nothing.
        */}
      {on ? 'EMOTES' : 'NAMES'}
    </button>
  )
}
