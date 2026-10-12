import { describe, expect, it } from 'vitest'
import {
  applyOps, cameraPath, canvasForRatio, emptyProject, fillGaps, findClip, hasLook, reframeClip, reframeOps, simplify, valueAt,
  type MediaClip, type Project, type SubjectSample,
} from '../src'

const S = 1_000_000
function seed(): Project {
  return applyOps(emptyProject('p', 'T'), [
    { type: 'add_asset', asset: { id: 'a', kind: 'video', path: 'a.mp4', name: 'a.mp4', durationUs: 20 * S, width: 1920, height: 1080, hasVideo: true, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c', kind: 'video', assetId: 'a', startUs: 0, durationUs: 10 * S, inUs: 2 * S } },
  ]).doc
}
const media = (doc: Project) => findClip(doc, 'c')!.clip as MediaClip

describe('cutout (background removal)', () => {
  it('is off by default; set_look patches it from defaults; null turns it off', () => {
    expect(media(seed()).cutout).toBeNull()
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c', cutout: {} }]).doc
    expect(media(doc).cutout).toEqual({ invert: false, edge: 0.3 })
    expect(hasLook(media(doc))).toBe(true)
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c', cutout: { invert: true } }]).doc
    expect(media(doc).cutout).toEqual({ invert: true, edge: 0.3 })
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c', cutout: null }]).doc
    expect(media(doc).cutout).toBeNull()
  })
})

describe('reframe maths', () => {
  it('new canvas keeps the short side', () => {
    expect(canvasForRatio({ width: 1920, height: 1080 }, '9:16')).toEqual({ width: 1080, height: 1920 })
    expect(canvasForRatio({ width: 1920, height: 1080 }, '1:1')).toEqual({ width: 1080, height: 1080 })
    expect(canvasForRatio({ width: 1920, height: 1080 }, '4:5')).toEqual({ width: 1080, height: 1350 })
    expect(canvasForRatio({ width: 1080, height: 1920 }, '16:9')).toEqual({ width: 1920, height: 1080 })
  })

  it('fills gaps with the nearest known value, or the fallback', () => {
    expect(fillGaps([null, 0.3, null, 0.6, null])).toEqual([0.3, 0.3, 0.3, 0.6, 0.6])
    expect(fillGaps([null, null], 0.5)).toEqual([0.5, 0.5])
  })

  it('the camera ignores jitter inside the dead zone and follows real moves without lag', () => {
    const jitter = [0, 3, -2, 4, -3, 2, 0]
    expect(new Set(cameraPath(jitter, 10).map((v) => Math.round(v))).size).toBe(1)
    const move = [0, 0, 0, 100, 100, 100, 100, 100]
    const p = cameraPath(move, 10)
    expect(p[p.length - 1]).toBeGreaterThan(80)
    expect(p[0]).toBeLessThan(20)
    // zero-phase: the camera starts easing before the step (no lag) and hasn't finished right at it
    expect(p[2]!).toBeGreaterThan(10)
    expect(p[3]!).toBeLessThan(85)
  })

  it('simplify keeps corners and drops points on straight lines', () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ t: i, v: i * 10 }))
    expect(simplify(line, 1)).toEqual([{ t: 0, v: 0 }, { t: 10, v: 100 }])
    const corner = [...line, ...Array.from({ length: 10 }, (_, i) => ({ t: 11 + i, v: 100 }))]
    expect(simplify(corner, 1).map((p) => p.t)).toEqual([0, 10, 20])
  })

  it('a landscape clip in a 9:16 frame covers it and follows a subject walking right', () => {
    const c = media(seed())
    const samples: SubjectSample[] = Array.from({ length: 51 }, (_, i) => ({ t: 2 + i * 0.2, x: 0.3 + (0.4 * i) / 50, y: 0.4, area: 0.1 }))
    const r = reframeClip(c, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, samples, 'subject')
    // contain fit is 1080/1920 wide; covering a 1920-high frame needs 1920/1080 ÷ that
    expect(r.scale).toBeCloseTo((1920 / 1080) / (1080 / 1920), 3)
    expect(r.yKeys).toEqual([]) // the picture is exactly the frame's height: nothing to pan
    expect(r.xKeys.length).toBeGreaterThanOrEqual(2)
    const first = r.xKeys[0]!
    const last = r.xKeys[r.xKeys.length - 1]!
    expect(first.tUs).toBe(0)
    expect(last.tUs).toBe(10 * S)
    // subject on the left → picture moves right (positive x); then left as they walk right
    expect(first.value).toBeGreaterThan(0)
    expect(last.value).toBeLessThan(0)
    // never uncovers the frame: |x| ≤ (picture width − frame width) / 2
    const picW = 1920 * (1080 / 1920) * r.scale
    for (const k of r.xKeys) expect(Math.abs(k.value)).toBeLessThanOrEqual((picW - 1080) / 2 + 0.5)
  })

  it('centres when nobody is found or follow is "center"', () => {
    const c = media(seed())
    const none = [{ t: 3, x: null, y: null, area: 0 }, { t: 4, x: null, y: null, area: 0 }]
    expect(reframeClip(c, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, none, 'subject')).toMatchObject({ x: 0, y: 0, xKeys: [], yKeys: [] })
    const someone = [{ t: 3, x: 0.9, y: 0.4, area: 0.2 }]
    expect(reframeClip(c, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, someone, 'center')).toMatchObject({ x: 0, xKeys: [] })
  })

  it('a subject standing still gives a static offset, not keyframes', () => {
    const c = media(seed())
    const still = Array.from({ length: 20 }, (_, i) => ({ t: 2 + i * 0.5, x: 0.7 + (i % 2) * 0.005, y: 0.4, area: 0.1 }))
    const r = reframeClip(c, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, still, 'subject')
    expect(r.xKeys).toEqual([])
    expect(r.x).toBeLessThan(0)
  })

  it('reframeOps apply cleanly and the clip shows the path', () => {
    let doc = applyOps(seed(), [{ type: 'set_canvas', canvas: { width: 1080, height: 1920 } }]).doc
    const samples = Array.from({ length: 51 }, (_, i) => ({ t: 2 + i * 0.2, x: 0.3 + (0.4 * i) / 50, y: 0.4, area: 0.1 }))
    doc = applyOps(doc, reframeOps(doc, 'c', doc.canvas, samples, 'subject')).doc
    const c = media(doc)
    expect(c.transform.scale).toBeGreaterThan(3)
    expect(valueAt(c, 'x', 0)).toBeGreaterThan(0)
    expect(valueAt(c, 'x', 10 * S)).toBeLessThan(0)
  })
})
