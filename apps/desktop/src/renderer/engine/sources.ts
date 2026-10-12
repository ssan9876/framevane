import { ALL_FORMATS, AudioBufferSink, Input, UrlSource, VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny'
import type { AssetRef } from '@reel/doc'

/**
 * Decoded media for the compositor and the audio graph.
 * Video: WebCodecs (hardware) via Mediabunny, one sequential reader per clip so playback/export decode forward only;
 * a jump restarts the reader from the nearest keyframe. Images: ImageBitmap. Audio: one AudioBuffer per asset.
 */

export const mediaUrl = (assetId: string) => `reel-media://asset/${encodeURIComponent(assetId)}`

class Lock {
  private p: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.p.then(fn, fn)
    this.p = next.catch(() => {})
    return next
  }
}

/** Forward-only frame reader. Holds the current sample until a later one is needed. */
class SequentialReader {
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null
  private current: VideoSample | null = null
  private next: VideoSample | null = null
  private lock = new Lock()
  closed = false

  constructor(private sink: VideoSampleSink) {}

  /** Sample visible at source time t (seconds), or null past the end. Do NOT close the returned sample. */
  frameAt(t: number): Promise<VideoSample | null> {
    return this.lock.run(async () => {
      if (this.closed) return null
      const cur = this.current
      const ahead = cur && t >= cur.timestamp - 1e-4 && t - cur.timestamp < 2.5
      if (!ahead) await this.restart(t)
      // advance while the next sample is already due
      while (this.next && this.next.timestamp <= t + 1e-4) {
        this.current?.close()
        this.current = this.next
        this.next = await this.pull()
      }
      return this.current
    })
  }

  private async restart(t: number) {
    this.current?.close()
    this.next?.close()
    this.current = this.next = null
    await this.iter?.return()
    this.iter = this.sink.samples(Math.max(0, t))
    this.current = await this.pull()
    this.next = this.current ? await this.pull() : null
  }

  private async pull(): Promise<VideoSample | null> {
    if (!this.iter) return null
    const r = await this.iter.next()
    return r.done ? null : r.value
  }

  async close() {
    await this.lock.run(async () => {
      this.closed = true
      this.current?.close()
      this.next?.close()
      this.current = this.next = null
      await this.iter?.return()
      this.iter = null
    })
  }
}

interface AssetEntry {
  input: Input
  video: InputVideoTrack | null
  sink: VideoSampleSink | null
  readers: Map<string, SequentialReader>
}

export class MediaPool {
  private assets = new Map<string, Promise<AssetEntry>>()
  private images = new Map<string, Promise<ImageBitmap>>()
  private audio = new Map<string, Promise<AudioBuffer | null>>()

  /** A reader dedicated to one clip (two clips of the same asset decode independently). */
  async frameAt(asset: AssetRef, clipId: string, sourceSeconds: number): Promise<VideoSample | null> {
    const e = await this.entry(asset)
    if (!e.sink) return null
    let r = e.readers.get(clipId)
    if (!r) { r = new SequentialReader(e.sink); e.readers.set(clipId, r) }
    return r.frameAt(sourceSeconds)
  }

  image(asset: AssetRef): Promise<ImageBitmap> {
    let p = this.images.get(asset.id)
    if (!p) {
      p = fetch(mediaUrl(asset.id)).then((r) => { if (!r.ok) throw new Error(`Image ${asset.name}: HTTP ${r.status}`); return r.blob() }).then((b) => createImageBitmap(b))
      this.images.set(asset.id, p)
      p.catch(() => this.images.delete(asset.id))
    }
    return p
  }

  /** Whole-asset decoded audio (M0: fine for clips up to ~20 min; streaming decode comes later). */
  audioBuffer(asset: AssetRef, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    let p = this.audio.get(asset.id)
    if (!p) {
      p = this.decodeAudio(asset, ctx)
      this.audio.set(asset.id, p)
      p.catch(() => this.audio.delete(asset.id))
    }
    return p
  }

  /** Drop readers for clips that no longer exist (after edits). */
  async prune(liveClipIds: Set<string>) {
    for (const p of this.assets.values()) {
      const e = await p.catch(() => null)
      if (!e) continue
      for (const [id, r] of e.readers) if (!liveClipIds.has(id)) { e.readers.delete(id); void r.close() }
    }
  }

  async dispose() {
    for (const p of this.assets.values()) {
      const e = await p.catch(() => null)
      if (!e) continue
      for (const r of e.readers.values()) await r.close()
      e.input.dispose()
    }
    for (const p of this.images.values()) void p.then((b) => b.close()).catch(() => {})
    this.assets.clear()
    this.images.clear()
    this.audio.clear()
  }

  private entry(asset: AssetRef): Promise<AssetEntry> {
    let p = this.assets.get(asset.id)
    if (!p) {
      p = (async () => {
        const input = new Input({ source: new UrlSource(mediaUrl(asset.id)), formats: ALL_FORMATS })
        const video = await input.getPrimaryVideoTrack()
        let sink: VideoSampleSink | null = null
        if (video && (await video.canDecode())) sink = new VideoSampleSink(video)
        else if (video) console.warn(`[media] cannot decode video of ${asset.name} (${video.codec})`)
        return { input, video, sink, readers: new Map() }
      })()
      this.assets.set(asset.id, p)
      p.catch(() => this.assets.delete(asset.id))
    }
    return p
  }

  private async decodeAudio(asset: AssetRef, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    const input = new Input({ source: new UrlSource(mediaUrl(asset.id)), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryAudioTrack()
      if (!track || !(await track.canDecode())) return null
      const sink = new AudioBufferSink(track)
      const chunks: { buffer: AudioBuffer; timestamp: number }[] = []
      for await (const w of sink.buffers()) chunks.push({ buffer: w.buffer, timestamp: w.timestamp })
      if (!chunks.length) return null
      const rate = chunks[0]!.buffer.sampleRate
      const channels = Math.min(2, Math.max(...chunks.map((c) => c.buffer.numberOfChannels)))
      const start = Math.min(0, chunks[0]!.timestamp)
      const end = Math.max(...chunks.map((c) => c.timestamp + c.buffer.duration))
      const out = ctx.createBuffer(channels, Math.ceil((end - start) * rate), rate)
      for (const c of chunks) {
        const offset = Math.round((c.timestamp - start) * rate)
        for (let ch = 0; ch < channels; ch++) {
          const src = c.buffer.getChannelData(Math.min(ch, c.buffer.numberOfChannels - 1))
          const room = out.length - offset
          if (room <= 0) continue
          out.copyToChannel(src.length > room ? src.subarray(0, room) : src, ch, Math.max(0, offset))
        }
      }
      return out
    } finally {
      input.dispose()
    }
  }
}
