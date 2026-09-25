import type { ChatMessage } from './irc'
import type { ChatList } from './messageList'

/**
 * How much chat to keep for rewinding. A little over the video's own back
 * buffer (120s), so the far end of a rewind still has the messages around it.
 */
const HISTORY_MS = 150_000

/**
 * A hard cap as well, because a huge channel can say several thousand things
 * in two minutes. Past this a full rewind starts partway into the window.
 */
const HISTORY_MAX = 3000

/** Going back further than this counts as a rewind and redraws the log. */
const REWIND_SLOP_MS = 1500

const TICK_MS = 200

/**
 * Holds chat back until the video reaches the moment each message was sent.
 *
 * Every message carries Twitch's `tmi-sent-ts`, and every Twitch segment carries
 * EXT-X-PROGRAM-DATE-TIME, which hls.js turns into the wall-clock time of the
 * frame on screen. Both come from Twitch's clocks, so comparing them needs no
 * guess at the viewer's latency - and it fixes the usual spoiler, where chat
 * reacts to a play a few seconds before the video shows it.
 *
 * Pausing freezes chat because that clock stops. Seeking back redraws the log
 * from history. When there is no clock (no stream, or a manifest without dates)
 * messages go straight through, same as with sync off.
 */
export class ChatSync {
  enabled = true

  /** Every message still inside the window, in arrival order. */
  private history: ChatMessage[] = []
  /** Index into history of the first message not yet on screen. */
  private next = 0
  /** Video time the log is currently drawn up to. */
  private shownUpTo = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly list: ChatList,
    /** Wall-clock ms of the frame on screen, or null when it is not known. */
    private readonly clock: () => number | null,
    /** How many messages the log itself holds; a redraw never renders more. */
    private readonly visible = 250
  ) {
    this.timer = setInterval(this.tick, TICK_MS)
  }

  push(msg: ChatMessage): void {
    const now = this.clock()

    // Your own message is stamped with local time, which is ahead of what you
    // are watching. Put it at the frame you sent it from, and show it at once.
    if (msg.id.startsWith('self-')) {
      const stamped = now === null ? msg : { ...msg, ts: now }
      this.record(stamped, true)
      this.list.push(stamped)
      return
    }

    const immediate = !this.enabled || now === null
    this.record(msg, immediate)
    if (immediate) this.list.push(msg)
  }

  /** A moderator cleared this user; do not let a rewind bring them back. */
  purge(login: string): void {
    const who = login.toLowerCase()
    const kept: ChatMessage[] = []
    let next = 0
    this.history.forEach((m, i) => {
      if (m.login === who) return
      if (i < this.next) next++
      kept.push(m)
    })
    this.history = kept
    this.next = next
    this.list.purge(login)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.catchUp()
    else this.tick()
  }

  /** Empty the log and forget the history: a new channel, or chat closed. */
  reset(): void {
    this.history = []
    this.next = 0
    this.shownUpTo = 0
    this.list.clear()
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.history = []
  }

  private record(msg: ChatMessage, shown: boolean): void {
    if (shown) {
      // Goes in ahead of anything still being held. For your own message that
      // is also its place in time, which keeps history sorted for a redraw.
      this.history.splice(this.next, 0, msg)
      this.next++
      this.shownUpTo = Math.max(this.shownUpTo, msg.ts)
    } else {
      this.history.push(msg)
    }
    this.trim()
  }

  private trim(): void {
    const newest = this.history[this.history.length - 1]?.ts ?? 0
    let drop = 0
    while (
      drop < this.history.length &&
      (this.history.length - drop > HISTORY_MAX || this.history[drop].ts < newest - HISTORY_MS)
    ) {
      drop++
    }
    if (!drop) return
    this.history.splice(0, drop)
    this.next = Math.max(0, this.next - drop)
  }

  /** Sync off: put out everything that was being held. */
  private catchUp(): void {
    for (; this.next < this.history.length; this.next++) this.list.push(this.history[this.next])
    const last = this.history[this.history.length - 1]
    if (last) this.shownUpTo = Math.max(this.shownUpTo, last.ts)
  }

  private tick = (): void => {
    if (!this.enabled) return
    const now = this.clock()
    if (now === null) {
      this.catchUp()
      return
    }

    if (now < this.shownUpTo - REWIND_SLOP_MS) {
      this.redraw(now)
      return
    }

    for (; this.next < this.history.length; this.next++) {
      const m = this.history[this.next]
      if (m.ts > now) break
      this.list.push(m)
    }
    this.shownUpTo = Math.max(this.shownUpTo, now)
  }

  /** Seeked back: draw the log as it stood at that moment. */
  private redraw(now: number): void {
    let end = 0
    while (end < this.history.length && this.history[end].ts <= now) end++

    this.list.clear()
    for (let i = Math.max(0, end - this.visible); i < end; i++) this.list.push(this.history[i])
    this.next = end
    this.shownUpTo = now
  }
}
