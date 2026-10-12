import type { AnimProp, Easing, Keyframe, Keyframes, MediaClip, TextClip } from './schema'

/** Clips with a transform that can be keyframed: media and text. */
export type AnimatableClip = MediaClip | TextClip

/**
 * Keyframes live on a clip, at times relative to the clip start (timeline µs). A property with keyframes is animated;
 * without, its static value (transform / volumeDb) applies. Between two keyframes the FIRST one's easing shapes the
 * segment; before the first and after the last, the value holds.
 */

const ease: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  hold: () => 0,
}

export function staticValue(clip: AnimatableClip, prop: AnimProp): number {
  if (prop === 'volumeDb') return clip.kind === 'text' ? 0 : clip.volumeDb
  return clip.transform[prop]
}

export function isAnimated(clip: AnimatableClip, prop: AnimProp): boolean {
  return (clip.keyframes[prop]?.length ?? 0) > 0
}

/** Value of a keyframe track at clip-local time t. */
export function sampleTrack(kfs: Keyframe[], tUs: number): number {
  const first = kfs[0]!
  if (tUs <= first.tUs) return first.value
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    if (tUs < b.tUs) {
      const u = (tUs - a.tUs) / Math.max(1, b.tUs - a.tUs)
      return a.value + (b.value - a.value) * ease[a.easing](u)
    }
  }
  return kfs[kfs.length - 1]!.value
}

/** Property value of a clip at clip-local time t (keyframed or static). */
export function valueAt(clip: AnimatableClip, prop: AnimProp, localUs: number): number {
  const kfs = clip.keyframes[prop]
  return kfs && kfs.length ? sampleTrack(kfs, localUs) : staticValue(clip, prop)
}

/** Resolved transform + volume at clip-local time t, used by the compositor and the audio graph. */
export function resolveAt(clip: AnimatableClip, localUs: number) {
  return {
    ...clip.transform,
    x: valueAt(clip, 'x', localUs),
    y: valueAt(clip, 'y', localUs),
    scale: valueAt(clip, 'scale', localUs),
    rotation: valueAt(clip, 'rotation', localUs),
    opacity: Math.max(0, Math.min(1, valueAt(clip, 'opacity', localUs))),
    volumeDb: valueAt(clip, 'volumeDb', localUs),
  }
}

/** Insert or replace the keyframe at tUs (within `toleranceUs`, default half a frame at 30 fps). */
export function upsertKeyframe(kfs: Keyframe[] | undefined, k: Keyframe, toleranceUs = 16_666): Keyframe[] {
  const out = (kfs ?? []).filter((x) => Math.abs(x.tUs - k.tUs) > toleranceUs)
  out.push(k)
  return out.sort((a, b) => a.tUs - b.tUs)
}

export function removeKeyframeAt(kfs: Keyframe[] | undefined, tUs: number, toleranceUs = 16_666): Keyframe[] {
  return (kfs ?? []).filter((x) => Math.abs(x.tUs - tUs) > toleranceUs)
}

/**
 * Keep the part of every track inside [fromUs, toUs) of the clip and re-base it to start at 0. Boundary keyframes are
 * inserted with the interpolated value so an animation cut in the middle continues exactly where it was.
 */
export function sliceKeyframes(all: Keyframes, fromUs: number, toUs: number): Keyframes {
  const out: Keyframes = {}
  for (const [prop, kfs] of Object.entries(all) as [AnimProp, Keyframe[] | undefined][]) {
    if (!kfs?.length) continue
    const inside = kfs.filter((k) => k.tUs > fromUs && k.tUs < toUs).map((k) => ({ ...k, tUs: k.tUs - fromUs }))
    const startVal = sampleTrack(kfs, fromUs)
    const endVal = sampleTrack(kfs, toUs)
    const easeAt = (t: number) => [...kfs].reverse().find((k) => k.tUs <= t)?.easing ?? kfs[0]!.easing
    const track: Keyframe[] = [{ tUs: 0, value: startVal, easing: easeAt(fromUs) }, ...inside]
    const span = toUs - fromUs
    if (kfs.some((k) => k.tUs >= toUs) && span > 0) track.push({ tUs: span, value: endVal, easing: easeAt(toUs) })
    // a track with every value equal and only boundary keys carries no animation: keep it (the user keyed it on purpose)
    out[prop] = dedupe(track)
  }
  return out
}

/** Speed change: clip-local times stretch by old/new speed. */
export function scaleKeyframes(all: Keyframes, factor: number): Keyframes {
  const out: Keyframes = {}
  for (const [prop, kfs] of Object.entries(all) as [AnimProp, Keyframe[] | undefined][]) {
    if (kfs?.length) out[prop] = kfs.map((k) => ({ ...k, tUs: Math.round(k.tUs * factor) }))
  }
  return out
}

function dedupe(kfs: Keyframe[]): Keyframe[] {
  const out: Keyframe[] = []
  for (const k of kfs) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.tUs - k.tUs) < 1) out[out.length - 1] = k
    else out.push(k)
  }
  return out
}
