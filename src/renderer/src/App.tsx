import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolveFailure, ResolvedStream } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { Player, type QualityLevel } from './player/hls'
import { TwitchChat, type ChatState } from './chat/irc'
import { ChatList } from './chat/messageList'
import { ChatPane } from './components/ChatPane'
import { Controls } from './components/Controls'
import { MemoryHud } from './components/MemoryHud'
import { Placeholder } from './components/Placeholder'

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving'; channel: string }
  | { kind: 'playing'; stream: ResolvedStream }
  | { kind: 'error'; reason: ResolveFailure; message: string }

const VOLUME_KEY = 'slipstream.volume'

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
  const [currentLevel, setCurrentLevel] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [behind, setBehind] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? 0.6))
  const [muted, setMuted] = useState(false)
  const [chatState, setChatState] = useState<ChatState>('idle')
  const [showJump, setShowJump] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const [hudVisible, setHudVisible] = useState(false)

  const start = useCallback(async (raw: string): Promise<void> => {
    const login = parseChannelInput(raw)
    if (!login) {
      setPhase({ kind: 'error', reason: 'invalid_channel', message: 'That does not look like a channel name.' })
      return
    }

    loginRef.current = login
    setChannel(login)
    setPhase({ kind: 'resolving', channel: login })
    setLevels([])

    const result = await window.slipstream.resolveChannel(login)
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
    listRef.current?.system(`Joining #${login}...`)
    chatRef.current?.connect(login)
  }, [])

  /** Re-run the token dance and swap the manifest without disturbing chat. */
  const refresh = useCallback(async (): Promise<void> => {
    const login = loginRef.current
    if (!login) return
    const result = await window.slipstream.resolveChannel(login)
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
        setCurrentLevel(-1)
      },
      onLevelSwitch: setCurrentLevel,
      onError: (message) => setPhase({ kind: 'error', reason: 'error', message }),
      onStale: () => void refresh()
    })
    playerRef.current = player

    return () => {
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

  // How far behind the live edge we are, for the DVR readout.
  useEffect(() => {
    if (phase.kind !== 'playing') return
    const id = setInterval(() => setBehind(playerRef.current?.behindLive() ?? 0), 1000)
    return () => clearInterval(id)
  }, [phase.kind])

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
      if (e.target instanceof HTMLInputElement) return
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'arrowleft':
          seek(-10)
          break
        case 'arrowright':
          seek(10)
          break
        case 'l':
          playerRef.current?.seekToLive()
          break
        case 'm':
          setMuted((v) => !v)
          break
        case 'c':
          setChatVisible((v) => !v)
          break
        case 'f2':
          setHudVisible((v) => !v)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seek, togglePlay])

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
      </header>

      <main className="stage">
        <div className="video-wrap">
          <video ref={videoRef} playsInline />
          {phase.kind === 'idle' && <Placeholder kind="idle" />}
          {phase.kind === 'resolving' && <Placeholder kind="resolving" channel={phase.channel} />}
          {phase.kind === 'error' && (
            <Placeholder kind="error" reason={phase.reason} message={phase.message} />
          )}
          {hudVisible && <MemoryHud />}
        </div>

        <Controls
          ready={phase.kind === 'playing'}
          playing={playing}
          onPlayPause={togglePlay}
          onSeek={seek}
          behind={behind}
          onJumpLive={() => playerRef.current?.seekToLive()}
          volume={volume}
          muted={muted}
          onVolume={(v) => {
            setVolume(v)
            if (v > 0) setMuted(false)
          }}
          onToggleMute={() => setMuted((v) => !v)}
          levels={levels}
          currentLevel={currentLevel}
          onLevel={(index) => {
            playerRef.current?.setLevel(index)
            setCurrentLevel(index)
          }}
          chatVisible={chatVisible}
          onToggleChat={() => setChatVisible((v) => !v)}
          hudVisible={hudVisible}
          onToggleHud={() => setHudVisible((v) => !v)}
        />
      </main>

      <ChatPane
        logRef={logRef}
        state={chatState}
        channel={channel}
        showJump={showJump}
        onJump={() => listRef.current?.jumpToLatest()}
      />
    </div>
  )
}
