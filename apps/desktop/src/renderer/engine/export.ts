import {
  AudioBufferSource, CanvasSource, canEncodeAudio, canEncodeVideo, Mp4OutputFormat, Output, StreamTarget, type StreamTargetChunk,
} from 'mediabunny'
import { projectDurationUs, type Project } from '@reel/doc'
import type { ExportSettings } from '../../shared/api'
import { renderMix } from './audio'
import { drawFrame, ensureFonts, fetchVisuals } from './compositor'
import { MediaPool } from './sources'

/**
 * Export = the preview compositor at full resolution, frame by frame, into the hardware encoder (WebCodecs),
 * muxed to MP4 by Mediabunny and streamed to disk through the main process. Same code path as preview.
 */

export interface ExportProgress { phase: 'audio' | 'video' | 'finalizing'; progress: number; frame: number; frames: number; fps: number; etaSeconds: number | null }

export async function exportProject(doc: Project, s: ExportSettings, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<{ path: string; bytes: number; audioCodec: string | null }> {
  const W = even(s.width)
  const H = even(s.height)
  const durationUs = projectDurationUs(doc)
  if (durationUs <= 0) throw new Error('The timeline is empty.')
  if (!(await canEncodeVideo(s.codec, { width: W, height: H, bitrate: s.bitrate }))) {
    throw new Error(`This system can't encode ${s.codec === 'hevc' ? 'HEVC' : 'H.264'} at ${W}×${H}. Try H.264 or a lower resolution.`)
  }
  await ensureFonts(doc)
  const pool = new MediaPool()
  const { handle } = await window.reel.export.open(s.outputPath)
  let finished = false
  try {
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { alpha: false })!
    const writable = new WritableStream<StreamTargetChunk>({
      write: (chunk) => window.reel.export.write(handle, chunk.position, chunk.data),
    })
    const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
    const video = new CanvasSource(canvas, { codec: s.codec, bitrate: s.bitrate, keyFrameInterval: 2, latencyMode: 'quality' } as ConstructorParameters<typeof CanvasSource>[1])
    output.addVideoTrack(video, { frameRate: s.fps })

    onProgress({ phase: 'audio', progress: 0, frame: 0, frames: 0, fps: 0, etaSeconds: null })
    const mix = await renderMix(doc, pool, durationUs)
    let audioCodec: 'aac' | 'opus' | null = null
    let audio: AudioBufferSource | null = null as AudioBufferSource | null
    if (mix) {
      audioCodec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192_000 })) ? 'aac' : 'opus'
      audio = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 })
      output.addAudioTrack(audio)
    }
    await output.start()
    // feed audio in 1 s slices just ahead of the video so the muxer interleaves without buffering whole tracks
    let audioFedUntil = 0
    const feedAudio = async (untilSeconds: number) => {
      if (!audio || !mix) return
      while (audioFedUntil < Math.min(untilSeconds, mix.duration)) {
        const from = audioFedUntil
        const to = Math.min(mix.duration, from + 1)
        await audio.add(slice(mix, from, to))
        audioFedUntil = to
      }
      if (audioFedUntil >= mix.duration - 1e-6) { audio.close(); audio = null }
    }

    const frames = Math.max(1, Math.round((durationUs / 1e6) * s.fps))
    const started = performance.now()
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
      const tUs = Math.round((i / s.fps) * 1e6)
      await feedAudio(i / s.fps + 1)
      const visuals = await fetchVisuals(doc, pool, tUs)
      drawFrame(ctx, doc, tUs, visuals, W / doc.canvas.width)
      await video.add(i / s.fps, 1 / s.fps)
      if (i % 5 === 0 || i === frames - 1) {
        const elapsed = (performance.now() - started) / 1000
        const fps = (i + 1) / Math.max(elapsed, 1e-3)
        onProgress({ phase: 'video', progress: (i + 1) / frames, frame: i + 1, frames, fps, etaSeconds: (frames - i - 1) / fps })
      }
    }
    await feedAudio(Infinity)
    video.close()
    onProgress({ phase: 'finalizing', progress: 1, frame: frames, frames, fps: 0, etaSeconds: 0 })
    await output.finalize()
    finished = true
    const r = await window.reel.export.close(handle, {})
    return { ...r, audioCodec }
  } finally {
    if (!finished) await window.reel.export.close(handle, { abort: true }).catch(() => {})
    await pool.dispose()
  }
}

function slice(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.floor(from * buf.sampleRate)
  const b = Math.min(buf.length, Math.floor(to * buf.sampleRate))
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, b - a), sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch)
  return out
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
