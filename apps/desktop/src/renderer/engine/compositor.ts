import { clipEnd, DEFAULT_CAPTION_STYLE, resolveAt, sourceTimeAt, type CaptionClip, type Clip, type MediaClip, type Project, type TextClip, type TextStyle } from '@framevane/doc'
import type { VideoSample } from 'mediabunny'
import type { MediaPool } from './sources'

/**
 * The ONE renderer for preview and export, so what you see is what you export.
 * M0 backend: Canvas 2D drawing WebCodecs frames (GPU-backed canvas in Chromium). The WebGPU backend for effects,
 * masks and color (architecture.md) replaces drawFrame's internals without changing callers.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Visual = { kind: 'video'; sample: VideoSample } | { kind: 'image'; bitmap: ImageBitmap }

export interface FrameJob { clip: MediaClip; visual: Promise<Visual | null> }

/** Visible items at time t, bottom to top. */
export function layersAt(doc: Project, tUs: number): { clip: Clip; trackStyle?: TextStyle }[] {
  const out: { clip: Clip; trackStyle?: TextStyle }[] = []
  for (const track of doc.tracks) {
    if (track.hidden) continue
    for (const clip of track.clips) {
      if (!clip.enabled || tUs < clip.startUs || tUs >= clipEnd(clip)) continue
      if (clip.kind === 'audio') continue
      out.push({ clip, trackStyle: track.style })
    }
  }
  return out
}

/** Fetch every visual needed for time t in parallel (decoders run concurrently). */
export async function fetchVisuals(doc: Project, pool: MediaPool, tUs: number, isReady: (assetId: string) => boolean = () => true): Promise<Map<string, Visual>> {
  const jobs = layersAt(doc, tUs).flatMap(({ clip }) => {
    if (clip.kind !== 'video' && clip.kind !== 'image') return []
    const asset = doc.assets[clip.assetId]
    if (!asset || !isReady(asset.id)) return []
    const p: Promise<Visual | null> = clip.kind === 'image'
      ? pool.image(asset).then((bitmap) => ({ kind: 'image' as const, bitmap })).catch(() => null)
      : pool.frameAt(asset, clip.id, sourceTimeAt(clip, tUs) / 1e6).then((s) => (s ? { kind: 'video' as const, sample: s } : null)).catch((e) => { console.warn('[compositor] frame', e); return null })
    return [p.then((v) => [clip.id, v] as const)]
  })
  const out = new Map<string, Visual>()
  for (const [id, v] of await Promise.all(jobs)) if (v) out.set(id, v)
  return out
}

/**
 * Draw the frame at t. `scale` maps project pixels to canvas pixels (preview canvases are smaller than the project).
 */
export function drawFrame(ctx: Ctx2D, doc: Project, tUs: number, visuals: Map<string, Visual>, scale = 1) {
  const W = doc.canvas.width
  const H = doc.canvas.height
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.globalAlpha = 1
  const layers = layersAt(doc, tUs)
  const bg = doc.canvas.background
  ctx.fillStyle = bg.kind === 'color' ? bg.color : '#000000'
  ctx.fillRect(0, 0, W, H)
  if (bg.kind === 'blur') {
    // blurred, darkened "cover" fill from the bottom-most picture (classic vertical-video background)
    const base = layers.find((l) => (l.clip.kind === 'video' || l.clip.kind === 'image') && visuals.has(l.clip.id))
    const v = base && visuals.get(base.clip.id)
    if (v) {
      try {
        const sw = v.kind === 'video' ? v.sample.displayWidth : v.bitmap.width
        const sh = v.kind === 'video' ? v.sample.displayHeight : v.bitmap.height
        const cover = Math.max(W / sw, H / sh) * 1.08
        ctx.save()
        ctx.filter = `blur(${Math.round(8 + bg.amount * 72)}px) brightness(0.7)`
        const w = sw * cover
        const h = sh * cover
        if (v.kind === 'video') v.sample.draw(ctx, (W - w) / 2, (H - h) / 2, w, h)
        else ctx.drawImage(v.bitmap, (W - w) / 2, (H - h) / 2, w, h)
        ctx.restore()
      } catch (e) { if (!/closed/i.test(String(e))) throw e }
    }
  }
  for (const { clip, trackStyle } of layers) {
    if (clip.kind === 'video' || clip.kind === 'image') {
      const v = visuals.get(clip.id)
      if (v) {
        try { drawMedia(ctx, clip, v, W, H, scale, tUs - clip.startUs) } catch (e) {
          // an edit can close a clip's decoder while this frame is in flight; the next render draws the new state (BUG-003)
          if (!/closed/i.test(String(e))) throw e
        }
      }
    } else if (clip.kind === 'caption') {
      drawText(ctx, clip, trackStyle ?? DEFAULT_CAPTION_STYLE, tUs - clip.startUs, W, H)
    } else if (clip.kind === 'text') {
      drawText(ctx, clip, clip.style, tUs - clip.startUs, W, H)
    }
  }
  ctx.restore()
}

/**
 * Where a media clip lands on the canvas at clip-local time t: centre, size of the visible (cropped) picture,
 * rotation. Shared by the compositor and the on-canvas transform handles so they always agree.
 */
export function mediaGeometry(clip: MediaClip, localUs: number, sw: number, sh: number, W: number, H: number) {
  const t = resolveAt(clip, localUs)
  const c = t.crop
  // "contain" fit of the full source; cropping hides edges without re-zooming
  const fit = Math.min(W / sw, H / sh) * t.scale
  const fullW = sw * fit
  const fullH = sh * fit
  const w = fullW * (1 - c.left - c.right)
  const h = fullH * (1 - c.top - c.bottom)
  // the visible part stays where it was in the uncropped picture
  const offX = ((c.left - c.right) / 2) * fullW * (t.flipH ? -1 : 1)
  const offY = ((c.top - c.bottom) / 2) * fullH * (t.flipV ? -1 : 1)
  const rad = (t.rotation * Math.PI) / 180
  const cx = W / 2 + t.x + offX * Math.cos(rad) - offY * Math.sin(rad)
  const cy = H / 2 + t.y + offX * Math.sin(rad) + offY * Math.cos(rad)
  return { cx, cy, w, h, rotation: t.rotation, opacity: t.opacity, flipH: t.flipH, flipV: t.flipV, crop: c, src: { x: c.left * sw, y: c.top * sh, w: sw * (1 - c.left - c.right), h: sh * (1 - c.top - c.bottom) } }
}

function drawMedia(ctx: Ctx2D, clip: MediaClip, v: Visual, W: number, H: number, scale: number, localUs: number) {
  const sw = v.kind === 'video' ? v.sample.displayWidth : v.bitmap.width
  const sh = v.kind === 'video' ? v.sample.displayHeight : v.bitmap.height
  const g = mediaGeometry(clip, localUs, sw, sh, W, H)
  if (g.w <= 0 || g.h <= 0 || g.opacity <= 0) return
  ctx.save()
  ctx.globalAlpha = g.opacity
  ctx.globalCompositeOperation = clip.blend === 'normal' ? 'source-over' : clip.blend
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.translate(g.cx, g.cy)
  if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180)
  if (g.flipH || g.flipV) ctx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1)
  if (v.kind === 'video') v.sample.draw(ctx, g.src.x, g.src.y, g.src.w, g.src.h, -g.w / 2, -g.h / 2, g.w, g.h)
  else ctx.drawImage(v.bitmap, g.src.x, g.src.y, g.src.w, g.src.h, -g.w / 2, -g.h / 2, g.w, g.h)
  ctx.restore()
}

const HIGHLIGHT = '#ffd84d'

/** Caption/text: wrapped lines, stroke then fill, active word highlighted when word timings exist. */
function drawText(ctx: Ctx2D, clip: CaptionClip | TextClip, style: TextStyle, localUs: number, W: number, H: number) {
  const text = clip.text.trim()
  if (!text) return
  ctx.save()
  ctx.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", "Inter Variable", system-ui, sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const words = text.split(/\s+/)
  const timed = clip.kind === 'caption' && clip.words.length === words.length ? clip.words : null
  const active = timed ? timed.findIndex((w) => localUs >= w.startUs && localUs < w.endUs) : -1
  const maxW = W * style.maxWidth
  const space = ctx.measureText(' ').width
  const lines: { idx: number; word: string; w: number }[][] = [[]]
  let lineW = 0
  words.forEach((word, idx) => {
    const w = ctx.measureText(word).width
    const cur = lines[lines.length - 1]!
    if (cur.length && lineW + space + w > maxW) { lines.push([]); lineW = 0 }
    lines[lines.length - 1]!.push({ idx, word, w })
    lineW += (lines[lines.length - 1]!.length > 1 ? space : 0) + w
  })
  const lineH = style.fontSize * 1.18
  const blockH = lineH * lines.length
  const baseY = H * style.y - blockH / 2 + style.fontSize * 0.9
  lines.forEach((line, li) => {
    const total = line.reduce((s, x) => s + x.w, 0) + space * (line.length - 1)
    let x = style.align === 'left' ? W * (1 - style.maxWidth) / 2 : style.align === 'right' ? W - W * (1 - style.maxWidth) / 2 - total : (W - total) / 2
    const y = baseY + li * lineH
    if (style.background) {
      ctx.fillStyle = style.background
      const pad = style.fontSize * 0.2
      ctx.fillRect(x - pad, y - style.fontSize * 0.95, total + pad * 2, lineH)
    }
    for (const { idx, word, w } of line) {
      if (style.strokeWidth > 0) {
        ctx.strokeStyle = style.strokeColor
        ctx.lineWidth = style.strokeWidth * 2
        ctx.strokeText(word, x, y)
      }
      ctx.fillStyle = idx === active ? HIGHLIGHT : style.color
      ctx.fillText(word, x, y)
      x += w + space
    }
  })
  ctx.restore()
}

/** Make sure canvas text uses the bundled font (not a fallback) before the first frame or an export. */
export async function ensureFonts(doc: Project) {
  const families = new Set<string>(['Inter Variable'])
  for (const t of doc.tracks) {
    if (t.style) families.add(t.style.fontFamily)
    for (const c of t.clips) if (c.kind === 'text') families.add(c.style.fontFamily)
  }
  await Promise.all([...families].flatMap((f) => [400, 700, 900].map((w) => document.fonts.load(`${w} 48px "${f}"`).catch(() => []))))
}
