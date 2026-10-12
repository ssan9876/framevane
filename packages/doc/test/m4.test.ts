import { describe, expect, it } from 'vitest'
import {
  applyOps, EFFECTS, effectParams, LutError, parseCube, sampleLut, emptyProject, FILTERS, findClip, hasLook, nextAdjacent, OpError, Project as ProjectSchema, transitionAt, TRANSITIONS,
  type MediaClip, type Project,
} from '../src'

const S = 1_000_000
function seed(): Project {
  return applyOps(emptyProject('p', 'T'), [
    { type: 'add_asset', asset: { id: 'a', kind: 'video', path: 'a.mp4', name: 'a.mp4', durationUs: 20 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_asset', asset: { id: 'm', kind: 'audio', path: 'm.mp3', name: 'm.mp3', durationUs: 20 * S, hasVideo: false, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c1', kind: 'video', assetId: 'a', startUs: 0, durationUs: 4 * S } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c2', kind: 'video', assetId: 'a', startUs: 4 * S, durationUs: 2 * S, inUs: 5 * S } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c3', kind: 'video', assetId: 'a', startUs: 7 * S, durationUs: 3 * S } },
    { type: 'add_track', track: { id: 'au', kind: 'audio', name: 'Audio', clips: [] } },
    { type: 'add_clip', trackId: 'au', clip: { id: 'mu', kind: 'audio', assetId: 'm', startUs: 0, durationUs: 5 * S } },
  ]).doc
}
const media = (doc: Project, id: string) => findClip(doc, id)!.clip as MediaClip
const main = (doc: Project) => doc.tracks.find((t) => t.main)!

describe('looks on clips', () => {
  it('new clips have a neutral look; old project files parse with it', () => {
    const c = media(seed(), 'c1')
    expect(c).toMatchObject({ chroma: null, filter: null, lut: null, effects: [], transition: null })
    expect(c.color.contrast).toBe(0)
    expect(hasLook(c)).toBe(false)
    const old = JSON.parse(JSON.stringify(seed())) as Record<string, unknown>
    delete old.luts
    for (const t of old.tracks as { clips: Record<string, unknown>[] }[]) for (const c of t.clips) { delete c.color; delete c.effects; delete c.transition; delete c.filter }
    const parsed = ProjectSchema.parse(old)
    expect(parsed.luts).toEqual({})
    expect((parsed.tracks[0]!.clips[0] as MediaClip).effects).toEqual([])
  })

  it('set_look patches colour without resetting other fields, and sets a filter', () => {
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', color: { contrast: 20, saturation: -10 } }]).doc
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c1', color: { temperature: 30 }, filter: { id: 'warm', intensity: 0.5 } }]).doc
    const c = media(doc, 'c1')
    expect(c.color).toMatchObject({ contrast: 20, saturation: -10, temperature: 30, exposure: 0 })
    expect(c.filter).toEqual({ id: 'warm', intensity: 0.5 })
    expect(hasLook(c)).toBe(true)
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c1', filter: null }]).doc
    expect(media(doc, 'c1').filter).toBeNull()
  })

  it('rejects out-of-range colour and looks on audio clips', () => {
    expect(() => applyOps(seed(), [{ type: 'set_look', clipId: 'c1', color: { contrast: 500 } }])).toThrow()
    expect(() => applyOps(seed(), [{ type: 'set_look', clipId: 'mu', filter: { id: 'warm', intensity: 1 } }])).toThrow(OpError)
  })

  it('chroma key: a patch starts from the defaults; null turns it off', () => {
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', chroma: { intensity: 0.6 } }]).doc
    expect(media(doc, 'c1').chroma).toEqual({ color: '#00ff00', intensity: 0.6, edge: 0.2, shadow: 0, spill: 0.5 })
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c1', chroma: { color: '#0000ff' } }]).doc
    expect(media(doc, 'c1').chroma).toMatchObject({ color: '#0000ff', intensity: 0.6 })
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c1', chroma: null }]).doc
    expect(media(doc, 'c1').chroma).toBeNull()
  })

  it('LUTs must be imported first; add_lut undoes', () => {
    expect(() => applyOps(seed(), [{ type: 'set_look', clipId: 'c1', lut: { id: 'l1', intensity: 1 } }])).toThrow(/not found/)
    const before = seed()
    const { doc, inverse } = applyOps(before, [
      { type: 'add_lut', lut: { id: 'l1', name: 'Film.cube', file: 'l1.cube' } },
      { type: 'set_look', clipId: 'c1', lut: { id: 'l1', intensity: 0.7 } },
    ])
    expect(doc.luts.l1!.name).toBe('Film.cube')
    expect(media(doc, 'c1').lut).toEqual({ id: 'l1', intensity: 0.7 })
    const back = applyOps(doc, inverse).doc
    expect(back.luts).toEqual({})
    expect(media(back, 'c1').lut).toBeNull()
  })

  it('effects: list replaced whole, ids unique, params default and clamp', () => {
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', effects: [{ id: 'e1', kind: 'glitch', params: { amount: 80 } }, { id: 'e2', kind: 'blur' }] }]).doc
    expect(media(doc, 'c1').effects.map((e) => e.kind)).toEqual(['glitch', 'blur'])
    expect(() => applyOps(doc, [{ type: 'set_look', clipId: 'c1', effects: [{ id: 'x', kind: 'blur' }, { id: 'x', kind: 'vhs' }] }])).toThrow(/unique/)
    doc = applyOps(doc, [{ type: 'set_look', clipId: 'c1', effects: [] }]).doc
    expect(media(doc, 'c1').effects).toEqual([])
    expect(effectParams({ kind: 'glitch', params: { amount: 500 } })).toEqual({ amount: 100, speed: 50 })
    expect(effectParams({ kind: 'blur', params: {} })).toEqual({ amount: 30 })
  })

  it('a split keeps the look on both pieces; the transition stays at the original end', () => {
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', color: { saturation: 40 }, effects: [{ id: 'e', kind: 'vhs', params: {} }], transition: { kind: 'dissolve', durationUs: S } }]).doc
    doc = applyOps(doc, [{ type: 'split_clip', clipId: 'c1', atUs: 2 * S, newClipId: 'c1b' }]).doc
    const [l, r] = [media(doc, 'c1'), media(doc, 'c1b')]
    expect(l.color.saturation).toBe(40)
    expect(r.color.saturation).toBe(40)
    expect(l.effects).toHaveLength(1)
    expect(r.effects).toHaveLength(1)
    expect(l.transition).toBeNull()
    expect(r.transition).toEqual({ kind: 'dissolve', durationUs: S })
  })
})

describe('transitions', () => {
  it('play centred on the cut between touching clips, progress 0 → 1', () => {
    const doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', transition: { kind: 'dissolve', durationUs: S } }]).doc
    const t = main(doc)
    expect(nextAdjacent(t, 'c1')?.id).toBe('c2')
    expect(transitionAt(t, 3.4 * S)).toBeNull()
    const mid = transitionAt(t, 4 * S)!
    expect(mid).toMatchObject({ kind: 'dissolve', startUs: 3.5 * S, endUs: 4.5 * S })
    expect(mid.from.id).toBe('c1')
    expect(mid.to.id).toBe('c2')
    expect(mid.progress).toBeCloseTo(0.5)
    expect(transitionAt(t, 3.75 * S)!.progress).toBeCloseTo(0.25)
    expect(transitionAt(t, 4.5 * S)).toBeNull()
  })

  it('need a touching next clip, and are never longer than either clip', () => {
    let doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c2', transition: { kind: 'iris', durationUs: S } }]).doc
    expect(nextAdjacent(main(doc), 'c2')).toBeNull() // gap before c3
    expect(transitionAt(main(doc), 6 * S)).toBeNull()
    doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', transition: { kind: 'dissolve', durationUs: 5 * S } }]).doc
    const t = transitionAt(main(doc), 4 * S)!
    expect(t.endUs - t.startUs).toBe(2 * S) // c2 is 2 s long
  })

  it('a disabled clip shows no transition', () => {
    const doc = applyOps(seed(), [{ type: 'set_look', clipId: 'c1', transition: { kind: 'dissolve', durationUs: S } }, { type: 'set_clip_props', clipId: 'c2', enabled: false }]).doc
    expect(transitionAt(main(doc), 4 * S)).toBeNull()
  })
})

describe('catalogue', () => {
  it('has ≈20 effects, 20 filters, 15+ transitions, with unique ids and sane params', () => {
    expect(EFFECTS.length).toBeGreaterThanOrEqual(20)
    expect(FILTERS.length).toBe(20)
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(15)
    expect(new Set(EFFECTS.map((e) => e.kind)).size).toBe(EFFECTS.length)
    expect(new Set(FILTERS.map((f) => f.id)).size).toBe(FILTERS.length)
    expect(new Set(TRANSITIONS.map((t) => t.kind)).size).toBe(TRANSITIONS.length)
    for (const e of EFFECTS) for (const p of e.params) expect(p.default >= p.min && p.default <= p.max).toBe(true)
  })
})

describe('.cube LUTs', () => {
  const identity = (n: number, extra = '') => {
    const rows: string[] = []
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`)
    return `# made by hand\nTITLE "Identity"\n${extra}LUT_3D_SIZE ${n}\n${rows.join('\n')}\n`
  }
  it('parses an identity LUT and looks colours up unchanged', () => {
    const lut = parseCube(identity(5))
    expect(lut).toMatchObject({ title: 'Identity', size: 5 })
    const [r, g, b] = sampleLut(lut, 0.3, 0.6, 0.85)
    expect(r).toBeCloseTo(0.3)
    expect(g).toBeCloseTo(0.6)
    expect(b).toBeCloseTo(0.85)
  })
  it('red changes fastest; DOMAIN scales values', () => {
    const lut = parseCube('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n0 0 0\n2 0 0\n0 2 0\n2 2 0\n0 0 2\n2 0 2\n0 2 2\n2 2 2\n')
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0])
    expect(sampleLut(lut, 1, 0, 0)).toEqual([1, 0, 0])
  })
  it('rejects 1D LUTs, short tables and junk', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(LutError)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow(/needs 8/)
    expect(() => parseCube('hello')).toThrow(LutError)
    expect(() => parseCube(identity(2).replace('0 0 0', '0 zero 0'))).toThrow(/Bad table row/)
  })
})
