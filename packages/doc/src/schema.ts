import { z } from 'zod'

/**
 * The project document. One JSON file per project (project.json); every change goes through an op (ops.ts).
 * Times are integer microseconds (µs). Clip times are timeline times unless a field says "source".
 */

export const Id = z.string().min(1).max(64)
export const Us = z.number().int()
export const PositiveUs = Us.min(1)

export const Fps = z.object({ num: z.number().int().positive(), den: z.number().int().positive() })
export type Fps = z.infer<typeof Fps>

export const Canvas = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: Fps,
  background: z.object({ kind: z.literal('color'), color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
})
export type Canvas = z.infer<typeof Canvas>

export const AssetRef = z.object({
  id: Id,
  kind: z.enum(['video', 'audio', 'image']),
  path: z.string().min(1),
  name: z.string(),
  durationUs: Us.min(0).optional(), // undefined for images (any length)
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: Fps.optional(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
})
export type AssetRef = z.infer<typeof AssetRef>

export const Transform = z.object({
  x: z.number().default(0), // px offset from canvas center
  y: z.number().default(0),
  scale: z.number().min(0).max(50).default(1),
  rotation: z.number().default(0), // degrees
  opacity: z.number().min(0).max(1).default(1),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
})
export type Transform = z.infer<typeof Transform>
export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false }

const ClipBase = {
  id: Id,
  startUs: Us.min(0),
  durationUs: PositiveUs,
  enabled: z.boolean().default(true),
}

/** Video, image or audio from a media asset. Source range = [inUs, inUs + durationUs * speed). */
export const MediaClip = z.object({
  ...ClipBase,
  kind: z.enum(['video', 'image', 'audio']),
  assetId: Id,
  inUs: Us.min(0).default(0),
  speed: z.number().min(0.1).max(100).default(1),
  transform: Transform.default(IDENTITY_TRANSFORM),
  volumeDb: z.number().min(-60).max(20).default(0),
})
export type MediaClip = z.infer<typeof MediaClip>

export const Word = z.object({ text: z.string(), startUs: Us.min(0), endUs: Us.min(0) }) // relative to clip start
export type Word = z.infer<typeof Word>

/** One caption line. Words carry timings for karaoke highlighting; they are relative to the clip start. */
export const CaptionClip = z.object({
  ...ClipBase,
  kind: z.literal('caption'),
  text: z.string().max(500),
  words: z.array(Word).default([]),
})
export type CaptionClip = z.infer<typeof CaptionClip>

export const TextStyle = z.object({
  fontFamily: z.string().default('Inter Variable'),
  fontSize: z.number().min(4).max(800).default(64), // px at canvas resolution
  fontWeight: z.number().int().min(100).max(1000).default(700),
  color: z.string().default('#ffffff'),
  strokeColor: z.string().default('#000000'),
  strokeWidth: z.number().min(0).max(50).default(6),
  background: z.string().nullable().default(null),
  align: z.enum(['left', 'center', 'right']).default('center'),
  /** Vertical anchor as a fraction of canvas height (0 = top, 1 = bottom). */
  y: z.number().min(0).max(1).default(0.82),
  maxWidth: z.number().min(0.1).max(1).default(0.86),
})
export type TextStyle = z.infer<typeof TextStyle>
export const DEFAULT_CAPTION_STYLE: TextStyle = TextStyle.parse({})

export const TextClip = z.object({
  ...ClipBase,
  kind: z.literal('text'),
  text: z.string().max(2000),
  style: TextStyle.default(DEFAULT_CAPTION_STYLE),
})
export type TextClip = z.infer<typeof TextClip>

export const Clip = z.discriminatedUnion('kind', [MediaClip, CaptionClip, TextClip])
export type Clip = z.infer<typeof Clip>

export const TrackKind = z.enum(['video', 'audio', 'text', 'caption'])
export type TrackKind = z.infer<typeof TrackKind>

export const Track = z.object({
  id: Id,
  kind: TrackKind,
  name: z.string(),
  /** The main video track: magnet keeps it gap-free. Exactly one video track may be main. */
  main: z.boolean().default(false),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  muted: z.boolean().default(false),
  /** Caption tracks share one style. */
  style: TextStyle.optional(),
  clips: z.array(Clip),
})
export type Track = z.infer<typeof Track>

export const Marker = z.object({ id: Id, atUs: Us.min(0), color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']), label: z.string().default('') })
export type Marker = z.infer<typeof Marker>

export const SCHEMA_VERSION = 1

export const Project = z.object({
  schema: z.literal(SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1).max(200),
  canvas: Canvas,
  assets: z.record(Id, AssetRef),
  /** Render order: index 0 is drawn first (bottom). The main track is usually index 0. */
  tracks: z.array(Track),
  markers: z.array(Marker).default([]),
  /** Bumped by every committed op batch. Agents and exports remember the version they started from. */
  version: z.number().int().min(0),
})
export type Project = z.infer<typeof Project>

export function emptyProject(id: string, name: string, canvas?: Partial<Canvas>): Project {
  return {
    schema: SCHEMA_VERSION,
    id,
    name,
    canvas: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, background: { kind: 'color', color: '#000000' }, ...canvas },
    assets: {},
    tracks: [{ id: 'track-main', kind: 'video', name: 'Main', main: true, locked: false, hidden: false, muted: false, clips: [] }],
    markers: [],
    version: 0,
  }
}
