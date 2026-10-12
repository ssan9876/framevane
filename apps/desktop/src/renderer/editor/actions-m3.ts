import {
  NO_LOOK, applyOps, captionLines, clipEnd, duckingKeyframes, findClip, isFiller, parseSrt, speechRanges, timelineWords, toPlainText, toSrt, wordCutRanges,
  DEFAULT_CAPTION_STYLE, NO_TEXT_ANIM, TextStyle,
  type Clip, type MediaClip, type OpInput, type Project, type TextClip, type TimelineWord,
} from '@framevane/doc'
import type { AudioPreset, MediaInfo } from '../../shared/api'
import { useApp } from '../app/store'
import { newId } from './actions'
import type { TextPreset } from './textPresets'

/** M3 editor actions: text, voice, audio clean-up, ducking, caption files and transcript cuts. */

const st = () => useApp.getState()
const free = (clips: Clip[], at: number, dur: number) => !clips.some((c) => c.startUs < at + dur && at < clipEnd(c))

/* ───────── text ───────── */

/** Add a text clip at the playhead (3 s) on the first text track with room, or a new one. */
export async function addText(preset?: TextPreset, text?: string) {
  const { doc, playheadUs } = st()
  if (!doc) return null
  const dur = 3_000_000
  const style = TextStyle.parse({ ...DEFAULT_CAPTION_STYLE, y: 0.5, fontSize: 96, strokeWidth: 0, ...(preset?.style ?? {}) })
  const clip: TextClip = {
    id: newId('text'), kind: 'text', startUs: playheadUs, durationUs: dur, enabled: true,
    text: text ?? preset?.sample ?? 'Add text', style,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    keyframes: {},
    anim: { in: { ...NO_TEXT_ANIM.in, ...(preset?.anim?.in ?? {}) }, out: { ...NO_TEXT_ANIM.out, ...(preset?.anim?.out ?? {}) } },
  }
  const ops: OpInput[] = []
  const track = doc.tracks.find((t) => t.kind === 'text' && !t.locked && free(t.clips, playheadUs, dur))
  let trackId = track?.id
  if (!trackId) {
    trackId = newId('track-text')
    ops.push({ type: 'add_track', track: { id: trackId, kind: 'text', name: `Text ${doc.tracks.filter((t) => t.kind === 'text').length + 1}`, main: false, locked: false, hidden: false, muted: false, clips: [] } })
  }
  ops.push({ type: 'add_clip', trackId, clip })
  if (await st().apply(ops)) { st().select([clip.id]); return clip.id }
  return null
}

/* ───────── audio placement ───────── */

/** Ops to put an imported audio asset at a time, on the first audio track with room (or a new one). */
export function placeAudioOps(doc: Project, m: MediaInfo, atUs: number): OpInput[] {
  const dur = m.asset.durationUs ?? 1_000_000
  const ops: OpInput[] = []
  if (!doc.assets[m.asset.id]) ops.push({ type: 'add_asset', asset: m.asset })
  let trackId = doc.tracks.find((t) => t.kind === 'audio' && !t.locked && free(t.clips, atUs, dur))?.id
  if (!trackId) {
    trackId = newId('track-audio')
    ops.push({ type: 'add_track', track: { id: trackId, kind: 'audio', name: `Audio ${doc.tracks.filter((t) => t.kind === 'audio').length + 1}`, main: false, locked: false, hidden: false, muted: false, clips: [] } })
  }
  ops.push({ type: 'add_clip', trackId, clip: { id: newId('clip'), kind: 'audio', assetId: m.asset.id, startUs: atUs, durationUs: dur } })
  return ops
}

/** Speak text with a voice and put the result on an audio track at `atUs`. */
export async function speak(text: string, voiceId: string, speed: number, atUs: number) {
  const doc = st().doc
  if (!doc) return false
  const m = await window.framevane.tts.speak(doc.id, text, voiceId, speed)
  const cur = st().doc!
  return st().apply(placeAudioOps(cur, m, atUs))
}

/* ───────── clean-up ───────── */

/**
 * Swap a clip's sound for a cleaned-up render. Audio clips switch media in place; a video clip first gets its sound
 * detached to a linked audio clip, which then switches (the picture is untouched).
 */
export async function cleanUpAudio(clipId: string, preset: AudioPreset) {
  const doc = st().doc
  const f = doc && findClip(doc, clipId)
  if (!doc || !f || (f.clip.kind !== 'audio' && f.clip.kind !== 'video')) return false
  const c = f.clip as MediaClip
  const m = await window.framevane.media.processAudio(doc.id, c.assetId, preset)
  const cur = st().doc!
  const now = findClip(cur, clipId)?.clip as MediaClip | undefined
  if (!now) return false
  const ops: OpInput[] = [{ type: 'add_asset', asset: m.asset }]
  if (now.kind === 'audio') {
    ops.push({ type: 'replace_clip_media', clipId: now.id, assetId: m.asset.id, inUs: now.inUs })
  } else {
    // detach: the video goes quiet, a linked audio clip carries the cleaned sound
    const linkId = now.linkId ?? newId('link')
    ops.push({ type: 'set_clip_props', clipId: now.id, audioEnabled: false, linkId, fadeInUs: 0, fadeOutUs: 0 })
    const audio: MediaClip = {
      id: newId('clip'), kind: 'audio', assetId: m.asset.id, startUs: now.startUs, durationUs: now.durationUs, enabled: true, inUs: now.inUs, speed: now.speed,
      transform: now.transform, volumeDb: now.volumeDb, blend: 'normal', audioEnabled: true, reversed: false, linkId,
      keyframes: now.keyframes.volumeDb ? { volumeDb: now.keyframes.volumeDb } : {}, fadeInUs: now.fadeInUs, fadeOutUs: now.fadeOutUs, ...NO_LOOK,
    }
    const tid = cur.tracks.find((t) => t.kind === 'audio' && !t.locked && free(t.clips, audio.startUs, audio.durationUs))?.id
    if (tid) ops.push({ type: 'add_clip', trackId: tid, clip: audio })
    else {
      const id = newId('track-audio')
      ops.push({ type: 'add_track', track: { id, kind: 'audio', name: `Audio ${cur.tracks.filter((t) => t.kind === 'audio').length + 1}`, main: false, locked: false, hidden: false, muted: false, clips: [] } })
      ops.push({ type: 'add_clip', trackId: id, clip: audio })
    }
  }
  return st().apply(ops)
}

/* ───────── ducking ───────── */

/** Main-track speech as timeline ranges (transcribes the main track's audio if needed; results are cached). */
export async function mainTrackWords(doc: Project): Promise<TimelineWord[]> {
  const main = doc.tracks.find((t) => t.main)
  if (!main) return []
  const ids = [...new Set(main.clips.flatMap((c) => ('assetId' in c && doc.assets[c.assetId]?.hasAudio && c.audioEnabled !== false ? [c.assetId] : [])))]
  // detached sound lives on linked audio clips; their words count too
  const linked = doc.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips.filter((c) => c.kind === 'audio' && c.linkId).map((c) => (c as MediaClip).assetId))
  const transcripts: Record<string, { text: string; start: number; end: number }[]> = {}
  for (const id of new Set([...ids, ...linked])) transcripts[id] = (await window.framevane.analysis.transcript(doc.id, id)).words
  const words = timelineWords(doc, transcripts, main.id)
  if (linked.length) for (const t of doc.tracks.filter((x) => x.kind === 'audio')) words.push(...timelineWords(doc, transcripts, t.id).filter((w) => (findClip(doc, w.clipId)?.clip as MediaClip | undefined)?.linkId))
  return words.sort((a, b) => a.startUs - b.startUs)
}

/** Lower a music clip while people talk on the main track. */
export async function duckUnderSpeech(clipId: string, duckDb = 12) {
  const doc = st().doc
  const f = doc && findClip(doc, clipId)
  if (!doc || !f || f.clip.kind !== 'audio') return 0
  const ranges = speechRanges(await mainTrackWords(doc))
  const c = findClip(st().doc!, clipId)?.clip as MediaClip
  const keyframes = duckingKeyframes(c, ranges, { duckDb })
  if (!keyframes.length) { st().setError('No speech overlaps this clip, so there is nothing to duck under.'); return 0 }
  await st().apply([{ type: 'set_keyframes', clipId, prop: 'volumeDb', keyframes }])
  return ranges.length
}

/* ───────── caption files ───────── */

export async function exportCaptions(format: 'srt' | 'txt') {
  const doc = st().doc
  if (!doc) return null
  const lines = captionLines(doc)
  if (!lines.length) { st().setError('There are no captions to export yet.'); return null }
  const path = await window.framevane.app.pickSavePath({ defaultName: doc.name, ext: format })
  if (!path) return null
  await window.framevane.app.writeTextFile(path, format === 'srt' ? toSrt(lines) : toPlainText(lines))
  return path
}

export async function importSrt() {
  const doc = st().doc
  if (!doc) return 0
  const [path] = await window.framevane.app.pickFiles({ kind: 'subtitle' })
  if (!path) return 0
  const clips = parseSrt(await window.framevane.app.readTextFile(path), `srt-${Date.now().toString(36)}`)
  if (!clips.length) { st().setError('No captions were found in that file.'); return 0 }
  const existing = doc.tracks.find((t) => t.kind === 'caption')
  const ok = await st().apply([{ type: 'add_captions', trackId: existing?.id ?? 'track-captions', trackName: 'Captions', clips, replace: !!existing }])
  return ok ? clips.length : 0
}

/* ───────── transcript cuts (S30) ───────── */

/** Cut the given words out of the timeline (one undo step). Ranges are applied latest-first so each stays valid. */
export async function cutWords(words: { startUs: number; endUs: number }[]) {
  const doc = st().doc
  if (!doc || !words.length) return false
  const ranges = wordCutRanges(words).reverse()
  const ops: OpInput[] = ranges.map((r) => ({ type: 'ripple_delete_range', startUs: r.startUs, endUs: r.endUs }))
  try { applyOps(doc, ops) } catch (e) { st().setError(e instanceof Error ? e.message : String(e)); return false }
  return st().apply(ops)
}

export const fillerWords = (words: TimelineWord[]) => words.filter((w) => isFiller(w.text))

