import type { CaptionClip, MediaClip, Project, Track } from './schema'
import { clipEnd } from './ops'

/**
 * Pure helpers that translate per-asset analysis (source time) onto the current timeline, so the same transcript
 * or silence list stays correct after any number of cuts, trims and speed changes.
 */

export interface SourceWord { text: string; start: number; end: number } // seconds, source time
export interface TimelineWord { text: string; startUs: number; endUs: number; clipId: string }
export interface RangeUs { startUs: number; endUs: number }

const mediaClipsWithAudio = (doc: Project, track: Track) =>
  track.clips.filter((c): c is MediaClip => (c.kind === 'video' || c.kind === 'audio') && !!doc.assets[c.assetId]?.hasAudio && c.enabled)

/** Audio-bearing tracks that are audible (not muted/hidden). Main track first. */
export function audibleTracks(doc: Project): Track[] {
  return doc.tracks.filter((t) => (t.kind === 'video' || t.kind === 'audio') && !t.muted).sort((a, b) => Number(b.main) - Number(a.main))
}

/** Map a source-time interval of one clip to timeline time (clamped to the clip). */
export function sourceToTimeline(clip: MediaClip, srcStartUs: number, srcEndUs: number): RangeUs | null {
  const srcIn = clip.inUs
  const srcOut = clip.inUs + clip.durationUs * clip.speed
  const a = Math.max(srcStartUs, srcIn)
  const b = Math.min(srcEndUs, srcOut)
  if (b <= a) return null
  return { startUs: Math.round(clip.startUs + (a - srcIn) / clip.speed), endUs: Math.round(clip.startUs + (b - srcIn) / clip.speed) }
}

/**
 * Words of every clip on the given track (default: main track), in timeline time.
 * transcripts: assetId → words in source seconds. A word must be mostly inside the clip to count.
 */
export function timelineWords(doc: Project, transcripts: Record<string, SourceWord[]>, trackId?: string): TimelineWord[] {
  const track = trackId ? doc.tracks.find((t) => t.id === trackId) : doc.tracks.find((t) => t.main) ?? audibleTracks(doc)[0]
  if (!track) return []
  const out: TimelineWord[] = []
  for (const clip of mediaClipsWithAudio(doc, track)) {
    const words = transcripts[clip.assetId]
    if (!words) continue
    for (const w of words) {
      const s = Math.round(w.start * 1e6)
      const e = Math.round(w.end * 1e6)
      const r = sourceToTimeline(clip, s, e)
      if (!r) continue
      // keep the word if at least half of it survived the cut
      if ((r.endUs - r.startUs) * clip.speed < (e - s) * 0.5) continue
      out.push({ text: w.text.trim(), startUs: r.startUs, endUs: r.endUs, clipId: clip.id })
    }
  }
  return out.sort((a, b) => a.startUs - b.startUs)
}

/** Silences (source seconds per asset) → timeline ranges on a track, shrunk by `padUs` on each side and merged. */
export function timelineSilences(doc: Project, silences: Record<string, { start: number; end: number }[]>, opts: { padUs?: number; minUs?: number; trackId?: string } = {}): RangeUs[] {
  const pad = opts.padUs ?? 100_000
  const min = opts.minUs ?? 300_000
  const track = opts.trackId ? doc.tracks.find((t) => t.id === opts.trackId) : doc.tracks.find((t) => t.main)
  if (!track) return []
  const ranges: RangeUs[] = []
  for (const clip of mediaClipsWithAudio(doc, track)) {
    for (const s of silences[clip.assetId] ?? []) {
      const r = sourceToTimeline(clip, Math.round(s.start * 1e6), Math.round(s.end * 1e6))
      if (!r) continue
      // don't pad at the very start/end of the clip: silence there can go entirely
      const a = r.startUs <= clip.startUs ? r.startUs : r.startUs + pad
      const b = r.endUs >= clipEnd(clip) ? r.endUs : r.endUs - pad
      if (b - a >= min) ranges.push({ startUs: a, endUs: b })
    }
  }
  return mergeRanges(ranges)
}

export function mergeRanges(ranges: RangeUs[]): RangeUs[] {
  const sorted = ranges.filter((r) => r.endUs > r.startUs).sort((a, b) => a.startUs - b.startUs)
  const out: RangeUs[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.startUs <= last.endUs) last.endUs = Math.max(last.endUs, r.endUs)
    else out.push({ ...r })
  }
  return out
}

export interface CaptionOptions { maxChars?: number; maxDurationUs?: number; maxGapUs?: number; idPrefix?: string }

/**
 * Group words into caption lines: break on sentence punctuation, long pauses, length and duration limits.
 * Lines never span a cut (words from different clips with a gap between them start a new line).
 */
export function buildCaptionClips(words: TimelineWord[], opts: CaptionOptions = {}): CaptionClip[] {
  const maxChars = opts.maxChars ?? 32
  const maxDur = opts.maxDurationUs ?? 3_500_000
  const maxGap = opts.maxGapUs ?? 600_000
  const prefix = opts.idPrefix ?? 'cap'
  const lines: TimelineWord[][] = []
  let cur: TimelineWord[] = []
  const flush = () => { if (cur.length) lines.push(cur); cur = [] }
  for (const w of words) {
    if (!w.text) continue
    const prev = cur[cur.length - 1]
    if (prev) {
      const text = [...cur, w].map((x) => x.text).join(' ')
      // let a sentence-ending word stay on its line (up to 30% over) instead of becoming a one-word orphan
      const endsSentence = /[.!?]$/.test(w.text)
      const tooLong = text.length > (endsSentence ? Math.round(maxChars * 1.3) : maxChars)
      const tooSlow = w.endUs - cur[0]!.startUs > maxDur
      const gap = w.startUs - prev.endUs > maxGap
      if (tooLong || tooSlow || gap) flush()
    }
    cur.push(w)
    if (/[.!?]$/.test(w.text)) flush()
  }
  flush()
  const clips: CaptionClip[] = []
  lines.forEach((ws, i) => {
    const start = ws[0]!.startUs
    // hold each line until the next one starts (max +400ms) so captions don't flicker off between words
    const next = lines[i + 1]?.[0]?.startUs
    const naturalEnd = ws[ws.length - 1]!.endUs
    const end = Math.max(naturalEnd, Math.min(next ?? naturalEnd + 400_000, naturalEnd + 400_000))
    const prevEnd = clips[clips.length - 1] ? clips[clips.length - 1]!.startUs + clips[clips.length - 1]!.durationUs : 0
    const startUs = Math.max(start, prevEnd)
    const durationUs = Math.max(100_000, end - startUs)
    clips.push({
      id: `${prefix}-${startUs.toString(36)}`,
      kind: 'caption',
      startUs,
      durationUs,
      enabled: true,
      text: ws.map((w) => w.text).join(' '),
      words: ws.map((w) => ({ text: w.text, startUs: Math.max(0, w.startUs - startUs), endUs: Math.max(0, Math.min(durationUs, w.endUs - startUs)) })),
    })
  })
  return clips
}
