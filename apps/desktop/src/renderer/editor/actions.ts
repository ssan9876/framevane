import { clipEnd, findClip, type Clip, type OpInput, type Project } from '@framevane/doc'
import { useApp } from '../app/store'

/** Editing commands shared by the toolbar, keyboard shortcuts and context menus. All go through ops. */

const st = () => useApp.getState()
export const newId = (p: string) => `${p}-${crypto.randomUUID().slice(0, 12)}`

/** Clips under the playhead on unlocked tracks (split target when nothing is selected). */
export function clipsUnderPlayhead(doc: Project, t: number) {
  return doc.tracks.filter((tr) => !tr.locked).flatMap((tr) => tr.clips.filter((c) => c.startUs < t && t < clipEnd(c)).map((c) => c.id))
}

export function splitAtPlayhead() {
  const { doc, playheadUs, selection } = st()
  if (!doc) return
  const targets = (selection.length ? selection : clipsUnderPlayhead(doc, playheadUs)).filter((id) => {
    const f = findClip(doc, id)
    return f && !f.track.locked && f.clip.startUs < playheadUs && playheadUs < clipEnd(f.clip)
  })
  if (!targets.length) return
  void st().apply(targets.map((clipId) => ({ type: 'split_clip', clipId, atUs: playheadUs, newClipId: newId('clip') })))
}

/** Delete selected clips. On the main track with magnet on, the gap closes. */
export function deleteSelection() {
  const { doc, selection, magnet } = st()
  if (!doc || !selection.length) return
  const ripple: string[] = []
  const plain: string[] = []
  for (const id of selection) {
    const f = findClip(doc, id)
    if (!f || f.track.locked) continue
    ;(magnet && f.track.main ? ripple : plain).push(id)
  }
  const ops: OpInput[] = []
  if (ripple.length) ops.push({ type: 'remove_clips', clipIds: ripple, ripple: true })
  if (plain.length) ops.push({ type: 'remove_clips', clipIds: plain, ripple: false })
  if (ops.length) void st().apply(ops).then((ok) => { if (ok) st().select([]) })
}

/** Q / W: cut from the start of the clip under the playhead up to it (left), or from it to the clip end (right). */
export function rippleDeleteSide(side: 'left' | 'right') {
  const { doc, playheadUs, selection } = st()
  if (!doc) return
  const main = doc.tracks.find((t) => t.main)
  const pick = (c: Clip) => c.startUs < playheadUs && playheadUs < clipEnd(c)
  const sel = selection.map((id) => findClip(doc, id)?.clip).find((c): c is Clip => !!c && pick(c))
  const clip = sel ?? main?.clips.find(pick)
  if (!clip) return
  const range = side === 'left' ? { startUs: clip.startUs, endUs: playheadUs } : { startUs: playheadUs, endUs: clipEnd(clip) }
  void st().apply([{ type: 'ripple_delete_range', ...range }])
  if (side === 'left') st().setPlayhead(clip.startUs)
}

/** Add a library item to the timeline: appended to the main track (magnet), or placed at a time on a free track. */
export async function addAssetToTimeline(assetId: string, atUs?: number) {
  const { doc, media, playheadUs, magnet } = st()
  if (!doc) return
  const m = media.find((x) => x.asset.id === assetId)
  if (!m || m.status !== 'ready') return
  const asset = m.asset
  const ops: OpInput[] = []
  if (!doc.assets[asset.id]) ops.push({ type: 'add_asset', asset })
  const dur = asset.durationUs ?? 5_000_000
  const at = atUs ?? playheadUs
  if (asset.kind === 'audio') {
    let trackId = doc.tracks.find((t) => t.kind === 'audio' && !t.locked && isFree(t.clips, at, dur))?.id
    if (!trackId) {
      trackId = newId('track-audio')
      ops.push({ type: 'add_track', track: { id: trackId, kind: 'audio', name: `Audio ${doc.tracks.filter((t) => t.kind === 'audio').length + 1}`, main: false, locked: false, hidden: false, muted: false, clips: [] } })
    }
    ops.push({ type: 'add_clip', trackId, clip: { id: newId('clip'), kind: 'audio', assetId: asset.id, startUs: at, durationUs: dur } })
  } else {
    const main = doc.tracks.find((t) => t.main)!
    const kind = asset.kind === 'image' ? ('image' as const) : ('video' as const)
    if (magnet && atUs === undefined) {
      const end = main.clips.reduce((e, c) => Math.max(e, clipEnd(c)), 0)
      ops.push({ type: 'add_clip', trackId: main.id, clip: { id: newId('clip'), kind, assetId: asset.id, startUs: end, durationUs: dur } })
    } else {
      const target = isFree(main.clips, at, dur) ? main : doc.tracks.find((t) => t.kind === 'video' && !t.main && !t.locked && isFree(t.clips, at, dur))
      if (target) ops.push({ type: 'add_clip', trackId: target.id, clip: { id: newId('clip'), kind, assetId: asset.id, startUs: at, durationUs: dur } })
      else {
        const id = newId('track-video')
        ops.push({ type: 'add_track', index: doc.tracks.findIndex((t) => t.main) + 1, track: { id, kind: 'video', name: `Overlay ${doc.tracks.filter((t) => t.kind === 'video').length}`, main: false, locked: false, hidden: false, muted: false, clips: [] } })
        ops.push({ type: 'add_clip', trackId: id, clip: { id: newId('clip'), kind, assetId: asset.id, startUs: at, durationUs: dur } })
      }
    }
    // the first video in an empty project sets the canvas to its size ("Original" ratio)
    if (!doc.tracks.some((t) => t.clips.length) && asset.width && asset.height && asset.kind === 'video') {
      ops.unshift({ type: 'set_canvas', canvas: { width: asset.width, height: asset.height, ...(asset.fps ? { fps: asset.fps } : {}) } })
    }
  }
  await st().apply(ops)
}

function isFree(clips: Clip[], at: number, dur: number) {
  return !clips.some((c) => c.startUs < at + dur && at < clipEnd(c))
}

export function frameUs(doc: Project) {
  return Math.round((1e6 * doc.canvas.fps.den) / doc.canvas.fps.num)
}

/** Move n frames from `us`, landing exactly on a frame (no drift from rounding 1/fps to whole µs). BUG-004 */
export function stepFrames(doc: Project, us: number, n: number) {
  const fps = doc.canvas.fps.num / doc.canvas.fps.den
  const f = Math.round((us * fps) / 1e6) + n
  return Math.max(0, Math.ceil((f * 1e6) / fps))
}
