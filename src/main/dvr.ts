import { randomBytes } from 'node:crypto'
import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

type DvrStartResult = { masterPlaylist: string; startAt: number }
type DvrStatus = { active: boolean; bytes: number; error: string | null }
type Options = { fetch?: typeof fetch; resolveMaster?: () => Promise<string>; maxBytes?: number; pollMs?: number; initialWaitMs?: number }
type Segment = { sequence: number; duration: number; date: number; url: string; discontinuity: boolean; offset: number; bytes: number }
type Playlist = { segments: Segment[]; ended: boolean; discontinuitySequence: number }
class TransientDownloadError extends Error {}

function variant(master: string, rendition: string): { url: string; metadata: string } {
  const lines = master.split(/\r?\n/).map(l => l.trim())
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue
    const video = /(?:^|,)VIDEO="([^"]+)"/.exec(lines[i].slice(18))?.[1]
    const uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'))
    if (uri && (video === rendition || uri === rendition)) {
      const url = new URL(uri)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported rendition protocol')
      const media = lines.filter(l => l.startsWith('#EXT-X-MEDIA:'))
      for (const type of ['AUDIO', 'VIDEO', 'SUBTITLES']) {
        const group = new RegExp(`(?:^|,)${type}="([^"]+)"`).exec(lines[i].slice(18))?.[1]
        if (group && media.some(l => l.includes(`TYPE=${type},`) && l.includes(`GROUP-ID="${group}"`) && /(?:^|,)URI=/.test(l))) throw new Error('Unsupported external recording track')
      }
      const labels = media.filter(l => l.includes('TYPE=VIDEO,') && l.includes(`GROUP-ID="${video}"`) && !/(?:^|,)URI=/.test(l))
      // Keep the original codec, resolution and quality name, but expose only our saved rendition.
      return { url: url.href, metadata: [...labels, lines[i]].join('\n') }
    }
  }
  throw new Error('Recording rendition is no longer available')
}

function parseMedia(text: string, url: string, originDate?: number): Playlist {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid recording playlist')
  const segments: Segment[] = []
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const normalized = lines.join('\n')
  let sequence = 0, duration = 0, date = NaN, discontinuity = false, discontinuitySequence = 0, explicitDate = false
  const fullContinuous = Number(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m.exec(normalized)?.[1] ?? 0) === 0 &&
    Number(/^#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/m.exec(normalized)?.[1] ?? 0) === 0 && !lines.includes('#EXT-X-DISCONTINUITY')
  let expectedDate = originDate
  for (const line of lines) {
    if (/^#EXT-X-(MAP|BYTERANGE|GAP|SKIP|I-FRAMES-ONLY):?/.test(line) || (line.startsWith('#EXT-X-KEY:') && !/^#EXT-X-KEY:METHOD=NONE(?:,|$)/.test(line))) {
      throw new Error('Unsupported recording format (encryption, maps, gaps or byte ranges)')
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.slice(22))
    else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) discontinuitySequence = Number(line.slice(30))
    else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      date = Date.parse(line.slice(25))
      if (!Number.isFinite(date)) throw new Error('Recording playlist lacks a valid dated timeline')
      explicitDate = true
    }
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0])
    else if (line === '#EXT-X-DISCONTINUITY') {
      discontinuity = true
      if (originDate !== undefined && !explicitDate) date = NaN
    }
    else if (line && !line.startsWith('#')) {
      if (originDate !== undefined && fullContinuous) {
        if (!Number.isFinite(date)) date = expectedDate!
        else if (Math.abs(date - expectedDate!) > 250) throw new Error('Archive rendition timeline does not match its origin')
      }
      if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(date) || !Number.isFinite(duration) || duration <= 0) throw new Error('Recording playlist lacks a valid dated timeline')
      const segmentUrl = new URL(line, url)
      if (!['https:', 'http:'].includes(segmentUrl.protocol)) throw new Error('Unsupported segment protocol')
      segments.push({ sequence: sequence++, duration, date, url: segmentUrl.href, discontinuity, offset: 0, bytes: 0 })
      date += duration * 1000
      if (expectedDate !== undefined) expectedDate += duration * 1000
      duration = 0
      discontinuity = false
      explicitDate = false
    }
  }
  if (!Number.isSafeInteger(discontinuitySequence) || discontinuitySequence < 0) throw new Error('Invalid discontinuity sequence')
  return { segments, ended: text.includes('#EXT-X-ENDLIST'), discontinuitySequence }
}

/** Owns only its dedicated temporary root; callers must use the app's single-instance lock. */
export class TemporaryDvr {
  private root: string
  private options: Options
  private server: Server | null = null
  private serverOrigin = ''
  private token = ''
  private controller: AbortController | null = null
  private worker: Promise<void> | null = null
  private serial: Promise<unknown> = Promise.resolve()
  private generation = 0
  private segments: Segment[] = []
  private streams = new Set<ReadStream>()
  private directory = ''
  private recording = false
  private used = 0
  private problem: string | null = null
  private position = 0
  private elapsed = 0
  private targetDuration = 1
  private lastSequence: number | null = null
  private discontinuitySequence = 0
  private rendition = ''
  private mediaUrl = ''
  private disposed = false
  private archiveOrigin: number | undefined
  private goal = Infinity

  constructor(root: string, options: Options = {}) {
    const absolute = resolve(root)
    if (!isAbsolute(root) || absolute === parse(absolute).root) throw new Error('A dedicated absolute recording root is required')
    this.root = absolute
    this.options = options
  }

  get origin(): string { return this.serverOrigin }
  status(): DvrStatus { return { active: this.recording, bytes: this.used, error: this.problem } }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation)
    this.serial = result.catch(() => {})
    return result
  }

  async initialize(): Promise<void> {
    await this.stop()
    await this.enqueue(async () => {
      if (this.disposed) throw new Error('Recorder disposed')
      await rm(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      await mkdir(this.root, { recursive: true })
      if (this.server) return
      const server = createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cache-Control', 'no-store')
        const path = req.url ?? ''
        if (!this.token || !path.startsWith(`/${this.token}/`)) { res.writeHead(403).end(); return }
        const name = path.slice(this.token.length + 2)
        if (name === 'index.m3u8' && this.segments.length) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
          res.end(this.playlist())
          return
        }
        const match = /^(\d+)\.ts$/.exec(name)
        if (!match || !this.segments.some(s => s.sequence === Number(match[1]))) { res.writeHead(404).end(); return }
        const stream = createReadStream(join(this.directory, name))
        this.streams.add(stream)
        res.setHeader('Content-Type', 'video/mp2t')
        stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end() })
        stream.on('close', () => this.streams.delete(stream))
        res.on('close', () => stream.destroy())
        stream.pipe(res)
      })
      await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); accept() }) })
      this.server = server
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Unable to bind recording server')
      this.serverOrigin = `http://127.0.0.1:${address.port}`
    })
  }

  start(masterPlaylist: string, rendition: string, programDateTime: number, archive?: { originDate: number }): Promise<DvrStartResult> {
    const generation = ++this.generation
    this.controller?.abort()
    return this.enqueue(async () => {
      await this.cleanup()
      if (generation !== this.generation || this.disposed) throw new Error('Recording cancelled')
      if (!this.server) throw new Error('Recorder must be initialized')
      if (!Number.isFinite(programDateTime)) throw new Error('Invalid paused timestamp')
      if (archive && !Number.isFinite(archive.originDate)) throw new Error('Invalid archive timeline origin')
      this.archiveOrigin = archive?.originDate
      this.controller = new AbortController()
      this.rendition = rendition
      const selected = variant(masterPlaylist, rendition)
      this.mediaUrl = selected.url
      this.token = randomBytes(24).toString('hex')
      this.directory = join(this.root, this.token)
      await mkdir(this.directory)
      this.recording = true
      let result: DvrStartResult | null = null
      const deadline = Date.now() + (this.options.initialWaitMs ?? 30000)
      const initialController = this.controller
      // Include slow playlist responses and URL renewal in the publication
      // deadline; counting only the sleeps could otherwise wait much longer.
      const initialTimer = archive ? setTimeout(() => initialController.abort(new Error('Paused frame is not yet available in the published archive')), this.options.initialWaitMs ?? 30000) : undefined
      try {
        let playlist = await this.loadPlaylist()
        const findPaused = (): number => playlist.segments.findIndex(s => s.date <= programDateTime && s.date + s.duration * 1000 > programDateTime)
        let paused = findPaused()
        while (archive && paused < 0 && !playlist.ended && Date.now() < deadline) {
          const last = playlist.segments.at(-1)
          if ((last && programDateTime < last.date + last.duration * 1000) || programDateTime < archive.originDate) break
          await delay(Math.min(this.options.pollMs ?? 1500, Math.max(1, deadline - Date.now())), undefined, { signal: this.controller.signal })
          playlist = await this.loadPlaylist()
          paused = findPaused()
        }
        clearTimeout(initialTimer)
        if (paused < 0) throw new Error('Paused frame is no longer available in the published archive playlist')
        // Start with the paused segment: fetching older history wastes bandwidth and
        // can fail on expired files even though the required paused frame is saved.
        const startAt = (programDateTime - playlist.segments[paused].date) / 1000
        this.position = startAt
        this.goal = archive ? startAt + 300 : Infinity
        this.discontinuitySequence = playlist.discontinuitySequence + playlist.segments.slice(0, paused).filter(segment => segment.discontinuity).length
        playlist.segments = playlist.segments.slice(paused)
        result = { masterPlaylist: `#EXTM3U\n${selected.metadata}\n${this.serverOrigin}/${this.token}/index.m3u8\n`, startAt }
        await this.save(playlist)
        this.checkAbort()
        if (!this.segments.length) throw new Error('No playable recording data')
        if (playlist.ended && this.lastSequence === playlist.segments.at(-1)?.sequence) this.recording = false
        if (this.recording) this.worker = this.poll()
        return result
      } catch (error) {
        clearTimeout(initialTimer)
        // timers/promises wraps an abort reason; retain the useful publication
        // deadline error while preserving ordinary user cancellation.
        const failure = initialController.signal.aborted ? initialController.signal.reason : error
        this.recording = false
        this.problem = failure instanceof Error ? failure.message : String(failure)
        // A later initial download can fail after the paused frame is safely
        // published. Keep that playable recording accessible to the renderer.
        if (result && this.segments.length && !this.controller.signal.aborted && generation === this.generation) return result
        throw failure
      }
    })
  }

  private checkAbort(): void { this.controller?.signal.throwIfAborted() }

  private async request(url: string): Promise<Response> {
    this.checkAbort()
    const signal = AbortSignal.any([this.controller!.signal, AbortSignal.timeout(15000)])
    const response = await (this.options.fetch ?? fetch)(url, { signal })
    this.checkAbort()
    return response
  }

  private async renew(): Promise<void> {
    if (!this.options.resolveMaster) throw new Error('Recording URLs expired and could not be renewed')
    const signal = this.controller!.signal
    const master = await new Promise<string>((accept, reject) => {
      const abort = (): void => reject(new Error('Recording cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      this.options.resolveMaster!().then(accept, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    this.checkAbort()
    this.mediaUrl = variant(master, this.rendition).url
  }

  private async loadPlaylist(renew = true): Promise<Playlist> {
    const response = await this.request(this.mediaUrl)
    if ((response.status === 403 || response.status === 404) && renew) {
      await response.body?.cancel()
      await this.renew()
      return this.loadPlaylist(false)
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Recording playlist HTTP ${response.status}`) }
    return parseMedia(await response.text(), this.mediaUrl, this.archiveOrigin)
  }

  private async download(segment: Segment): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await this.downloadOnce(segment); return }
      catch (error) {
        this.checkAbort()
        if (!(error instanceof TransientDownloadError)) throw error
        if (attempt >= 2) throw new Error(`Missing recording segment after 3 attempts: ${error.message}`)
        await delay(this.options.pollMs ?? 1500, undefined, { signal: this.controller!.signal })
      }
    }
  }

  private async downloadOnce(segment: Segment, retry = true): Promise<void> {
    let response: Response
    try { response = await this.request(segment.url) }
    catch (error) {
      this.checkAbort()
      throw new TransientDownloadError(error instanceof Error ? error.message : String(error))
    }
    if ((response.status === 403 || response.status === 404) && retry) {
      await response.body?.cancel()
      await this.renew()
      const refreshed = await this.loadPlaylist(false)
      const replacement = refreshed.segments.find(s => s.sequence === segment.sequence)
      if (!replacement || replacement.date !== segment.date || replacement.duration !== segment.duration) throw new Error('Missing recording segment after URL renewal')
      segment.url = replacement.url
      return this.downloadOnce(segment, false)
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel()
      throw new TransientDownloadError(`HTTP ${response.status}`)
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Missing recording segment: HTTP ${response.status}`) }
    const temporary = join(this.directory, `${segment.sequence}.partial`)
    // Remove a failed previous attempt before retrying this same sequence.
    await rm(temporary, { force: true })
    let handle
    try { handle = await open(temporary, 'wx') }
    catch (error) { await response.body.cancel(); throw error }
    const reader = response.body.getReader()
    const abort = (): void => { void reader.cancel().catch(() => {}) }
    this.controller!.signal.addEventListener('abort', abort, { once: true })
    let bytes = 0
    let complete = false
    try {
      for (;;) {
        this.checkAbort()
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try { chunk = await reader.read() }
        catch (error) {
          this.checkAbort()
          throw new TransientDownloadError(error instanceof Error ? error.message : String(error))
        }
        this.checkAbort()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (this.used + bytes > (this.options.maxBytes ?? 4 * 1024 ** 3)) {
          // Playback may have advanced while this response was arriving.
          await this.evict()
          if (this.used + bytes > (this.options.maxBytes ?? 4 * 1024 ** 3)) throw new Error('Temporary recording storage limit reached')
        }
        await handle.writeFile(chunk.value)
      }
      if (!bytes) throw new Error('Missing recording segment: empty response')
      complete = true
    } finally {
      this.controller!.signal.removeEventListener('abort', abort)
      await reader.cancel().catch(() => {})
      await handle.close()
      if (!complete) await rm(temporary, { force: true, maxRetries: 5, retryDelay: 50 })
    }
    this.checkAbort()
    await rename(temporary, join(this.directory, `${segment.sequence}.ts`))
    segment.bytes = bytes
    this.used += bytes
  }

  private async save(playlist: Playlist): Promise<void> {
    // Reclaim watched history before capacity checks on newly arriving media.
    await this.evict()
    const latest = playlist.segments.at(-1)
    if (this.lastSequence !== null && latest && latest.sequence < this.lastSequence) throw new Error('Missing recording continuity: broadcaster sequence restarted')
    const pending = playlist.segments.filter(s => this.lastSequence === null || s.sequence > this.lastSequence)
    if (this.lastSequence !== null && pending.length && pending[0].sequence !== this.lastSequence + 1) throw new Error('Missing sequence in recording; recording stopped before the gap')
    for (const segment of pending) {
      if (this.elapsed >= this.goal) break
      if (this.lastSequence !== null && segment.sequence !== this.lastSequence + 1) throw new Error('Missing sequence in recording')
      const previous = this.segments.at(-1)
      if (previous && !segment.discontinuity && Math.abs(segment.date - previous.date - previous.duration * 1000) > 250) throw new Error('Missing interval in recording timeline')
      if (!segment.bytes) await this.download(segment)
      segment.offset = this.elapsed
      this.targetDuration = Math.max(this.targetDuration, Math.ceil(segment.duration))
      this.elapsed += segment.duration
      this.segments.push(segment)
      this.lastSequence = segment.sequence
    }
    await this.evict()
  }

  private async evict(): Promise<void> {
    while (this.segments.length > 1 && this.segments[0].offset + this.segments[0].duration <= this.position - 120) {
      const segment = this.segments[0]
      await rm(join(this.directory, `${segment.sequence}.ts`), { force: true, maxRetries: 5, retryDelay: 50 })
      this.segments.shift()
      this.used -= segment.bytes
      if (segment.discontinuity) this.discontinuitySequence++
    }
  }

  private async poll(): Promise<void> {
    let failures = 0
    while (this.recording) {
      try {
        await delay(this.options.pollMs ?? 1500, undefined, { signal: this.controller!.signal })
        // A full archive batch needs no upstream traffic, even if the source is
        // still growing. Playback progress opens the next five-minute goal.
        if (this.archiveOrigin !== undefined && this.elapsed >= this.goal && this.elapsed - this.position <= 60) this.goal = this.elapsed + 300
        if (this.elapsed >= this.goal) continue
        const playlist = await this.loadPlaylist()
        await this.save(playlist)
        failures = 0
        if (playlist.ended && this.lastSequence === playlist.segments.at(-1)?.sequence) this.recording = false
      } catch (error) {
        if (this.controller?.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (/Missing|storage|Unsupported|timeline|expired|rendition/.test(message) || ++failures >= 3) {
          this.recording = false
          this.problem = message
        }
      }
    }
  }

  updatePosition(mediaSeconds: number): void {
    // HLS media time retains its initial origin while this player stays attached.
    if (Number.isFinite(mediaSeconds) && mediaSeconds >= 0) this.position = Math.min(mediaSeconds, this.elapsed)
    if (this.archiveOrigin !== undefined && this.recording && this.elapsed >= this.goal && this.elapsed - this.position <= 60) this.goal = this.elapsed + 300
  }

  private playlist(): string {
    const first = this.segments[0]
    return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${this.targetDuration}\n#EXT-X-MEDIA-SEQUENCE:${first.sequence}\n#EXT-X-DISCONTINUITY-SEQUENCE:${this.discontinuitySequence}\n` + this.segments.map(s => `${s.discontinuity ? '#EXT-X-DISCONTINUITY\n' : ''}#EXT-X-PROGRAM-DATE-TIME:${new Date(s.date).toISOString()}\n#EXTINF:${s.duration},\n${s.sequence}.ts\n`).join('') + (this.recording ? '' : '#EXT-X-ENDLIST\n')
  }

  private async cleanup(): Promise<void> {
    // Revoke serving before the first await: no new file reader can enter cleanup.
    this.token = ''
    this.controller?.abort()
    await this.worker
    this.worker = null
    const streams = [...this.streams]
    await Promise.all(streams.map(stream => new Promise<void>(accept => { if (stream.closed) accept(); else { stream.once('close', accept); stream.destroy() } })))
    if (this.directory) await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    this.directory = ''
    this.segments = []
    this.recording = false
    this.used = 0
    this.problem = null
    this.position = 0
    this.elapsed = 0
    this.targetDuration = 1
    this.lastSequence = null
    this.discontinuitySequence = 0
    this.archiveOrigin = undefined
    this.goal = Infinity
  }

  stop(): Promise<void> {
    ++this.generation
    this.controller?.abort()
    return this.enqueue(() => this.cleanup())
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.stop()
    await this.enqueue(async () => {
      const server = this.server
      this.server = null
      if (server) await new Promise<void>((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeAllConnections() })
      await rm(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })
  }
}
