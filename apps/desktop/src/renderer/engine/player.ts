import { projectDurationUs, type Project } from '@framevane/doc'
import { loadAudio, schedule } from './audio'
import { drawFrame, ensureFonts, fetchVisuals } from './compositor'
import { ensureLuts } from './luts'
import { MediaPool } from './sources'

/**
 * Preview player. The audio clock drives the playhead while playing; video frames follow it (a frame that isn't
 * decoded in time is skipped, never waited for). While paused, every seek renders the latest requested time only.
 */
export class Player {
  readonly pool = new MediaPool()
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private nodes: AudioBufferSourceNode[] = []
  private doc: Project
  private canvas: HTMLCanvasElement | null = null
  private c2d: CanvasRenderingContext2D | null = null
  private playing = false
  private startUs = 0
  private startCtxTime = 0
  private raf = 0
  private rendering = false
  private pendingUs: number | null = null
  private lastUs = 0
  private audioReady: Promise<Map<string, AudioBuffer | null>> | null = null
  private disposed = false
  private pendingPrune: Set<string> | null = null
  private isReady: (assetId: string) => boolean = () => false // nothing decodes until the editor says what is ready

  /** Media that is missing or still being prepared is not decoded (BUG-005). Call again when statuses change. */
  setAvailability(isReady: (assetId: string) => boolean, useProxy: (assetId: string) => boolean = () => false) {
    this.isReady = isReady
    this.pool.useProxy = useProxy
    this.audioReady = null
    if (!this.playing) this.seek(this.lastUs)
  }

  private flushPrune() {
    if (!this.pendingPrune) return
    const live = this.pendingPrune
    this.pendingPrune = null
    void this.pool.prune(live)
  }

  constructor(doc: Project, private onTime: (us: number) => void, private onEnded: () => void) {
    this.doc = doc
    void ensureFonts(doc).then(() => this.seek(this.lastUs))
  }

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas
    this.c2d = canvas?.getContext('2d', { alpha: false }) ?? null
    if (canvas) this.seek(this.lastUs)
  }

  setDoc(doc: Project) {
    const fonts = (d: Project) => JSON.stringify(d.tracks.map((t) => [t.style?.fontFamily, t.style?.italic, ...t.clips.map((c) => (c.kind === 'text' ? `${c.style.fontFamily}/${c.style.italic}` : ''))]))
    const fontsChanged = fonts(doc) !== fonts(this.doc)
    this.doc = doc
    this.audioReady = null
    // never close decoders under a frame that is being drawn: prune after the render (BUG-003)
    this.pendingPrune = new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.id)))
    if (!this.rendering) this.flushPrune()
    if (fontsChanged) void ensureFonts(doc).then(() => { if (!this.playing) this.seek(this.lastUs) })
    if (this.playing) { const t = this.now(); this.pause(); void this.play(t) }
    else this.seek(this.lastUs)
  }

  get isPlaying() { return this.playing }

  async play(fromUs = this.lastUs) {
    if (this.playing) return
    const dur = projectDurationUs(this.doc)
    if (fromUs >= dur - 1000) fromUs = 0
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' })
    if (!this.master) { this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination) }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.audioReady ??= loadAudio(this.doc, this.pool, this.ctx, this.isReady)
    const buffers = await this.audioReady
    if (this.disposed) return
    this.playing = true
    this.startUs = fromUs
    this.startCtxTime = this.ctx.currentTime + 0.05
    this.nodes = schedule(this.doc, buffers, this.ctx, this.master, fromUs, this.startCtxTime)
    const tick = () => {
      if (!this.playing) return
      const t = this.now()
      if (t >= projectDurationUs(this.doc)) { this.pause(); this.lastUs = projectDurationUs(this.doc); this.onTime(this.lastUs); this.onEnded(); return }
      this.lastUs = t
      this.onTime(t)
      if (!this.rendering) void this.render(t)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause() {
    if (!this.playing) return
    this.lastUs = this.now()
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const n of this.nodes) { try { n.stop() } catch { /* already stopped */ } }
    this.nodes = []
  }

  /** Paused seek: render the latest requested time; intermediate requests are dropped. */
  seek(us: number) {
    this.lastUs = Math.max(0, us)
    if (this.playing) { this.pause(); void this.play(this.lastUs); return }
    this.pendingUs = this.lastUs
    if (!this.rendering) void this.drain()
  }

  private async drain() {
    while (this.pendingUs !== null) {
      const t = this.pendingUs
      this.pendingUs = null
      await this.render(t)
    }
  }

  private now() {
    if (!this.ctx) return this.lastUs
    return this.startUs + Math.max(0, this.ctx.currentTime - this.startCtxTime) * 1e6
  }

  private async render(tUs: number) {
    if (!this.canvas || !this.c2d) return
    this.rendering = true
    try {
      const doc = this.doc
      await ensureLuts(doc)
      const visuals = await fetchVisuals(doc, this.pool, tUs, this.isReady)
      if (this.disposed || !this.c2d) return
      drawFrame(this.c2d, doc, tUs, visuals, this.canvas.width / doc.canvas.width)
    } finally {
      this.rendering = false
      this.flushPrune()
    }
  }

  async dispose() {
    this.disposed = true
    this.pause()
    await this.ctx?.close().catch(() => {})
    await this.pool.dispose()
  }
}
