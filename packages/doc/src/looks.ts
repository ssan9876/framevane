import { clipEnd } from './ops'
import type { ColorAdjust, Effect, MediaClip, Track } from './schema'
import { NO_COLOR } from './schema'

/**
 * The built-in look catalogue: effects, filters and transitions. All of it is authored for Framevane (the shaders
 * live in the renderer, engine/gl.ts); this file is the data both the UI and the agents read.
 */

export interface ParamDef { key: string; label: string; min: number; max: number; default: number; step?: number; unit?: string }

export interface EffectDef {
  kind: string
  name: string
  category: 'basic' | 'retro' | 'distort' | 'stylize' | 'light'
  description: string
  params: ParamDef[]
  /** Changes over time (the preview tile is drawn mid-way). */
  animated?: boolean
}

const amount = (d: number, label = 'Amount'): ParamDef => ({ key: 'amount', label, min: 0, max: 100, default: d, unit: '%' })
const speed = (d: number): ParamDef => ({ key: 'speed', label: 'Speed', min: 0, max: 100, default: d, unit: '%' })

export const EFFECTS: EffectDef[] = [
  { kind: 'blur', name: 'Blur', category: 'basic', description: 'Soft focus over the whole clip.', params: [amount(30)] },
  { kind: 'glow', name: 'Glow', category: 'light', description: 'Bright areas bloom outwards.', params: [amount(50), { key: 'threshold', label: 'Threshold', min: 0, max: 100, default: 60, unit: '%' }] },
  { kind: 'vhs', name: 'VHS', category: 'retro', description: 'Tape wobble, colour bleed and scanlines.', params: [amount(60)], animated: true },
  { kind: 'old-film', name: 'Old film', category: 'retro', description: 'Sepia, flicker, dust and scratches.', params: [amount(70)], animated: true },
  { kind: 'film-grain', name: 'Film grain', category: 'retro', description: 'Moving grain like film stock.', params: [amount(40), { key: 'size', label: 'Size', min: 0, max: 100, default: 30, unit: '%' }], animated: true },
  { kind: 'scanlines', name: 'Scanlines', category: 'retro', description: 'CRT-style horizontal lines.', params: [amount(50), { key: 'density', label: 'Density', min: 0, max: 100, default: 50, unit: '%' }] },
  { kind: 'glitch', name: 'Glitch', category: 'distort', description: 'Blocks jump and colour channels tear.', params: [amount(50), speed(50)], animated: true },
  { kind: 'rgb-split', name: 'RGB split', category: 'distort', description: 'Red and blue drift apart.', params: [amount(30)] },
  { kind: 'wave', name: 'Wave', category: 'distort', description: 'The picture ripples like water.', params: [amount(30), { key: 'frequency', label: 'Frequency', min: 0, max: 100, default: 40, unit: '%' }, speed(40)], animated: true },
  { kind: 'shake', name: 'Shake', category: 'distort', description: 'Handheld camera shake.', params: [amount(40), speed(60)], animated: true },
  { kind: 'zoom-pulse', name: 'Zoom pulse', category: 'distort', description: 'A rhythmic punch-in.', params: [amount(30), speed(40)], animated: true },
  { kind: 'bulge', name: 'Bulge', category: 'distort', description: 'Fisheye swell from the centre (negative pinches).', params: [{ key: 'amount', label: 'Amount', min: -100, max: 100, default: 50, unit: '%' }] },
  { kind: 'mirror', name: 'Mirror', category: 'stylize', description: 'Reflect one half onto the other.', params: [{ key: 'mode', label: 'Mode', min: 0, max: 3, default: 0, step: 1 }] },
  { kind: 'kaleidoscope', name: 'Kaleidoscope', category: 'stylize', description: 'Repeating mirrored wedges.', params: [{ key: 'segments', label: 'Segments', min: 3, max: 16, default: 6, step: 1 }, { key: 'spin', label: 'Spin', min: -100, max: 100, default: 20, unit: '%' }], animated: true },
  { kind: 'pixelate', name: 'Pixelate', category: 'stylize', description: 'Big square pixels.', params: [{ key: 'size', label: 'Size', min: 0, max: 100, default: 40, unit: '%' }] },
  { kind: 'halftone', name: 'Halftone', category: 'stylize', description: 'Printed dot pattern.', params: [{ key: 'size', label: 'Size', min: 0, max: 100, default: 35, unit: '%' }] },
  { kind: 'sketch', name: 'Sketch', category: 'stylize', description: 'Pencil lines from the edges.', params: [amount(80)] },
  { kind: 'posterize', name: 'Posterize', category: 'stylize', description: 'Flat bands of colour.', params: [{ key: 'levels', label: 'Levels', min: 2, max: 16, default: 5, step: 1 }] },
  { kind: 'duotone', name: 'Duotone', category: 'stylize', description: 'Two colours, dark to light.', params: [{ key: 'dark', label: 'Dark hue', min: 0, max: 360, default: 250, unit: '°' }, { key: 'light', label: 'Light hue', min: 0, max: 360, default: 40, unit: '°' }, amount(100)] },
  { kind: 'invert', name: 'Invert', category: 'stylize', description: 'Photo negative.', params: [amount(100)] },
  { kind: 'light-leak', name: 'Light leak', category: 'light', description: 'Warm light drifting across the frame.', params: [amount(60), speed(30)], animated: true },
  { kind: 'flash', name: 'Flash', category: 'light', description: 'Strobing white flashes.', params: [amount(70), speed(50)], animated: true },
]

export interface FilterDef {
  id: string
  name: string
  category: 'natural' | 'warm' | 'cool' | 'mono' | 'film' | 'vivid'
  /** Colour settings the filter applies (same scale as ColorAdjust). */
  color: Partial<ColorAdjust>
  mono?: boolean
  /** Split toning: shadows and highlights tinted towards these colours. */
  split?: { shadows: string; highlights: string; amount: number }
}

export const FILTERS: FilterDef[] = [
  { id: 'warm', name: 'Warm', category: 'warm', color: { temperature: 35, saturation: 10, contrast: 5 } },
  { id: 'golden', name: 'Golden hour', category: 'warm', color: { temperature: 45, exposure: 5, highlights: 15, saturation: 15 }, split: { shadows: '#6b3d1a', highlights: '#ffcf70', amount: 0.3 } },
  { id: 'rose', name: 'Rose', category: 'warm', color: { tint: 25, temperature: 15, fade: 15, saturation: 5 } },
  { id: 'retro', name: 'Seventies', category: 'film', color: { temperature: 30, fade: 25, saturation: -15, tint: 10, grain: 20 }, split: { shadows: '#5a3a1a', highlights: '#ffe0a0', amount: 0.35 } },
  { id: 'cool', name: 'Cool', category: 'cool', color: { temperature: -35, tint: -5, contrast: 5 } },
  { id: 'arctic', name: 'Arctic', category: 'cool', color: { temperature: -25, brightness: 15, saturation: -25, highlights: 20 } },
  { id: 'night', name: 'Night', category: 'cool', color: { exposure: -25, temperature: -45, saturation: -20, contrast: 15 } },
  { id: 'vivid', name: 'Vivid', category: 'vivid', color: { saturation: 35, vibrance: 30, contrast: 15 } },
  { id: 'punch', name: 'Punch', category: 'vivid', color: { contrast: 35, vibrance: 40, shadows: -10, highlights: -10 } },
  { id: 'forest', name: 'Forest', category: 'vivid', color: { tint: -20, saturation: 20, temperature: -5, shadows: 10 } },
  { id: 'teal-orange', name: 'Teal & orange', category: 'film', color: { saturation: 10, contrast: 10 }, split: { shadows: '#00807f', highlights: '#ff9a3d', amount: 0.55 } },
  { id: 'cinema', name: 'Cinema', category: 'film', color: { contrast: 20, saturation: -10, vignette: 25 }, split: { shadows: '#1d4a6b', highlights: '#ffb26b', amount: 0.45 } },
  { id: 'cross', name: 'Cross process', category: 'film', color: { contrast: 25, saturation: 25, tint: -10 }, split: { shadows: '#003a8c', highlights: '#fff36b', amount: 0.5 } },
  { id: 'bleach', name: 'Bleach bypass', category: 'film', color: { saturation: -55, contrast: 40, highlights: 10 } },
  { id: 'faded', name: 'Faded', category: 'natural', color: { fade: 45, saturation: -20, contrast: -10 } },
  { id: 'pastel', name: 'Pastel', category: 'natural', color: { fade: 30, saturation: -10, brightness: 15, contrast: -20, tint: 8 } },
  { id: 'moody', name: 'Moody', category: 'natural', color: { exposure: -10, contrast: 20, saturation: -25, shadows: -15, temperature: -10, vignette: 30 } },
  { id: 'mono', name: 'Mono', category: 'mono', color: { contrast: 10 }, mono: true },
  { id: 'noir', name: 'Noir', category: 'mono', color: { contrast: 45, shadows: -20, vignette: 40, grain: 15 }, mono: true },
  { id: 'sepia', name: 'Sepia', category: 'mono', color: { contrast: 5 }, mono: true, split: { shadows: '#4a2c12', highlights: '#f0d2a0', amount: 0.9 } },
]

export interface TransitionDef { kind: string; name: string; category: 'basic' | 'slide' | 'wipe' | 'stylized'; description: string }

export const TRANSITIONS: TransitionDef[] = [
  { kind: 'dissolve', name: 'Dissolve', category: 'basic', description: 'Cross-fade.' },
  { kind: 'dip-black', name: 'Dip to black', category: 'basic', description: 'Fade out to black, then in.' },
  { kind: 'dip-white', name: 'Dip to white', category: 'basic', description: 'Fade out to white, then in.' },
  { kind: 'push-left', name: 'Push left', category: 'slide', description: 'The next clip pushes this one off to the left.' },
  { kind: 'push-right', name: 'Push right', category: 'slide', description: 'The next clip pushes this one off to the right.' },
  { kind: 'push-up', name: 'Push up', category: 'slide', description: 'The next clip pushes this one up.' },
  { kind: 'push-down', name: 'Push down', category: 'slide', description: 'The next clip pushes this one down.' },
  { kind: 'wipe-left', name: 'Wipe left', category: 'wipe', description: 'A soft edge sweeps right to left.' },
  { kind: 'wipe-right', name: 'Wipe right', category: 'wipe', description: 'A soft edge sweeps left to right.' },
  { kind: 'wipe-diagonal', name: 'Diagonal wipe', category: 'wipe', description: 'A soft edge sweeps corner to corner.' },
  { kind: 'iris', name: 'Circle', category: 'wipe', description: 'A circle opens from the centre.' },
  { kind: 'clock', name: 'Clock', category: 'wipe', description: 'A hand sweeps round like a clock.' },
  { kind: 'zoom', name: 'Zoom', category: 'stylized', description: 'Rush in, land on the next clip.' },
  { kind: 'blur', name: 'Blur', category: 'stylized', description: 'Blur out, blur in.' },
  { kind: 'pixelate', name: 'Pixelate', category: 'stylized', description: 'Break into pixels and rebuild.' },
  { kind: 'glitch', name: 'Glitch', category: 'stylized', description: 'A digital tear between clips.' },
]

export const effectDef = (kind: string) => EFFECTS.find((e) => e.kind === kind)
export const filterDef = (id: string) => FILTERS.find((f) => f.id === id)
export const transitionDef = (kind: string) => TRANSITIONS.find((t) => t.kind === kind)

/** Every param of an effect, defaults filled in and values clamped to their range. */
export function effectParams(e: Pick<Effect, 'kind' | 'params'>): Record<string, number> {
  const def = effectDef(e.kind)
  if (!def) return { ...e.params }
  return Object.fromEntries(def.params.map((p) => {
    const v = e.params[p.key]
    return [p.key, v === undefined || !Number.isFinite(v) ? p.default : Math.max(p.min, Math.min(p.max, v))]
  }))
}

export const isNeutralColor = (c: ColorAdjust) => (Object.keys(NO_COLOR) as (keyof ColorAdjust)[]).every((k) => c[k] === NO_COLOR[k])

/** Does this clip need the GPU look pipeline at all? (Plain clips take the fast path.) */
export function hasLook(c: MediaClip): boolean {
  if (c.kind === 'audio') return false
  return !!(c.chroma || (c.filter && c.filter.intensity > 0 && filterDef(c.filter.id)) || (c.lut && c.lut.intensity > 0) || c.effects.length || !isNeutralColor(c.color))
}

/* ───────────────────────── transitions on the timeline ───────────────────────── */

/** Gap below which two clips count as touching (one frame at 1000 fps). */
const TOUCH_US = 1000

/** The clip that starts where this one ends on the same track, if any. */
export function nextAdjacent(track: Track, clipId: string): MediaClip | null {
  const i = track.clips.findIndex((c) => c.id === clipId)
  const a = track.clips[i]
  const b = track.clips[i + 1]
  if (!a || !b || (b.kind !== 'video' && b.kind !== 'image')) return null
  return Math.abs(b.startUs - clipEnd(a)) <= TOUCH_US ? b : null
}

/** Effective length of a transition between a and b: never more than either clip. */
export function transitionLength(a: MediaClip, b: MediaClip): number {
  return Math.max(0, Math.min(a.transition?.durationUs ?? 0, a.durationUs, b.durationUs))
}

export interface ActiveTransition { from: MediaClip; to: MediaClip; kind: string; progress: number; startUs: number; endUs: number }

/** A transition playing on this track at time t: centred on the cut, progress 0 → 1. */
export function transitionAt(track: Track, tUs: number): ActiveTransition | null {
  for (let i = 0; i < track.clips.length - 1; i++) {
    const a = track.clips[i]!
    if ((a.kind !== 'video' && a.kind !== 'image') || !a.transition || !a.enabled) continue
    const b = nextAdjacent(track, a.id)
    if (!b || !b.enabled) continue
    const d = transitionLength(a, b)
    if (d <= 0) continue
    const cut = clipEnd(a)
    const startUs = cut - d / 2
    const endUs = cut + d / 2
    if (tUs >= startUs && tUs < endUs) return { from: a, to: b, kind: a.transition.kind, progress: (tUs - startUs) / d, startUs, endUs }
    if (startUs > tUs) break
  }
  return null
}
