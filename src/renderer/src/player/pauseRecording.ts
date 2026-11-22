export interface PauseSnapshot { rendition: string; programDateTime: number }
interface StartResult { masterPlaylist: string; startAt: number }
interface RecordingApi {
  start(rendition: string, programDateTime: number): Promise<StartResult>
  stop(): Promise<void>
}
export interface RecordingState {
  kind: 'idle' | 'preparing' | 'recording' | 'failed'
  error: string | null
  resumeRequested?: boolean
}
interface Hooks {
  suspend(): void
  restore(play: boolean): void
  load(result: StartResult, play: boolean): void
  changed(state: RecordingState): void
}

/** Keeps user intent independent from native pause events during MSE replacement. */
export class PauseRecording {
  state: RecordingState = { kind: 'idle', error: null }
  private generation = 0
  private wantsPlay = false
  private stopping: Promise<void> = Promise.resolve()

  constructor(private readonly api: RecordingApi, private readonly hooks: Hooks) {}

  get retained(): boolean { return this.state.kind === 'recording' }
  get busy(): boolean { return this.state.kind === 'preparing' }

  private change(kind: RecordingState['kind'], error: string | null = null): void {
    this.state = { kind, error, resumeRequested: kind === 'preparing' && this.wantsPlay }
    this.hooks.changed(this.state)
  }

  pause(snapshot: PauseSnapshot): void {
    this.wantsPlay = false
    if (this.busy) this.change('preparing')
    if (this.state.kind !== 'idle') return
    const generation = ++this.generation
    this.change('preparing')
    this.hooks.suspend()
    void (async () => {
      try {
        await this.stopping
        if (generation !== this.generation) return
        const result = await this.api.start(snapshot.rendition, snapshot.programDateTime)
        if (generation !== this.generation) return
        this.change('recording')
        this.hooks.load(result, this.wantsPlay)
      } catch (error) {
        if (generation !== this.generation) return
        this.change('failed', `Could not save this pause: ${error instanceof Error ? error.message : String(error)}`)
        this.hooks.restore(this.wantsPlay)
      }
    })()
  }

  /** True means the coordinator owns this Resume and native play must wait. */
  resume(): boolean {
    this.wantsPlay = true
    if (this.busy) {
      this.change('preparing')
      return true
    }
    return false
  }

  /** Both keyboard and button toggle pending intent while native media stays paused. */
  togglePreparing(): boolean {
    if (!this.busy) return false
    this.wantsPlay = !this.wantsPlay
    this.change('preparing')
    return true
  }

  reportError(error: string): void {
    if (this.retained && this.state.error !== error) this.change('recording', error)
  }

  cancel(): Promise<void> {
    const needed = this.state.kind !== 'idle'
    ++this.generation
    this.wantsPlay = false
    this.change('idle')
    if (needed) this.stopping = this.api.stop().catch(() => undefined)
    return this.stopping
  }
}
