import {
  effectDef, effectParams, findClip, nextAdjacent, transitionDef,
  type Effect, type MediaClip, type OpInput, type Project, type Track,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { newId } from './actions'

/** M4 editor actions: filters, LUTs, effects, transitions, chroma key. Every change is one op batch (one undo step). */

const st = () => useApp.getState()

/** The selected video/image clips (on unlocked tracks). */
export function selectedVisuals(doc: Project, selection: string[]): MediaClip[] {
  return selection.flatMap((id) => {
    const f = findClip(doc, id)
    return f && !f.track.locked && (f.clip.kind === 'video' || f.clip.kind === 'image') ? [f.clip] : []
  })
}

export async function applyFilter(clipIds: string[], filterId: string | null, intensity?: number) {
  const { doc } = st()
  if (!doc || !clipIds.length) return false
  return st().apply(clipIds.map((clipId) => {
    const c = findClip(doc, clipId)?.clip as MediaClip | undefined
    return { type: 'set_look', clipId, filter: filterId ? { id: filterId, intensity: intensity ?? c?.filter?.intensity ?? 0.8 } : null }
  }))
}

export async function applyLut(clipIds: string[], lutId: string | null, intensity = 1) {
  if (!clipIds.length) return false
  return st().apply(clipIds.map((clipId) => ({ type: 'set_look', clipId, lut: lutId ? { id: lutId, intensity } : null })))
}

/** Import .cube files picked by the user; returns the new LUT ids (already registered with the project). */
export async function importLuts(): Promise<string[]> {
  const { doc } = st()
  if (!doc) return []
  const paths = await window.framevane.app.pickFiles({ kind: 'lut' })
  if (!paths.length) return []
  const refs = await window.framevane.luts.import(paths)
  const fresh = refs.filter((r) => !doc.luts[r.id])
  if (fresh.length) await st().apply(fresh.map((lut) => ({ type: 'add_lut', lut })))
  return refs.map((r) => r.id)
}

/** Add an effect (with its default params) to the end of each clip's effect list. */
export async function addEffect(clipIds: string[], kind: string) {
  const { doc } = st()
  const def = effectDef(kind)
  if (!doc || !def || !clipIds.length) return false
  const ops: OpInput[] = []
  for (const clipId of clipIds) {
    const c = findClip(doc, clipId)?.clip as MediaClip | undefined
    if (!c) continue
    if (c.effects.length >= 8) throw new Error('A clip can have up to 8 effects')
    const e: Effect = { id: newId('fx'), kind, params: effectParams({ kind, params: {} }) }
    ops.push({ type: 'set_look', clipId, effects: [...c.effects, e] })
  }
  return ops.length ? st().apply(ops) : false
}

export function setEffects(clipId: string, effects: Effect[]) {
  return st().apply([{ type: 'set_look', clipId, effects }])
}

/**
 * Put a transition on the cut after a clip. Returns false (and changes nothing) if no clip starts right where it ends.
 */
export async function setTransition(clipId: string, kind: string | null, durationUs?: number) {
  const { doc } = st()
  const f = doc && findClip(doc, clipId)
  if (!f || (kind && !transitionDef(kind))) return false
  if (kind && !nextAdjacent(f.track, clipId)) return false
  const cur = (f.clip as MediaClip).transition
  return st().apply([{ type: 'set_look', clipId, transition: kind ? { kind, durationUs: durationUs ?? cur?.durationUs ?? 500_000 } : null }])
}

/** Every cut on the track gets the same transition ("apply to all"). Returns how many cuts. */
export async function applyTransitionToAll(trackId: string, kind: string, durationUs: number) {
  const { doc } = st()
  const track = doc?.tracks.find((t) => t.id === trackId)
  if (!track || track.locked) return 0
  const ops: OpInput[] = cutsOn(track).map((c) => ({ type: 'set_look', clipId: c.id, transition: { kind, durationUs } }))
  if (!ops.length) return 0
  return (await st().apply(ops)) ? ops.length : 0
}

/** Clips on a track that have another clip touching their end (where a transition can go). */
export function cutsOn(track: Track): MediaClip[] {
  return track.clips.filter((c): c is MediaClip => (c.kind === 'video' || c.kind === 'image') && !!nextAdjacent(track, c.id))
}

/** Pick a colour anywhere on screen (Chromium's EyeDropper); null if cancelled or unsupported. */
export async function pickScreenColor(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
  if (!Ctor) return null
  try {
    const r = await new Ctor().open()
    const hex = r.sRGBHex
    if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase()
    const m = hex.match(/\d+/g)
    return m && m.length >= 3 ? `#${m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : null
  } catch {
    return null
  }
}
