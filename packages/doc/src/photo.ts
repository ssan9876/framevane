import type { OpInput } from './ops'
import { valueAt, type AnimatableClip } from './keyframes'
import type { Clip, Project, Track } from './schema'

/**
 * Photo canvas operations (S25): crop, resize, rotate and flip the whole picture. They are op batches (one undo step)
 * built from set_canvas + set_clip_props, mapping every layer's position so nothing jumps: media keeps its pixel size
 * (its "fit" to the canvas is recomputed), text and shapes keep theirs, and text anchored by style.y stays put.
 */

type Pt = { x: number; y: number }

/** Where a layer's anchor sits, relative to the canvas centre. */
function anchor(c: AnimatableClip, W: number, H: number): Pt {
  const x = valueAt(c, 'x', 0)
  const y = valueAt(c, 'y', 0)
  return c.kind === 'text' ? { x, y: H * c.style.y + y - H / 2 } : { x, y }
}

/** The transform y that puts a layer's anchor at `p` (relative to the centre of a W'×H' canvas). */
function yFor(c: AnimatableClip, p: Pt, H2: number) {
  return c.kind === 'text' ? p.y + H2 / 2 - H2 * c.style.y : p.y
}

const visual = (c: Clip): c is AnimatableClip => c.kind === 'video' || c.kind === 'image' || c.kind === 'text' || c.kind === 'shape'

/**
 * Move every layer onto a new canvas. `map` takes an anchor (relative to the old centre) to the new one; `k` scales
 * layer size; `dRot` adds rotation; `mirror` flips horizontally.
 */
function remap(doc: Project, W2: number, H2: number, map: (p: Pt) => Pt, k: number, dRot = 0, mirror = false): OpInput[] {
  const { width: W, height: H } = doc.canvas
  const ops: OpInput[] = [{ type: 'set_canvas', canvas: { width: W2, height: H2 } }]
  for (const t of doc.tracks as Track[]) {
    if (t.locked) continue
    for (const c of t.clips) {
      if (!visual(c)) continue
      const p = map(anchor(c, W, H))
      let scale = valueAt(c, 'scale', 0) * k
      if (c.kind === 'video' || c.kind === 'image') {
        // media is sized by "contain" fit to the canvas: keep its on-screen pixels when the canvas changes
        const a = doc.assets[c.assetId]
        if (a?.width && a.height) {
          // (the renderer fits the unrotated source to the canvas, so this holds for quarter turns too)
          scale *= Math.min(W / a.width, H / a.height) / Math.min(W2 / a.width, H2 / a.height)
        }
      }
      const r0 = valueAt(c, 'rotation', 0)
      // text and shapes aren't mirrored (text would read backwards): their position and angle are
      const rotation = mirror ? (c.kind === 'text' || c.kind === 'shape' ? -r0 : -r0 + dRot) : r0 + dRot
      for (const prop of ['x', 'y', 'scale', 'rotation'] as const) if (c.keyframes[prop]?.length) ops.push({ type: 'set_keyframes', clipId: c.id, prop, keyframes: [] })
      ops.push({
        type: 'set_clip_props', clipId: c.id,
        transform: { x: round(p.x), y: round(yFor(c, p, H2)), scale, rotation: angle(rotation), ...(mirror && c.kind !== 'text' && c.kind !== 'shape' ? { flipH: !c.transform.flipH } : {}) },
      })
    }
  }
  return ops
}

/** Two decimals, and never −0. */
const round = (v: number) => Math.round(v * 100) / 100 || 0
/** An angle in (−180, 180]. */
const angle = (deg: number) => { const r = ((deg % 360) + 360) % 360; return (r > 180 ? r - 360 : r) || 0 }
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Keep only `rect` (canvas px) of the picture. */
export function cropCanvasOps(doc: Project, rect: { x: number; y: number; width: number; height: number }): OpInput[] {
  const { width: W, height: H } = doc.canvas
  const x0 = Math.max(0, Math.min(W - 2, rect.x))
  const y0 = Math.max(0, Math.min(H - 2, rect.y))
  const W2 = even(Math.min(W - x0, rect.width))
  const H2 = even(Math.min(H - y0, rect.height))
  const dx = x0 + W2 / 2 - W / 2
  const dy = y0 + H2 / 2 - H / 2
  return remap(doc, W2, H2, (p) => ({ x: p.x - dx, y: p.y - dy }), 1)
}

/** New pixel size. scaleContent: the picture scales with it (resize); otherwise layers keep their size (canvas size). */
export function resizeCanvasOps(doc: Project, width: number, height: number, scaleContent = true): OpInput[] {
  const { width: W, height: H } = doc.canvas
  const W2 = even(width)
  const H2 = even(height)
  const k = scaleContent ? Math.min(W2 / W, H2 / H) : 1
  return remap(doc, W2, H2, (p) => ({ x: p.x * k, y: p.y * k }), k)
}

/** Turn the picture a quarter turn (clockwise or not). */
export function rotateCanvasOps(doc: Project, clockwise = true): OpInput[] {
  const { width: W, height: H } = doc.canvas
  return remap(doc, H, W, (p) => (clockwise ? { x: -p.y, y: p.x } : { x: p.y, y: -p.x }), 1, clockwise ? 90 : -90)
}

/** Mirror the picture left↔right, or top↔bottom (a horizontal mirror plus a half turn). */
export function flipCanvasOps(doc: Project, axis: 'horizontal' | 'vertical' = 'horizontal'): OpInput[] {
  const { width: W, height: H } = doc.canvas
  if (axis === 'horizontal') return remap(doc, W, H, (p) => ({ x: -p.x, y: p.y }), 1, 0, true)
  return remap(doc, W, H, (p) => ({ x: p.x, y: -p.y }), 1, 180, true)
}
