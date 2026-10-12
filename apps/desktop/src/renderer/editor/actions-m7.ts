import {
  cropCanvasOps, DEFAULT_CAPTION_STYLE, flipCanvasOps, IDENTITY_TRANSFORM, NO_TEXT_ANIM, PHOTO_DURATION_US, resizeCanvasOps, rotateCanvasOps, TextStyle,
  type Clip, type OpInput, type Project, type ShapeKind, type Track,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { newId } from './actions'
import type { TextPreset } from './textPresets'

/**
 * M7 photo editor actions (S25). A photo is a project whose layers are tracks, each holding one clip at 0 that lasts
 * PHOTO_DURATION_US. Layers stack bottom (index 0) to top. Every action is one op batch, so one undo step.
 */

const st = () => useApp.getState()

/** The clip that is a layer's content. */
export const layerClip = (t: Track): Clip | undefined => t.clips[0]

export function layerName(doc: Project, t: Track): string {
  const c = layerClip(t)
  if (!c) return t.name
  if (c.kind === 'text' || c.kind === 'caption') return c.text.trim().split('\n')[0]!.slice(0, 40) || 'Text'
  if (c.kind === 'shape') return { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', star: 'Star', line: 'Line', arrow: 'Arrow' }[c.shape]
  return doc.assets[c.assetId]?.name ?? t.name
}

/** Put a clip on a new layer at the top and select it. */
async function addLayer(kind: 'video' | 'text', name: string, clip: Clip, extra: OpInput[] = []) {
  const { doc } = st()
  if (!doc) return null
  const trackId = newId('track-layer')
  const ok = await st().apply([
    ...extra,
    { type: 'add_track', track: { id: trackId, kind, name, main: false, locked: false, hidden: false, muted: false, clips: [] } },
    { type: 'add_clip', trackId, clip },
  ])
  if (ok) st().select([clip.id])
  return ok ? clip.id : null
}

export async function addImageLayers(paths?: string[]) {
  const { doc } = st()
  if (!doc) return 0
  const picked = paths ?? (await window.framevane.app.pickFiles({ kind: 'image' }))
  if (!picked.length) return 0
  const infos = (await window.framevane.media.import(doc.id, picked)).filter((m) => m.asset.kind === 'image' && m.status !== 'unsupported')
  useApp.setState((s) => ({ media: [...s.media.filter((m) => !infos.some((i) => i.asset.id === m.asset.id)), ...infos] }))
  for (const m of infos) {
    const fresh = !st().doc!.assets[m.asset.id]
    await addLayer('video', m.asset.name, { id: newId('clip'), kind: 'image', assetId: m.asset.id, startUs: 0, durationUs: PHOTO_DURATION_US } as Clip, fresh ? [{ type: 'add_asset', asset: m.asset }] : [])
  }
  return infos.length
}

export function addTextLayer(preset?: TextPreset, text?: string) {
  const style = TextStyle.parse({ ...DEFAULT_CAPTION_STYLE, y: 0.5, fontSize: Math.round((st().doc?.canvas.height ?? 1080) / 10), strokeWidth: 0, ...(preset?.style ?? {}) })
  return addLayer('text', 'Text', {
    id: newId('text'), kind: 'text', startUs: 0, durationUs: PHOTO_DURATION_US, enabled: true, text: text ?? preset?.sample ?? 'Add text', style,
    transform: IDENTITY_TRANSFORM, keyframes: {}, anim: NO_TEXT_ANIM,
  })
}

/** Emoji stickers are text layers drawn with the system's colour emoji font. */
export function addEmojiLayer(emoji: string) {
  const H = st().doc?.canvas.height ?? 1080
  const style = TextStyle.parse({ ...DEFAULT_CAPTION_STYLE, y: 0.5, fontFamily: 'Segoe UI Emoji', fontSize: Math.round(H / 5), strokeWidth: 0, fontWeight: 400 })
  return addLayer('text', 'Sticker', {
    id: newId('sticker'), kind: 'text', startUs: 0, durationUs: PHOTO_DURATION_US, enabled: true, text: emoji, style, transform: IDENTITY_TRANSFORM, keyframes: {}, anim: NO_TEXT_ANIM,
  })
}

export function addShapeLayer(shape: ShapeKind) {
  const { doc } = st()
  const side = Math.round(Math.min(doc?.canvas.width ?? 1080, doc?.canvas.height ?? 1080) / 3)
  const dims = shape === 'line' ? { width: side * 1.5, height: Math.max(8, side / 12) } : shape === 'arrow' ? { width: side * 1.4, height: side / 2 } : { width: side, height: side }
  return addLayer('text', 'Shape', {
    id: newId('shape'), kind: 'shape', shape, ...dims, fill: '#ff7a3d', stroke: '#ffffff', strokeWidth: 0, radius: shape === 'rect' ? 0.08 : 0,
    startUs: 0, durationUs: PHOTO_DURATION_US, enabled: true, transform: IDENTITY_TRANSFORM, keyframes: {},
  } as Clip)
}

/** Move a layer one step up (towards the top) or down. */
export function moveLayer(trackId: string, dir: 1 | -1) {
  const { doc } = st()
  const i = doc?.tracks.findIndex((t) => t.id === trackId) ?? -1
  if (!doc || i < 0) return
  const to = i + dir
  if (to < 0 || to >= doc.tracks.length) return
  return st().apply([{ type: 'move_track', trackId, index: to }])
}

export const setLayerFlags = (trackId: string, flags: { hidden?: boolean; locked?: boolean }) => st().apply([{ type: 'set_track_flags', trackId, ...flags }])
export const deleteLayer = (trackId: string) => st().apply([{ type: 'remove_track', trackId }])

/* ───────────── the whole picture ───────────── */

export const cropPhoto = (rect: { x: number; y: number; width: number; height: number }) => { const d = st().doc; return d ? st().apply(cropCanvasOps(d, rect)) : null }
export const resizePhoto = (w: number, h: number, scaleContent: boolean) => { const d = st().doc; return d ? st().apply(resizeCanvasOps(d, w, h, scaleContent)) : null }
export const rotatePhoto = (clockwise: boolean) => { const d = st().doc; return d ? st().apply(rotateCanvasOps(d, clockwise)) : null }
export const flipPhoto = (axis: 'horizontal' | 'vertical') => { const d = st().doc; return d ? st().apply(flipCanvasOps(d, axis)) : null }

/** Make a photo project from an image file and open it. */
export async function newPhotoFromFile() {
  const [path] = await window.framevane.app.pickFiles({ kind: 'image' })
  if (!path) return null
  const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') || 'Photo'
  const { projectId } = await window.framevane.projects.create({ name, kind: 'photo', files: [path] })
  st().go({ name: 'editor', projectId })
  return projectId
}
