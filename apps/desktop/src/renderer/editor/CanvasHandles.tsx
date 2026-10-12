import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { applyOps, clipEnd, findClip, valueAt, type AnimatableClip, type Clip, type OpInput, type Project } from '@framevane/doc'
import { useApp } from '../app/store'
import { layersAt, mediaGeometry, textGeometry } from '../engine/compositor'
import { localPlayhead, setAnimProp } from './actions-m1'
import { useEditor } from './Editor'

/**
 * S13 on-canvas editing for the selected picture: drag to move, corners to resize (uniform), the top knob to rotate.
 * Snaps to the canvas centre lines and edges (Alt disables, Shift snaps rotation to 15°). While dragging, the player
 * shows a locally simulated document; one op (one undo step) is committed on release. Keyed properties get keyframes.
 */

type Mode = { kind: 'move' | 'scale' | 'rotate'; startX: number; startY: number; orig: { x: number; y: number; scale: number; rotation: number }; cx: number; cy: number }
const SNAP = 10 // px in canvas space

export function CanvasHandles({ doc, cssW, cssH }: { doc: Project; cssW: number; cssH: number }) {
  const selection = useApp((s) => s.selection)
  const playheadUs = useApp((s) => s.playheadUs)
  const { player } = useEditor()
  const [mode, setMode] = useState<Mode | null>(null)
  const [live, setLive] = useState<{ x: number; y: number; scale: number; rotation: number } | null>(null)
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const box = useRef<HTMLDivElement>(null)

  const W = doc.canvas.width
  const H = doc.canvas.height
  const k = cssW / W // canvas px → css px

  const movable = (c: Clip): c is AnimatableClip => c.kind === 'video' || c.kind === 'image' || c.kind === 'text'
  /** Canvas-space box of a picture or text clip at the playhead (null when its size isn't known yet). */
  const geometry = (c: AnimatableClip) => {
    const local = localPlayhead(c, playheadUs)
    if (c.kind === 'text') return textGeometry(c, local, W, H)
    const a = doc.assets[c.assetId]
    return a?.width && a.height ? mediaGeometry(c, local, a.width, a.height, W, H) : null
  }

  // the selected picture or text under the playhead
  const f = selection.length === 1 ? findClip(doc, selection[0]!) : null
  const clip = f && movable(f.clip) && !f.track.locked && !f.track.hidden && f.clip.startUs <= playheadUs && playheadUs < clipEnd(f.clip) ? f.clip : null

  // click on the canvas selects the topmost picture under the pointer
  const pick = (e: RPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const px = (e.clientX - r.left) / k
    const py = (e.clientY - r.top) / k
    const hits = layersAt(doc, playheadUs).map((l) => l.clip).filter(movable).reverse()
    for (const c of hits) {
      const g = geometry(c)
      if (!g) continue
      const rad = (-g.rotation * Math.PI) / 180
      const dx = px - g.cx
      const dy = py - g.cy
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
      if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) { useApp.getState().select([c.id]); return c }
    }
    useApp.getState().select([])
    return null
  }

  const opsFor = (c: AnimatableClip, v: { x: number; y: number; scale: number; rotation: number }): OpInput[] => {
    const ops: OpInput[] = []
    const cur = { x: c.transform.x, y: c.transform.y, scale: c.transform.scale, rotation: c.transform.rotation }
    for (const prop of ['x', 'y', 'scale', 'rotation'] as const) {
      const keyed = (c.keyframes[prop]?.length ?? 0) > 0
      if (keyed || Math.abs(v[prop] - cur[prop]) > 1e-6) ops.push(setAnimProp(c, prop, v[prop]))
    }
    return ops
  }

  const startDrag = (kind: Mode['kind']) => (e: RPointerEvent) => {
    const g = clip && geometry(clip)
    if (!clip || !g) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const t = { x: valueOf(clip, 'x'), y: valueOf(clip, 'y'), scale: valueOf(clip, 'scale'), rotation: valueOf(clip, 'rotation') }
    setMode({ kind, startX: e.clientX, startY: e.clientY, orig: t, cx: g.cx, cy: g.cy })
    setLive(t)
  }
  const valueOf = (c: AnimatableClip, p: 'x' | 'y' | 'scale' | 'rotation') => valueAt(c, p, localPlayhead(c, playheadUs))

  const onMove = (e: RPointerEvent) => {
    if (!mode || !clip) return
    const dx = (e.clientX - mode.startX) / k
    const dy = (e.clientY - mode.startY) / k
    let next = { ...mode.orig }
    const g = { v: false, h: false }
    if (mode.kind === 'move') {
      next.x = mode.orig.x + dx
      next.y = mode.orig.y + dy
      if (!e.altKey) {
        if (Math.abs(next.x) < SNAP) { next.x = 0; g.v = true }
        if (Math.abs(next.y) < SNAP) { next.y = 0; g.h = true }
      }
    } else if (mode.kind === 'scale') {
      const r = box.current!.getBoundingClientRect()
      const cx = r.left + mode.cx * k
      const cy = r.top + mode.cy * k
      const d0 = Math.hypot(mode.startX - cx, mode.startY - cy)
      const d1 = Math.hypot(e.clientX - cx, e.clientY - cy)
      next.scale = Math.max(0.05, Math.min(10, mode.orig.scale * (d1 / Math.max(1, d0))))
      if (!e.altKey && Math.abs(next.scale - 1) < 0.03) next.scale = 1
    } else {
      const r = box.current!.getBoundingClientRect()
      const cx = r.left + mode.cx * k
      const cy = r.top + mode.cy * k
      const a0 = Math.atan2(mode.startY - cy, mode.startX - cx)
      const a1 = Math.atan2(e.clientY - cy, e.clientX - cx)
      let rot = mode.orig.rotation + ((a1 - a0) * 180) / Math.PI
      rot = ((rot + 540) % 360) - 180
      if (e.shiftKey) rot = Math.round(rot / 15) * 15
      else if (!e.altKey && Math.abs(rot) < 3) rot = 0
      next.rotation = rot
    }
    setGuides(g)
    setLive(next)
    // live preview without committing: simulate the ops locally and hand the result to the player
    try { player.setDoc(applyOps(doc, opsFor(clip, next)).doc) } catch { /* out of range: keep last good frame */ }
  }

  const onUp = () => {
    if (!mode || !clip || !live) { setMode(null); return }
    const ops = opsFor(clip, live)
    setMode(null)
    setLive(null)
    setGuides({ v: false, h: false })
    if (ops.length) void useApp.getState().apply(ops)
    else player.setDoc(doc)
  }

  let frame = null
  const g0 = clip && geometry(clip)
  if (clip && g0) {
    const g = g0
    const cx = mode && live ? g.cx + (live.x - mode.orig.x) : g.cx
    const cy = mode && live ? g.cy + (live.y - mode.orig.y) : g.cy
    const sc = mode && live ? live.scale / Math.max(1e-6, mode.orig.scale) : 1
    const rot = mode && live ? live.rotation : g.rotation
    const w = g.w * sc * k
    const h = g.h * sc * k
    frame = (
      <div
        role="group" aria-label={`Selected ${clip.kind === 'text' ? 'text' : 'clip'} on canvas: drag to move, corners to resize, top knob to rotate`}
        className="absolute cursor-move outline outline-1 outline-selection"
        style={{ left: cx * k - w / 2, top: cy * k - h / 2, width: w, height: h, transform: `rotate(${rot}deg)` }}
        onPointerDown={startDrag('move')}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
          <span key={c} onPointerDown={startDrag('scale')} aria-hidden
            className="absolute size-2.5 rounded-xs border border-scrim bg-selection"
            style={{ left: c.includes('w') ? -5 : undefined, right: c.includes('e') ? -5 : undefined, top: c.includes('n') ? -5 : undefined, bottom: c.includes('s') ? -5 : undefined, cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
        ))}
        <span onPointerDown={startDrag('rotate')} aria-hidden className="absolute left-1/2 -top-6 size-3 -translate-x-1/2 cursor-grab rounded-pill border border-scrim bg-selection" />
        <span aria-hidden className="absolute left-1/2 -top-3.5 h-3 w-px -translate-x-1/2 bg-selection" />
      </div>
    )
  }

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ width: cssW, height: cssH }}
      onPointerDown={(e) => { if (e.button === 0) pick(e) }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {guides.v && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-snap-guide" />}
      {guides.h && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-snap-guide" />}
      {frame}
    </div>
  )
}
