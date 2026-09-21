export interface EmoteRange {
  id: string
  /** Code point offsets, inclusive, as Twitch reports them. */
  start: number
  end: number
}

export interface ChatMessage {
  id: string
  login: string
  display: string
  color: string | null
  body: string
  emotes: EmoteRange[]
  ts: number
}

export type ChatState = 'idle' | 'connecting' | 'open' | 'closed'

export interface ChatHandlers {
  onMessage: (msg: ChatMessage) => void
  onSystem: (text: string) => void
  onState: (state: ChatState) => void
  /** A moderator cleared this user's messages. */
  onPurge: (login: string) => void
}

const ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443'

/** Shared, because allocating one per frame at 20 messages a second is silly. */
const ENCODER = new TextEncoder()

/** IRCv3 tag escaping, per the spec Twitch follows. */
function unescapeTag(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) =>
    c === 's' ? ' ' : c === ':' ? ';' : c === 'r' ? '\r' : c === 'n' ? '\n' : c
  )
}

function parseTags(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) out[pair] = ''
    else out[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1))
  }
  return out
}

/** `25:0-4,6-10/1902:12-16` */
function parseEmotes(raw: string): EmoteRange[] {
  if (!raw) return []
  const out: EmoteRange[] = []
  for (const group of raw.split('/')) {
    const colon = group.indexOf(':')
    if (colon === -1) continue
    const id = group.slice(0, colon)
    for (const range of group.slice(colon + 1).split(',')) {
      const [a, b] = range.split('-')
      const start = Number(a)
      const end = Number(b)
      if (Number.isInteger(start) && Number.isInteger(end)) out.push({ id, start, end })
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

interface IrcLine {
  tags: Record<string, string>
  prefix: string
  command: string
  params: string[]
}

function parseLine(line: string): IrcLine | null {
  let rest = line
  let tags: Record<string, string> = {}

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ')
    if (sp === -1) return null
    tags = parseTags(rest.slice(1, sp))
    rest = rest.slice(sp + 1)
  }

  let prefix = ''
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ')
    if (sp === -1) return null
    prefix = rest.slice(1, sp)
    rest = rest.slice(sp + 1)
  }

  const params: string[] = []
  while (rest.length) {
    if (rest.startsWith(':')) {
      params.push(rest.slice(1))
      break
    }
    const sp = rest.indexOf(' ')
    if (sp === -1) {
      params.push(rest)
      break
    }
    params.push(rest.slice(0, sp))
    rest = rest.slice(sp + 1)
  }

  const command = params.shift()
  return command ? { tags, prefix, command, params } : null
}

/**
 * Twitch assigns a colour only to users who picked one. For everyone else the web
 * client derives a stable colour from the name, so the same person looks the same
 * every session. Same idea here, against our own palette.
 */
const FALLBACK_COLORS = [
  '#ff7a85', '#ff9f5a', '#f2c94c', '#6ee7a0', '#5ad1e6',
  '#7aa2ff', '#b18cff', '#ff8fd0', '#8fe3c8', '#ffb3a7'
]

export function colorFor(login: string): string {
  let h = 0
  for (let i = 0; i < login.length; i++) h = (h * 31 + login.charCodeAt(i)) | 0
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length]
}

export class TwitchChat {
  private ws: WebSocket | null = null
  private channel: string | null = null
  private retries = 0
  /** Payload bytes off the socket since the last connect. Makes the cost of
   *  leaving chat running visible, which is the point of being able to close it. */
  private bytes = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUs = false

  constructor(private readonly handlers: ChatHandlers) {}

  connect(channel: string): void {
    this.disconnect()
    this.channel = channel.toLowerCase()
    this.closedByUs = false
    this.bytes = 0
    this.open()
  }

  /** Approximate: payload only, excluding TLS and WebSocket framing overhead. */
  get bytesReceived(): number {
    return this.bytes
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private open(): void {
    if (!this.channel) return
    this.handlers.onState('connecting')

    const ws = new WebSocket(ENDPOINT)
    this.ws = ws

    ws.onopen = () => {
      // Reading chat needs no account at all: any justinfan<digits> nick is
      // accepted as an anonymous, read-only session.
      const nick = `justinfan${10000 + Math.floor(Math.random() * 89999)}`
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send(`NICK ${nick}`)
      ws.send(`JOIN #${this.channel}`)
      this.retries = 0
      this.handlers.onState('open')
    }

    ws.onmessage = (ev) => {
      const frame = String(ev.data)
      this.bytes += ENCODER.encode(frame).length
      for (const raw of frame.split('\r\n')) {
        if (raw) this.handleLine(raw)
      }
    }

    ws.onerror = () => {
      /* onclose always follows; retry logic lives there */
    }

    ws.onclose = () => {
      this.ws = null
      this.handlers.onState('closed')
      if (this.closedByUs) return
      const delay = Math.min(30_000, 1000 * 2 ** this.retries++)
      this.handlers.onSystem(`Chat disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`)
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
  }

  private handleLine(raw: string): void {
    const line = parseLine(raw)
    if (!line) return

    switch (line.command) {
      case 'PING':
        this.ws?.send(`PONG :${line.params[0] ?? 'tmi.twitch.tv'}`)
        break

      case 'PRIVMSG': {
        const login = line.prefix.split('!')[0]
        const body = line.params[1] ?? ''
        this.handlers.onMessage({
          id: line.tags['id'] || `${Date.now()}-${Math.random()}`,
          login,
          display: line.tags['display-name'] || login,
          color: line.tags['color'] || null,
          body,
          emotes: parseEmotes(line.tags['emotes'] || ''),
          ts: Number(line.tags['tmi-sent-ts']) || Date.now()
        })
        break
      }

      case 'CLEARCHAT': {
        const target = line.params[1]
        if (target) this.handlers.onPurge(target)
        break
      }

      case 'NOTICE':
        this.handlers.onSystem(line.params[1] ?? '')
        break

      case '353': // end of the name list; the join actually succeeded
      case '366':
        break
    }
  }

  disconnect(): void {
    this.closedByUs = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.channel = null
  }
}
