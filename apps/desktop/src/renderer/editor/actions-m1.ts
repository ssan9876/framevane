import {
  applyOps, clipEnd, findClip, isAnimated, sourceTimeAt,
  type AnimProp, type Clip, type MediaClip, type OpInput, type Project, type Track, type TrackKind,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { newId } from './actions'

/**
 * M1 editing commands: clipboard, duplicate, detach audio, freeze frame, reverse, enable/disable, groups, markers,
 * mirror, and keyframe-aware property edits. Placement is checked by simulating the ops locally (the op engine is
 * pure), so a paste never lands on top of another clip.
 */

const st = () => useApp.getState()
const isMedia = (c: Clip): c is MediaClip => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio'

/** Grow a selection to whole groups and (with linkage on) linked video/audio partners. */
export function expandSelection(doc: Project, ids: string[], linkage = st().linkage): string[] {
  const out = new Set(ids)
  const all = doc.tracks.flatMap((t) => t.clips)
  for (const id of ids) {
    const c = all.find((x) => x.id === id)
    if (!c) continue
    if (c.groupId) for (const x of all) if (x.groupId === c.groupId) out.add(x.id)
    if (linkage && isMedia(c) && c.linkId) for (const x of all) if (isMedia(x) && x.linkId === c.linkId) out.add(x.id)
  }
  return [...out]
}

/** Apply ops to a scratch copy; returns null if they don't fit (overlap, lock, range). */
function simulate(doc: Project, ops: OpInput[]): Project | null {
  try { return applyOps(doc, ops).doc } catch { return null }
}

function newTrackOp(doc: Project, kind: TrackKind): { op: OpInput; id: string } {
  const id = newId(`track-${kind}`)
  const n = doc.tracks.filter((t) => t.kind === kind).length + 1
  const name = kind === 'audio' ? `Audio ${n}` : kind === 'video' ? `Overlay ${n - 1}` : kind === 'caption' ? `Captions ${n}` : `Text ${n}`
  const index = kind === 'video' ? doc.tracks.findIndex((t) => t.main) + 1 : undefined
  return { id, op: { type: 'add_track', ...(index !== undefined ? { index } : {}), track: { id, kind, name, main: false, locked: false, hidden: false, muted: false, clips: [] } } }
}

/* ───────── clipboard ───────── */

export function copySelection(): boolean {
  const { doc, selection } = st()
  if (!doc || !selection.length) return false
  const items = expandSelection(doc, selection).map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => ({ trackId: f.track.id, trackKind: f.track.kind, clip: f.clip }))
  if (!items.length) return false
  useApp.setState({ clipboard: { items, originUs: Math.min(...items.map((i) => i.clip.startUs)) } })
  return true
}

export function cutSelection() {
  if (!copySelection()) return
  const { doc, selection, magnet } = st()
  if (!doc) return
  const ids = expandSelection(doc, selection)
  const ripple = ids.filter((id) => magnet && findClip(doc, id)?.track.main)
  const plain = ids.filter((id) => !ripple.includes(id))
  const ops: OpInput[] = []
  if (ripple.length) ops.push({ type: 'remove_clips', clipIds: ripple, ripple: true })
  if (plain.length) ops.push({ type: 'remove_clips', clipIds: plain, ripple: false })
  void st().apply(ops).then((ok) => { if (ok) st().select([]) })
}

/** Paste the clipboard at `atUs` (default: the playhead). On the magnet main track it inserts and pushes clips right. */
export async function pasteClipboard(atUs = st().playheadUs) {
  const { doc, clipboard, magnet } = st()
  if (!doc || !clipboard) return
  let work = doc
  const ops: OpInput[] = []
  const groupMap = new Map<string, string>()
  const linkMap = new Map<string, string>()
  const remap = (m: Map<string, string>, id?: string) => { if (!id) return undefined; if (!m.has(id)) m.set(id, newId('ref')); return m.get(id) }
  const pasted: string[] = []
  let mainCursor: number | null = null
  for (const item of [...clipboard.items].sort((a, b) => a.clip.startUs - b.clip.startUs)) {
    const id = newId('clip')
    const base = { ...item.clip, id, groupId: remap(groupMap, item.clip.groupId) } as Clip
    if (isMedia(base)) (base as MediaClip).linkId = remap(linkMap, (item.clip as MediaClip).linkId)
    const want = Math.max(0, atUs + (item.clip.startUs - clipboard.originUs))
    const main = work.tracks.find((t) => t.main)
    const sameTrack = work.tracks.find((t) => t.id === item.trackId && !t.locked)
    const target = sameTrack ?? work.tracks.find((t) => t.kind === item.trackKind && !t.locked)
    let step: OpInput[] | null = null
    if (target?.main && magnet && main) {
      // insert on the main track: split the clip under the insert point, then push everything after it right
      let at: number = mainCursor ?? want
      const under = main.clips.find((c) => c.startUs < at && at < clipEnd(c))
      const pre: OpInput[] = []
      if (under) {
        if (at - under.startUs < clipEnd(under) - at && at - under.startUs < 200_000) at = under.startUs
        else if (clipEnd(under) - at < 200_000) at = clipEnd(under)
        else pre.push({ type: 'split_clip', clipId: under.id, atUs: at, newClipId: newId('clip') })
      }
      step = [...pre, { type: 'add_clip', trackId: main.id, ripple: true, clip: { ...base, startUs: at } as Clip }]
      mainCursor = at + base.durationUs
    } else if (target) {
      const tryOn = (t: Track) => [{ type: 'add_clip', trackId: t.id, clip: { ...base, startUs: want } as Clip }] as OpInput[]
      step = simulate(work, tryOn(target)) ? tryOn(target) : null
      if (!step) {
        const other = work.tracks.find((t) => t.kind === item.trackKind && !t.locked && !t.main && t.id !== target.id && simulate(work, tryOn(t)))
        if (other) step = tryOn(other)
      }
    }
    if (!step) {
      const nt = newTrackOp(work, item.trackKind === 'video' && target?.main ? 'video' : item.trackKind)
      step = [nt.op, { type: 'add_clip', trackId: nt.id, clip: { ...base, startUs: want } as Clip }]
    }
    const next = simulate(work, step)
    if (!next) continue
    work = next
    ops.push(...step)
    pasted.push(id)
  }
  if (ops.length && (await st().apply(ops))) st().select(pasted)
}

export async function duplicateSelection() {
  const { doc, selection } = st()
  if (!doc || !selection.length || !copySelection()) return
  const ids = expandSelection(doc, selection)
  const end = Math.max(...ids.map((id) => findClip(doc, id)).filter(Boolean).map((f) => clipEnd(f!.clip)))
  await pasteClipboard(end)
}

/* ───────── audio / picture tools ───────── */

/** Move the sound of selected videos to linked clips on an audio track (and silence the video's own sound). */
export async function detachAudio() {
  const { doc, selection, playheadUs } = st()
  if (!doc) return
  const ids = selection.length ? selection : doc.tracks.filter((t) => t.main).flatMap((t) => t.clips.filter((c) => c.startUs <= playheadUs && playheadUs < clipEnd(c)).map((c) => c.id))
  let work = doc
  const ops: OpInput[] = []
  for (const id of ids) {
    const f = findClip(work, id)
    if (!f || f.clip.kind !== 'video' || f.track.locked) continue
    const c = f.clip
    if (!c.audioEnabled || c.freezeAtUs !== undefined || !work.assets[c.assetId]?.hasAudio) continue
    const linkId = newId('link')
    const audio: MediaClip = {
      id: newId('clip'), kind: 'audio', assetId: c.assetId, startUs: c.startUs, durationUs: c.durationUs, enabled: true,
      inUs: c.inUs, speed: c.speed, transform: c.transform, volumeDb: c.volumeDb, blend: 'normal', audioEnabled: true, reversed: c.reversed,
      keyframes: c.keyframes.volumeDb ? { volumeDb: c.keyframes.volumeDb } : {}, linkId,
    }
    const own: OpInput = { type: 'set_clip_props', clipId: c.id, audioEnabled: false, linkId }
    const free = work.tracks.find((t) => t.kind === 'audio' && !t.locked && simulate(work, [{ type: 'add_clip', trackId: t.id, clip: audio }]))
    const step: OpInput[] = free
      ? [own, { type: 'add_clip', trackId: free.id, clip: audio }]
      : (() => { const nt = newTrackOp(work, 'audio'); return [own, nt.op, { type: 'add_clip', trackId: nt.id, clip: audio }] as OpInput[] })()
    const next = simulate(work, step)
    if (!next) continue
    work = next
    ops.push(...step)
  }
  if (!ops.length) { st().setError('Select a video clip that has sound to detach its audio.'); return }
  await st().apply(ops)
}

/** Insert a 3 s still of the frame under the playhead and push the rest of the track right. */
export async function freezeFrame(durationUs = 3_000_000) {
  const { doc, selection, playheadUs } = st()
  if (!doc) return
  const pick = (c: Clip) => c.kind === 'video' && c.startUs <= playheadUs && playheadUs < clipEnd(c)
  const f = selection.map((id) => findClip(doc, id)).find((x) => x && pick(x.clip) && !x.track.locked)
    ?? doc.tracks.filter((t) => t.main && !t.locked).flatMap((t) => t.clips.filter(pick).map((c) => ({ track: t, clip: c })))[0]
  if (!f || f.clip.kind !== 'video') { st().setError('Put the playhead over a video clip to freeze a frame.'); return }
  const c = f.clip
  const freeze: MediaClip = { ...c, id: newId('freeze'), startUs: playheadUs, durationUs, freezeAtUs: Math.round(sourceTimeAt(c, playheadUs)), audioEnabled: false, linkId: undefined, keyframes: {} }
  const ops: OpInput[] = []
  if (playheadUs > c.startUs) ops.push({ type: 'split_clip', clipId: c.id, atUs: playheadUs, newClipId: newId('clip') })
  ops.push({ type: 'add_clip', trackId: f.track.id, ripple: true, clip: freeze })
  if (await st().apply(ops)) st().select([freeze.id])
}

/** Replace selected video clips with a backwards render of the same range (sound reversed too). */
export async function reverseSelection() {
  const { doc, selection } = st()
  if (!doc) return
  const targets = selection.map((id) => findClip(doc, id)).filter((f) => f && (f.clip.kind === 'video' || f.clip.kind === 'audio') && (f.clip as MediaClip).freezeAtUs === undefined && !f.track.locked)
  if (!targets.length) { st().setError('Select a video or audio clip to reverse.'); return }
  for (const f of targets) {
    const c = f!.clip as MediaClip
    const srcOut = Math.round(c.inUs + c.durationUs * c.speed)
    try {
      const info = await window.framevane.media.reverse(doc.id, c.assetId, c.inUs, srcOut)
      const cur = st().doc!
      await st().apply([
        ...(cur.assets[info.asset.id] ? [] : [{ type: 'add_asset' as const, asset: info.asset }]),
        { type: 'replace_clip_media', clipId: c.id, assetId: info.asset.id, inUs: 0, reversed: !c.reversed },
      ])
      useApp.setState((s) => ({ media: s.media.some((m) => m.asset.id === info.asset.id) ? s.media : [...s.media, info] }))
    } catch (e) {
      st().setError(`Couldn't reverse the clip: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

export function toggleEnabled() {
  const { doc, selection } = st()
  if (!doc || !selection.length) return
  const clips = expandSelection(doc, selection).map((id) => findClip(doc, id)?.clip).filter((c): c is Clip => !!c)
  const enable = clips.some((c) => !c.enabled)
  void st().apply(clips.map((c) => ({ type: 'set_clip_props', clipId: c.id, enabled: enable })))
}

export function toggleMirror() {
  const { doc, selection } = st()
  if (!doc) return
  const clips = selection.map((id) => findClip(doc, id)?.clip).filter((c): c is MediaClip => !!c && (c.kind === 'video' || c.kind === 'image'))
  if (!clips.length) return
  void st().apply(clips.map((c) => ({ type: 'set_clip_props', clipId: c.id, transform: { flipH: !c.transform.flipH } })))
}

export function groupSelection() {
  const { doc, selection } = st()
  if (!doc || selection.length < 2) return
  const groupId = newId('group')
  void st().apply(selection.map((id) => ({ type: 'set_clip_props', clipId: id, groupId })))
}

export function ungroupSelection() {
  const { doc, selection } = st()
  if (!doc) return
  const ids = expandSelection(doc, selection, false).filter((id) => findClip(doc, id)?.clip.groupId)
  if (ids.length) void st().apply(ids.map((id) => ({ type: 'set_clip_props', clipId: id, groupId: null })))
}

/* ───────── markers ───────── */

const MARKER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export function addMarker() {
  const { doc, playheadUs } = st()
  if (!doc) return
  if (doc.markers.some((m) => Math.abs(m.atUs - playheadUs) < 20_000)) return
  void st().apply([{ type: 'add_marker', marker: { id: newId('marker'), atUs: Math.round(playheadUs), color: MARKER_COLORS[doc.markers.length % MARKER_COLORS.length]!, label: '' } }])
}
export function removeMarker(markerId: string) {
  void st().apply([{ type: 'remove_marker', markerId }])
}
export function markerJump(doc: Project, fromUs: number, dir: 1 | -1): number | null {
  const ms = doc.markers.map((m) => m.atUs).sort((a, b) => a - b)
  const hit = dir > 0 ? ms.find((t) => t > fromUs + 1000) : [...ms].reverse().find((t) => t < fromUs - 1000)
  return hit ?? null
}

/* ───────── keyframe-aware property edits ───────── */

/** Clip-local playhead, clamped into the clip. */
export function localPlayhead(clip: Clip, playheadUs = st().playheadUs) {
  return Math.max(0, Math.min(clip.durationUs, Math.round(playheadUs - clip.startUs)))
}

/** Set a property: animated → keyframe at the playhead, otherwise the static value. */
export function setAnimProp(clip: MediaClip, prop: AnimProp, value: number): OpInput {
  if (isAnimated(clip, prop)) return { type: 'set_keyframe', clipId: clip.id, prop, tUs: localPlayhead(clip), value }
  return prop === 'volumeDb' ? { type: 'set_clip_props', clipId: clip.id, volumeDb: value } : { type: 'set_clip_props', clipId: clip.id, transform: { [prop]: value } }
}
