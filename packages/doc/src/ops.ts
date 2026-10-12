import { z } from 'zod'
import {
  AnimProp, AssetRef, BlendMode, Keyframe, CaptionClip, Canvas, ChromaKey, Clip, Cutout, ColorAdjust, Easing, Effect, FilterUse, Id, LutRef, LutUse, MediaClip, Marker, Transition, patchOf, PositiveUs, Project, TextAnimKind, TextStyle, Track, Transform, Us,
  type Clip as ClipT, type Project as ProjectT, type TextClip, type Track as TrackT,
} from './schema'
import { removeKeyframeAt, scaleKeyframes, sliceKeyframes, upsertKeyframe, type AnimatableClip } from './keyframes'

/**
 * Ops are the ONLY way a project changes: UI gestures, shortcuts, undo/redo, the agent panel and external MCP agents
 * all produce ops. Each op is pure and deterministic (ids for new objects are derived from the args), so a journal of
 * ops replays to the same document and agent proposals can be rebased onto a newer version by id.
 */

export const Op = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_asset'), asset: AssetRef }),
  z.object({ type: z.literal('add_track'), track: Track, index: z.number().int().min(0).optional() }),
  z.object({ type: z.literal('remove_track'), trackId: Id }),
  z.object({
    type: z.literal('set_track_flags'), trackId: Id,
    locked: z.boolean().optional(), hidden: z.boolean().optional(), muted: z.boolean().optional(), name: z.string().min(1).max(80).optional(),
  }),
  z.object({ type: z.literal('set_track_style'), trackId: Id, style: patchOf(TextStyle) }),
  z.object({
    type: z.literal('add_clip'), trackId: Id, clip: Clip,
    /** Insert: push every clip that starts at or after this one right by its duration (magnet track, paste, freeze). */
    ripple: z.boolean().default(false),
  }),
  z.object({ type: z.literal('remove_clips'), clipIds: z.array(Id).min(1), ripple: z.boolean().default(false) }),
  z.object({ type: z.literal('move_clip'), clipId: Id, startUs: Us.min(0), toTrackId: Id.optional() }),
  z.object({
    type: z.literal('set_clip_timing'), clipId: Id, startUs: Us.min(0).optional(), inUs: Us.min(0).optional(), durationUs: PositiveUs.optional(),
    /** Shift every later clip on the track by the change in this clip's end (magnet / ripple trim). */
    ripple: z.boolean().default(false),
  }),
  /** Lay a track's clips end to end from 0 in the given order (main-track magnet reorder). Clips not listed keep their order after the listed ones. */
  z.object({ type: z.literal('pack_track'), trackId: Id, order: z.array(Id).optional() }),
  z.object({ type: z.literal('split_clip'), clipId: Id, atUs: Us.min(0), newClipId: Id.optional() }),
  z.object({
    type: z.literal('ripple_delete_range'), startUs: Us.min(0), endUs: Us.min(1),
    /** Tracks to cut. Default: every unlocked track. */
    trackIds: z.array(Id).optional(),
  }),
  z.object({
    type: z.literal('add_captions'),
    /** Existing caption track, or a new one created with this id. */
    trackId: Id,
    trackName: z.string().default('Captions'),
    clips: z.array(CaptionClip).min(1),
    /** Replace every caption on the track (re-generate) instead of adding. */
    replace: z.boolean().default(false),
  }),
  z.object({ type: z.literal('set_caption_text'), clipId: Id, text: z.string().max(500) }),
  z.object({
    type: z.literal('set_clip_props'), clipId: Id,
    transform: patchOf(Transform).optional(), volumeDb: z.number().min(-60).max(20).optional(),
    enabled: z.boolean().optional(), speed: z.number().min(0.1).max(100).optional(),
    blend: BlendMode.optional(), audioEnabled: z.boolean().optional(),
    /** null removes the group / link. */
    groupId: Id.nullable().optional(), linkId: Id.nullable().optional(),
    fadeInUs: Us.min(0).optional(), fadeOutUs: Us.min(0).optional(),
  }),
  /** Text clips: content, style (a patch) and in/out animation. */
  z.object({
    type: z.literal('set_text'), clipId: Id,
    text: z.string().max(2000).optional(),
    style: patchOf(TextStyle).optional(),
    anim: z.object({
      in: z.object({ kind: TextAnimKind.optional(), durationUs: PositiveUs.optional() }).optional(),
      out: z.object({ kind: TextAnimKind.optional(), durationUs: PositiveUs.optional() }).optional(),
    }).optional(),
  }),
  /**
   * A video or image clip's look: colour (a patch), filter, LUT, chroma key (a patch; null turns it off), the whole
   * effect list, and the transition into the next clip. Fields left out are unchanged.
   */
  z.object({
    type: z.literal('set_look'), clipId: Id,
    color: patchOf(ColorAdjust).optional(),
    filter: FilterUse.nullable().optional(),
    lut: LutUse.nullable().optional(),
    chroma: patchOf(ChromaKey).nullable().optional(),
    cutout: patchOf(Cutout).nullable().optional(),
    effects: z.array(Effect).max(8).optional(),
    transition: Transition.nullable().optional(),
  }),
  /** Register a .cube LUT already copied into the project's luts folder. */
  z.object({ type: z.literal('add_lut'), lut: LutRef }),
  z.object({ type: z.literal('set_keyframe'), clipId: Id, prop: AnimProp, tUs: Us.min(0), value: z.number(), easing: Easing.optional() }),
  z.object({ type: z.literal('remove_keyframe'), clipId: Id, prop: AnimProp, tUs: Us.min(0) }),
  /** Replace every keyframe of one property (e.g. a generated ducking curve). An empty list removes the animation. */
  z.object({ type: z.literal('set_keyframes'), clipId: Id, prop: AnimProp, keyframes: z.array(Keyframe).max(10_000) }),
  /** Remove all keyframes of a property (or of every property); the property keeps its value at `atUs`. */
  z.object({ type: z.literal('clear_keyframes'), clipId: Id, prop: AnimProp.optional(), atUs: Us.min(0).default(0) }),
  z.object({ type: z.literal('replace_clip_media'), clipId: Id, assetId: Id, inUs: Us.min(0), reversed: z.boolean().optional() }),
  z.object({ type: z.literal('add_marker'), marker: Marker }),
  z.object({ type: z.literal('remove_marker'), markerId: Id }),
  z.object({ type: z.literal('set_canvas'), canvas: Canvas.partial() }),
  z.object({
    type: z.literal('restore'),
    /** Internal: produced as an inverse. Map of track id → previous track (null = did not exist). */
    tracks: z.record(Id, Track.nullable()).optional(),
    trackOrder: z.array(Id).optional(),
    assets: z.record(Id, AssetRef.nullable()).optional(),
    canvas: Canvas.optional(),
    markers: z.array(Marker).optional(),
    luts: z.record(Id, LutRef.nullable()).optional(),
  }),
])
export type Op = z.infer<typeof Op>
export type OpInput = z.input<typeof Op>

export class OpError extends Error {
  constructor(public code: 'not_found' | 'locked' | 'overlap' | 'invalid' | 'out_of_range' | 'kind_mismatch', message: string) {
    super(message)
  }
}

/* ───────────────────────── queries ───────────────────────── */

export const clipEnd = (c: { startUs: number; durationUs: number }) => c.startUs + c.durationUs

export function findClip(doc: ProjectT, clipId: string): { track: TrackT; clip: ClipT; trackIndex: number; clipIndex: number } | null {
  for (let ti = 0; ti < doc.tracks.length; ti++) {
    const track = doc.tracks[ti]!
    const ci = track.clips.findIndex((c) => c.id === clipId)
    if (ci >= 0) return { track, clip: track.clips[ci]!, trackIndex: ti, clipIndex: ci }
  }
  return null
}

export function projectDurationUs(doc: ProjectT): number {
  let end = 0
  for (const t of doc.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c))
  return end
}

/** Source time (µs) shown by a media clip at timeline time t. */
export function sourceTimeAt(clip: MediaClip, tUs: number): number {
  if (clip.freezeAtUs !== undefined) return clip.freezeAtUs
  return clip.inUs + (tUs - clip.startUs) * clip.speed
}

export function clipsAt(doc: ProjectT, tUs: number): { track: TrackT; clip: ClipT }[] {
  const out: { track: TrackT; clip: ClipT }[] = []
  for (const track of doc.tracks) for (const clip of track.clips) if (tUs >= clip.startUs && tUs < clipEnd(clip)) out.push({ track, clip })
  return out
}

const allowed: Record<TrackT['kind'], ClipT['kind'][]> = {
  video: ['video', 'image'],
  audio: ['audio'],
  text: ['text'],
  caption: ['caption'],
}

/* ───────────────────────── apply ───────────────────────── */

export interface ApplyResult { doc: ProjectT; inverse: Op[] }

/** Apply a batch atomically. Throws OpError (and changes nothing) if any op is invalid. Bumps version once. */
export function applyOps(doc: ProjectT, ops: OpInput[]): ApplyResult {
  let cur = doc
  const inverses: Op[] = []
  for (const raw of ops) {
    const op = Op.parse(raw)
    const next = applyOne(cur, op)
    validateDoc(next)
    inverses.unshift(inverseOf(cur, next))
    cur = next
  }
  return { doc: { ...cur, version: doc.version + 1 }, inverse: inverses }
}

function applyOne(doc: ProjectT, op: Op): ProjectT {
  switch (op.type) {
    case 'add_asset':
      return { ...doc, assets: { ...doc.assets, [op.asset.id]: op.asset } }

    case 'add_track': {
      if (doc.tracks.some((t) => t.id === op.track.id)) throw new OpError('invalid', `Track ${op.track.id} already exists`)
      const tracks = doc.tracks.slice()
      tracks.splice(op.index ?? tracks.length, 0, { ...op.track, clips: sortClips(op.track.clips) })
      return { ...doc, tracks }
    }

    case 'remove_track':
      return { ...doc, tracks: doc.tracks.filter((t) => t.id !== needTrack(doc, op.trackId).id) }

    case 'set_track_flags': {
      const { type: _t, trackId, ...flags } = op
      return mapTrack(doc, trackId, (t) => ({ ...t, ...defined(flags) }), { allowLocked: true })
    }

    case 'set_track_style':
      return mapTrack(doc, op.trackId, (t) => ({ ...t, style: TextStyle.parse({ ...t.style, ...op.style }) }), { allowLocked: true })

    case 'add_clip': {
      if (findClip(doc, op.clip.id)) throw new OpError('invalid', `Clip ${op.clip.id} already exists`)
      const at = op.clip.startUs
      return mapTrack(doc, op.trackId, (t) => {
        const shifted = op.ripple ? t.clips.map((c) => (c.startUs >= at ? { ...c, startUs: c.startUs + op.clip.durationUs } : c)) : t.clips
        return { ...t, clips: sortClips([...shifted, op.clip]) }
      })
    }

    case 'remove_clips': {
      let next = doc
      // remove right-to-left per track so ripple shifts don't disturb pending removals
      const targets = op.clipIds.map((id) => {
        const f = findClip(doc, id)
        if (!f) throw new OpError('not_found', `Clip ${id} not found`)
        return f
      }).sort((a, b) => b.clip.startUs - a.clip.startUs)
      for (const { track, clip } of targets) {
        next = mapTrack(next, track.id, (t) => {
          const clips = t.clips.filter((c) => c.id !== clip.id)
          return { ...t, clips: op.ripple ? clips.map((c) => (c.startUs >= clipEnd(clip) ? { ...c, startUs: c.startUs - clip.durationUs } : c)) : clips }
        })
      }
      return next
    }

    case 'move_clip': {
      const f = needClip(doc, op.clipId)
      const moved = { ...f.clip, startUs: op.startUs }
      if (!op.toTrackId || op.toTrackId === f.track.id) {
        return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: sortClips(t.clips.map((c) => (c.id === op.clipId ? moved : c))) }))
      }
      const removed = mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== op.clipId) }))
      return mapTrack(removed, op.toTrackId, (t) => ({ ...t, clips: sortClips([...t.clips, moved]) }))
    }

    case 'set_clip_timing': {
      const f = needClip(doc, op.clipId)
      const oldEnd = clipEnd(f.clip)
      const newEnd = (op.startUs ?? f.clip.startUs) + (op.durationUs ?? f.clip.durationUs)
      const shift = op.ripple ? newEnd - oldEnd : 0
      return mapTrack(doc, f.track.id, (t) => ({
        ...t,
        clips: sortClips(t.clips.map((c) => {
          if (c.id !== op.clipId) return shift && c.startUs >= oldEnd ? { ...c, startUs: c.startUs + shift } : c
          const next = { ...c, ...defined({ startUs: op.startUs, durationUs: op.durationUs }) } as ClipT
          if (op.inUs !== undefined) {
            if (!isMedia(next)) throw new OpError('invalid', 'Only media clips have an in point')
            ;(next as MediaClip).inUs = op.inUs
          }
          if (isMedia(c) && hasKeys(c)) {
            // keyframes stay pinned to the picture: shift by the change in source in-point, then trim to the new length
            const localShift = Math.round(((op.inUs ?? c.inUs) - c.inUs) / c.speed)
            ;(next as MediaClip).keyframes = sliceKeyframes(c.keyframes, localShift, localShift + next.durationUs)
          }
          return next
        })),
      }))
    }

    case 'pack_track': {
      const t0 = needTrack(doc, op.trackId)
      const order = op.order ?? t0.clips.map((c) => c.id)
      const byId = new Map(t0.clips.map((c) => [c.id, c]))
      for (const id of order) if (!byId.has(id)) throw new OpError('not_found', `Clip ${id} is not on track "${t0.name}"`)
      const rest = t0.clips.filter((c) => !order.includes(c.id))
      let at = 0
      return mapTrack(doc, op.trackId, (t) => ({
        ...t,
        clips: [...order.map((id) => byId.get(id)!), ...rest].map((c) => { const placed = { ...c, startUs: at }; at += c.durationUs; return placed }),
      }))
    }

    case 'split_clip': {
      const f = needClip(doc, op.clipId)
      const { clip } = f
      if (op.atUs <= clip.startUs || op.atUs >= clipEnd(clip)) throw new OpError('out_of_range', `Split point is outside clip ${clip.id}`)
      const [left, right] = splitClip(clip, op.atUs, op.newClipId ?? deriveId(doc, clip.id, op.atUs))
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: sortClips(t.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c]))) }))
    }

    case 'ripple_delete_range': {
      const { startUs: a, endUs: b } = op
      if (b <= a) throw new OpError('invalid', 'Range end must be after start')
      const len = b - a
      const ids = op.trackIds ?? doc.tracks.filter((t) => !t.locked).map((t) => t.id)
      let next = doc
      for (const id of ids) {
        next = mapTrack(next, id, (t) => {
          const out: ClipT[] = []
          for (const c of t.clips) {
            const ce = clipEnd(c)
            if (ce <= a) { out.push(c); continue }                                   // entirely before
            if (c.startUs >= b) { out.push({ ...c, startUs: c.startUs - len }); continue } // entirely after: shift left
            // overlaps the range: keep the parts outside it
            if (c.startUs < a) out.push(trimRight(c, a))
            if (ce > b) {
              const keepRight = trimLeft(c, b)
              out.push({ ...keepRight, id: c.startUs < a ? deriveId(doc, c.id, b) : c.id, startUs: a })
            }
          }
          return { ...t, clips: sortClips(out) }
        })
      }
      return next
    }

    case 'add_captions': {
      const existing = doc.tracks.find((t) => t.id === op.trackId)
      if (existing && existing.kind !== 'caption') throw new OpError('kind_mismatch', `Track ${op.trackId} is not a caption track`)
      for (const c of op.clips) {
        const f = findClip(doc, c.id)
        if (f && !(op.replace && f.track.id === op.trackId)) throw new OpError('invalid', `Clip ${c.id} already exists`)
      }
      if (!existing) {
        const track: TrackT = { id: op.trackId, kind: 'caption', name: op.trackName, main: false, locked: false, hidden: false, muted: false, clips: sortClips(op.clips) }
        return { ...doc, tracks: [...doc.tracks, track] }
      }
      return mapTrack(doc, op.trackId, (t) => ({ ...t, clips: sortClips(op.replace ? op.clips : [...t.clips, ...op.clips]) }))
    }

    case 'set_caption_text': {
      const f = needClip(doc, op.clipId)
      if (f.clip.kind !== 'caption' && f.clip.kind !== 'text') throw new OpError('kind_mismatch', 'Not a text or caption clip')
      return mapTrack(doc, f.track.id, (t) => ({
        ...t,
        // editing the text drops word timings unless the words still match
        clips: t.clips.map((c) => (c.id === op.clipId ? ({ ...c, text: op.text, ...(c.kind === 'caption' && !sameWords(c.words, op.text) ? { words: [] } : {}) } as ClipT) : c)),
      }))
    }

    case 'set_clip_props': {
      const f = needClip(doc, op.clipId)
      return mapTrack(doc, f.track.id, (t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== op.clipId) return c
          let next: ClipT = op.enabled === undefined ? c : { ...c, enabled: op.enabled }
          if (op.groupId !== undefined) next = { ...next, groupId: op.groupId ?? undefined }
          if (next.kind === 'text' && op.transform && op.volumeDb === undefined && op.speed === undefined && !op.blend && op.audioEnabled === undefined && op.linkId === undefined && op.fadeInUs === undefined && op.fadeOutUs === undefined) {
            return { ...next, transform: { ...next.transform, ...defined(op.transform) } }
          }
          if (op.transform || op.fadeInUs !== undefined || op.fadeOutUs !== undefined || op.volumeDb !== undefined || op.speed !== undefined || op.blend || op.audioEnabled !== undefined || op.linkId !== undefined) {
            if (!isMedia(next)) throw new OpError('kind_mismatch', 'Transform/volume/speed/blend apply to media clips')
            const m: MediaClip = next
            next = {
              ...m,
              ...(op.transform ? { transform: { ...m.transform, ...defined(op.transform) } } : {}),
              ...(op.volumeDb !== undefined ? { volumeDb: op.volumeDb } : {}),
              ...(op.blend ? { blend: op.blend } : {}),
              ...(op.audioEnabled !== undefined ? { audioEnabled: op.audioEnabled } : {}),
              ...(op.linkId !== undefined ? { linkId: op.linkId ?? undefined } : {}),
              ...(op.fadeInUs !== undefined ? { fadeInUs: op.fadeInUs } : {}),
              ...(op.fadeOutUs !== undefined ? { fadeOutUs: op.fadeOutUs } : {}),
              ...(op.speed !== undefined ? {
                speed: op.speed,
                durationUs: Math.max(1, Math.round((m.durationUs * m.speed) / op.speed)),
                keyframes: scaleKeyframes(m.keyframes, m.speed / op.speed),
              } : {}),
            }
          }
          return next
        }),
      }))
    }

    case 'set_look': {
      const f = needClip(doc, op.clipId)
      if (f.clip.kind !== 'video' && f.clip.kind !== 'image') throw new OpError('kind_mismatch', 'Looks apply to video and image clips')
      const c = f.clip
      if (op.lut && !doc.luts[op.lut.id]) throw new OpError('not_found', `LUT ${op.lut.id} not found`)
      if (op.effects && new Set(op.effects.map((e) => e.id)).size !== op.effects.length) throw new OpError('invalid', 'Effect ids must be unique on a clip')
      const next: MediaClip = {
        ...c,
        ...(op.color ? { color: ColorAdjust.parse({ ...c.color, ...defined(op.color) }) } : {}),
        ...(op.filter !== undefined ? { filter: op.filter } : {}),
        ...(op.lut !== undefined ? { lut: op.lut } : {}),
        ...(op.chroma !== undefined ? { chroma: op.chroma === null ? null : ChromaKey.parse({ ...(c.chroma ?? {}), ...defined(op.chroma) }) } : {}),
        ...(op.cutout !== undefined ? { cutout: op.cutout === null ? null : Cutout.parse({ ...(c.cutout ?? {}), ...defined(op.cutout) }) } : {}),
        ...(op.effects ? { effects: op.effects } : {}),
        ...(op.transition !== undefined ? { transition: op.transition } : {}),
      }
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.map((x) => (x.id === c.id ? next : x)) }))
    }

    case 'add_lut':
      return { ...doc, luts: { ...doc.luts, [op.lut.id]: op.lut } }

    case 'set_text': {
      const f = needClip(doc, op.clipId)
      if (f.clip.kind !== 'text') throw new OpError('kind_mismatch', 'Not a text clip')
      const c = f.clip
      const next: TextClip = {
        ...c,
        ...(op.text !== undefined ? { text: op.text } : {}),
        ...(op.style ? { style: TextStyle.parse({ ...c.style, ...defined(op.style) }) } : {}),
        ...(op.anim ? { anim: { in: { ...c.anim.in, ...defined(op.anim.in ?? {}) }, out: { ...c.anim.out, ...defined(op.anim.out ?? {}) } } } : {}),
      }
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.map((x) => (x.id === c.id ? next : x)) }))
    }

    case 'set_keyframes': {
      const f = needClip(doc, op.clipId)
      if (!isAnimatable(f.clip)) throw new OpError('kind_mismatch', 'Only media and text clips have keyframes')
      if (f.clip.kind === 'text' && op.prop === 'volumeDb') throw new OpError('kind_mismatch', 'Text has no volume')
      const c = f.clip
      if (op.keyframes.some((k) => k.tUs > c.durationUs)) throw new OpError('out_of_range', 'Keyframe time is outside the clip')
      const keyframes = { ...c.keyframes }
      if (op.keyframes.length) keyframes[op.prop] = [...op.keyframes].sort((a, b) => a.tUs - b.tUs)
      else delete keyframes[op.prop]
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.map((x) => (x.id === c.id ? ({ ...c, keyframes } as ClipT) : x)) }))
    }

    case 'set_keyframe':
    case 'remove_keyframe':
    case 'clear_keyframes': {
      const f = needClip(doc, op.clipId)
      if (!isAnimatable(f.clip)) throw new OpError('kind_mismatch', 'Only media and text clips have keyframes')
      const clip = f.clip
      if (clip.kind === 'text' && op.type !== 'clear_keyframes' && op.prop === 'volumeDb') throw new OpError('kind_mismatch', 'Text has no volume')
      if (op.type !== 'clear_keyframes' && (op.tUs < 0 || op.tUs > clip.durationUs)) throw new OpError('out_of_range', 'Keyframe time is outside the clip')
      let keyframes = { ...clip.keyframes }
      let next: AnimatableClip = clip
      if (op.type === 'set_keyframe') {
        const existing = keyframes[op.prop]?.find((k) => Math.abs(k.tUs - op.tUs) <= 16_666)
        keyframes[op.prop] = upsertKeyframe(keyframes[op.prop], { tUs: op.tUs, value: op.value, easing: op.easing ?? existing?.easing ?? 'ease-in-out' })
      } else if (op.type === 'remove_keyframe') {
        keyframes[op.prop] = removeKeyframeAt(keyframes[op.prop], op.tUs)
        if (!keyframes[op.prop]!.length) delete keyframes[op.prop]
      } else {
        // clearing bakes the value at `atUs` into the static property so the picture doesn't jump
        const props = op.prop ? [op.prop] : (Object.keys(keyframes) as AnimProp[])
        for (const prop of props) {
          const kfs = keyframes[prop]
          if (!kfs?.length) continue
          const v = sampleKeys(kfs, op.atUs)
          next = prop === 'volumeDb' ? (next.kind === 'text' ? next : { ...next, volumeDb: clampVolume(v) }) : { ...next, transform: { ...next.transform, [prop]: v } } as AnimatableClip
          delete keyframes[prop]
        }
      }
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === clip.id ? { ...next, keyframes } : c)) }))
    }

    case 'replace_clip_media': {
      const f = needClip(doc, op.clipId)
      if (!isMedia(f.clip)) throw new OpError('kind_mismatch', 'Not a media clip')
      if (!doc.assets[op.assetId]) throw new OpError('not_found', `Asset ${op.assetId} not found`)
      const next = { ...f.clip, assetId: op.assetId, inUs: op.inUs, ...(op.reversed !== undefined ? { reversed: op.reversed } : {}) }
      return mapTrack(doc, f.track.id, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === op.clipId ? next : c)) }))
    }

    case 'add_marker':
      if (doc.markers.some((m) => m.id === op.marker.id)) throw new OpError('invalid', 'Marker already exists')
      return { ...doc, markers: [...doc.markers, op.marker].sort((a, b) => a.atUs - b.atUs) }

    case 'remove_marker':
      if (!doc.markers.some((m) => m.id === op.markerId)) throw new OpError('not_found', 'Marker not found')
      return { ...doc, markers: doc.markers.filter((m) => m.id !== op.markerId) }

    case 'set_canvas':
      return { ...doc, canvas: Canvas.parse({ ...doc.canvas, ...defined(op.canvas) }) }

    case 'restore': {
      let tracks = doc.tracks
      if (op.tracks) {
        const prev = op.tracks
        tracks = tracks.filter((t) => !(t.id in prev) || prev[t.id] !== null).map((t) => (t.id in prev ? prev[t.id]! : t))
        for (const [id, t] of Object.entries(prev)) if (t && !tracks.some((x) => x.id === id)) tracks = [...tracks, t]
      }
      if (op.trackOrder) {
        const byId = new Map(tracks.map((t) => [t.id, t]))
        tracks = op.trackOrder.map((id) => byId.get(id)).filter((t): t is TrackT => !!t)
      }
      let assets = doc.assets
      if (op.assets) {
        assets = { ...assets }
        for (const [id, a] of Object.entries(op.assets)) if (a === null) delete assets[id]; else assets[id] = a
      }
      let luts = doc.luts
      if (op.luts) {
        luts = { ...luts }
        for (const [id, l] of Object.entries(op.luts)) if (l === null) delete luts[id]; else luts[id] = l
      }
      return { ...doc, tracks, assets, luts, canvas: op.canvas ?? doc.canvas, markers: op.markers ?? doc.markers }
    }
  }
}

/** Inverse = restore whatever changed between prev and next (track-level, by reference). Works for every op. */
function inverseOf(prev: ProjectT, next: ProjectT): Op {
  const inv: Extract<Op, { type: 'restore' }> = { type: 'restore' }
  const prevById = new Map(prev.tracks.map((t) => [t.id, t]))
  const nextById = new Map(next.tracks.map((t) => [t.id, t]))
  const tracks: Record<string, TrackT | null> = {}
  for (const [id, t] of prevById) if (nextById.get(id) !== t) tracks[id] = t
  for (const id of nextById.keys()) if (!prevById.has(id)) tracks[id] = null
  if (Object.keys(tracks).length) inv.tracks = tracks
  if (prev.tracks.map((t) => t.id).join('\u0000') !== next.tracks.map((t) => t.id).join('\u0000')) inv.trackOrder = prev.tracks.map((t) => t.id)
  if (prev.assets !== next.assets) {
    const assets: Record<string, z.infer<typeof AssetRef> | null> = {}
    for (const id of new Set([...Object.keys(prev.assets), ...Object.keys(next.assets)])) {
      if (prev.assets[id] !== next.assets[id]) assets[id] = prev.assets[id] ?? null
    }
    inv.assets = assets
  }
  if (prev.luts !== next.luts) {
    const luts: Record<string, z.infer<typeof LutRef> | null> = {}
    for (const id of new Set([...Object.keys(prev.luts), ...Object.keys(next.luts)])) {
      if (prev.luts[id] !== next.luts[id]) luts[id] = prev.luts[id] ?? null
    }
    inv.luts = luts
  }
  if (prev.canvas !== next.canvas) inv.canvas = prev.canvas
  if (prev.markers !== next.markers) inv.markers = prev.markers
  return inv
}

/* ───────────────────────── invariants ───────────────────────── */

export function validateDoc(doc: ProjectT) {
  const seen = new Set<string>()
  let mains = 0
  for (const t of doc.tracks) {
    if (t.main) { mains++; if (t.kind !== 'video') throw new OpError('invalid', 'Only a video track can be the main track') }
    let lastEnd = -1
    for (const c of t.clips) {
      if (seen.has(c.id)) throw new OpError('invalid', `Duplicate clip id ${c.id}`)
      seen.add(c.id)
      if (!allowed[t.kind].includes(c.kind)) throw new OpError('kind_mismatch', `A ${c.kind} clip can't go on a ${t.kind} track`)
      if (c.startUs < lastEnd) throw new OpError('overlap', `Clip ${c.id} overlaps the previous clip on track "${t.name}"`)
      lastEnd = clipEnd(c)
      if (isMedia(c)) {
        const a = doc.assets[c.assetId]
        if (!a) throw new OpError('not_found', `Asset ${c.assetId} not found`)
        if (c.freezeAtUs !== undefined) {
          if (a.durationUs !== undefined && c.freezeAtUs > a.durationUs) throw new OpError('out_of_range', `Freeze frame of ${c.id} is past the end of ${a.name}`)
        } else if (a.durationUs !== undefined && c.kind !== 'image') {
          const srcEnd = c.inUs + c.durationUs * c.speed
          if (srcEnd > a.durationUs + 1000) throw new OpError('out_of_range', `Clip ${c.id} runs past the end of ${a.name}`)
        }
      }
    }
  }
  if (mains > 1) throw new OpError('invalid', 'Only one main track is allowed')
}

/* ───────────────────────── helpers ───────────────────────── */

const isMedia = (c: ClipT): c is MediaClip => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio'
const isAnimatable = (c: ClipT): c is AnimatableClip => isMedia(c) || c.kind === 'text'
const sortClips = (clips: ClipT[]) => clips.slice().sort((a, b) => a.startUs - b.startUs)
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

function needTrack(doc: ProjectT, id: string) {
  const t = doc.tracks.find((x) => x.id === id)
  if (!t) throw new OpError('not_found', `Track ${id} not found`)
  return t
}
function needClip(doc: ProjectT, id: string) {
  const f = findClip(doc, id)
  if (!f) throw new OpError('not_found', `Clip ${id} not found`)
  if (f.track.locked) throw new OpError('locked', `Track "${f.track.name}" is locked`)
  return f
}
function mapTrack(doc: ProjectT, id: string, fn: (t: TrackT) => TrackT, opts: { allowLocked?: boolean } = {}): ProjectT {
  const t = needTrack(doc, id)
  if (t.locked && !opts.allowLocked) throw new OpError('locked', `Track "${t.name}" is locked`)
  return { ...doc, tracks: doc.tracks.map((x) => (x.id === id ? fn(x) : x)) }
}

/** Deterministic id for a piece created by a cut, unique within the doc. */
function deriveId(doc: ProjectT, base: string, atUs: number) {
  const stem = `${base.split('~')[0]}~${atUs.toString(36)}`
  let id = stem
  for (let i = 2; findClip(doc, id); i++) id = `${stem}-${i}`
  return id
}

const hasKeys = (c: AnimatableClip) => Object.values(c.keyframes).some((k) => k && k.length)
const clampVolume = (v: number) => Math.max(-60, Math.min(20, v))
function sampleKeys(kfs: { tUs: number; value: number }[], t: number) {
  if (t <= kfs[0]!.tUs) return kfs[0]!.value
  for (let i = 0; i < kfs.length - 1; i++) if (t < kfs[i + 1]!.tUs) return kfs[i]!.value + (kfs[i + 1]!.value - kfs[i]!.value) * ((t - kfs[i]!.tUs) / Math.max(1, kfs[i + 1]!.tUs - kfs[i]!.tUs))
  return kfs[kfs.length - 1]!.value
}

/** Keep [start, at) of a clip. */
function trimRight(c: ClipT, atUs: number): ClipT {
  const durationUs = atUs - c.startUs
  if (isMedia(c)) return { ...c, durationUs, fadeOutUs: 0, transition: null, ...(hasKeys(c) ? { keyframes: sliceKeyframes(c.keyframes, 0, durationUs) } : {}) }
  if (c.kind === 'text') return { ...c, durationUs, anim: { ...c.anim, out: { ...c.anim.out, kind: 'none' } }, ...(hasKeys(c) ? { keyframes: sliceKeyframes(c.keyframes, 0, durationUs) } : {}) }
  if (c.kind === 'caption') return { ...c, durationUs, words: c.words.filter((w) => w.startUs < durationUs).map((w) => ({ ...w, endUs: Math.min(w.endUs, durationUs) })) }
  return c
}

/** Keep [at, end) of a clip (startUs is left at `at`; the caller repositions it). */
function trimLeft(c: ClipT, atUs: number): ClipT {
  const cut = atUs - c.startUs
  const durationUs = c.durationUs - cut
  if (isMedia(c)) {
    const inUs = c.freezeAtUs !== undefined ? c.inUs : c.inUs + Math.round(cut * c.speed)
    return { ...c, startUs: atUs, durationUs, inUs, fadeInUs: 0, ...(hasKeys(c) ? { keyframes: sliceKeyframes(c.keyframes, cut, c.durationUs) } : {}) }
  }
  if (c.kind === 'text') {
    return { ...c, startUs: atUs, durationUs, anim: { ...c.anim, in: { ...c.anim.in, kind: 'none' } }, ...(hasKeys(c) ? { keyframes: sliceKeyframes(c.keyframes, cut, c.durationUs) } : {}) }
  }
  if (c.kind === 'caption') {
    return { ...c, startUs: atUs, durationUs, words: c.words.filter((w) => w.endUs > cut).map((w) => ({ ...w, startUs: Math.max(0, w.startUs - cut), endUs: w.endUs - cut })) }
  }
  return c
}

function splitClip(c: ClipT, atUs: number, newId: string): [ClipT, ClipT] {
  return [trimRight(c, atUs), { ...trimLeft(c, atUs), id: newId }]
}

function sameWords(words: { text: string }[], text: string) {
  const a = words.map((w) => w.text.trim()).filter(Boolean).join(' ')
  return a === text.trim().split(/\s+/).join(' ')
}

/* ───────────────────────── labels for review UI (S29) ───────────────────────── */

export function formatUs(us: number) {
  const s = us / 1e6
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

export function describeOp(doc: ProjectT, raw: OpInput): string {
  const op = Op.parse(raw)
  const clipName = (id: string) => {
    const f = findClip(doc, id)
    if (!f) return id
    if (f.clip.kind === 'caption' || f.clip.kind === 'text') return `"${f.clip.text.slice(0, 24)}"`
    return doc.assets[(f.clip as MediaClip).assetId]?.name ?? id
  }
  switch (op.type) {
    case 'ripple_delete_range': return `Cut ${formatUs(op.startUs)}–${formatUs(op.endUs)}`
    case 'split_clip': return `Split ${clipName(op.clipId)} at ${formatUs(op.atUs)}`
    case 'remove_clips': return `${op.ripple ? 'Ripple delete' : 'Delete'} ${op.clipIds.length === 1 ? clipName(op.clipIds[0]!) : `${op.clipIds.length} clips`}`
    case 'add_captions': return `${op.replace ? 'Replace' : 'Add'} ${op.clips.length} caption${op.clips.length === 1 ? '' : 's'}`
    case 'add_clip': return `Add ${op.clip.kind === 'caption' || op.clip.kind === 'text' ? `text "${op.clip.text.slice(0, 24)}"` : doc.assets[(op.clip as MediaClip).assetId]?.name ?? 'clip'} at ${formatUs(op.clip.startUs)}`
    case 'move_clip': return `Move ${clipName(op.clipId)} to ${formatUs(op.startUs)}`
    case 'set_clip_timing': return `Trim ${clipName(op.clipId)}`
    case 'pack_track': return 'Reorder clips'
    case 'set_keyframe': return `Keyframe ${op.prop} on ${clipName(op.clipId)} at ${formatUs(op.tUs)}`
    case 'remove_keyframe': return `Remove ${op.prop} keyframe`
    case 'set_keyframes': return op.prop === 'volumeDb' ? `Volume curve on ${clipName(op.clipId)} (${op.keyframes.length} points)` : `Animate ${op.prop} on ${clipName(op.clipId)}`
    case 'clear_keyframes': return `Clear ${op.prop ?? 'all'} keyframes`
    case 'replace_clip_media': return op.reversed ? `Reverse ${clipName(op.clipId)}` : `Replace media of ${clipName(op.clipId)}`
    case 'add_marker': return `Add marker at ${formatUs(op.marker.atUs)}`
    case 'remove_marker': return 'Remove marker'
    case 'set_caption_text': return `Edit caption → "${op.text.slice(0, 32)}"`
    case 'set_look': {
      const what = [op.color && 'colour', op.filter !== undefined && (op.filter ? `filter ${op.filter.id}` : 'no filter'), op.lut !== undefined && (op.lut ? 'LUT' : 'no LUT'),
        op.chroma !== undefined && (op.chroma ? 'chroma key' : 'no chroma key'), op.cutout !== undefined && (op.cutout ? 'background removed' : 'background back'), op.effects && `${op.effects.length} effect${op.effects.length === 1 ? '' : 's'}`,
        op.transition !== undefined && (op.transition ? `${op.transition.kind} transition` : 'no transition')].filter(Boolean)
      return `Look of ${clipName(op.clipId)}: ${what.join(', ') || 'unchanged'}`
    }
    case 'add_lut': return `Import LUT ${op.lut.name}`
    case 'set_text': return op.text !== undefined ? `Edit text → "${op.text.slice(0, 32)}"` : op.anim ? `Animate ${clipName(op.clipId)}` : `Restyle ${clipName(op.clipId)}`
    case 'set_clip_props': return `Change ${clipName(op.clipId)} (${Object.keys(op).filter((k) => !['type', 'clipId'].includes(k)).join(', ')})`
    case 'set_track_style': return 'Restyle captions'
    case 'set_canvas': return `Canvas ${op.canvas.width ?? doc.canvas.width}×${op.canvas.height ?? doc.canvas.height}`
    case 'add_track': return `Add ${op.track.kind} track "${op.track.name}"`
    case 'remove_track': return `Remove track`
    case 'set_track_flags': return `Track settings`
    case 'add_asset': return `Import ${op.asset.name}`
    case 'restore': return 'Restore'
  }
}

export const _internal = { splitClip, trimLeft, trimRight, deriveId }
export type { MediaClip }
export { Project }
