import {
  AudioBufferSource, CanvasSource, canEncodeAudio, canEncodeVideo, MovOutputFormat, Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat, type StreamTargetChunk,
} from 'mediabunny'
import { projectDurationUs, type Project } from '@framevane/doc'
import type { ExportRequest, ExportSettings, VideoCodecId, VideoContainer } from '../../shared/api'
import { renderMix } from './audio'
import { drawFrame, ensureFonts, fetchVisuals } from './compositor'
import { ensureLuts } from './luts'
import { MediaPool } from './sources'

/**
 * Export = the preview compositor at full resolution, frame by frame, into the hardware encoder (WebCodecs),
 * muxed by Mediabunny and streamed to disk through the main process. Same code path as preview.
 * Also here: GIF (a silent MP4, then FFmpeg), audio only (WAV, or MP3/M4A through FFmpeg) and a still frame.
 */

export interface ExportProgress { phase: 'audio' | 'video' | 'finalizing'; progress: number; frame: number; frames: number; fps: number; etaSeconds: number | null }
type HasMatte = (assetId: string) => boolean

/** Codecs each container can hold (MOV: what QuickTime and editors read; WebM: the open codecs). */
export const CONTAINER_CODECS: Record<VideoContainer, VideoCodecId[]> = { mp4: ['avc', 'hevc', 'av1'], mov: ['avc', 'hevc'], webm: ['vp9', 'av1'] }
export const CODEC_LABEL: Record<VideoCodecId, string> = { avc: 'H.264', hevc: 'HEVC (H.265)', av1: 'AV1', vp9: 'VP9' }

/** Which codecs this computer can encode at a size (hardware or software WebCodecs). */
export async function encodableCodecs(width: number, height: number, bitrate: number): Promise<Set<VideoCodecId>> {
  const out = new Set<VideoCodecId>()
  for (const c of ['avc', 'hevc', 'av1', 'vp9'] as const) if (await canEncodeVideo(c, { width: even(width), height: even(height), bitrate }).catch(() => false)) out.add(c)
  return out
}

/** The part of the timeline to export, checked. */
export function exportRange(doc: Project, range?: { startUs: number; endUs: number }) {
  const total = projectDurationUs(doc)
  const startUs = Math.max(0, Math.min(range?.startUs ?? 0, total))
  const endUs = Math.max(startUs, Math.min(range?.endUs ?? total, total))
  if (endUs - startUs <= 0) throw new Error(total <= 0 ? 'The timeline is empty.' : 'The range to export is empty.')
  return { startUs, endUs, durationUs: endUs - startUs }
}

function checkMattes(doc: Project, hasMatte: HasMatte) {
  // a clip whose background removal hasn't finished would export with its background: say so instead
  const waiting = new Set(doc.tracks.flatMap((t) => t.clips).flatMap((c) => ((c.kind === 'video' || c.kind === 'image') && c.enabled && c.cutout && !hasMatte(c.assetId) ? [c.assetId] : [])))
  if (waiting.size) throw new Error(`Background removal is still running for ${waiting.size} file${waiting.size === 1 ? '' : 's'}. Export again when it finishes.`)
}

/** Write bytes produced in the renderer to a file through the main process. */
async function writeFile(path: string, data: Uint8Array) {
  const { handle } = await window.framevane.export.open(path)
  try {
    await window.framevane.export.write(handle, 0, data)
    return await window.framevane.export.close(handle, {})
  } catch (e) {
    await window.framevane.export.close(handle, { abort: true }).catch(() => {})
    throw e
  }
}

export async function exportProject(doc: Project, s: ExportSettings, onProgress: (p: ExportProgress) => void, signal: AbortSignal, hasMatte: HasMatte = () => false): Promise<{ path: string; bytes: number; audioCodec: string | null }> {
  const W = even(s.width)
  const H = even(s.height)
  const { startUs, durationUs } = exportRange(doc, s.range)
  checkMattes(doc, hasMatte)
  const container = s.container ?? 'mp4'
  if (!CONTAINER_CODECS[container].includes(s.codec)) throw new Error(`${CODEC_LABEL[s.codec]} can't go in a ${container.toUpperCase()} file.`)
  if (!(await canEncodeVideo(s.codec, { width: W, height: H, bitrate: s.bitrate }))) {
    throw new Error(`This system can't encode ${CODEC_LABEL[s.codec]} at ${W}×${H}. Try H.264 or a lower resolution.`)
  }
  await ensureFonts(doc)
  await ensureLuts(doc)
  const pool = new MediaPool()
  const { handle } = await window.framevane.export.open(s.outputPath)
  let finished = false
  try {
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d', { alpha: false })!
    const writable = new WritableStream<StreamTargetChunk>({
      write: (chunk) => window.framevane.export.write(handle, chunk.position, chunk.data),
    })
    const format = container === 'webm' ? new WebMOutputFormat() : container === 'mov' ? new MovOutputFormat() : new Mp4OutputFormat()
    const output = new Output({ format, target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) })
    const video = new CanvasSource(canvas, { codec: s.codec, bitrate: s.bitrate, keyFrameInterval: 2, latencyMode: 'quality' } as ConstructorParameters<typeof CanvasSource>[1])
    output.addVideoTrack(video, { frameRate: s.fps })

    onProgress({ phase: 'audio', progress: 0, frame: 0, frames: 0, fps: 0, etaSeconds: null })
    const mix = s.noAudio ? null : await renderMix(doc, pool, durationUs, 48000, startUs)
    let audioCodec: 'aac' | 'opus' | null = null
    let audio: AudioBufferSource | null = null as AudioBufferSource | null
    if (mix) {
      audioCodec = container !== 'webm' && (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192_000 })) ? 'aac' : 'opus'
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
      const tUs = startUs + Math.round((i / s.fps) * 1e6)
      await feedAudio(i / s.fps + 1)
      const visuals = await fetchVisuals(doc, pool, tUs, undefined, hasMatte)
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
    const r = await window.framevane.export.close(handle, {})
    return { ...r, audioCodec }
  } finally {
    if (!finished) await window.framevane.export.close(handle, { abort: true }).catch(() => {})
    await pool.dispose()
  }
}

/** An animated GIF: a silent H.264 render at the GIF's size, then FFmpeg's two-pass palette. */
export async function exportGif(doc: Project, o: { outputPath: string; width: number; fps: number; range?: { startUs: number; endUs: number } }, onProgress: (p: ExportProgress) => void, signal: AbortSignal, hasMatte: HasMatte = () => false) {
  const tmp = await window.framevane.export.tempPath('mp4')
  const W = even(o.width)
  const H = even((o.width * doc.canvas.height) / doc.canvas.width)
  await exportProject(doc, { projectId: doc.id, outputPath: tmp, width: W, height: H, fps: o.fps, bitrate: Math.round(W * H * o.fps * 0.4), codec: 'avc', range: o.range, noAudio: true }, onProgress, signal, hasMatte)
  onProgress({ phase: 'finalizing', progress: 1, frame: 0, frames: 0, fps: 0, etaSeconds: null })
  return window.framevane.export.convert({ kind: 'gif', src: tmp, out: o.outputPath, fps: o.fps, width: W })
}

/** The timeline's sound only: WAV written directly, MP3 or M4A (AAC) through FFmpeg. */
export async function exportAudio(doc: Project, o: { outputPath: string; format: 'wav' | 'mp3' | 'm4a'; range?: { startUs: number; endUs: number } }) {
  const { startUs, durationUs } = exportRange(doc, o.range)
  const pool = new MediaPool()
  try {
    const mix = await renderMix(doc, pool, durationUs, 48000, startUs)
    if (!mix) throw new Error('There is no sound on the timeline.')
    const wav = encodeWav(mix)
    if (o.format === 'wav') return await writeFile(o.outputPath, wav)
    const tmp = await window.framevane.export.tempPath('wav')
    await writeFile(tmp, wav)
    return await window.framevane.export.convert({ kind: 'audio', src: tmp, out: o.outputPath, format: o.format })
  } finally {
    await pool.dispose()
  }
}

/** One frame of the timeline as a picture, exactly as the preview draws it. */
/** One frame of the timeline (or a photo) as a picture. PNG and WebP keep transparency; JPG gets a white background. */
export async function exportFrame(doc: Project, o: { outputPath: string; format: 'png' | 'jpg' | 'webp'; width: number; height: number; tUs: number; quality?: number }, hasMatte: HasMatte = () => false) {
  checkMattes(doc, hasMatte)
  await ensureFonts(doc)
  await ensureLuts(doc)
  const pool = new MediaPool()
  try {
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(o.width)), Math.max(1, Math.round(o.height)))
    const ctx = canvas.getContext('2d', { alpha: o.format !== 'jpg' })!
    if (o.format === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    const t = Math.max(0, Math.min(o.tUs, projectDurationUs(doc) - 1))
    const visuals = await fetchVisuals(doc, pool, t, undefined, hasMatte)
    if (o.format === 'jpg' && doc.canvas.background.kind === 'transparent') {
      // draw onto the white page instead of clearing it
      const layer = new OffscreenCanvas(canvas.width, canvas.height)
      drawFrame(layer.getContext('2d')!, doc, t, visuals, canvas.width / doc.canvas.width)
      ctx.drawImage(layer, 0, 0)
    } else drawFrame(ctx, doc, t, visuals, canvas.width / doc.canvas.width)
    const blob = await canvas.convertToBlob(o.format === 'png' ? { type: 'image/png' } : { type: o.format === 'webp' ? 'image/webp' : 'image/jpeg', quality: o.quality ?? 0.92 })
    return await writeFile(o.outputPath, new Uint8Array(await blob.arrayBuffer()))
  } finally {
    await pool.dispose()
  }
}

/** 16-bit PCM WAV. */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels
  const n = buf.length
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true)
  data.setUint32(24, buf.sampleRate, true); data.setUint32(28, buf.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true)
  str(36, 'data'); data.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c]![i]!)); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2 }
  return new Uint8Array(data.buffer)
}

function slice(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.floor(from * buf.sampleRate)
  const b = Math.min(buf.length, Math.floor(to * buf.sampleRate))
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, b - a), sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch)
  return out
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/* ───────────── one entry point for the dialog and the MCP tool ───────────── */

const BITRATE_PER_PIXEL = { low: 0.07, recommended: 0.12, high: 0.2 }
/** HEVC, AV1 and VP9 reach the same quality with fewer bits. */
const CODEC_EFFICIENCY: Record<VideoCodecId, number> = { avc: 1, hevc: 0.65, av1: 0.55, vp9: 0.7 }

/** Output size for a short side, keeping the project's shape. */
export function outputSize(doc: Project, short: number) {
  const portrait = doc.canvas.height > doc.canvas.width
  const ar = doc.canvas.width / doc.canvas.height
  return { width: even(portrait ? short : short * ar), height: even(portrait ? short / ar : short) }
}

export function bitrateFor(width: number, height: number, fps: number, codec: VideoCodecId, quality: 'low' | 'recommended' | 'high' = 'recommended', mbps?: number) {
  return mbps ? Math.round(mbps * 1e6) : Math.round(width * height * fps * BITRATE_PER_PIXEL[quality] * CODEC_EFFICIENCY[codec])
}

export async function runExport(doc: Project, r: ExportRequest, onProgress: (p: ExportProgress) => void, signal: AbortSignal, hasMatte: HasMatte = () => false): Promise<{ path: string; bytes: number }> {
  const { width, height } = outputSize(doc, r.height)
  switch (r.format) {
    // for a GIF the size given is its width
    case 'gif': return exportGif(doc, { outputPath: r.outputPath, width: Math.min(r.height, 1080), fps: Math.min(r.fps, 30), range: r.range }, onProgress, signal, hasMatte)
    case 'wav': case 'mp3': case 'm4a': return exportAudio(doc, { outputPath: r.outputPath, format: r.format, range: r.range })
    case 'png': case 'jpg': case 'webp': return exportFrame(doc, { outputPath: r.outputPath, format: r.format, width: r.width ?? width, height: r.width ? Math.round((r.width * doc.canvas.height) / doc.canvas.width) : height, tUs: r.atUs ?? 0, quality: r.imageQuality }, hasMatte)
    default: {
      const codec = r.codec ?? (r.format === 'webm' ? 'vp9' : 'avc')
      const bitrate = bitrateFor(width, height, r.fps, codec, r.quality, r.bitrateMbps)
      return exportProject(doc, { projectId: doc.id, outputPath: r.outputPath, width, height, fps: r.fps, bitrate, codec, container: r.format, range: r.range }, onProgress, signal, hasMatte)
    }
  }
}
