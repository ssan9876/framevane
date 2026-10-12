import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Pipette } from 'lucide-react'
import { cn } from '../cn'
import { Popover } from './Overlay'

/* ─────────── color math ─────────── */
type HSV = { h: number; s: number; v: number }
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1]!, 16) : 0
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height))
  }
  return {
    ref,
    onPointerDown: (e: RPointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); at(e) },
    onPointerMove: (e: RPointerEvent) => { if (e.buttons) at(e) },
  }
}

const DEFAULT_SWATCHES = ['#ffffff', '#000000', '#ff4d4d', '#ffb02e', '#ffe14d', '#3ddc84', '#4da3ff', '#9b6bff', '#ff6bd6', '#8a8f98']

/**
 * Color picker: swatch trigger → popover with saturation/value square, hue strip, hex input, swatches, eyedropper.
 * Keyboard: the square and hue strip are sliders (arrows adjust, Shift = ×10). The eyedropper uses the
 * Chromium EyeDropper API, so it can pick from the player canvas (chroma key).
 */
export function ColorPicker({ label, value, onChange, swatches = DEFAULT_SWATCHES }: { label: string; value: string; onChange: (hex: string) => void; swatches?: string[] }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const set = (next: HSV) => { setHsv(next); onChange(hsvToHex(next)) }
  const sv = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }))
  const hue = useDrag((x) => set({ ...hsv, h: x * 360 }))
  const hasEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window

  const keySv = (e: KeyboardEvent) => {
    const d = (e.shiftKey ? 0.1 : 0.01)
    const map: Record<string, Partial<HSV>> = { ArrowLeft: { s: clamp01(hsv.s - d) }, ArrowRight: { s: clamp01(hsv.s + d) }, ArrowUp: { v: clamp01(hsv.v + d) }, ArrowDown: { v: clamp01(hsv.v - d) } }
    if (map[e.key]) { e.preventDefault(); set({ ...hsv, ...map[e.key] }) }
  }
  const keyHue = (e: KeyboardEvent) => {
    const d = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set({ ...hsv, h: (hsv.h + (e.key === 'ArrowRight' ? d : -d) + 360) % 360 }) }
  }

  return (
    <Popover
      trigger={
        <button type="button" aria-label={`${label}: ${value}`} className="flex h-7 items-center gap-2 rounded-sm border border-border-input bg-surface-2 pl-1 pr-2 text-sm hover:border-border-strong">
          <span className="size-5 rounded-xs checker"><span className="block size-full rounded-xs ring-1 ring-inset ring-fg/10" style={{ background: value }} /></span>
          <span className="font-mono text-xs uppercase text-muted">{value}</span>
        </button>
      }
    >
      <div className="flex w-56 flex-col gap-3">
        <div
          {...sv}
          role="slider"
          tabIndex={0}
          aria-label={`${label} saturation and brightness`}
          aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          onKeyDown={keySv}
          className="relative h-36 cursor-crosshair rounded-sm"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }}
        >
          <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-fg shadow-card" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div
          {...hue}
          role="slider"
          tabIndex={0}
          aria-label={`${label} hue`}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onKeyDown={keyHue}
          className="relative h-3 cursor-pointer rounded-pill"
          style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
        >
          <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-fg shadow-card" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label={`${label} hex`}
            value={hexDraft ?? value}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => {
              if (hexDraft && /^#?[0-9a-f]{6}$/i.test(hexDraft)) { const h = hexDraft.startsWith('#') ? hexDraft : '#' + hexDraft; setHsv(hexToHsv(h)); onChange(h.toLowerCase()) }
              setHexDraft(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="h-7 flex-1 rounded-sm border border-border-input bg-surface px-2 font-mono text-sm uppercase focus-visible:border-focus"
          />
          {hasEyedropper && (
            <button
              type="button"
              aria-label="Pick a color from the screen"
              className="grid size-7 place-items-center rounded-sm border border-border-input text-muted hover:text-fg"
              onClick={async () => {
                const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open().catch(() => null)
                if (r) { setHsv(hexToHsv(r.sRGBHex)); onChange(r.sRGBHex) }
              }}
            >
              <Pipette className="size-3.5" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Swatches" className="grid grid-cols-10 gap-1">
          {swatches.map((s) => (
            <button key={s} type="button" aria-label={s} onClick={() => { setHsv(hexToHsv(s)); onChange(s) }} className={cn('aspect-square rounded-xs ring-1 ring-inset ring-fg/10', s === value && 'ring-2 ring-accent')} style={{ background: s }} />
          ))}
        </div>
      </div>
    </Popover>
  )
}

/* ─────────── Curve editor (color curves, speed curves, keyframe easing) ─────────── */
export interface CurvePoint { x: number; y: number }

/**
 * Points in 0..1, x strictly increasing, first/last pinned to x=0/x=1.
 * Drag a point · double-click empty space to add · select + Delete to remove · arrows nudge the selected point.
 */
export function CurveEditor({ points, onChange, color = 'var(--fv-color-fg)', label, size = 200 }: { points: CurvePoint[]; onChange: (p: CurvePoint[]) => void; color?: string; label: string; size?: number }) {
  const svg = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) }
  }
  const move = (i: number, p: CurvePoint) => {
    const next = points.slice()
    const lo = i === 0 ? 0 : points[i - 1]!.x + 0.01
    const hi = i === points.length - 1 ? 1 : points[i + 1]!.x - 0.01
    next[i] = { x: i === 0 ? 0 : i === points.length - 1 ? 1 : Math.min(hi, Math.max(lo, p.x)), y: p.y }
    onChange(next)
  }
  const path = monotonePath(points, size)
  return (
    <svg
      ref={svg}
      role="group"
      aria-label={label}
      tabIndex={0}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="touch-none rounded-sm bg-bg"
      onDoubleClick={(e) => {
        const p = toLocal(e)
        const i = points.findIndex((q) => q.x > p.x)
        if (i > 0) { const next = points.slice(); next.splice(i, 0, p); onChange(next); setSel(i) }
      }}
      onKeyDown={(e) => {
        if (sel === null) return
        const pt = points[sel]!
        const d = e.shiftKey ? 0.05 : 0.01
        if ((e.key === 'Delete' || e.key === 'Backspace') && sel > 0 && sel < points.length - 1) { onChange(points.filter((_, i) => i !== sel)); setSel(null) }
        const dirs: Record<string, CurvePoint> = { ArrowUp: { x: pt.x, y: clamp01(pt.y + d) }, ArrowDown: { x: pt.x, y: clamp01(pt.y - d) }, ArrowLeft: { x: pt.x - d, y: pt.y }, ArrowRight: { x: pt.x + d, y: pt.y } }
        if (dirs[e.key]) { e.preventDefault(); move(sel, dirs[e.key]!) }
      }}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="stroke-border">
          <line x1={g * size} x2={g * size} y1={0} y2={size} />
          <line y1={g * size} y2={g * size} x1={0} x2={size} />
        </g>
      ))}
      <line x1={0} y1={size} x2={size} y2={0} className="stroke-border-strong" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x * size}
          cy={(1 - p.y) * size}
          r={sel === i ? 5 : 4}
          fill={sel === i ? color : 'var(--fv-color-bg)'}
          stroke={color}
          strokeWidth={1.5}
          className="cursor-grab"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setSel(i) }}
          onPointerMove={(e) => { if (e.buttons) move(i, toLocal(e)) }}
        />
      ))}
    </svg>
  )
}

/** Smooth curve through points (Catmull-Rom → cubic Bézier), good enough for UI; the renderer uses the same spline. */
function monotonePath(pts: CurvePoint[], size: number) {
  const P = pts.map((p) => ({ x: p.x * size, y: (1 - p.y) * size }))
  if (P.length < 2) return ''
  let d = `M${P[0]!.x},${P[0]!.y}`
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]!, p1 = P[i]!, p2 = P[i + 1]!, p3 = P[i + 2] ?? p2
    d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`
  }
  return d
}
