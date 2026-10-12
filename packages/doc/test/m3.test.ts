import { describe, expect, it } from 'vitest'
import {
  applyOps, duckingKeyframes, emptyProject, fadeGainAt, findClip, isFiller, parseSrt, resolveAt, sampleTrack, speechRanges, toSrt, valueAt, wordCutRanges,
  type CaptionClip, type MediaClip, type Project, type TextClip,
} from '../src'

const S = 1_000_000
function seed(): Project {
  return applyOps(emptyProject('p', 'T'), [
    { type: 'add_asset', asset: { id: 'a', kind: 'video', path: 'a.mp4', name: 'a.mp4', durationUs: 20 * S, hasVideo: true, hasAudio: true } },
    { type: 'add_clip', trackId: 'track-main', clip: { id: 'c', kind: 'video', assetId: 'a', startUs: 0, durationUs: 10 * S } },
    { type: 'add_track', track: { id: 'tx', kind: 'text', name: 'Text', clips: [] } },
    { type: 'add_clip', trackId: 'tx', clip: { id: 't', kind: 'text', text: 'Hello world', startUs: S, durationUs: 4 * S, style: { y: 0.5 } } },
  ]).doc
}
const text = (doc: Project, id = 't') => findClip(doc, id)!.clip as TextClip
const media = (doc: Project, id = 'c') => findClip(doc, id)!.clip as MediaClip

describe('text clips', () => {
  it('get defaults for transform, keyframes, animation and the new style fields', () => {
    const t = text(seed())
    expect(t.transform.scale).toBe(1)
    expect(t.anim.in.kind).toBe('none')
    expect(t.style).toMatchObject({ y: 0.5, italic: false, letterSpacing: 0, shadow: null, highlightColor: '#ffd84d' })
  })

  it('set_text patches content, style and animation without resetting other fields', () => {
    let doc = applyOps(seed(), [{ type: 'set_text', clipId: 't', style: { fontSize: 120, italic: true } }]).doc
    doc = applyOps(doc, [{ type: 'set_text', clipId: 't', style: { color: '#ff0000' }, anim: { in: { kind: 'pop' } } }]).doc
    doc = applyOps(doc, [{ type: 'set_text', clipId: 't', text: 'Bye' }]).doc
    expect(text(doc)).toMatchObject({ text: 'Bye', style: { fontSize: 120, italic: true, color: '#ff0000' }, anim: { in: { kind: 'pop', durationUs: 500_000 } } })
  })

  it('moves, keyframes and clears like media; no volume', () => {
    let doc = applyOps(seed(), [{ type: 'set_clip_props', clipId: 't', transform: { x: 100, rotation: 10 } }]).doc
    expect(text(doc).transform).toMatchObject({ x: 100, rotation: 10, scale: 1 })
    doc = applyOps(doc, [
      { type: 'set_keyframe', clipId: 't', prop: 'scale', tUs: 0, value: 1, easing: 'linear' },
      { type: 'set_keyframe', clipId: 't', prop: 'scale', tUs: 2 * S, value: 2 },
    ]).doc
    expect(valueAt(text(doc), 'scale', S)).toBeCloseTo(1.5)
    expect(resolveAt(text(doc), S).x).toBe(100)
    expect(() => applyOps(doc, [{ type: 'set_keyframe', clipId: 't', prop: 'volumeDb', tUs: 0, value: -6 }])).toThrow(/no volume/)
    doc = applyOps(doc, [{ type: 'clear_keyframes', clipId: 't', atUs: 2 * S }]).doc
    expect(text(doc).transform.scale).toBeCloseTo(2)
  })

  it('a split keeps the in-animation on the left piece and the out-animation on the right', () => {
    let doc = applyOps(seed(), [{ type: 'set_text', clipId: 't', anim: { in: { kind: 'fade' }, out: { kind: 'slide-down' } } }]).doc
    doc = applyOps(doc, [{ type: 'split_clip', clipId: 't', atUs: 3 * S, newClipId: 't2' }]).doc
    expect(text(doc).anim).toMatchObject({ in: { kind: 'fade' }, out: { kind: 'none' } })
    expect(text(doc, 't2').anim).toMatchObject({ in: { kind: 'none' }, out: { kind: 'slide-down' } })
  })

  it('media props are refused on text', () => {
    expect(() => applyOps(seed(), [{ type: 'set_clip_props', clipId: 't', volumeDb: -3 }])).toThrow()
  })
})

describe('audio fades', () => {
  it('fade in/out shape the gain and are capped at half the clip', () => {
    const c = { durationUs: 10 * S, fadeInUs: 2 * S, fadeOutUs: 2 * S }
    expect(fadeGainAt(c, 0)).toBe(0)
    expect(fadeGainAt(c, S)).toBeCloseTo(0.5)
    expect(fadeGainAt(c, 5 * S)).toBe(1)
    expect(fadeGainAt(c, 9 * S)).toBeCloseTo(0.5)
    expect(fadeGainAt({ durationUs: 2 * S, fadeInUs: 5 * S, fadeOutUs: 0 }, S)).toBeCloseTo(1)
  })

  it('set via set_clip_props; a split keeps the fade-in left and the fade-out right', () => {
    let doc = applyOps(seed(), [{ type: 'set_clip_props', clipId: 'c', fadeInUs: S, fadeOutUs: 2 * S }]).doc
    expect(media(doc)).toMatchObject({ fadeInUs: S, fadeOutUs: 2 * S })
    doc = applyOps(doc, [{ type: 'split_clip', clipId: 'c', atUs: 5 * S, newClipId: 'c2' }]).doc
    expect(media(doc)).toMatchObject({ fadeInUs: S, fadeOutUs: 0 })
    expect(media(doc, 'c2')).toMatchObject({ fadeInUs: 0, fadeOutUs: 2 * S })
  })
})

describe('ducking', () => {
  it('drops the music under speech with ramps and comes back up between', () => {
    const music = { startUs: 0, durationUs: 20 * S, volumeDb: -4 }
    const kfs = duckingKeyframes(music, [{ startUs: 2 * S, endUs: 5 * S }, { startUs: 10 * S, endUs: 12 * S }], { duckDb: 12, rampUs: 250_000 })
    expect(sampleTrack(kfs, 0)).toBe(-4)
    expect(sampleTrack(kfs, 3 * S)).toBe(-16)
    expect(sampleTrack(kfs, 8 * S)).toBe(-4)
    expect(sampleTrack(kfs, 11 * S)).toBe(-16)
    expect(sampleTrack(kfs, 19 * S)).toBe(-4)
    expect(kfs.every((k, i) => i === 0 || k.tUs > kfs[i - 1]!.tUs)).toBe(true)
  })

  it('merges short gaps and handles speech at the very start', () => {
    const kfs = duckingKeyframes({ startUs: 0, durationUs: 10 * S, volumeDb: 0 }, [{ startUs: 0, endUs: 2 * S }, { startUs: 2.3 * S, endUs: 4 * S }])
    expect(sampleTrack(kfs, 0)).toBe(-12)
    expect(sampleTrack(kfs, 2.15 * S)).toBe(-12)
    expect(sampleTrack(kfs, 8 * S)).toBe(0)
  })

  it('set_keyframes replaces a whole curve; empty removes it', () => {
    const kfs = duckingKeyframes({ startUs: 0, durationUs: 10 * S, volumeDb: 0 }, [{ startUs: 2 * S, endUs: 4 * S }])
    let doc = applyOps(seed(), [{ type: 'set_keyframes', clipId: 'c', prop: 'volumeDb', keyframes: kfs }]).doc
    expect(media(doc).keyframes.volumeDb).toHaveLength(kfs.length)
    expect(valueAt(media(doc), 'volumeDb', 3 * S)).toBe(-12)
    doc = applyOps(doc, [{ type: 'set_keyframes', clipId: 'c', prop: 'volumeDb', keyframes: [] }]).doc
    expect(media(doc).keyframes.volumeDb).toBeUndefined()
    expect(() => applyOps(seed(), [{ type: 'set_keyframes', clipId: 'c', prop: 'x', keyframes: [{ tUs: 11 * S, value: 1 }] }])).toThrow(/outside/)
  })

  it('speech ranges join nearby words', () => {
    const w = (s: number, e: number) => ({ text: 'x', startUs: s * S, endUs: e * S, clipId: 'c' })
    expect(speechRanges([w(0, 1), w(1.2, 2), w(5, 6)])).toEqual([{ startUs: 0, endUs: 2 * S }, { startUs: 5 * S, endUs: 6 * S }])
  })
})

describe('captions in and out', () => {
  it('SRT round trip', () => {
    const lines: CaptionClip[] = [
      { id: 'a', kind: 'caption', startUs: 0, durationUs: 1_500_000, enabled: true, text: 'Hello there', words: [] },
      { id: 'b', kind: 'caption', startUs: 3_723_456_000, durationUs: 2 * S, enabled: true, text: 'Later — café ☕', words: [] },
    ]
    const srt = toSrt(lines)
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500')
    expect(srt).toContain('01:02:03,456 --> 01:02:05,456')
    const back = parseSrt(srt)
    expect(back.map((c) => [c.startUs, c.durationUs, c.text])).toEqual(lines.map((c) => [c.startUs, c.durationUs, c.text]))
  })

  it('parses CRLF, tags, VTT-style dots and fixes overlaps', () => {
    const srt = '1\r\n00:00:01.000 --> 00:00:03.000\r\n<i>One</i>\r\nline\r\n\r\n2\r\n00:00:02,500 --> 00:00:04,000\r\nTwo\r\n\r\nnot a cue\r\n'
    const c = parseSrt(srt)
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ startUs: S, durationUs: 2 * S, text: 'One line' })
    expect(c[1]).toMatchObject({ startUs: 3 * S, durationUs: S, text: 'Two' })
  })

  it('imported captions are valid on a caption track', () => {
    const doc = applyOps(seed(), [{ type: 'add_captions', trackId: 'cap', trackName: 'Captions', clips: parseSrt('1\n00:00:00,500 --> 00:00:02,000\nHi\n') }]).doc
    expect(doc.tracks.find((t) => t.id === 'cap')!.clips).toHaveLength(1)
  })
})

describe('filler words', () => {
  it('spots hesitations only', () => {
    expect(['Um,', 'uh', 'Erm…', 'hmm'].every(isFiller)).toBe(true)
    expect(['like', 'umbrella', 'the'].some(isFiller)).toBe(false)
  })
  it('cut ranges are padded and merged', () => {
    expect(wordCutRanges([{ startUs: S, endUs: 1.2 * S }, { startUs: 1.21 * S, endUs: 1.4 * S }], 20_000)).toEqual([{ startUs: 980_000, endUs: 1_420_000 }])
  })
})
