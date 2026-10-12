import { describe, expect, it } from 'vitest'
import {
  applyOps, cropCanvasOps, emptyProject, findClip, flipCanvasOps, OpError, PHOTO_DURATION_US, Project as ProjectSchema, resizeCanvasOps, rotateCanvasOps,
  type MediaClip, type Project, type ShapeClip, type TextClip,
} from '../src'

/** A 2000×1000 photo: the image fills it; a text layer near the top; a shape right of centre. */
function photo(): Project {
  return applyOps(emptyProject('p', 'Photo', { width: 2000, height: 1000 }, 'photo'), [
    { type: 'add_asset', asset: { id: 'img', kind: 'image', path: 'a.png', name: 'a.png', width: 2000, height: 1000, hasVideo: true, hasAudio: false } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'i', kind: 'image', assetId: 'img', startUs: 0, durationUs: PHOTO_DURATION_US } },
    { type: 'add_track', track: { id: 't', kind: 'text', name: 'Text', clips: [] } },
    { type: 'add_clip', trackId: 't', clip: { id: 'tx', kind: 'text', text: 'Hi', startUs: 0, durationUs: PHOTO_DURATION_US, style: { y: 0.2 } } },
    { type: 'add_track', track: { id: 's', kind: 'text', name: 'Shape', clips: [] } },
    { type: 'add_clip', trackId: 's', clip: { id: 'sh', kind: 'shape', shape: 'ellipse', startUs: 0, durationUs: PHOTO_DURATION_US, transform: { x: 300, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, crop: { left: 0, top: 0, right: 0, bottom: 0 } } } },
  ]).doc
}
const get = <T>(d: Project, id: string) => findClip(d, id)!.clip as T

describe('photo documents', () => {
  it('know they are photos; old files are videos', () => {
    expect(photo().kind).toBe('photo')
    const old = JSON.parse(JSON.stringify(photo())) as Record<string, unknown>
    delete old.kind
    expect(ProjectSchema.parse(old).kind).toBe('video')
  })

  it('shapes: defaults, set_shape patches, they go on text tracks, have no volume', () => {
    let d = photo()
    expect(get<ShapeClip>(d, 'sh')).toMatchObject({ shape: 'ellipse', width: 400, fill: '#ff7a3d', strokeWidth: 0 })
    d = applyOps(d, [{ type: 'set_shape', clipId: 'sh', shape: { fill: null, strokeWidth: 8, stroke: '#00000080' } }]).doc
    expect(get<ShapeClip>(d, 'sh')).toMatchObject({ shape: 'ellipse', fill: null, strokeWidth: 8, stroke: '#00000080', width: 400 })
    expect(() => applyOps(d, [{ type: 'set_shape', clipId: 'sh', shape: { fill: 'orange' } }])).toThrow()
    expect(() => applyOps(d, [{ type: 'set_keyframe', clipId: 'sh', prop: 'volumeDb', tUs: 0, value: -6 }])).toThrow(OpError)
    d = applyOps(d, [{ type: 'set_clip_props', clipId: 'sh', transform: { rotation: 30 } }]).doc
    expect(get<ShapeClip>(d, 'sh').transform).toMatchObject({ x: 300, rotation: 30 })
  })

  it('move_track reorders layers; undo puts them back', () => {
    const before = photo()
    const { doc, inverse } = applyOps(before, [{ type: 'move_track', trackId: 's', index: 0 }])
    expect(doc.tracks.map((t) => t.id)).toEqual(['s', 'track-main', 't'])
    expect(applyOps(doc, inverse).doc.tracks.map((t) => t.id)).toEqual(['track-main', 't', 's'])
  })
})

describe('canvas operations', () => {
  it('crop keeps every layer where it was in the picture', () => {
    // keep the right half
    const d = applyOps(photo(), cropCanvasOps(photo(), { x: 1000, y: 0, width: 1000, height: 1000 })).doc
    expect(d.canvas).toMatchObject({ width: 1000, height: 1000 })
    const img = get<MediaClip>(d, 'i')
    // the image keeps its pixel size (fit halves → scale doubles) and its centre moves left by 500
    expect(img.transform.scale).toBeCloseTo(2)
    expect(img.transform.x).toBe(-500)
    // the shape was 300 px right of the old centre (1300 px) → 300 px from the new left edge = −200 from the new centre
    expect(get<ShapeClip>(d, 'sh').transform.x).toBe(-200)
    // text anchored at 20 % of 1000 px = 200 px down stays at 200 px down
    const tx = get<TextClip>(d, 'tx')
    expect(1000 * tx.style.y + tx.transform.y).toBeCloseTo(200)
    expect(tx.transform.x).toBe(-500)
  })

  it('resize scales the whole picture', () => {
    const d = applyOps(photo(), resizeCanvasOps(photo(), 1000, 500)).doc
    expect(d.canvas).toMatchObject({ width: 1000, height: 500 })
    expect(get<MediaClip>(d, 'i').transform.scale).toBeCloseTo(1) // fit follows the canvas
    expect(get<ShapeClip>(d, 'sh').transform).toMatchObject({ x: 150, scale: 0.5 })
    const tx = get<TextClip>(d, 'tx')
    expect(tx.transform.scale).toBeCloseTo(0.5)
    expect(500 * tx.style.y + tx.transform.y).toBeCloseTo(100)
  })

  it('canvas size without scaling keeps layer pixel sizes', () => {
    const d = applyOps(photo(), resizeCanvasOps(photo(), 3000, 1000, false)).doc
    expect(get<MediaClip>(d, 'i').transform.scale).toBeCloseTo(1)
    expect(get<ShapeClip>(d, 'sh').transform).toMatchObject({ x: 300, scale: 1 })
  })

  it('rotate a quarter turn: canvas swaps, layers turn around the centre', () => {
    const d = applyOps(photo(), rotateCanvasOps(photo(), true)).doc
    expect(d.canvas).toMatchObject({ width: 1000, height: 2000 })
    const img = get<MediaClip>(d, 'i')
    expect(img.transform.rotation).toBe(90)
    expect(img.transform.scale).toBeCloseTo(2) // fit of 2000×1000 into 1000×2000 is 0.5: double to keep pixels
    // right of centre → below centre
    expect(get<ShapeClip>(d, 'sh').transform).toMatchObject({ x: 0, y: 300, rotation: 90 })
    const back = applyOps(d, rotateCanvasOps(d, false)).doc
    expect(back.canvas).toMatchObject({ width: 2000, height: 1000 })
    expect(get<ShapeClip>(back, 'sh').transform).toMatchObject({ x: 300, y: 0, rotation: 0 })
  })

  it('flip mirrors media and positions but never mirrors text', () => {
    const d = applyOps(photo(), flipCanvasOps(photo(), 'horizontal')).doc
    expect(get<MediaClip>(d, 'i').transform.flipH).toBe(true)
    expect(get<ShapeClip>(d, 'sh').transform.x).toBe(-300)
    expect(get<TextClip>(d, 'tx').transform.flipH).toBe(false)
    const v = applyOps(photo(), flipCanvasOps(photo(), 'vertical')).doc
    expect(get<MediaClip>(v, 'i').transform).toMatchObject({ flipH: true, rotation: 180 })
    expect(get<TextClip>(v, 'tx').transform.rotation).toBe(0)
  })
})
