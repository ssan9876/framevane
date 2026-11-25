import { describe, expect, it } from 'vitest'
import {
  applyOps, CUT_FRAME_BYTES, detectCuts, emptyProject, findClip, frameDifference, groupLines, ocrSampleTimes, planFill, slotsFromCuts, templateOps, textLanes, textsFromOcr, textSimilarity,
  type AssetRef, type MediaClip, type OcrItem, type OcrSample, type TemplateSlot, type TextClip,
} from '../src'

/** A deterministic pseudo-random generator so the "noise" is the same every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** An analysis frame filled with a colour plus sensor noise, optionally with a bright bar at x (motion). */
function frame(rgb: [number, number, number], rand: () => number, barX?: number): Uint8Array {
  const f = new Uint8Array(CUT_FRAME_BYTES)
  for (let p = 0; p < CUT_FRAME_BYTES / 3; p++) {
    const x = p % 64
    const bar = barX !== undefined && Math.abs(x - barX) < 6
    for (let c = 0; c < 3; c++) f[p * 3 + c] = Math.max(0, Math.min(255, (bar ? 230 : rgb[c]!) + Math.round((rand() - 0.5) * 12)))
  }
  return f
}

function scoresOf(frames: Uint8Array[]) {
  return frames.map((f, i) => (i ? frameDifference(frames[i - 1]!, f) : 0))
}

describe('cut detection', () => {
  it('scores identical frames 0 and black → white near 1', () => {
    const a = new Uint8Array(CUT_FRAME_BYTES)
    const b = new Uint8Array(CUT_FRAME_BYTES).fill(255)
    expect(frameDifference(a, a)).toBe(0)
    expect(frameDifference(a, b)).toBeGreaterThan(0.95)
  })

  it('finds hard cuts between shots, on the right frame', () => {
    const r = rng(1)
    const shots: [number, number, number][] = [[40, 60, 90], [200, 120, 40], [30, 160, 70], [120, 40, 140]]
    const lens = [30, 24, 45, 21] // frames at 30 fps
    const frames = shots.flatMap((c, i) => Array.from({ length: lens[i]! }, (_, k) => frame(c, r, (k * 2) % 64)))
    expect(detectCuts(scoresOf(frames), 30)).toEqual([30, 54, 99])
  })

  it('ignores motion and noise inside a shot', () => {
    const r = rng(2)
    // a bar sweeping fast across the frame: big pixel changes every frame, no cut
    const frames = Array.from({ length: 90 }, (_, k) => frame([60, 60, 60], r, (k * 5) % 64))
    expect(detectCuts(scoresOf(frames), 30)).toEqual([])
  })

  it('merges a flash (two spikes a frame apart) into one cut', () => {
    const r = rng(3)
    const frames = [
      ...Array.from({ length: 30 }, () => frame([50, 50, 50], r)),
      frame([255, 255, 255], r),
      ...Array.from({ length: 30 }, () => frame([150, 90, 40], r)),
    ]
    expect(detectCuts(scoresOf(frames), 30)).toHaveLength(1)
  })

  it('turns cuts into slots that tile the video on the frame grid', () => {
    const fps = { num: 30, den: 1 }
    const slots = slotsFromCuts([1_000_000, 1_812_345, 3_000_000], 5_000_000, fps)
    expect(slots.map((s) => s.startUs)).toEqual([0, 1_000_000, 1_800_000, 3_000_000])
    expect(slots.reduce((t, s) => t + s.durationUs, 0)).toBe(5_000_000)
    expect(slots[0]!.id).toBe('slot-001')
    expect(slotsFromCuts([], 2_000_000, fps)).toHaveLength(1)
  })
})

const item = (text: string, box: [number, number, number, number], extra: Partial<OcrItem> = {}): OcrItem => ({ text, box, score: 0.95, color: '#ffffff', background: null, ...extra })

describe('on-screen text', () => {
  it('stacks lines into one block and leaves separate text and watermarks out', () => {
    const blocks = groupLines([
      item('found the recipe', [0.2, 0.31, 0.8, 0.36]),
      item('POV you finally', [0.22, 0.25, 0.78, 0.3]),
      item('Step 1', [0.37, 0.73, 0.62, 0.79], { color: '#0d0d0d', background: '#ffffff' }),
      item('@someone.creator', [0.05, 0.9, 0.3, 0.92]),
    ])
    expect(blocks.map((b) => b.text)).toEqual(['POV you finally\nfound the recipe', 'Step 1'])
    expect(blocks[0]!.lines).toBe(2)
    expect(blocks[0]!.align).toBe('center')
    expect(blocks[1]!.background).toBe('#ffffff')
  })

  it('compares text loosely', () => {
    expect(textSimilarity('POV you finally', 'pov  you finally')).toBe(1)
    expect(textSimilarity('POV you finaly', 'POV you finally')).toBeGreaterThan(0.9)
    expect(textSimilarity('Step 1', 'Step 2')).toBeGreaterThan(0.6)
    expect(textSimilarity('hello', 'world')).toBeLessThan(0.5)
  })

  it('follows a title across samples, snaps it to the cut and styles it like the original', () => {
    const title = item('POV you finally', [0.2, 0.25, 0.8, 0.3])
    const samples: OcrSample[] = []
    for (let t = 0.1; t < 4; t += 0.5) samples.push({ t: Math.round(t * 10) / 10, items: t < 2.8 ? [{ ...title, text: t > 1 && t < 1.2 ? 'POV you finaIly' : title.text }] : [item('Step 1', [0.37, 0.73, 0.62, 0.79], { color: '#0d0d0d', background: '#ffffff' })] })
    const texts = textsFromOcr(samples, 0.5, { width: 1080, height: 1920 }, [2_800_000], 4_000_000)
    expect(texts.map((t) => t.text)).toEqual(['POV you finally', 'Step 1'])
    expect(texts[0]!.startUs).toBe(0)
    expect(texts[0]!.startUs + texts[0]!.durationUs).toBe(2_800_000)
    expect(texts[1]!.startUs).toBe(2_800_000)
    expect(texts[1]!.startUs + texts[1]!.durationUs).toBe(4_000_000)
    const s = texts[0]!.style
    expect(s.y).toBeCloseTo(0.275, 3)
    expect(s.fontSize).toBe(Math.round(0.05 * 1920 * 0.92))
    expect(texts[0]!.x).toBe(0)
    expect(texts[1]!.style).toMatchObject({ color: '#0d0d0d', background: '#ffffff', shadow: null })
  })

  it('keeps growing (typewriter) text as one clip with its full wording, and changing captions apart', () => {
    const box: [number, number, number, number] = [0.2, 0.6, 0.8, 0.65]
    const words = ['so', 'so this', 'so this is', 'so this is it', 'so this is it', 'so this is it']
    const typed = textsFromOcr(words.map((w, i) => ({ t: i * 0.5, items: [item(w, box)] })), 0.5, { width: 1080, height: 1920 }, [], 3_000_000)
    expect(typed.map((t) => t.text)).toEqual(['so this is it'])
    const caps = textsFromOcr(['hello', 'world', 'again'].map((w, i) => ({ t: i * 0.5 + 0.25, items: [item(w, box)] })), 0.5, { width: 1080, height: 1920 }, [], 1_500_000)
    expect(caps.map((t) => t.text)).toEqual(['hello', 'world', 'again'])
  })

  it('drops a lone low-confidence read', () => {
    const texts = textsFromOcr([{ t: 1, items: [item('blur', [0.1, 0.1, 0.3, 0.15], { score: 0.65 })] }], 0.5, { width: 1080, height: 1920 }, [], 3_000_000)
    expect(texts).toEqual([])
  })

  it('samples about twice a second, less for long videos', () => {
    expect(ocrSampleTimes(5_000_000).times).toEqual([0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6, 4.1, 4.6])
    expect(ocrSampleTimes(600_000_000).intervalS).toBe(2)
  })

  it('puts overlapping texts on separate lanes', () => {
    expect(textLanes([{ startUs: 0, durationUs: 2e6 }, { startUs: 1e6, durationUs: 2e6 }, { startUs: 2e6, durationUs: 1e6 }, { startUs: 3e6, durationUs: 1e6 }])).toEqual([0, 1, 0, 0])
  })
})

const slot = (i: number, startUs: number, durationUs: number): TemplateSlot => ({ id: `slot-${i}`, startUs, durationUs, thumb: null })
const video = (id: string, durationUs: number, width = 1920, height = 1080): AssetRef => ({ id, kind: 'video', path: `${id}.mp4`, name: `${id}.mp4`, durationUs, width, height, hasVideo: true, hasAudio: true })
const image = (id: string): AssetRef => ({ id, kind: 'image', path: `${id}.png`, name: `${id}.png`, width: 1080, height: 1080, hasVideo: true, hasAudio: false })

describe('filling a template', () => {
  const slots = [slot(1, 0, 1_000_000), slot(2, 1_000_000, 500_000), slot(3, 1_500_000, 2_000_000), slot(4, 3_500_000, 1_500_000)]

  it('fills slots in order, round and round, continuing each clip where it left off', () => {
    const plan = planFill(slots, [video('a', 3_000_000), video('b', 10_000_000)], ['a', 'b'])
    expect(plan.map((p) => [p.assetId, p.inUs, p.speed])).toEqual([['a', 0, 1], ['b', 0, 1], ['a', 1_000_000, 1], ['b', 500_000, 1]])
  })

  it('wraps a clip back to its start when the rest is too short', () => {
    const plan = planFill(slots, [video('a', 2_200_000)], ['a'])
    expect(plan.map((p) => p.inUs)).toEqual([0, 1_000_000, 0, 0])
  })

  it('slows a short clip down to fit, holds a frame when it is far too short, and uses images as they are', () => {
    const plan = planFill([slot(1, 0, 2_000_000), slot(2, 2_000_000, 2_000_000), slot(3, 4_000_000, 1_000_000)], [video('short', 1_000_000), video('tiny', 100_000), image('pic')], [], ['short', 'tiny', 'pic'])
    expect(plan[0]).toMatchObject({ assetId: 'short', speed: 0.5, inUs: 0 })
    expect(plan[1]).toMatchObject({ assetId: 'tiny', speed: 1, freezeAtUs: 50_000 })
    expect(plan[2]).toMatchObject({ assetId: 'pic', speed: 1 })
  })

  it('lets a picked clip override the pool for its slot only', () => {
    const plan = planFill(slots, [video('a', 9_000_000), video('b', 9_000_000)], ['a'], [null, 'b', null, null])
    expect(plan.map((p) => p.assetId)).toEqual(['a', 'b', 'a', 'a'])
  })

  it('leaves slots empty when there is no media, and skips audio', () => {
    expect(planFill(slots, [], [])).toEqual([])
    const audio: AssetRef = { id: 'm', kind: 'audio', path: 'm.mp3', name: 'm.mp3', durationUs: 9e6, hasVideo: false, hasAudio: true }
    expect(planFill(slots, [audio], ['m'])).toEqual([])
  })

  it('builds a valid project: same cuts, clips cover the canvas, template sound, text on lanes', () => {
    const assets = [video('a', 9_000_000), image('pic'), { id: 'snd', kind: 'audio' as const, path: 'sound.m4a', name: 'sound.m4a', durationUs: 5_200_000, hasVideo: false, hasAudio: true }]
    const fills = planFill(slots, assets, ['a', 'pic'])
    const tpl = {
      canvas: { width: 1080, height: 1920, fps: { num: 30, den: 1 } },
      durationUs: 5_000_000,
      slots,
      texts: [
        { id: 'text-001', startUs: 0, durationUs: 3_000_000, text: 'Top', x: 0, style: emptyStyle(0.2) },
        { id: 'text-002', startUs: 1_000_000, durationUs: 1_000_000, text: 'Bottom', x: 40, style: emptyStyle(0.8) },
      ],
    }
    const ops = templateOps({ template: tpl, fills, assets, soundAssetId: 'snd', sound: 'template', keepText: true })
    const doc = applyOps(emptyProject('p', 'From template'), ops).doc
    expect(doc.canvas).toMatchObject({ width: 1080, height: 1920 })
    const main = doc.tracks.find((t) => t.main)!
    expect(main.clips.map((c) => [c.startUs, c.durationUs])).toEqual(slots.map((s) => [s.startUs, s.durationUs]))
    const first = main.clips[0] as MediaClip
    expect(first.transform.scale).toBeCloseTo(Math.max(1080 / 1920, 1920 / 1080) / Math.min(1080 / 1920, 1920 / 1080), 5)
    expect(first.audioEnabled).toBe(false)
    expect(main.clips[1]!.kind).toBe('image')
    const sound = doc.tracks.find((t) => t.id === 'track-template-sound')!
    expect(sound.clips[0]).toMatchObject({ kind: 'audio', startUs: 0, durationUs: 5_000_000 })
    expect(doc.tracks.filter((t) => t.kind === 'text')).toHaveLength(2)
    expect((findClip(doc, 'clip-text-002')!.clip as TextClip).transform.x).toBe(40)
  })

  it('keeps the clips\' own sound when asked, and the text out', () => {
    const assets = [video('a', 9_000_000)]
    const ops = templateOps({ template: { canvas: { width: 1080, height: 1920, fps: { num: 30, den: 1 } }, durationUs: 5_000_000, slots, texts: [] }, fills: planFill(slots, assets, ['a']), assets, soundAssetId: null, sound: 'clips', keepText: false })
    const doc = applyOps(emptyProject('p', 'x'), ops).doc
    expect(doc.tracks).toHaveLength(1)
    expect((doc.tracks[0]!.clips[0] as MediaClip).audioEnabled).toBe(true)
  })
})

function emptyStyle(y: number) {
  return { fontFamily: 'Inter Variable', fontSize: 64, fontWeight: 700, italic: false, underline: false, color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, background: null, backgroundRadius: 0.2, shadow: null, letterSpacing: 0, lineHeight: 1.18, align: 'center' as const, y, maxWidth: 0.86, highlightColor: null, wordByWord: false }
}

describe('text colour vote', () => {
  it('takes the colour most reads agree on', async () => {
    const { consensusColor, textsFromOcr } = await import('../src')
    expect(consensusColor(['#0403fa', '#f2f2f2', '#e2e5d0', '#fafafa'])).toBe('#f2f2f2')
    expect(consensusColor([])).toBe('#ffffff')
    const box: [number, number, number, number] = [0.2, 0.3, 0.8, 0.35]
    const reads = ['#0403fa', '#f4f4f4', '#ffffff'].map((color, i) => ({ t: i * 0.5, items: [{ text: 'Title', box, score: 0.95, color, background: null }] }))
    expect(textsFromOcr(reads, 0.5, { width: 1080, height: 1920 }, [], 1_500_000)[0]!.style.color).toBe('#f4f4f4')
  })
})
