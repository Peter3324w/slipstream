import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolveFailure, ResolveResult, ResolvedStream } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { Player, type QualityLevel } from './player/hls'
import { TwitchChat, type ChatState } from './chat/irc'
import { ChatList } from './chat/messageList'
import { EmoteTraffic } from './chat/emotes'
import { ChatPane } from './components/ChatPane'
import { Controls } from './components/Controls'
import { MemoryHud } from './components/MemoryHud'
import { ChatBubble, ChatOff, Gauge } from './components/Icons'
import { Placeholder } from './components/Placeholder'

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving'; channel: string }
  | { kind: 'playing'; stream: ResolvedStream }
  | { kind: 'error'; reason: ResolveFailure; message: string }

const VOLUME_KEY = 'slipstream.volume'
const QUALITY_KEY = 'slipstream.quality'
const CHAT_CLOSED_KEY = 'slipstream.chatClosed'
const EMOTES_KEY = 'slipstream.emotes'

/**
 * Main's own caps add up to about 53s (30s streamlink + 15s manifest + 8s liveness),
 * so this only fires when main is genuinely stuck rather than merely slow. It exists
 * because the alternative failure mode is a spinner that never resolves, which is
 * exactly how a broken preload bridge presented: silent, and indistinguishable from
 * a slow network.
 */
const RESOLVE_TIMEOUT_MS = 60_000

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * The preload bridge is all or nothing. If it failed to load there is no point
 * pretending the app works - say so, and say that it is a build problem, because
 * it looks exactly like a network one.
 */
function bridgeReady(): boolean {
  return typeof window.slipstream?.resolveChannel === 'function'
}

export default function App(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const chatRef = useRef<TwitchChat | null>(null)
  const listRef = useRef<ChatList | null>(null)
  /** The channel currently on screen, readable from callbacks without re-binding. */
  const loginRef = useRef<string | null>(null)

  const [input, setInput] = useState('')
  /** Mirrors loginRef for rendering; a ref alone would not trigger an update. */
  const [channel, setChannel] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [levels, setLevels] = useState<QualityLevel[]>([])
  /** What hls.js is actually playing. Under ABR this moves on its own. */
  const [activeLevel, setActiveLevel] = useState(-1)
  /**
   * What the viewer asked for, as a label rather than an index, because level
   * indices are per-manifest and mean nothing on the next channel. null = Auto.
   */
  const [pinnedLabel, setPinnedLabel] = useState<string | null>(() =>
    localStorage.getItem(QUALITY_KEY)
  )
  const pinnedRef = useRef<string | null>(pinnedLabel)
  const [playing, setPlaying] = useState(false)
  /** The scrubbable window. Polled, because MSE has no event for it moving. */
  const [dvr, setDvr] = useState({ start: 0, end: 0, current: 0 })
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? 0.6))
  const [muted, setMuted] = useState(false)
  const [chatState, setChatState] = useState<ChatState>('idle')
  const [showJump, setShowJump] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  /**
   * Closed is not hidden. Hidden keeps the socket up, so the log stays current
   * and you pay for it the whole time. Closed drops the connection and frees the
   * message nodes; coming back costs a reconnect and starts from nothing.
   * Persisted, because closing it is a deliberate choice about data.
   */
  const [chatClosed, setChatClosed] = useState(() => localStorage.getItem(CHAT_CLOSED_KEY) === '1')
  const chatClosedRef = useRef(chatClosed)
  const [chatBytes, setChatBytes] = useState(0)

  /**
   * Third-party emotes. On by default, but a switch rather than a fixture:
   * a channel's index alone is ~290KB compressed, and the images on top of that
   * are what makes chat unwatchable on a poor connection.
   */
  const [emotesOn, setEmotesOn] = useState(() => localStorage.getItem(EMOTES_KEY) !== '0')
  const emotesOnRef = useRef(emotesOn)
  const [emoteBytes, setEmoteBytes] = useState(0)
  const [emoteCount, setEmoteCount] = useState(0)
  const trafficRef = useRef<EmoteTraffic | null>(null)
  const [hudVisible, setHudVisible] = useState(false)

  const loadEmotes = useCallback(async (login: string): Promise<void> => {
    if (!emotesOnRef.current || !bridgeReady()) return
    const set = await window.slipstream.fetchEmotes(login)
    if (loginRef.current !== login || !emotesOnRef.current) return
    if (listRef.current) listRef.current.emotes = set.emotes
    setEmoteCount(set.globalCount + set.channelCount)
    if (set.errors.length) listRef.current?.system(`7TV: ${set.errors.join('; ')}`)
  }, [])

  const start = useCallback(async (raw: string): Promise<void> => {
    const login = parseChannelInput(raw)
    if (!login) {
      setPhase({ kind: 'error', reason: 'invalid_channel', message: 'That does not look like a channel name.' })
      return
    }

    if (!bridgeReady()) {
      setPhase({
        kind: 'error',
        reason: 'error',
        message:
          'The preload bridge did not load, so nothing can reach streamlink. That is a build problem, not a network one.'
      })
      return
    }

    loginRef.current = login
    setChannel(login)
    setPhase({ kind: 'resolving', channel: login })
    setLevels([])

    let result: ResolveResult
    try {
      result = await withTimeout(
        window.slipstream.resolveChannel(login),
        RESOLVE_TIMEOUT_MS,
        'streamlink did not answer within 60 seconds.'
      )
    } catch (err) {
      if (loginRef.current !== login) return
      setPhase({
        kind: 'error',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }

    // The user may have moved on while streamlink was working.
    if (loginRef.current !== login) return

    if (!result.ok) {
      setPhase({ kind: 'error', reason: result.reason, message: result.message })
      chatRef.current?.disconnect()
      setChatState('idle')
      return
    }

    setPhase({ kind: 'playing', stream: result.stream })
    playerRef.current?.load(result.stream.masterPlaylist)
    listRef.current?.clear()
    if (!chatClosedRef.current) {
      listRef.current?.system(`Joining #${login}...`)
      chatRef.current?.connect(login)
      void loadEmotes(login)
    }
  }, [loadEmotes])

  const toggleEmotes = useCallback((): void => {
    const next = !emotesOnRef.current
    emotesOnRef.current = next
    setEmotesOn(next)
    localStorage.setItem(EMOTES_KEY, next ? '1' : '0')

    if (!next) {
      // Messages already on screen keep the images they downloaded; there is
      // nothing to reclaim by tearing them out. New ones render as plain text.
      if (listRef.current) listRef.current.emotes = null
      setEmoteCount(0)
      return
    }
    const login = loginRef.current
    if (login) void loadEmotes(login)
  }, [loadEmotes])

  const closeChat = useCallback((): void => {
    chatClosedRef.current = true
    setChatClosed(true)
    setChatBytes(0)
    localStorage.setItem(CHAT_CLOSED_KEY, '1')
    chatRef.current?.disconnect()
    // Drop the message nodes too - a closed chat should not still be holding
    // 250 elements and their emote images.
    listRef.current?.clear()
    setChatState('idle')
  }, [])

  const openChat = useCallback((): void => {
    chatClosedRef.current = false
    setChatClosed(false)
    setChatVisible(true)
    localStorage.removeItem(CHAT_CLOSED_KEY)
    const login = loginRef.current
    if (login) {
      listRef.current?.clear()
      listRef.current?.system(`Joining #${login}...`)
      chatRef.current?.connect(login)
      void loadEmotes(login)
    }
  }, [loadEmotes])

  /**
   * Show/hide only, in every state. Reconnecting is deliberately NOT on this
   * button: it costs data, so it lives behind Connect in the panel itself.
   */
  const toggleChat = useCallback((): void => setChatVisible((v) => !v), [])

  const cancel = useCallback((): void => {
    // Clearing the ref makes any in-flight resolve discard itself on return.
    loginRef.current = null
    setChannel(null)
    setPhase({ kind: 'idle' })
  }, [])

  /** Re-run the token dance and swap the manifest without disturbing chat. */
  const refresh = useCallback(async (): Promise<void> => {
    const login = loginRef.current
    if (!login) return
    let result: ResolveResult
    try {
      result = await withTimeout(
        window.slipstream.resolveChannel(login),
        RESOLVE_TIMEOUT_MS,
        'streamlink did not answer within 60 seconds.'
      )
    } catch {
      return // the stream is still playing; a failed refresh is not worth a teardown
    }
    if (loginRef.current !== login) return
    if (result.ok) {
      setPhase({ kind: 'playing', stream: result.stream })
      playerRef.current?.load(result.stream.masterPlaylist)
    } else {
      setPhase({ kind: 'error', reason: result.reason, message: result.message })
    }
  }, [])

  // -------------------------------------------------------------- wiring

  useEffect(() => {
    const video = videoRef.current
    const log = logRef.current
    if (!video || !log) return

    const list = new ChatList(log, 250, (pinned) => setShowJump(!pinned))
    listRef.current = list

    const chat = new TwitchChat({
      onMessage: (m) => list.push(m),
      onSystem: (t) => list.system(t),
      onState: setChatState,
      onPurge: (login) => list.purge(login)
    })
    chatRef.current = chat

    const player = new Player(video, {
      onLevels: (next) => {
        setLevels(next)
        // Re-apply a remembered choice on every new stream. Matching on the label
        // is the point: "720p60" survives a channel change, index 2 does not.
        const wanted = pinnedRef.current
        const match = wanted ? next.find((l) => l.label === wanted) : undefined
        if (match) player.setLevel(match.index)
        else if (wanted) setPinnedLabel(null) // this channel does not offer it
      },
      onLevelSwitch: setActiveLevel,
      onError: (message) => setPhase({ kind: 'error', reason: 'error', message }),
      onStale: () => void refresh()
    })
    playerRef.current = player

    const traffic = new EmoteTraffic()
    traffic.start()
    trafficRef.current = traffic

    return () => {
      traffic.stop()
      player.destroy()
      chat.disconnect()
      list.destroy()
      playerRef.current = null
      chatRef.current = null
      listRef.current = null
    }
  }, [refresh])

  // video element -> react state
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
    localStorage.setItem(VOLUME_KEY, String(volume))
  }, [volume, muted])

  // The buffer's floor and the live edge both move on their own, and MSE fires
  // no event when they do, so the bar has to be driven by polling. timeupdate
  // alone is too coarse (~4Hz, and it stops while paused).
  useEffect(() => {
    if (phase.kind !== 'playing') return
    const video = videoRef.current
    const tick = (): void => {
      const window = playerRef.current?.seekableWindow()
      if (window) setDvr(window)
    }
    tick()
    const id = setInterval(tick, 250)
    video?.addEventListener('timeupdate', tick)
    return () => {
      clearInterval(id)
      video?.removeEventListener('timeupdate', tick)
    }
  }, [phase.kind])

  useEffect(() => {
    pinnedRef.current = pinnedLabel
  }, [pinnedLabel])

  useEffect(() => {
    if (chatClosed) return
    const id = setInterval(() => {
      setChatBytes(chatRef.current?.bytesReceived ?? 0)
      setEmoteBytes(trafficRef.current?.total ?? 0)
    }, 1000)
    return () => clearInterval(id)
  }, [chatClosed])

  /**
   * Keep titlebar content clear of the native minimise/maximise/close buttons.
   *
   * The CSS env(titlebar-area-*) variables would do this, but they only exist
   * where Window Controls Overlay is active - so the layout silently differs
   * between the app and a browser tab. Reading the rect directly works in both,
   * and geometrychange fires on maximise/restore, when the reserved width moves.
   */
  useEffect(() => {
    const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
      .windowControlsOverlay
    if (!wco) return

    const apply = (): void => {
      const rect = wco.getTitlebarAreaRect()
      const inset = Math.max(0, window.innerWidth - (rect.x + rect.width))
      document.documentElement.style.setProperty('--titlebar-inset-right', `${inset + 8}px`)
    }
    apply()
    wco.addEventListener('geometrychange', apply)
    return () => wco.removeEventListener('geometrychange', apply)
  }, [])

  useEffect(() => {
    document.title = phase.kind === 'playing' ? `${phase.stream.channel.author} - Slipstream` : 'Slipstream'
  }, [phase])

  // ----------------------------------------------------------- shortcuts

  const seek = useCallback((delta: number): void => {
    const video = videoRef.current
    if (video) video.currentTime += delta
  }, [])

  const togglePlay = useCallback((): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      // Only bail for real text entry. Bailing for every input meant that once
      // you touched the volume slider, every shortcut silently stopped working.
      const typing =
        (target instanceof HTMLInputElement && target.type !== 'range') ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (typing) return

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'arrowleft':
          e.preventDefault()
          seek(-10)
          break
        case 'arrowright':
          e.preventDefault()
          seek(10)
          break
        case 'l':
          playerRef.current?.seekToLive()
          break
        case 'm':
          setMuted((v) => !v)
          break
        case 'c':
          toggleChat()
          break
        case 'f2':
          setHudVisible((v) => !v)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seek, togglePlay, toggleChat])

  // --------------------------------------------------------------- view

  const stream = phase.kind === 'playing' ? phase.stream : null

  return (
    <div className={`app ${chatVisible ? '' : 'chat-hidden'}`}>
      <header className="titlebar">
        <div className="wordmark">
          <span className="dot" />
          Slipstream
        </div>

        <form
          className="channel-form"
          onSubmit={(e) => {
            e.preventDefault()
            void start(input)
          }}
        >
          <input
            className="channel-input"
            placeholder="channel or twitch.tv link"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim()}>
            Watch
          </button>
        </form>

        {stream && (
          <div className="now-playing">
            <span className="live-dot">live</span>
            <span className="who">{stream.channel.author}</span>
            <span className="what">
              {stream.channel.category ? `${stream.channel.category} - ` : ''}
              {stream.channel.title}
            </span>
          </div>
        )}

        <div className="titlebar-actions">
          <button
            className={`ctl ${hudVisible ? 'is-pinned' : ''}`}
            onClick={() => setHudVisible((v) => !v)}
            title="Memory readout  (F2)"
          >
            <Gauge />
          </button>
          <button
            className={`ctl ${chatClosed ? 'is-closed' : chatVisible ? 'is-on' : 'is-off'}`}
            onClick={toggleChat}
            title={
              chatClosed
                ? 'Chat is closed - connect  (C)'
                : chatVisible
                  ? 'Hide chat, stays connected  (C)'
                  : 'Show chat  (C)'
            }
          >
            {chatClosed ? <ChatOff /> : <ChatBubble />}
            {chatClosed && <span style={{ fontSize: 11 }}>off</span>}
            {!chatClosed && !chatVisible && <span style={{ fontSize: 11 }}>chat</span>}
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="video-wrap">
          <video ref={videoRef} playsInline />
          {phase.kind === 'idle' && <Placeholder kind="idle" />}
          {phase.kind === 'resolving' && (
            <Placeholder kind="resolving" channel={phase.channel} onCancel={cancel} />
          )}
          {phase.kind === 'error' && (
            <Placeholder
              kind="error"
              reason={phase.reason}
              message={phase.message}
              onRetry={channel ? () => void start(channel) : undefined}
            />
          )}
          {hudVisible && <MemoryHud />}
        </div>

        <Controls
          ready={phase.kind === 'playing'}
          playing={playing}
          onPlayPause={togglePlay}
          onSeek={seek}
          dvr={dvr}
          onSeekTo={(time) => playerRef.current?.seekTo(time)}
          onJumpLive={() => playerRef.current?.seekToLive()}
          volume={volume}
          muted={muted}
          onVolume={(v) => {
            setVolume(v)
            if (v > 0) setMuted(false)
          }}
          onToggleMute={() => setMuted((v) => !v)}
          levels={levels}
          pinnedLabel={pinnedLabel}
          activeLevel={activeLevel}
          onPick={(label) => {
            pinnedRef.current = label
            setPinnedLabel(label)
            if (label === null) {
              localStorage.removeItem(QUALITY_KEY)
              playerRef.current?.setLevel(-1)
            } else {
              localStorage.setItem(QUALITY_KEY, label)
              const match = levels.find((l) => l.label === label)
              if (match) playerRef.current?.setLevel(match.index)
            }
          }}
        />
      </main>

      <ChatPane
        logRef={logRef}
        state={chatState}
        channel={channel}
        showJump={showJump}
        onJump={() => listRef.current?.jumpToLatest()}
        closed={chatClosed}
        bytes={chatBytes}
        onClose={closeChat}
        onConnect={openChat}
        emotesOn={emotesOn}
        emoteBytes={emoteBytes}
        emoteCount={emoteCount}
        onToggleEmotes={toggleEmotes}
      />
    </div>
  )
}
