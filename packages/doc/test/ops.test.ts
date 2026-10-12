import { describe, expect, it } from 'vitest'
import { applyOps, emptyProject, findClip, OpError, projectDurationUs, type OpInput, type Project } from '../src'

const S = 1_000_000

function seed(): Project {
  let doc = emptyProject('p1', 'Test')
  doc = applyOps(doc, [
    { type: 'add_asset', asset: { id: 'a1', kind: 'video', path: 'C:/m/a.mp4', name: 'a.mp4', durationUs: 20 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_asset', asset: { id: 'a2', kind: 'video', path: 'C:/m/b.mp4', name: 'b.mp4', durationUs: 10 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c1', kind: 'video', assetId: 'a1', startUs: 0, durationUs: 20 * S } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c2', kind: 'video', assetId: 'a2', startUs: 20 * S, durationUs: 10 * S } },
  ]).doc
  return doc
}

const undo = (doc: Project, inverse: OpInput[]) => applyOps(doc, inverse).doc
const strip = (d: Project) => ({ ...d, version: 0 })

describe('applyOps', () => {
  it('bumps the version once per batch', () => {
    expect(seed().version).toBe(1)
  })

  it('splits a clip and keeps source continuity', () => {
    const { doc } = applyOps(seed(), [{ type: 'split_clip', clipId: 'c1', atUs: 5 * S, newClipId: 'c1b' }])
    const main = doc.tracks[0]!.clips
    expect(main.map((c) => c.id)).toEqual(['c1', 'c1b', 'c2'])
    expect(main[0]).toMatchObject({ startUs: 0, durationUs: 5 * S, inUs: 0 })
    expect(main[1]).toMatchObject({ startUs: 5 * S, durationUs: 15 * S, inUs: 5 * S })
  })

  it('derives a deterministic id when none is given', () => {
    const a = applyOps(seed(), [{ type: 'split_clip', clipId: 'c1', atUs: 5 * S }]).doc
    const b = applyOps(seed(), [{ type: 'split_clip', clipId: 'c1', atUs: 5 * S }]).doc
    expect(a.tracks[0]!.clips[1]!.id).toBe(b.tracks[0]!.clips[1]!.id)
  })

  it('ripple-deletes a range inside a clip and shifts later clips', () => {
    const { doc } = applyOps(seed(), [{ type: 'ripple_delete_range', startUs: 4 * S, endUs: 6 * S }])
    const [l, r, c2] = doc.tracks[0]!.clips
    expect(l).toMatchObject({ id: 'c1', startUs: 0, durationUs: 4 * S, inUs: 0 })
    expect(r).toMatchObject({ startUs: 4 * S, durationUs: 14 * S, inUs: 6 * S })
    expect(c2).toMatchObject({ id: 'c2', startUs: 18 * S })
    expect(projectDurationUs(doc)).toBe(28 * S)
  })

  it('ripple-deletes across a clip boundary', () => {
    const { doc } = applyOps(seed(), [{ type: 'ripple_delete_range', startUs: 18 * S, endUs: 22 * S }])
    const [c1, c2] = doc.tracks[0]!.clips
    expect(c1).toMatchObject({ id: 'c1', durationUs: 18 * S })
    expect(c2).toMatchObject({ id: 'c2', startUs: 18 * S, durationUs: 8 * S, inUs: 2 * S })
  })

  it('cuts caption words with the range', () => {
    let doc = seed()
    doc = applyOps(doc, [{
      type: 'add_captions', trackId: 'cap', clips: [{
        id: 'k1', kind: 'caption', startUs: 3 * S, durationUs: 4 * S, text: 'one two three four',
        words: [{ text: 'one', startUs: 0, endUs: S }, { text: 'two', startUs: S, endUs: 2 * S }, { text: 'three', startUs: 2 * S, endUs: 3 * S }, { text: 'four', startUs: 3 * S, endUs: 4 * S }],
      }],
    }]).doc
    doc = applyOps(doc, [{ type: 'ripple_delete_range', startUs: 4 * S, endUs: 5 * S }]).doc
    const caps = doc.tracks.find((t) => t.id === 'cap')!.clips
    expect(caps).toHaveLength(2)
    expect(caps[0]).toMatchObject({ startUs: 3 * S, durationUs: S })
    expect(caps[1]).toMatchObject({ startUs: 4 * S, durationUs: 2 * S })
  })

  it('undo restores the exact previous document', () => {
    const before = seed()
    const batches: OpInput[][] = [
      [{ type: 'split_clip', clipId: 'c1', atUs: 7 * S }],
      [{ type: 'ripple_delete_range', startUs: 2 * S, endUs: 9 * S }],
      [{ type: 'remove_clips', clipIds: ['c2'], ripple: true }],
      [{ type: 'set_clip_props', clipId: 'c1', transform: { scale: 1.2 }, volumeDb: -6 }],
      [{ type: 'add_captions', trackId: 'cap', clips: [{ id: 'k', kind: 'caption', startUs: 0, durationUs: S, text: 'hi' }] }],
      [{ type: 'set_canvas', canvas: { width: 1080, height: 1920 } }],
    ]
    for (const ops of batches) {
      const { doc, inverse } = applyOps(before, ops)
      expect(strip(undo(doc, inverse))).toEqual(strip(before))
    }
  })

  it('rejects overlaps atomically', () => {
    const before = seed()
    expect(() => applyOps(before, [
      { type: 'split_clip', clipId: 'c1', atUs: 5 * S },
      { type: 'add_clip', trackId: 'track-main', clip: { id: 'x', kind: 'video', assetId: 'a2', startUs: 3 * S, durationUs: S } },
    ])).toThrow(OpError)
    expect(before.tracks[0]!.clips).toHaveLength(2)
  })

  it('refuses edits on locked tracks', () => {
    const doc = applyOps(seed(), [{ type: 'set_track_flags', trackId: 'track-main', locked: true }]).doc
    expect(() => applyOps(doc, [{ type: 'split_clip', clipId: 'c1', atUs: S }])).toThrow(/locked/)
  })

  it('refuses clips that run past the source', () => {
    expect(() => applyOps(seed(), [{ type: 'set_clip_timing', clipId: 'c2', durationUs: 11 * S }])).toThrow(/past the end/)
  })

  it('keeps clip kinds on matching tracks', () => {
    expect(() => applyOps(seed(), [{ type: 'add_captions', trackId: 'track-main', clips: [{ id: 'k', kind: 'caption', startUs: 0, durationUs: S, text: 'x' }] }])).toThrow(/not a caption track/)
  })

  it('speed change rescales duration', () => {
    const { doc } = applyOps(seed(), [{ type: 'set_clip_props', clipId: 'c2', speed: 2 }])
    expect(findClip(doc, 'c2')!.clip).toMatchObject({ durationUs: 5 * S, speed: 2 })
  })
})

describe('magnet helpers', () => {
  it('ripple trim shifts later clips', () => {
    const { doc } = applyOps(seed(), [{ type: 'set_clip_timing', clipId: 'c1', durationUs: 15 * S, ripple: true }])
    expect(findClip(doc, 'c2')!.clip.startUs).toBe(15 * S)
  })
  it('ripple left-trim keeps the start and closes the gap', () => {
    const { doc } = applyOps(seed(), [{ type: 'set_clip_timing', clipId: 'c1', inUs: 4 * S, durationUs: 16 * S, ripple: true }])
    expect(findClip(doc, 'c1')!.clip).toMatchObject({ startUs: 0, inUs: 4 * S, durationUs: 16 * S })
    expect(findClip(doc, 'c2')!.clip.startUs).toBe(16 * S)
  })
  it('pack_track reorders end to end', () => {
    const { doc } = applyOps(seed(), [{ type: 'pack_track', trackId: 'track-main', order: ['c2', 'c1'] }])
    expect(doc.tracks[0]!.clips.map((c) => [c.id, c.startUs])).toEqual([['c2', 0], ['c1', 10 * S]])
  })
})
