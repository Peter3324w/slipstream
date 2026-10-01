import type { VodChatMessage, VodChatPage } from '@shared/types'
import type { ChatMessage } from './irc'
import type { ChatList } from './messageList'

export type VodChatState = 'idle' | 'loading' | 'replaying' | 'ended' | 'failed'

/** Video seconds of chat to keep buffered ahead of the playhead. */
const LOOKAHEAD_SECONDS = 20

/**
 * A seek lands here many seconds before the playhead, so it arrives in the
 * middle of a conversation rather than staring at an empty pane until the next
 * thing anyone happens to say.
 */
const CONTEXT_SECONDS = 30

/** Going back further than this, or forward past the buffer, is a seek. */
const REWIND_SLOP_SECONDS = 2
const JUMP_AHEAD_SECONDS = 30

const TICK_MS = 200
const RETRY_MS = 5000

/** Ids kept for deduplication. A page is ~58, so this is many pages deep. */
const SEEN_MAX = 4000

/**
 * Chat as it was said, replayed against the video's own clock.
 *
 * The live path holds messages until the frame they belong to
 * ([[ChatSync]]); here the messages are already stamped with where they belong
 * - `contentOffsetSeconds` from the start of the VOD - so the clock is simply
 * `video.currentTime`. Pausing stops chat because that clock stops, and seeking
 * redraws from the new position, both for free.
 *
 * Paging is by offset and deduplicated by id, because Twitch refuses cursor
 * paging to an anonymous client; see the note on `vodComments` in main. A page
 * overlaps the one before it by a second or so, which is why `seen` exists.
 */
export class VodChat {
  private videoId: string | null = null
  private buffer: VodChatMessage[] = []
  private seen = new Set<string>()
  private nextOffset = 0
  private hasMore = true
  private fetching = false
  private shownUpTo = 0
  private bytes = 0
  private retryAt = 0
  /** Bumped by anything that invalidates a fetch in flight. */
  private generation = 0
  private state: VodChatState = 'idle'
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly list: ChatList,
    /** Video position in seconds, or null when a VOD is not what is playing. */
    private readonly clock: () => number | null,
    private readonly fetchPage: (id: string, offset: number) => Promise<VodChatPage>,
    private readonly onChange?: (state: VodChatState, bytes: number) => void
  ) {
    this.timer = setInterval(this.tick, TICK_MS)
  }

  get bytesReceived(): number {
    return this.bytes
  }

  start(videoId: string): void {
    this.generation++
    this.videoId = videoId
    this.bytes = 0
    this.reseek(this.clock() ?? 0)
    this.emit('loading')
  }

  /** Stop replaying and stop fetching. The log is left as it is. */
  stop(): void {
    this.generation++
    this.videoId = null
    this.buffer = []
    this.seen.clear()
    this.fetching = false
    this.emit('idle')
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stop()
  }

  private tick = (): void => {
    if (!this.videoId) return
    const now = this.clock()
    if (now === null) return

    // A seek in either direction: the buffer describes somewhere else now.
    if (now < this.shownUpTo - REWIND_SLOP_SECONDS || now > this.shownUpTo + JUMP_AHEAD_SECONDS) {
      this.reseek(now)
      return
    }
    this.shownUpTo = now

    while (this.buffer.length && this.buffer[0].offset <= now) {
      this.list.push(toChatMessage(this.buffer.shift() as VodChatMessage))
    }

    const covered = this.buffer.length ? this.buffer[this.buffer.length - 1].offset : now
    if (this.hasMore && covered < now + LOOKAHEAD_SECONDS) void this.fetch()
    else if (!this.hasMore && !this.buffer.length) this.emit('ended')
  }

  private reseek(now: number): void {
    this.generation++
    this.buffer = []
    this.seen.clear()
    this.list.clear()
    this.shownUpTo = now
    this.hasMore = true
    this.fetching = false
    this.retryAt = 0
    this.nextOffset = Math.max(0, Math.floor(now) - CONTEXT_SECONDS)
    this.emit('loading')
    void this.fetch()
  }

  private async fetch(): Promise<void> {
    const id = this.videoId
    if (!id || this.fetching || Date.now() < this.retryAt) return

    const generation = this.generation
    const offset = this.nextOffset
    this.fetching = true

    let page: VodChatPage | null = null
    try {
      page = await this.fetchPage(id, offset)
    } catch {
      page = null
    }

    // A seek, a stop or another VOD while this was in flight: it describes a
    // position nobody is at any more.
    if (generation !== this.generation) return
    this.fetching = false

    if (!page) {
      this.retryAt = Date.now() + RETRY_MS
      this.emit('failed')
      return
    }

    this.bytes += page.bytes
    if (page.failed) {
      this.retryAt = Date.now() + RETRY_MS
      this.emit('failed')
      return
    }

    let added = 0
    for (const m of page.messages) {
      if (this.seen.has(m.id)) continue
      this.seen.add(m.id)
      this.buffer.push(m)
      added++
    }
    if (added) this.buffer.sort((a, b) => a.offset - b.offset)
    this.trimSeen()

    this.hasMore = page.hasMore
    // A page that was pure overlap would otherwise ask for the same window for
    // ever: step past it. A second holding more messages than one page is the
    // only way that happens, and one second of a hype moment is a fair price.
    this.nextOffset = added ? page.nextOffset : page.nextOffset + 1
    this.emit(this.hasMore || this.buffer.length ? 'replaying' : 'ended')
  }

  private trimSeen(): void {
    if (this.seen.size <= SEEN_MAX) return
    // Pages only move forward, so the oldest ids cannot come round again.
    this.seen = new Set([...this.seen].slice(-Math.floor(SEEN_MAX / 2)))
  }

  private emit(state: VodChatState): void {
    const changed = state !== this.state
    this.state = state
    if (changed) this.onChange?.(state, this.bytes)
  }
}

function toChatMessage(m: VodChatMessage): ChatMessage {
  return {
    id: m.id,
    login: m.login,
    display: m.display,
    color: m.color,
    body: m.body,
    emotes: m.emotes,
    // Unused by the log, which draws in arrival order; kept honest anyway.
    ts: m.offset * 1000
  }
}
