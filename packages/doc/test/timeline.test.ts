import { describe, expect, it } from 'vitest'
import { applyOps, buildCaptionClips, emptyProject, timelineSilences, timelineWords, type Project } from '../src'

const S = 1_000_000
function doc(): Project {
  return applyOps(emptyProject('p', 'T'), [
    { type: 'add_asset', asset: { id: 'a', kind: 'video', path: 'a.mp4', name: 'a.mp4', durationUs: 20 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c', kind: 'video', assetId: 'a', startUs: 0, durationUs: 20 * S } },
  ]).doc
}
const words = [
  { text: 'Hello', start: 1, end: 1.4 }, { text: 'world.', start: 1.5, end: 2 },
  { text: 'This', start: 5, end: 5.3 }, { text: 'is', start: 5.3, end: 5.5 }, { text: 'after', start: 5.5, end: 5.9 }, { text: 'a', start: 5.9, end: 6 }, { text: 'pause', start: 6, end: 6.5 },
]

describe('timeline mapping', () => {
  it('maps words to timeline time and follows cuts', () => {
    let d = doc()
    expect(timelineWords(d, { a: words })[2]).toMatchObject({ text: 'This', startUs: 5 * S })
    d = applyOps(d, [{ type: 'ripple_delete_range', startUs: 2.2 * S, endUs: 4.8 * S }]).doc
    const w = timelineWords(d, { a: words })
    expect(w).toHaveLength(7)
    expect(w[2]).toMatchObject({ text: 'This', startUs: 2.4 * S })
  })

  it('drops words that were mostly cut', () => {
    const d = applyOps(doc(), [{ type: 'ripple_delete_range', startUs: 1.45 * S, endUs: 2 * S }]).doc
    expect(timelineWords(d, { a: words }).map((w) => w.text)).not.toContain('world.')
  })

  it('maps silences with padding and respects speed', () => {
    let d = doc()
    const r = timelineSilences(d, { a: [{ start: 2, end: 5 }] }, { padUs: 100_000 })
    expect(r).toEqual([{ startUs: 2.1 * S, endUs: 4.9 * S }])
    d = applyOps(d, [{ type: 'set_clip_props', clipId: 'c', speed: 2 }]).doc
    expect(timelineSilences(d, { a: [{ start: 2, end: 5 }] }, { padUs: 0 })).toEqual([{ startUs: 1 * S, endUs: 2.5 * S }])
  })

  it('builds caption lines that break on punctuation and pauses', () => {
    const caps = buildCaptionClips(timelineWords(doc(), { a: words }))
    expect(caps.map((c) => c.text)).toEqual(['Hello world.', 'This is after a pause'])
    expect(caps[0]!.words[0]).toMatchObject({ text: 'Hello', startUs: 0 })
    // captions can be applied as an op
    const d = applyOps(doc(), [{ type: 'add_captions', trackId: 'cap', clips: caps }]).doc
    expect(d.tracks.find((t) => t.id === 'cap')!.clips).toHaveLength(2)
  })
})

describe('caption line breaking', () => {
  it('keeps a short sentence ending on its line instead of orphaning it', () => {
    const ws = 'This part has a long pause after it.'.split(' ').map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }))
    const caps = buildCaptionClips(timelineWords(doc(), { a: ws }))
    expect(caps.map((c) => c.text)).toEqual(['This part has a long pause after it.'])
  })
})
