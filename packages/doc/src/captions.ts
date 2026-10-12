import { clipEnd } from './ops'
import type { CaptionClip, Keyframe, MediaClip, Project } from './schema'
import { mergeRanges, type RangeUs, type TimelineWord } from './timeline'

/* ───────────────────────── SRT / TXT ───────────────────────── */

function srtTime(us: number) {
  const ms = Math.max(0, Math.round(us / 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

/** The caption lines of a track (default: the first caption track), in time order. */
export function captionLines(doc: Project, trackId?: string): CaptionClip[] {
  const t = doc.tracks.find((x) => (trackId ? x.id === trackId : x.kind === 'caption'))
  if (!t) return []
  return t.clips.filter((c): c is CaptionClip => c.kind === 'caption' && c.enabled && c.text.trim() !== '').sort((a, b) => a.startUs - b.startUs)
}

export function toSrt(lines: CaptionClip[]): string {
  return lines.map((c, i) => `${i + 1}\n${srtTime(c.startUs)} --> ${srtTime(clipEnd(c))}\n${c.text.trim()}\n`).join('\n')
}

export function toPlainText(lines: CaptionClip[]): string {
  return lines.map((c) => c.text.trim()).join('\n') + (lines.length ? '\n' : '')
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
const toUs = (m: RegExpMatchArray) => ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, '0'))) * 1000

/** Parse SRT (also tolerates WebVTT cue blocks). Overlapping cues are trimmed so they fit one caption track. */
export function parseSrt(text: string, idPrefix = 'srt'): CaptionClip[] {
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: { startUs: number; endUs: number; text: string }[] = []
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '')
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const [a, z] = lines[ti]!.split('-->')
    const ma = a?.match(TIME)
    const mz = z?.match(TIME)
    if (!ma || !mz) continue
    const body = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, '').replace(/\s+/g, ' ').trim()
    const startUs = toUs(ma)
    const endUs = toUs(mz)
    if (!body || endUs <= startUs) continue
    cues.push({ startUs, endUs, text: body.slice(0, 500) })
  }
  cues.sort((x, y) => x.startUs - y.startUs)
  const out: CaptionClip[] = []
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!
    const prevEnd = out.length ? clipEnd(out[out.length - 1]!) : 0
    const startUs = Math.max(c.startUs, prevEnd)
    if (c.endUs - startUs < 50_000) continue
    out.push({ id: `${idPrefix}-${i + 1}`, kind: 'caption', startUs, durationUs: c.endUs - startUs, enabled: true, text: c.text, words: [] })
  }
  return out
}

/* ───────────────────────── audio fades & ducking ───────────────────────── */

/** Fade gain (0–1) of a media clip at clip-local time t. In and out never overlap: each is capped at half the clip. */
export function fadeGainAt(clip: Pick<MediaClip, 'durationUs' | 'fadeInUs' | 'fadeOutUs'>, localUs: number): number {
  const half = clip.durationUs / 2
  const fin = Math.min(clip.fadeInUs, half)
  const fout = Math.min(clip.fadeOutUs, half)
  let g = 1
  if (fin > 0 && localUs < fin) g = Math.min(g, Math.max(0, localUs / fin))
  if (fout > 0 && localUs > clip.durationUs - fout) g = Math.min(g, Math.max(0, (clip.durationUs - localUs) / fout))
  return g
}

/**
 * Volume keyframes that lower a music clip while someone speaks ("ducking"). Speech ranges are timeline µs.
 * The clip's own level is the "up" value; it drops by `duckDb` with `rampUs` ramps around each speech range.
 */
export function duckingKeyframes(clip: Pick<MediaClip, 'startUs' | 'durationUs' | 'volumeDb'>, speech: RangeUs[], opts: { duckDb?: number; rampUs?: number; mergeGapUs?: number } = {}): Keyframe[] {
  const duck = opts.duckDb ?? 12
  const ramp = opts.rampUs ?? 250_000
  const gap = opts.mergeGapUs ?? 700_000
  const up = clip.volumeDb
  const down = Math.max(-60, up - duck)
  const end = clip.durationUs
  // local ranges, padded by the ramp and merged when the music would only come up briefly
  const local = mergeRanges(speech.map((r) => ({ startUs: r.startUs - clip.startUs - ramp, endUs: r.endUs - clip.startUs + ramp }))
    .filter((r) => r.endUs > 0 && r.startUs < end))
  const merged: RangeUs[] = []
  for (const r of local) {
    const last = merged[merged.length - 1]
    if (last && r.startUs - last.endUs < gap) last.endUs = Math.max(last.endUs, r.endUs)
    else merged.push({ ...r })
  }
  if (!merged.length) return []
  const kfs: Keyframe[] = []
  const push = (tUs: number, value: number) => {
    const t = Math.max(0, Math.min(end, Math.round(tUs)))
    const last = kfs[kfs.length - 1]
    if (last && t <= last.tUs) { if (t === last.tUs) last.value = value; return }
    kfs.push({ tUs: t, value, easing: 'linear' })
  }
  push(0, merged[0]!.startUs <= 0 ? down : up)
  for (const r of merged) {
    if (r.startUs > 0) { push(r.startUs, up); push(r.startUs + ramp, down) }
    if (r.endUs < end) { push(r.endUs - ramp, down); push(r.endUs, up) }
  }
  return kfs
}

/** Speech ranges from timeline words: words closer than `joinUs` count as one stretch of speech. */
export function speechRanges(words: TimelineWord[], joinUs = 400_000): RangeUs[] {
  const out: RangeUs[] = []
  for (const w of [...words].sort((a, b) => a.startUs - b.startUs)) {
    const last = out[out.length - 1]
    if (last && w.startUs - last.endUs <= joinUs) last.endUs = Math.max(last.endUs, w.endUs)
    else out.push({ startUs: w.startUs, endUs: w.endUs })
  }
  return out
}

/* ───────────────────────── filler words ───────────────────────── */

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm', 'eh'])

/** Hesitation sounds ("um", "uh"…). Words like "like" or "you know" are left to judgement (the agent). */
export function isFiller(word: string) {
  return FILLERS.has(word.toLowerCase().replace(/[^a-z]/g, ''))
}

/** Ranges to cut for a set of words, padded a little and merged (for transcript editing and filler removal). */
export function wordCutRanges(words: { startUs: number; endUs: number }[], padUs = 20_000): RangeUs[] {
  return mergeRanges(words.map((w) => ({ startUs: Math.max(0, w.startUs - padUs), endUs: w.endUs + padUs })))
}
