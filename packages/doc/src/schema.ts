import { z } from 'zod'

/**
 * The project document. One JSON file per project (project.json); every change goes through an op (ops.ts).
 * Times are integer microseconds (µs). Clip times are timeline times unless a field says "source".
 */

export const Id = z.string().min(1).max(64)

/**
 * A "patch" of an object schema: every field optional and WITHOUT its default. (zod's .partial() keeps defaults, so a
 * patch like {y: 5} would come back as {x: 0, y: 5, scale: 1, …} and silently reset the other fields. BUG-010.)
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? (v.unwrap() as z.ZodTypeAny) : v]))
  return z.object(shape).partial()
}
export const Us = z.number().int()
export const PositiveUs = Us.min(1)

export const Fps = z.object({ num: z.number().int().positive(), den: z.number().int().positive() })
export type Fps = z.infer<typeof Fps>

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i)

/** What shows behind the media where it doesn't cover the canvas: a colour, or a blurred fill of the main video. */
export const Background = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: HexColor }),
  z.object({ kind: z.literal('blur'), amount: z.number().min(0).max(1).default(0.5) }),
])
export type Background = z.infer<typeof Background>

export const Canvas = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: Fps,
  background: Background,
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

/** Fractions of the source cut from each side (0 = nothing, 0.9 max). */
export const Crop = z.object({
  left: z.number().min(0).max(0.9).default(0),
  top: z.number().min(0).max(0.9).default(0),
  right: z.number().min(0).max(0.9).default(0),
  bottom: z.number().min(0).max(0.9).default(0),
})
export type Crop = z.infer<typeof Crop>
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

export const Transform = z.object({
  x: z.number().default(0), // px offset from canvas center
  y: z.number().default(0),
  scale: z.number().min(0).max(50).default(1),
  rotation: z.number().default(0), // degrees
  opacity: z.number().min(0).max(1).default(1),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  crop: Crop.default(NO_CROP),
})
export type Transform = z.infer<typeof Transform>
export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, crop: NO_CROP }

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const
export const BlendMode = z.enum(BLEND_MODES)
export type BlendMode = z.infer<typeof BlendMode>

/** Properties that can be keyframed, and where their static value lives. */
export const ANIM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volumeDb'] as const
export const AnimProp = z.enum(ANIM_PROPS)
export type AnimProp = z.infer<typeof AnimProp>
export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] as const
export const Easing = z.enum(EASINGS)
export type Easing = z.infer<typeof Easing>

/** A keyframe at a time relative to the clip start (timeline µs). Its easing shapes the segment that follows it. */
export const Keyframe = z.object({ tUs: Us.min(0), value: z.number(), easing: Easing.default('ease-in-out') })
export type Keyframe = z.infer<typeof Keyframe>
export const Keyframes = z.object({
  x: z.array(Keyframe).optional(),
  y: z.array(Keyframe).optional(),
  scale: z.array(Keyframe).optional(),
  rotation: z.array(Keyframe).optional(),
  opacity: z.array(Keyframe).optional(),
  volumeDb: z.array(Keyframe).optional(),
})
export type Keyframes = z.infer<typeof Keyframes>

/**
 * Basic colour (S18). Values are −100…100 with 0 = unchanged, except fade, sharpen, vignette and grain (0…100).
 */
export const ColorAdjust = z.object({
  exposure: z.number().min(-100).max(100).default(0),
  brightness: z.number().min(-100).max(100).default(0),
  contrast: z.number().min(-100).max(100).default(0),
  saturation: z.number().min(-100).max(100).default(0),
  vibrance: z.number().min(-100).max(100).default(0),
  temperature: z.number().min(-100).max(100).default(0),
  tint: z.number().min(-100).max(100).default(0),
  highlights: z.number().min(-100).max(100).default(0),
  shadows: z.number().min(-100).max(100).default(0),
  fade: z.number().min(0).max(100).default(0),
  sharpen: z.number().min(0).max(100).default(0),
  vignette: z.number().min(0).max(100).default(0),
  grain: z.number().min(0).max(100).default(0),
})
export type ColorAdjust = z.infer<typeof ColorAdjust>
export const NO_COLOR: ColorAdjust = ColorAdjust.parse({})

/** A filter (look) from the built-in catalogue (looks.ts), mixed with the original by intensity. */
export const FilterUse = z.object({ id: z.string().min(1).max(40), intensity: z.number().min(0).max(1).default(0.8) })
export type FilterUse = z.infer<typeof FilterUse>

/** A .cube LUT the project knows about; the file lives in the project's luts folder. */
export const LutRef = z.object({ id: Id, name: z.string().max(200), file: z.string().min(1).max(200) })
export type LutRef = z.infer<typeof LutRef>
export const LutUse = z.object({ id: Id, intensity: z.number().min(0).max(1).default(1) })
export type LutUse = z.infer<typeof LutUse>

/** Green/blue screen. intensity: how much colour around the key goes; edge: softness; shadow: keep darker areas; spill: remove the key colour's cast. */
export const ChromaKey = z.object({
  color: HexColor.default('#00ff00'),
  intensity: z.number().min(0).max(1).default(0.4),
  edge: z.number().min(0).max(1).default(0.2),
  shadow: z.number().min(0).max(1).default(0),
  spill: z.number().min(0).max(1).default(0.5),
})
export type ChromaKey = z.infer<typeof ChromaKey>

/** One effect on a clip (kinds and their params: looks.ts). Effects run in list order. */
export const Effect = z.object({ id: Id, kind: z.string().min(1).max(40), params: z.record(z.string().max(40), z.number()).default({}) })
export type Effect = z.infer<typeof Effect>

/** A transition from this clip into the clip that starts right where it ends (same track), centred on the cut. */
export const Transition = z.object({ kind: z.string().min(1).max(40), durationUs: z.number().int().min(100_000).max(5_000_000).default(500_000) })
export type Transition = z.infer<typeof Transition>

const ClipBase = {
  id: Id,
  startUs: Us.min(0),
  durationUs: PositiveUs,
  enabled: z.boolean().default(true),
  /** Clips that select and move together (Ctrl+G). */
  groupId: Id.optional(),
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
  blend: BlendMode.default('normal'),
  keyframes: Keyframes.default({}),
  /** A freeze frame: always shows this source time (µs) and plays no sound. */
  freezeAtUs: Us.min(0).optional(),
  /** False after "detach audio": the clip's own sound is off (a linked audio clip carries it). */
  audioEnabled: z.boolean().default(true),
  /** Video and its detached audio share a link id; with linkage on they move and cut together. */
  linkId: Id.optional(),
  /** The media is a reversed render of the original (label only; the asset itself is the reversed file). */
  reversed: z.boolean().default(false),
  /** Audio fade in / out lengths (timeline µs), on top of volume and its keyframes. */
  fadeInUs: Us.min(0).default(0),
  fadeOutUs: Us.min(0).default(0),
  /** Picture look, applied in this order: chroma key, filter, LUT, colour, effects. Ignored on audio clips. */
  chroma: ChromaKey.nullable().default(null),
  filter: FilterUse.nullable().default(null),
  lut: LutUse.nullable().default(null),
  color: ColorAdjust.default(NO_COLOR),
  effects: z.array(Effect).max(8).default([]),
  transition: Transition.nullable().default(null),
})
export type MediaClip = z.infer<typeof MediaClip>
/** The look fields of a clip with no look (for building audio clips from video ones). */
export const NO_LOOK = { chroma: null, filter: null, lut: null, color: NO_COLOR, effects: [], transition: null } satisfies Partial<MediaClip>

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

export const Shadow = z.object({ color: z.string().default('#000000'), blur: z.number().min(0).max(100).default(12), x: z.number().min(-100).max(100).default(0), y: z.number().min(-100).max(100).default(4) })
export type Shadow = z.infer<typeof Shadow>

export const TextStyle = z.object({
  fontFamily: z.string().default('Inter Variable'),
  fontSize: z.number().min(4).max(800).default(64), // px at canvas resolution
  fontWeight: z.number().int().min(100).max(1000).default(700),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: z.string().default('#ffffff'),
  strokeColor: z.string().default('#000000'),
  strokeWidth: z.number().min(0).max(50).default(6),
  /** A box behind each line (null = none). */
  background: z.string().nullable().default(null),
  /** Corner radius of the box, as a fraction of the font size. */
  backgroundRadius: z.number().min(0).max(1).default(0.2),
  shadow: Shadow.nullable().default(null),
  /** Extra space between letters, px. */
  letterSpacing: z.number().min(-50).max(200).default(0),
  /** Line height as a multiple of the font size. */
  lineHeight: z.number().min(0.6).max(4).default(1.18),
  align: z.enum(['left', 'center', 'right']).default('center'),
  /** Vertical anchor as a fraction of canvas height (0 = top, 1 = bottom). */
  y: z.number().min(0).max(1).default(0.82),
  maxWidth: z.number().min(0.1).max(1).default(0.86),
  /** Captions: colour of the word being spoken (karaoke); null turns the highlight off. */
  highlightColor: z.string().nullable().default('#ffd84d'),
  /** Captions: show one word at a time instead of the whole line. */
  wordByWord: z.boolean().default(false),
})
export type TextStyle = z.infer<typeof TextStyle>
export const DEFAULT_CAPTION_STYLE: TextStyle = TextStyle.parse({})

export const TEXT_ANIMS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'pop', 'zoom-out', 'typewriter', 'wipe'] as const
export const TextAnimKind = z.enum(TEXT_ANIMS)
export type TextAnimKind = z.infer<typeof TextAnimKind>
export const TextAnimPart = z.object({ kind: TextAnimKind.default('none'), durationUs: PositiveUs.default(500_000) })
export const TextAnim = z.object({ in: TextAnimPart.default({ kind: 'none', durationUs: 500_000 }), out: TextAnimPart.default({ kind: 'none', durationUs: 500_000 }) })
export type TextAnim = z.infer<typeof TextAnim>
export const NO_TEXT_ANIM: TextAnim = { in: { kind: 'none', durationUs: 500_000 }, out: { kind: 'none', durationUs: 500_000 } }

/**
 * A title or text overlay. The text block is anchored at (canvas centre x + transform.x, style.y × height + transform.y);
 * scale, rotation and opacity come from the transform and can be keyframed like media.
 */
export const TextClip = z.object({
  ...ClipBase,
  kind: z.literal('text'),
  text: z.string().max(2000),
  style: TextStyle.default(DEFAULT_CAPTION_STYLE),
  transform: Transform.default(IDENTITY_TRANSFORM),
  keyframes: Keyframes.default({}),
  anim: TextAnim.default(NO_TEXT_ANIM),
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
  /** .cube LUTs imported into this project. */
  luts: z.record(Id, LutRef).default({}),
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
    luts: {},
    version: 0,
  }
}
