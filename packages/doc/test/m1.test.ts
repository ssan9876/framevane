import { describe, expect, it } from 'vitest'
import { applyOps, emptyProject, findClip, OpError, resolveAt, sampleTrack, valueAt, type MediaClip, type OpInput, type Project } from '../src'

const S = 1_000_000
function seed(): Project {
  return applyOps(emptyProject('p', 'T'), [
    { type: 'add_asset', asset: { id: 'a', kind: 'video', path: 'a.mp4', name: 'a.mp4', durationUs: 20 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c', kind: 'video', assetId: 'a', startUs: 0, durationUs: 10 * S } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'd', kind: 'video', assetId: 'a', startUs: 10 * S, durationUs: 5 * S, inUs: 10 * S } },
  ]).doc
}
const clip = (doc: Project, id: string) => findClip(doc, id)!.clip as MediaClip
const undo = (doc: Project, inv: OpInput[]) => applyOps(doc, inv).doc

describe('keyframes', () => {
  it('interpolates with easing and holds outside the keys', () => {
    const k = [{ tUs: 0, value: 0, easing: 'linear' as const }, { tUs: 10, value: 100, easing: 'linear' as const }]
    expect(sampleTrack(k, -5)).toBe(0)
    expect(sampleTrack(k, 5)).toBe(50)
    expect(sampleTrack(k, 99)).toBe(100)
    expect(sampleTrack([{ tUs: 0, value: 0, easing: 'hold' }, { tUs: 10, value: 100, easing: 'linear' }], 9)).toBe(0)
    expect(sampleTrack([{ tUs: 0, value: 0, easing: 'ease-in' }, { tUs: 10, value: 100, easing: 'linear' }], 5)).toBeLessThan(50)
  })

  it('set / replace / remove keyframes', () => {
    let doc = seed()
    doc = applyOps(doc, [
      { type: 'set_keyframe', clipId: 'c', prop: 'scale', tUs: 0, value: 1, easing: 'linear' },
      { type: 'set_keyframe', clipId: 'c', prop: 'scale', tUs: 4 * S, value: 2 },
    ]).doc
    expect(valueAt(clip(doc, 'c'), 'scale', 2 * S)).toBeCloseTo(1.5)
    doc = applyOps(doc, [{ type: 'set_keyframe', clipId: 'c', prop: 'scale', tUs: 4 * S + 5000, value: 3 }]).doc // within half a frame → replaces
    expect(clip(doc, 'c').keyframes.scale).toHaveLength(2)
    expect(valueAt(clip(doc, 'c'), 'scale', 9 * S)).toBe(3)
    doc = applyOps(doc, [{ type: 'remove_keyframe', clipId: 'c', prop: 'scale', tUs: 4 * S }]).doc
    expect(clip(doc, 'c').keyframes.scale).toHaveLength(1)
  })

  it('a split keeps the animation continuous on both sides', () => {
    let doc = applyOps(seed(), [
      { type: 'set_keyframe', clipId: 'c', prop: 'x', tUs: 0, value: 0, easing: 'linear' },
      { type: 'set_keyframe', clipId: 'c', prop: 'x', tUs: 10 * S, value: 100, easing: 'linear' },
    ]).doc
    doc = applyOps(doc, [{ type: 'split_clip', clipId: 'c', atUs: 4 * S, newClipId: 'c2' }]).doc
    expect(valueAt(clip(doc, 'c'), 'x', 4 * S - 1)).toBeCloseTo(40, 0)
    expect(valueAt(clip(doc, 'c2'), 'x', 0)).toBeCloseTo(40, 3)
    expect(valueAt(clip(doc, 'c2'), 'x', 6 * S)).toBe(100)
  })

  it('a left trim keeps keyframes pinned to the picture', () => {
    let doc = applyOps(seed(), [{ type: 'set_keyframe', clipId: 'c', prop: 'opacity', tUs: 5 * S, value: 0.2 }]).doc
    doc = applyOps(doc, [{ type: 'set_clip_timing', clipId: 'c', inUs: 2 * S, durationUs: 8 * S, ripple: true }]).doc
    expect(clip(doc, 'c').keyframes.opacity!.some((k) => k.tUs === 3 * S && k.value === 0.2)).toBe(true)
  })

  it('a speed change stretches keyframe times', () => {
    let doc = applyOps(seed(), [{ type: 'set_keyframe', clipId: 'c', prop: 'rotation', tUs: 8 * S, value: 90 }]).doc
    doc = applyOps(doc, [{ type: 'set_clip_props', clipId: 'c', speed: 2 }]).doc
    expect(clip(doc, 'c').keyframes.rotation![0]!.tUs).toBe(4 * S)
  })

  it('clearing bakes the value at the playhead into the static property', () => {
    let doc = applyOps(seed(), [
      { type: 'set_keyframe', clipId: 'c', prop: 'scale', tUs: 0, value: 1, easing: 'linear' },
      { type: 'set_keyframe', clipId: 'c', prop: 'scale', tUs: 10 * S, value: 3, easing: 'linear' },
    ]).doc
    doc = applyOps(doc, [{ type: 'clear_keyframes', clipId: 'c', prop: 'scale', atUs: 5 * S }]).doc
    expect(clip(doc, 'c').keyframes.scale).toBeUndefined()
    expect(clip(doc, 'c').transform.scale).toBeCloseTo(2)
    expect(resolveAt(clip(doc, 'c'), 0).scale).toBeCloseTo(2)
  })

  it('refuses keyframes outside the clip', () => {
    expect(() => applyOps(seed(), [{ type: 'set_keyframe', clipId: 'c', prop: 'x', tUs: 11 * S, value: 1 }])).toThrow(OpError)
  })

  it('volume keyframes resolve too', () => {
    const doc = applyOps(seed(), [
      { type: 'set_keyframe', clipId: 'c', prop: 'volumeDb', tUs: 0, value: 0, easing: 'linear' },
      { type: 'set_keyframe', clipId: 'c', prop: 'volumeDb', tUs: 2 * S, value: -60, easing: 'linear' },
    ]).doc
    expect(resolveAt(clip(doc, 'c'), S).volumeDb).toBeCloseTo(-30)
  })
})

describe('M1 editing ops', () => {
  it('ripple insert pushes later clips right; undo restores', () => {
    const before = seed()
    const { doc, inverse } = applyOps(before, [{ type: 'add_clip', trackId: 'track-main', ripple: true, clip: { id: 'n', kind: 'video', assetId: 'a', startUs: 10 * S, durationUs: 2 * S } }])
    expect(clip(doc, 'd').startUs).toBe(12 * S)
    expect(undo(doc, inverse).tracks).toEqual(before.tracks)
  })

  it('freeze frames are not bound by the source length', () => {
    const doc = applyOps(seed(), [{ type: 'add_clip', trackId: 'track-main', ripple: true, clip: { id: 'f', kind: 'video', assetId: 'a', startUs: 10 * S, durationUs: 30 * S, freezeAtUs: 9 * S, audioEnabled: false } }]).doc
    expect(clip(doc, 'f').freezeAtUs).toBe(9 * S)
    expect(() => applyOps(seed(), [{ type: 'add_clip', trackId: 'track-main', clip: { id: 'f', kind: 'video', assetId: 'a', startUs: 20 * S, durationUs: S, freezeAtUs: 25 * S } }])).toThrow(/past the end/)
  })

  it('blend, crop, audio, link and group properties', () => {
    let doc = applyOps(seed(), [{ type: 'set_clip_props', clipId: 'c', blend: 'screen', audioEnabled: false, linkId: 'L1', groupId: 'G1', transform: { crop: { left: 0.1, top: 0, right: 0.2, bottom: 0 } } }]).doc
    expect(clip(doc, 'c')).toMatchObject({ blend: 'screen', audioEnabled: false, linkId: 'L1', groupId: 'G1' })
    expect(clip(doc, 'c').transform.crop.right).toBe(0.2)
    doc = applyOps(doc, [{ type: 'set_clip_props', clipId: 'c', linkId: null, groupId: null }]).doc
    expect(clip(doc, 'c').linkId).toBeUndefined()
    expect(clip(doc, 'c').groupId).toBeUndefined()
  })

  it('markers add/remove and undo', () => {
    const before = seed()
    const a = applyOps(before, [{ type: 'add_marker', marker: { id: 'm1', atUs: 3 * S, color: 'red', label: 'hook' } }])
    expect(a.doc.markers).toHaveLength(1)
    expect(undo(a.doc, a.inverse).markers).toEqual([])
    expect(applyOps(a.doc, [{ type: 'remove_marker', markerId: 'm1' }]).doc.markers).toEqual([])
  })

  it('replace_clip_media swaps in a reversed render', () => {
    let doc = applyOps(seed(), [{ type: 'add_asset', asset: { id: 'r', kind: 'video', path: 'r.mp4', name: 'a (reversed).mp4', durationUs: 10 * S, hasVideo: true, hasAudio: true } }]).doc
    doc = applyOps(doc, [{ type: 'replace_clip_media', clipId: 'c', assetId: 'r', inUs: 0, reversed: true }]).doc
    expect(clip(doc, 'c')).toMatchObject({ assetId: 'r', inUs: 0, reversed: true })
  })

  it('blurred background is a valid canvas setting', () => {
    const doc = applyOps(seed(), [{ type: 'set_canvas', canvas: { background: { kind: 'blur', amount: 0.7 } } }]).doc
    expect(doc.canvas.background).toEqual({ kind: 'blur', amount: 0.7 })
  })
})

describe('BUG-010: partial transform edits', () => {
  it('setting one transform field leaves the others alone', () => {
    let doc = applyOps(seed(), [{ type: 'set_clip_props', clipId: 'c', transform: { x: 230, scale: 1.5, rotation: 12 } }]).doc
    doc = applyOps(doc, [{ type: 'set_clip_props', clipId: 'c', transform: { y: 115 } }]).doc
    expect(clip(doc, 'c').transform).toMatchObject({ x: 230, y: 115, scale: 1.5, rotation: 12 })
  })
})

describe('BUG-010: partial caption style edits', () => {
  it('changing the caption colour keeps the size', () => {
    let doc = applyOps(seed(), [{ type: 'add_captions', trackId: 'cap', clips: [{ id: 'k', kind: 'caption', startUs: 0, durationUs: S, text: 'hi' }] }]).doc
    doc = applyOps(doc, [{ type: 'set_track_style', trackId: 'cap', style: { fontSize: 120 } }]).doc
    doc = applyOps(doc, [{ type: 'set_track_style', trackId: 'cap', style: { color: '#ff0000' } }]).doc
    expect(doc.tracks.find((t) => t.id === 'cap')!.style).toMatchObject({ fontSize: 120, color: '#ff0000' })
  })
})
