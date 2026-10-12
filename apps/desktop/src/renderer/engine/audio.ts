import { clipEnd, type MediaClip, type Project } from '@framevane/doc'
import type { MediaPool } from './sources'

/**
 * One audio graph definition for preview (AudioContext) and export (OfflineAudioContext):
 * every audible clip becomes a buffer source with its speed and volume, started at its timeline position.
 */

export function audibleClips(doc: Project): MediaClip[] {
  const out: MediaClip[] = []
  for (const t of doc.tracks) {
    if (t.muted || (t.kind !== 'video' && t.kind !== 'audio')) continue
    for (const c of t.clips) {
      if (!c.enabled || (c.kind !== 'video' && c.kind !== 'audio')) continue
      if (!doc.assets[c.assetId]?.hasAudio) continue
      out.push(c)
    }
  }
  return out
}

export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Preload decoded audio for every audible clip. */
export async function loadAudio(doc: Project, pool: MediaPool, ctx: BaseAudioContext, isReady: (assetId: string) => boolean = () => true) {
  const ids = new Set(audibleClips(doc).map((c) => c.assetId).filter(isReady))
  const entries = await Promise.all([...ids].map(async (id) => [id, await pool.audioBuffer(doc.assets[id]!, ctx).catch(() => null)] as const))
  return new Map(entries)
}

/**
 * Schedule playback from timeline time `fromUs` at context time `when`. Returns the nodes (stop them to pause/seek).
 */
export function schedule(doc: Project, buffers: Map<string, AudioBuffer | null>, ctx: BaseAudioContext, dest: AudioNode, fromUs: number, when: number, untilUs = Infinity) {
  const nodes: AudioBufferSourceNode[] = []
  for (const c of audibleClips(doc)) {
    const buf = buffers.get(c.assetId)
    if (!buf) continue
    const end = Math.min(clipEnd(c), untilUs)
    if (end <= fromUs) continue
    const startTl = Math.max(c.startUs, fromUs)
    const srcOffset = (c.inUs + (startTl - c.startUs) * c.speed) / 1e6
    const durSrc = ((end - startTl) * c.speed) / 1e6
    if (durSrc <= 0 || srcOffset >= buf.duration) continue
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.playbackRate.value = c.speed
    const gain = ctx.createGain()
    gain.gain.value = dbToGain(c.volumeDb)
    node.connect(gain).connect(dest)
    node.start(when + (startTl - fromUs) / 1e6, srcOffset, durSrc)
    nodes.push(node)
  }
  return nodes
}

/** Render the whole mix offline (export). */
export async function renderMix(doc: Project, pool: MediaPool, durationUs: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  const length = Math.ceil((durationUs / 1e6) * sampleRate)
  if (length <= 0) return null
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate })
  const buffers = await loadAudio(doc, pool, ctx)
  if (![...buffers.values()].some(Boolean)) return null
  schedule(doc, buffers, ctx, ctx.destination, 0, 0, durationUs)
  return ctx.startRendering()
}
