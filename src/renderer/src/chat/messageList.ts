import { colorFor, type ChatMessage } from './irc'

const EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

/** How close to the bottom still counts as "following along", in px. */
const PIN_SLOP = 48

/**
 * The chat log, rendered by hand.
 *
 * A busy Twitch channel pushes 20+ messages a second. Putting that through a
 * virtual DOM means a reconcile per message, and a growing keyed list is exactly
 * the shape React is worst at. This is the single hottest path in the app and the
 * thing the README blames for the browser's 988MB tab, so it is plain DOM:
 * appends batched into one animation frame, a hard cap on node count, and no
 * framework in the loop. Appearance is still all CSS, so styling stays editable.
 */
export class ChatList {
  private queue: ChatMessage[] = []
  private frame = 0
  private pinned = true
  private byLogin = new Map<string, Set<HTMLElement>>()

  constructor(
    private readonly root: HTMLElement,
    private readonly max = 250,
    private readonly onPinnedChange?: (pinned: boolean) => void
  ) {
    this.root.addEventListener('scroll', this.handleScroll, { passive: true })
  }

  private handleScroll = (): void => {
    const distance = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight
    const next = distance <= PIN_SLOP
    if (next !== this.pinned) {
      this.pinned = next
      this.onPinnedChange?.(next)
    }
  }

  push(msg: ChatMessage): void {
    this.queue.push(msg)
    this.schedule()
  }

  system(text: string): void {
    const el = document.createElement('div')
    el.className = 'msg-system'
    el.textContent = text
    this.appendNode(el)
    this.trim()
    this.scrollIfPinned()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.flush()
    })
  }

  private flush(): void {
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []

    const frag = document.createDocumentFragment()
    for (const msg of batch) frag.append(this.build(msg))
    this.root.append(frag)

    this.trim()
    this.scrollIfPinned()
  }

  private build(msg: ChatMessage): HTMLElement {
    const el = document.createElement('div')
    el.className = 'msg'
    el.dataset.login = msg.login

    const nick = document.createElement('span')
    nick.className = 'nick'
    nick.style.color = msg.color || colorFor(msg.login)
    nick.textContent = msg.display
    el.append(nick, ' ')

    const body = document.createElement('span')
    body.className = 'body'

    // Twitch reports emote offsets in code points, so a message containing an
    // astral character (any emoji) desyncs if you index the string directly.
    const cps = Array.from(msg.body)
    let cursor = 0
    for (const e of msg.emotes) {
      if (e.start < cursor || e.end >= cps.length) continue
      if (e.start > cursor) body.append(cps.slice(cursor, e.start).join(''))
      const img = document.createElement('img')
      img.className = 'emote'
      img.loading = 'lazy'
      img.decoding = 'async'
      img.src = `${EMOTE_CDN}/${e.id}/default/dark/1.0`
      img.alt = cps.slice(e.start, e.end + 1).join('')
      img.title = img.alt
      body.append(img)
      cursor = e.end + 1
    }
    if (cursor < cps.length) body.append(cps.slice(cursor).join(''))

    el.append(body)

    let set = this.byLogin.get(msg.login)
    if (!set) this.byLogin.set(msg.login, (set = new Set()))
    set.add(el)

    return el
  }

  private appendNode(el: HTMLElement): void {
    this.root.append(el)
  }

  /** A moderator timed this user out; drop what they already said. */
  purge(login: string): void {
    const set = this.byLogin.get(login.toLowerCase())
    if (!set) return
    for (const el of set) el.remove()
    this.byLogin.delete(login.toLowerCase())
  }

  private trim(): void {
    let overflow = this.root.childElementCount - this.max
    while (overflow-- > 0 && this.root.firstElementChild) {
      const el = this.root.firstElementChild as HTMLElement
      const login = el.dataset.login
      if (login) {
        const set = this.byLogin.get(login)
        if (set) {
          set.delete(el)
          if (!set.size) this.byLogin.delete(login)
        }
      }
      el.remove()
    }
  }

  private scrollIfPinned(): void {
    if (this.pinned) this.root.scrollTop = this.root.scrollHeight
  }

  jumpToLatest(): void {
    this.pinned = true
    this.onPinnedChange?.(true)
    this.root.scrollTop = this.root.scrollHeight
  }

  clear(): void {
    this.queue = []
    this.byLogin.clear()
    this.root.replaceChildren()
    this.pinned = true
    this.onPinnedChange?.(true)
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.root.removeEventListener('scroll', this.handleScroll)
    this.clear()
  }
}
