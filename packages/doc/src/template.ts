import { z } from 'zod'
import type { OpInput } from './ops'
import { Fps, Id, PositiveUs, TextStyle, Us, type AssetRef, type Fps as FpsT, type TextStyle as TextStyleT } from './schema'

/**
 * Templates: someone else's edit (a TikTok, a Reel) turned into slots for your own clips. The analysis finds the cuts
 * (each shot becomes a slot with the same timing), the on-screen text (local OCR) and keeps the sound. Using a template
 * fills the slots with your media, in order, and builds an ordinary project. Everything here is pure so the main
 * process, the agents and the tests share it.
 */

export const TEMPLATE_SCHEMA = 1

export const TemplateSlot = z.object({
  id: Id,
  startUs: Us.min(0),
  durationUs: PositiveUs,
  /** A still of the original shot (file in the template folder), shown in the fill dialog. */
  thumb: z.string().nullable().default(null),
})
export type TemplateSlot = z.infer<typeof TemplateSlot>

/** On-screen text found in the original, as a text clip: centred at (canvas centre + x, style.y × height). */
export const TemplateText = z.object({
  id: Id,
  startUs: Us.min(0),
  durationUs: PositiveUs,
  text: z.string().min(1).max(2000),
  x: z.number(),
  style: TextStyle,
})
export type TemplateText = z.infer<typeof TemplateText>

export const Template = z.object({
  schema: z.literal(TEMPLATE_SCHEMA),
  id: Id,
  name: z.string().min(1).max(200),
  createdAt: z.number(),
  source: z.object({
    kind: z.enum(['file', 'link']),
    url: z.string().max(2000).optional(),
    title: z.string().max(500).optional(),
    fileName: z.string().max(500).optional(),
  }),
  canvas: z.object({ width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), fps: Fps }),
  durationUs: PositiveUs,
  slots: z.array(TemplateSlot).min(1).max(500),
  texts: z.array(TemplateText).max(1000).default([]),
  /** The original sound, extracted (file in the template folder). */
  sound: z.object({ file: z.string(), durationUs: PositiveUs }).nullable().default(null),
  /** The original video, kept so the fill dialog can play it next to your clips. */
  reference: z.string().nullable().default(null),
  cover: z.string().nullable().default(null),
  /** Things the analysis could not do (no local AI for text, no sound…), shown to the user. */
  warnings: z.array(z.string()).default([]),
})
export type Template = z.infer<typeof Template>

/* ───────────────────────── cut detection ───────────────────────── */

/** Size of the analysis frames (RGB24): small enough to be fast, big enough to see a cut. */
export const CUT_FRAME_W = 64
export const CUT_FRAME_H = 36
export const CUT_FRAME_BYTES = CUT_FRAME_W * CUT_FRAME_H * 3

/**
 * How different two analysis frames are, 0…1: mean pixel difference blended with a colour-histogram distance (the
 * histogram tells a cut between look-alike framings from motion, the pixels tell a cut between look-alike colours).
 */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let sum = 0
  const ha = new Float64Array(48)
  const hb = new Float64Array(48)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    sum += Math.abs(x - y)
    const ch = (i % 3) * 16
    ha[ch + (x >> 4)]!++
    hb[ch + (y >> 4)]!++
  }
  let hist = 0
  for (let i = 0; i < 48; i++) hist += Math.abs(ha[i]! - hb[i]!)
  const pixels = n / 3
  return 0.6 * (sum / n / 255) + 0.4 * (hist / (2 * 3 * pixels))
}

export interface CutOptions {
  /** A cut must be at least this different from the previous frame (0…1). */
  minScore?: number
  /** …and this many times above the local typical change (motion). */
  contrast?: number
  /** Shots shorter than this merge into a neighbour (flash frames, glitches). Seconds. */
  minShot?: number
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((p, q) => p - q)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Frame indexes where a new shot starts. scores[i] is the difference between frame i−1 and frame i (scores[0] unused),
 * sampled at `fps`. A cut is a spike: well above the change around it (so fast motion and handheld shake don't count),
 * above an absolute floor, and the biggest within the minimum shot length.
 */
export function detectCuts(scores: ArrayLike<number>, fps: number, opts: CutOptions = {}): number[] {
  const minScore = opts.minScore ?? 0.1
  const contrast = opts.contrast ?? 3
  const minGap = Math.max(1, Math.round((opts.minShot ?? 0.2) * fps))
  const w = Math.max(2, Math.round(fps * 0.5))
  const n = scores.length
  const out: number[] = []
  for (let i = 1; i < n; i++) {
    const s = scores[i]!
    if (s < minScore) continue
    const around: number[] = []
    for (let j = Math.max(1, i - w); j <= Math.min(n - 1, i + w); j++) if (Math.abs(j - i) > 1) around.push(scores[j]!)
    const base = median(around)
    if (s < base * contrast + 0.02) continue
    // the local peak only (a cut over two frames, a flash)
    let peak = true
    for (let j = Math.max(1, i - minGap + 1); j <= Math.min(n - 1, i + minGap - 1); j++) if (j !== i && (scores[j]! > s || (scores[j] === s && j < i))) peak = false
    if (!peak) continue
    if (i < minGap || n - i < minGap) continue // a "shot" of a few frames at either end
    if (out.length && i - out[out.length - 1]! < minGap) continue
    out.push(i)
  }
  return out
}

/** Snap a time to the canvas frame grid (µs). */
export function snapToFrame(us: number, fps: FpsT): number {
  const frame = (1e6 * fps.den) / fps.num
  return Math.round(Math.round(us / frame) * frame)
}

/** Slots from cut times (µs, ascending): [0, c1), [c1, c2) … [cn, duration). */
export function slotsFromCuts(cutsUs: number[], durationUs: number, fps: FpsT): TemplateSlot[] {
  const bounds = [0, ...cutsUs.map((c) => snapToFrame(c, fps)).filter((c) => c > 0 && c < durationUs), durationUs]
  const uniq = bounds.filter((b, i) => i === 0 || b > bounds[i - 1]!)
  const slots: TemplateSlot[] = []
  for (let i = 0; i < uniq.length - 1; i++) slots.push({ id: `slot-${String(i + 1).padStart(3, '0')}`, startUs: uniq[i]!, durationUs: uniq[i + 1]! - uniq[i]!, thumb: null })
  return slots
}

/* ───────────────────────── on-screen text ───────────────────────── */

export interface OcrItem { text: string; score: number; box: [number, number, number, number]; color: string; background: string | null }
export interface OcrSample { t: number; items: OcrItem[] }

interface Block { text: string; box: [number, number, number, number]; lineH: number; lines: number; align: 'left' | 'center' | 'right'; color: string; background: string | null; score: number }

/** Words that are platform chrome, not part of the edit (watermarks, handles). */
const CHROME = /^(@[\w.]{2,}|tiktok|instagram|reels?|capcut|template)$/i

/** Lines of one text block: stacked, overlapping horizontally, similar size. */
export function groupLines(items: OcrItem[]): Block[] {
  const lines = items
    .filter((it) => it.text.trim().length > 0 && !CHROME.test(it.text.trim()) && /[\p{L}\p{N}]/u.test(it.text))
    .slice()
    .sort((a, b) => a.box[1] - b.box[1])
  const blocks: { items: OcrItem[] }[] = []
  for (const it of lines) {
    const h = it.box[3] - it.box[1]
    const into = blocks.find((b) => {
      const last = b.items[b.items.length - 1]!
      const lh = last.box[3] - last.box[1]
      const gap = it.box[1] - last.box[3]
      const overlap = Math.min(it.box[2], last.box[2]) - Math.max(it.box[0], last.box[0])
      const narrow = Math.min(it.box[2] - it.box[0], last.box[2] - last.box[0])
      return gap < 0.7 * Math.max(h, lh) && gap > -0.5 * Math.min(h, lh) && overlap > 0.3 * narrow && Math.max(h, lh) / Math.max(1e-6, Math.min(h, lh)) < 1.6
    })
    if (into) into.items.push(it)
    else blocks.push({ items: [it] })
  }
  return blocks.map(({ items: ls }) => {
    const box: [number, number, number, number] = [Math.min(...ls.map((l) => l.box[0])), Math.min(...ls.map((l) => l.box[1])), Math.max(...ls.map((l) => l.box[2])), Math.max(...ls.map((l) => l.box[3]))]
    const spread = (f: (l: OcrItem) => number) => { const v = ls.map(f); return Math.max(...v) - Math.min(...v) }
    const align = ls.length < 2 || spread((l) => (l.box[0] + l.box[2]) / 2) <= spread((l) => l.box[0]) + 0.01 ? 'center' : spread((l) => l.box[0]) < spread((l) => l.box[2]) ? 'left' : 'right'
    return {
      text: ls.map((l) => l.text.trim()).join('\n'),
      box,
      lineH: ls.reduce((s, l) => s + (l.box[3] - l.box[1]), 0) / ls.length,
      lines: ls.length,
      align,
      color: ls[0]!.color,
      background: ls[0]!.background,
      score: ls.reduce((s, l) => s + l.score, 0) / ls.length,
    }
  })
}

/** 0…1 similarity of two strings (1 = same), case and spacing ignored. */
export function textSimilarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/\s+/g, ' ').trim()
  const y = b.toLowerCase().replace(/\s+/g, ' ').trim()
  if (x === y) return 1
  if (!x.length || !y.length) return 0
  const prev = new Array<number>(y.length + 1)
  for (let j = 0; j <= y.length; j++) prev[j] = j
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length)
}

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!))
  const iy = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!))
  const inter = ix * iy
  const union = (a[2]! - a[0]!) * (a[3]! - a[1]!) + (b[2]! - b[0]!) * (b[3]! - b[1]!) - inter
  return union > 0 ? inter / union : 0
}

const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  if (!m) return 1
  return (0.299 * parseInt(m[1]!, 16) + 0.587 * parseInt(m[2]!, 16) + 0.114 * parseInt(m[3]!, 16)) / 255
}

/** A text style that looks like the block on a canvas of this size. */
export function styleForBlock(b: Pick<Block, 'box' | 'lineH' | 'lines' | 'align' | 'color' | 'background'>, canvas: { width: number; height: number }): { style: TextStyleT; x: number } {
  const H = canvas.height
  const W = canvas.width
  const fontSize = Math.max(8, Math.min(400, Math.round(b.lineH * H * 0.92)))
  const blockH = (b.box[3] - b.box[1]) * H
  const lineHeight = b.lines > 1 ? Math.max(0.9, Math.min(2, blockH / b.lines / fontSize)) : 1.18
  const light = luminance(b.color) > 0.5
  const style = TextStyle.parse({
    fontFamily: 'Montserrat Variable',
    fontWeight: 700,
    fontSize,
    color: b.color,
    background: b.background,
    backgroundRadius: 0.25,
    strokeWidth: 0,
    strokeColor: light ? '#000000' : '#ffffff',
    shadow: !b.background && light ? { color: '#000000', blur: 10, x: 0, y: 2 } : null,
    lineHeight,
    align: b.align,
    y: Math.max(0, Math.min(1, (b.box[1] + b.box[3]) / 2)),
    maxWidth: Math.max(0.2, Math.min(0.98, (b.box[2] - b.box[0]) * 1.3)),
    highlightColor: null,
  })
  return { style, x: Math.round(((b.box[0] + b.box[2]) / 2 - 0.5) * W) }
}

/**
 * OCR samples (taken every `intervalS` seconds) → text clips. A block that stays in roughly the same place with the
 * same words across samples is one clip; its ends snap to a nearby cut (text usually changes on the cut). Text that
 * grows (typewriter) stays one clip with its longest wording. Lone low-confidence reads are dropped.
 */
export function textsFromOcr(samples: OcrSample[], intervalS: number, canvas: { width: number; height: number }, cutsUs: number[], durationUs: number): TemplateText[] {
  interface Track { blocks: Block[]; first: number; last: number; open: boolean }
  const tracks: Track[] = []
  const sorted = samples.slice().sort((a, b) => a.t - b.t)
  for (const s of sorted) {
    const blocks = groupLines(s.items)
    const used = new Set<Track>()
    for (const b of blocks) {
      const match = tracks.find((tr) => {
        if (!tr.open || used.has(tr)) return false
        const last = tr.blocks[tr.blocks.length - 1]!
        if (iou(last.box, b.box) < 0.25 && !(iou(last.box, b.box) > 0.05 && (b.text.startsWith(last.text) || last.text.startsWith(b.text)))) return false
        const sim = textSimilarity(last.text, b.text)
        const grows = b.text.replace(/\s+/g, ' ').startsWith(last.text.replace(/\s+/g, ' ')) || last.text.replace(/\s+/g, ' ').startsWith(b.text.replace(/\s+/g, ' '))
        return sim >= 0.6 || grows
      })
      if (match) { match.blocks.push(b); match.last = s.t; used.add(match) }
      else { const tr = { blocks: [b], first: s.t, last: s.t, open: true }; tracks.push(tr); used.add(tr) }
    }
    for (const tr of tracks) if (!used.has(tr)) tr.open = false
  }
  const half = intervalS / 2
  const snap = (us: number) => {
    let best = us
    let d = intervalS * 0.75 * 1e6
    for (const c of [0, ...cutsUs, durationUs]) if (Math.abs(c - us) <= d) { d = Math.abs(c - us); best = c }
    return best
  }
  const out: TemplateText[] = []
  for (const tr of tracks) {
    const conf = tr.blocks.reduce((s, b) => s + b.score, 0) / tr.blocks.length
    if (tr.blocks.length === 1 && conf < 0.8) continue
    // the most common wording; ties go to the longer one (typewriter text ends complete)
    const counts = new Map<string, number>()
    for (const b of tr.blocks) counts.set(b.text, (counts.get(b.text) ?? 0) + 1)
    const text = [...counts.entries()].sort((p, q) => q[1] - p[1] || q[0].length - p[0].length)[0]![0]
    const best = tr.blocks.filter((b) => b.text === text).sort((p, q) => q.score - p.score)[0]!
    // the look is voted on across every read: one frame over a busy picture can get the colour wrong
    const bgs = tr.blocks.map((b) => b.background)
    const boxed = bgs.filter(Boolean).length > bgs.length / 2
    const rep = { ...best, color: consensusColor(tr.blocks.map((b) => b.color)), background: boxed ? consensusColor(bgs.filter((x): x is string => !!x)) : null }
    const start = snap(Math.max(0, Math.round((tr.first - half) * 1e6)))
    const end = snap(Math.min(durationUs, Math.round((tr.last + half) * 1e6)))
    if (end - start < 100_000) continue
    const { style, x } = styleForBlock(rep, canvas)
    out.push({ id: `text-${String(out.length + 1).padStart(3, '0')}`, startUs: start, durationUs: end - start, text, x, style })
  }
  return out.sort((a, b) => a.startUs - b.startUs).map((t, i) => ({ ...t, id: `text-${String(i + 1).padStart(3, '0')}` }))
}

const rgbOf = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex)
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [255, 255, 255]
}

/** The colour most of the reads agree on: the one with the most others close to it (ties: the first). */
export function consensusColor(colors: string[]): string {
  if (!colors.length) return '#ffffff'
  const rgb = colors.map(rgbOf)
  let best = 0
  let bestN = -1
  rgb.forEach((c, i) => {
    const n = rgb.filter((d) => Math.hypot(c[0]! - d[0]!, c[1]! - d[1]!, c[2]! - d[2]!) < 60).length
    if (n > bestN) { best = i; bestN = n }
  })
  return colors[best]!
}

/** Evenly spaced OCR sample times for a video (seconds): about every half second, fewer for long videos. */
export function ocrSampleTimes(durationUs: number): { times: number[]; intervalS: number } {
  const dur = durationUs / 1e6
  const intervalS = Math.max(0.5, Math.min(2, dur / 240))
  const times: number[] = []
  for (let t = Math.min(0.1, dur / 2); t < dur; t += intervalS) times.push(Math.round(t * 1000) / 1000)
  return { times, intervalS }
}

/* ───────────────────────── filling a template ───────────────────────── */

/** Media for the slots: what the planner needs to know about each. */
export type FillMedia = Pick<AssetRef, 'id' | 'kind' | 'durationUs' | 'width' | 'height' | 'hasAudio'>

export interface SlotFill {
  slotId: string
  assetId: string
  inUs: number
  speed: number
  /** The media is shorter than the slot even slowed down: hold a frame instead. */
  freezeAtUs?: number
}

/**
 * Which media goes in which slot, and from where. `picked[i]` is the user's choice for slot i (an asset id) or null;
 * empty slots take the next media from `pool` in order, round and round. A clip used again continues from where it
 * left off; one too short for its slot is slowed down to fit (down to 0.25×), then held on a frame.
 */
export function planFill(slots: TemplateSlot[], media: FillMedia[], pool: string[], picked: (string | null)[] = []): SlotFill[] {
  const byId = new Map(media.map((m) => [m.id, m]))
  const usable = pool.filter((id) => byId.get(id) && byId.get(id)!.kind !== 'audio')
  const cursor = new Map<string, number>()
  let next = 0
  const out: SlotFill[] = []
  slots.forEach((slot, i) => {
    let id = picked[i] ?? null
    if (!id || !byId.get(id) || byId.get(id)!.kind === 'audio') {
      if (!usable.length) return
      id = usable[next % usable.length]!
      next++
    }
    const m = byId.get(id)!
    if (m.kind === 'image' || !m.durationUs) { out.push({ slotId: slot.id, assetId: id, inUs: 0, speed: 1 }); return }
    const need = slot.durationUs
    const len = m.durationUs
    let at = cursor.get(id) ?? 0
    if (len >= need) {
      if (at + need > len) at = 0
      cursor.set(id, at + need)
      out.push({ slotId: slot.id, assetId: id, inUs: at, speed: 1 })
      return
    }
    const speed = Math.floor((len / need) * 1000) / 1000
    if (speed >= 0.25) out.push({ slotId: slot.id, assetId: id, inUs: 0, speed })
    else out.push({ slotId: slot.id, assetId: id, inUs: 0, speed: 1, freezeAtUs: Math.floor(len / 2) })
  })
  return out
}

/** Scale (in the compositor's "contain" units) that makes a picture cover the canvas. */
export function coverScale(src: { width?: number; height?: number }, canvas: { width: number; height: number }): number {
  if (!src.width || !src.height) return 1
  const fit = Math.min(canvas.width / src.width, canvas.height / src.height)
  return Math.max(canvas.width / src.width, canvas.height / src.height) / fit
}

export type TemplateSound = 'template' | 'clips' | 'both'

export interface TemplateBuild {
  template: Pick<Template, 'canvas' | 'slots' | 'texts' | 'durationUs'>
  fills: SlotFill[]
  /** Every asset the fills use (already imported into the project), plus the template sound if any. */
  assets: AssetRef[]
  soundAssetId?: string | null
  sound: TemplateSound
  keepText: boolean
}

/** The ops that turn an empty project into the filled template. */
export function templateOps(b: TemplateBuild): OpInput[] {
  const { template: t } = b
  const ops: OpInput[] = [{ type: 'set_canvas', canvas: { width: t.canvas.width, height: t.canvas.height, fps: t.canvas.fps, background: { kind: 'color', color: '#000000' } } }]
  const assets = new Map(b.assets.map((a) => [a.id, a]))
  const used = new Set([...b.fills.map((f) => f.assetId), ...(b.soundAssetId ? [b.soundAssetId] : [])])
  for (const id of used) { const a = assets.get(id); if (a) ops.push({ type: 'add_asset', asset: a }) }
  const slots = new Map(t.slots.map((s) => [s.id, s]))
  const soundAsset = b.soundAssetId ? assets.get(b.soundAssetId) : undefined
  const withTemplateSound = !!soundAsset && b.sound !== 'clips'
  for (const f of b.fills) {
    const slot = slots.get(f.slotId)
    const a = assets.get(f.assetId)
    if (!slot || !a) continue
    ops.push({
      type: 'add_clip', trackId: 'track-main',
      clip: {
        id: `clip-${slot.id}`, kind: a.kind === 'image' ? 'image' : 'video', assetId: a.id, startUs: slot.startUs, durationUs: slot.durationUs,
        inUs: f.inUs, speed: f.speed, ...(f.freezeAtUs !== undefined ? { freezeAtUs: f.freezeAtUs } : {}),
        transform: { scale: coverScale(a, t.canvas) },
        ...(withTemplateSound && b.sound === 'template' ? { audioEnabled: false } : {}),
        ...(b.sound === 'both' ? { volumeDb: -12 } : {}),
      },
    })
  }
  if (withTemplateSound && soundAsset) {
    ops.push({ type: 'add_track', track: { id: 'track-template-sound', kind: 'audio', name: 'Template sound', clips: [] } })
    const len = Math.min(t.durationUs, soundAsset.durationUs ?? t.durationUs)
    if (len > 0) ops.push({ type: 'add_clip', trackId: 'track-template-sound', clip: { id: 'clip-template-sound', kind: 'audio', assetId: soundAsset.id, startUs: 0, durationUs: len } })
  }
  if (b.keepText && t.texts.length) {
    // text that is on screen at the same time goes on separate tracks (a track's clips can't overlap)
    const lanes = textLanes(t.texts)
    const count = Math.max(...lanes) + 1
    for (let l = 0; l < count; l++) ops.push({ type: 'add_track', track: { id: `track-template-text-${l + 1}`, kind: 'text', name: count > 1 ? `Template text ${l + 1}` : 'Template text', clips: [] } })
    t.texts.forEach((tx, i) => {
      ops.push({ type: 'add_clip', trackId: `track-template-text-${lanes[i]! + 1}`, clip: { id: `clip-${tx.id}`, kind: 'text', startUs: tx.startUs, durationUs: tx.durationUs, text: tx.text, style: tx.style, transform: { x: tx.x } } })
    })
  }
  return ops
}

/** Lane (track index) per text so no two texts on a lane overlap in time: first lane that is free, in start order. */
export function textLanes(texts: Pick<TemplateText, 'startUs' | 'durationUs'>[]): number[] {
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.startUs - texts[b]!.startUs)
  const ends: number[] = []
  const lanes = new Array<number>(texts.length).fill(0)
  for (const i of order) {
    const tx = texts[i]!
    let lane = ends.findIndex((e) => e <= tx.startUs)
    if (lane < 0) { lane = ends.length; ends.push(0) }
    ends[lane] = tx.startUs + tx.durationUs
    lanes[i] = lane
  }
  return lanes
}
