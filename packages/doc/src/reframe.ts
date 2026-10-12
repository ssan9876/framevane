import { findClip, type OpInput } from './ops'
import type { Canvas, Keyframe, MediaClip, Project } from './schema'

/**
 * Auto reframe: change the canvas to a new ratio and keep each clip's subject in frame. The local AI reports where the
 * person is over time (SubjectSample, source seconds, 0…1 coordinates); this turns that into a smooth virtual-camera
 * path and then into position keyframes on a clip scaled to fill the new frame. Pure, so agents and the UI share it.
 */

export interface SubjectSample { t: number; x: number | null; y: number | null; area: number }

export const REFRAME_RATIOS = { '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9], '4:3': [4, 3] } as const
export type ReframeRatio = keyof typeof REFRAME_RATIOS
export type Follow = 'subject' | 'center'

/** The new canvas: the old short side stays the short side of the new ratio (1920×1080 → 9:16 = 1080×1920). */
export function canvasForRatio(canvas: Pick<Canvas, 'width' | 'height'>, ratio: ReframeRatio): { width: number; height: number } {
  const [rw, rh] = REFRAME_RATIOS[ratio]
  const short = Math.min(canvas.width, canvas.height)
  const even = (n: number) => Math.max(16, Math.round(n / 2) * 2)
  return rw <= rh ? { width: even(short), height: even((short * rh) / rw) } : { width: even((short * rw) / rh), height: even(short) }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Fill gaps (nobody in frame) with the nearest known position, or the centre if the subject never appears. */
export function fillGaps(values: (number | null)[], fallback = 0.5): number[] {
  const first = values.find((v) => v !== null) ?? fallback
  let last = first
  return values.map((v) => (v === null ? last : (last = v)))
}

/**
 * A camera that only moves when the target leaves a dead zone around it, then smoothed both ways (no lag, no jitter).
 * deadzone and the result are in the same units as the input.
 */
export function cameraPath(targets: number[], deadzone: number, smoothing = 0.35): number[] {
  if (!targets.length) return []
  const cam: number[] = []
  let c = targets[0]!
  for (const t of targets) {
    if (t - c > deadzone) c = t - deadzone
    else if (c - t > deadzone) c = t + deadzone
    cam.push(c)
  }
  const a = clamp(smoothing, 0, 0.95)
  const fwd = cam.slice()
  for (let i = 1; i < fwd.length; i++) fwd[i] = a * fwd[i - 1]! + (1 - a) * fwd[i]!
  const back = fwd.slice()
  for (let i = back.length - 2; i >= 0; i--) back[i] = a * back[i + 1]! + (1 - a) * back[i]!
  return back
}

/** Ramer–Douglas–Peucker: the fewest points whose straight lines stay within epsilon of the path. */
export function simplify(points: { t: number; v: number }[], epsilon: number): { t: number; v: number }[] {
  if (points.length <= 2) return points.slice()
  let worst = 0
  let at = 0
  const a = points[0]!
  const b = points[points.length - 1]!
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const u = (p.t - a.t) / Math.max(1e-9, b.t - a.t)
    const d = Math.abs(p.v - (a.v + (b.v - a.v) * u))
    if (d > worst) { worst = d; at = i }
  }
  if (worst <= epsilon) return [a, b]
  return [...simplify(points.slice(0, at + 1), epsilon).slice(0, -1), ...simplify(points.slice(at), epsilon)]
}

export interface ReframeResult { scale: number; x: number; y: number; xKeys: Keyframe[]; yKeys: Keyframe[] }

/**
 * Where to put one clip in the new canvas: scaled to cover it, offset so the subject's centre (x) and upper body (y, at
 * 35 % of the height) stay in frame. Without a subject, or with follow "center", the clip is centred.
 */
export function reframeClip(clip: MediaClip, src: { width: number; height: number }, canvas: { width: number; height: number }, samples: SubjectSample[], follow: Follow): ReframeResult {
  const { width: W, height: H } = canvas
  const fit = Math.min(W / src.width, H / src.height)
  const scale = Math.max(W / src.width, H / src.height) / fit
  const picW = src.width * fit * scale
  const picH = src.height * fit * scale
  const maxX = Math.max(0, (picW - W) / 2)
  const maxY = Math.max(0, (picH - H) / 2)
  const centred: ReframeResult = { scale, x: 0, y: 0, xKeys: [], yKeys: [] }
  const inRange = samples.filter((s) => {
    const local = (s.t * 1e6 - clip.inUs) / clip.speed
    return local >= -1e5 && local <= clip.durationUs + 1e5
  })
  if (follow === 'center' || !inRange.some((s) => s.x !== null)) return centred
  const times = inRange.map((s) => clamp(Math.round((s.t * 1e6 - clip.inUs) / clip.speed), 0, clip.durationUs))
  const xs = fillGaps(inRange.map((s) => s.x)).map((u) => clamp((0.5 - u) * picW, -maxX, maxX))
  const ys = fillGaps(inRange.map((s) => s.y), 0.4).map((v) => clamp(-0.15 * H - (v - 0.5) * picH, -maxY, maxY))
  const axis = (vals: number[], max: number, size: number) => {
    if (max < 1) return { value: 0, keys: [] as Keyframe[] }
    const path = cameraPath(vals, size * 0.06)
    const pts = simplify(times.map((t, i) => ({ t, v: Math.round(path[i]!) })), Math.max(2, size * 0.004))
    // collapse duplicate times (samples clamped to the clip edges)
    const uniq = pts.filter((p, i) => i === 0 || p.t !== pts[i - 1]!.t)
    if (uniq.length < 2 || uniq.every((p) => Math.abs(p.v - uniq[0]!.v) < 1)) return { value: uniq[0]?.v ?? 0, keys: [] as Keyframe[] }
    return { value: uniq[0]!.v, keys: uniq.map((p) => ({ tUs: p.t, value: p.v, easing: 'linear' as const })) }
  }
  const ax = axis(xs, maxX, W)
  const ay = axis(ys, maxY, H)
  return { scale, x: ax.value, y: ay.value, xKeys: ax.keys, yKeys: ay.keys }
}

/** Ops that place one clip per reframeClip: scale to cover, crop off, static or keyframed position. */
export function reframeOps(doc: Project, clipId: string, canvas: { width: number; height: number }, samples: SubjectSample[], follow: Follow): OpInput[] {
  const f = findClip(doc, clipId)
  if (!f || (f.clip.kind !== 'video' && f.clip.kind !== 'image')) return []
  const c = f.clip as MediaClip
  const a = doc.assets[c.assetId]
  if (!a?.width || !a.height) return []
  const r = reframeClip(c, { width: a.width, height: a.height }, canvas, samples, follow)
  return [
    { type: 'set_keyframes', clipId, prop: 'scale', keyframes: [] },
    { type: 'set_clip_props', clipId, transform: { scale: r.scale, x: r.x, y: r.y, rotation: 0, crop: { left: 0, top: 0, right: 0, bottom: 0 } } },
    { type: 'set_keyframes', clipId, prop: 'x', keyframes: r.xKeys },
    { type: 'set_keyframes', clipId, prop: 'y', keyframes: r.yKeys },
  ]
}
