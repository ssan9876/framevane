import {
  clipEnd, DEFAULT_CAPTION_STYLE, hasLook, resolveAt, sourceTimeAt, transitionAt,
  type ActiveTransition, type AssetRef, type CaptionClip, type Clip, type MediaClip, type Project, type ShapeClip, type TextClip, type TextStyle,
} from '@framevane/doc'
import type { VideoSample } from 'mediabunny'
import { loadCustomFonts } from './fonts'
import { LookRenderer } from './gl'
import { lutFor } from './luts'
import type { MediaPool } from './sources'

/**
 * The ONE renderer for preview and export, so what you see is what you export.
 * M0 backend: Canvas 2D drawing WebCodecs frames (GPU-backed canvas in Chromium). The WebGPU backend for effects,
 * masks and color (architecture.md) replaces drawFrame's internals without changing callers.
 */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Picture = { kind: 'video'; sample: VideoSample } | { kind: 'image'; bitmap: ImageBitmap }
/** A clip's picture, plus its background matte when Remove BG is on and the matte is ready. */
type Visual = Picture & { matte?: Picture }

export interface FrameJob { clip: MediaClip; visual: Promise<Visual | null> }

export interface Layer { clip: Clip; trackStyle?: TextStyle; transition?: ActiveTransition }

/** Visible items at time t, bottom to top. A transition between two clips is one layer. */
export function layersAt(doc: Project, tUs: number): Layer[] {
  const out: Layer[] = []
  for (const track of doc.tracks) {
    if (track.hidden) continue
    const tr = track.kind === 'video' ? transitionAt(track, tUs) : null
    if (tr) { out.push({ clip: tr.from, transition: tr }); continue }
    for (const clip of track.clips) {
      if (!clip.enabled || tUs < clip.startUs || tUs >= clipEnd(clip)) continue
      if (clip.kind === 'audio') continue
      out.push({ clip, trackStyle: track.style })
    }
  }
  return out
}

/** Source time to show; a transition reads past a clip's ends (its handles), held at the media's first/last frame. */
function frameSeconds(clip: MediaClip, asset: AssetRef, tUs: number) {
  const s = sourceTimeAt(clip, tUs)
  const max = asset.durationUs !== undefined ? Math.max(0, asset.durationUs - 1000) : s
  return Math.max(0, Math.min(max, s)) / 1e6
}

/** Fetch every visual needed for time t in parallel (decoders run concurrently). */
export async function fetchVisuals(doc: Project, pool: MediaPool, tUs: number, isReady: (assetId: string) => boolean = () => true, hasMatte: (assetId: string) => boolean = () => false): Promise<Map<string, Visual>> {
  const clips = layersAt(doc, tUs).flatMap((l) => (l.transition ? [l.transition.from, l.transition.to] : [l.clip]))
  const jobs = clips.flatMap((clip) => {
    if (clip.kind !== 'video' && clip.kind !== 'image') return []
    const asset = doc.assets[clip.assetId]
    if (!asset || !isReady(asset.id)) return []
    const t = frameSeconds(clip, asset, tUs)
    const p: Promise<Visual | null> = clip.kind === 'image'
      ? pool.image(asset).then((bitmap) => ({ kind: 'image' as const, bitmap })).catch(() => null)
      : pool.frameAt(asset, clip.id, t).then((s) => (s ? { kind: 'video' as const, sample: s } : null)).catch((e) => { console.warn('[compositor] frame', e); return null })
    const m: Promise<Picture | null> = !clip.cutout || !hasMatte(asset.id) ? Promise.resolve(null) : clip.kind === 'image'
      ? pool.matteImage(asset).then((bitmap) => ({ kind: 'image' as const, bitmap })).catch(() => null)
      : pool.matteFrameAt(asset, clip.id, t).then((s) => (s ? { kind: 'video' as const, sample: s } : null)).catch((e) => { console.warn('[compositor] matte', e); return null })
    return [Promise.all([p, m]).then(([v, matte]) => [clip.id, v && matte ? { ...v, matte } : v] as const)]
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
  if (bg.kind === 'transparent') ctx.clearRect(0, 0, W, H) // black on opaque canvases (video export), see-through on photos
  else {
    ctx.fillStyle = bg.kind === 'color' ? bg.color : '#000000'
    ctx.fillRect(0, 0, W, H)
  }
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
  for (const { clip, trackStyle, transition } of layers) {
    if (transition) {
      try { drawTransition(ctx, doc, transition, visuals, W, H, scale, tUs) } catch (e) { if (!/closed/i.test(String(e))) throw e }
      continue
    }
    if (clip.kind === 'video' || clip.kind === 'image') {
      const v = visuals.get(clip.id)
      if (v) {
        try { drawMedia(ctx, doc, clip, v, W, H, scale, tUs - clip.startUs) } catch (e) {
          // an edit can close a clip's decoder while this frame is in flight; the next render draws the new state (BUG-003)
          if (!/closed/i.test(String(e))) throw e
        }
      }
    } else if (clip.kind === 'caption') {
      drawText(ctx, clip, trackStyle ?? DEFAULT_CAPTION_STYLE, tUs - clip.startUs, W, H)
    } else if (clip.kind === 'text') {
      drawText(ctx, clip, clip.style, tUs - clip.startUs, W, H)
    } else if (clip.kind === 'shape') {
      drawShape(ctx, clip, tUs - clip.startUs, W, H)
    }
  }
  ctx.restore()
}

/* ───────────────────────── shapes ───────────────────────── */

/** Where a shape sits on the canvas at clip-local time t (centre, scaled size, rotation). */
export function shapeGeometry(clip: ShapeClip, localUs: number, W: number, H: number) {
  const t = resolveAt(clip, localUs)
  return { cx: W / 2 + t.x, cy: H / 2 + t.y, w: clip.width * t.scale, h: clip.height * t.scale, rotation: t.rotation, opacity: t.opacity, scale: t.scale }
}

function shapePath(ctx: Ctx2D, c: ShapeClip) {
  const w = c.width
  const h = c.height
  ctx.beginPath()
  switch (c.shape) {
    case 'rect': ctx.roundRect(-w / 2, -h / 2, w, h, c.radius * Math.min(w, h)); break
    case 'ellipse': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break
    case 'triangle': ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); break
    case 'star':
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.42 : 1
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        ctx.lineTo((Math.cos(a) * r * w) / 2, (Math.sin(a) * r * h) / 2)
      }
      ctx.closePath()
      break
    case 'arrow': {
      const head = Math.min(w * 0.4, h * 1.2)
      const shaft = h * 0.36
      ctx.moveTo(-w / 2, -shaft / 2); ctx.lineTo(w / 2 - head, -shaft / 2); ctx.lineTo(w / 2 - head, -h / 2); ctx.lineTo(w / 2, 0)
      ctx.lineTo(w / 2 - head, h / 2); ctx.lineTo(w / 2 - head, shaft / 2); ctx.lineTo(-w / 2, shaft / 2); ctx.closePath()
      break
    }
    case 'line': ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); break
  }
}

function drawShape(ctx: Ctx2D, clip: ShapeClip, localUs: number, W: number, H: number) {
  const g = shapeGeometry(clip, localUs, W, H)
  if (g.opacity <= 0 || g.scale <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, g.opacity)
  ctx.translate(g.cx, g.cy)
  if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180)
  ctx.scale(g.scale, g.scale)
  shapePath(ctx, clip)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (clip.shape === 'line') {
    // a line is all stroke: its colour is the fill (or the outline colour if there's no fill), its weight the height
    ctx.strokeStyle = clip.fill ?? clip.stroke
    ctx.lineWidth = Math.max(1, clip.strokeWidth || clip.height * 0.1)
    ctx.stroke()
  } else {
    if (clip.fill) { ctx.fillStyle = clip.fill; ctx.fill() }
    if (clip.strokeWidth > 0) { ctx.strokeStyle = clip.stroke; ctx.lineWidth = clip.strokeWidth; ctx.stroke() }
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

let scratch: OffscreenCanvasRenderingContext2D | null = null
let matteScratch: OffscreenCanvasRenderingContext2D | null = null

/**
 * A clip's picture with its look applied (crop, then the GPU passes), sized for where it lands on screen. Null when
 * the clip has no look or the GPU path is unavailable (the plain picture is drawn then).
 */
function lookImage(doc: Project, clip: MediaClip, v: Visual, g: ReturnType<typeof mediaGeometry>, scale: number, localUs: number) {
  if (!hasLook(clip)) return null
  const fx = LookRenderer.get()
  if (!fx) return null
  // process at the size it is shown, never above the source's own pixels
  const ow = Math.max(2, Math.round(Math.min(g.w * scale, g.src.w)))
  const oh = Math.max(2, Math.round(ow * (g.src.h / g.src.w)))
  scratch ??= new OffscreenCanvas(ow, oh).getContext('2d')!
  if (scratch.canvas.width !== ow || scratch.canvas.height !== oh) { scratch.canvas.width = ow; scratch.canvas.height = oh }
  scratch.clearRect(0, 0, ow, oh)
  if (v.kind === 'video') v.sample.draw(scratch, g.src.x, g.src.y, g.src.w, g.src.h, 0, 0, ow, oh)
  else scratch.drawImage(v.bitmap, g.src.x, g.src.y, g.src.w, g.src.h, 0, 0, ow, oh)
  const lut = clip.lut ? lutFor(doc, clip.lut.id) : null
  let matte: OffscreenCanvas | null = null
  if (clip.cutout && v.matte) {
    // the matte covers the same picture, maybe at another size: map the visible (cropped) part across
    const m = v.matte
    const mw = m.kind === 'video' ? m.sample.displayWidth : m.bitmap.width
    const mh = m.kind === 'video' ? m.sample.displayHeight : m.bitmap.height
    const [kx, ky] = [mw / (g.src.w / (1 - g.crop.left - g.crop.right)), mh / (g.src.h / (1 - g.crop.top - g.crop.bottom))]
    matteScratch ??= new OffscreenCanvas(ow, oh).getContext('2d')!
    if (matteScratch.canvas.width !== ow || matteScratch.canvas.height !== oh) { matteScratch.canvas.width = ow; matteScratch.canvas.height = oh }
    const r = [g.src.x * kx, g.src.y * ky, g.src.w * kx, g.src.h * ky] as const
    if (m.kind === 'video') m.sample.draw(matteScratch, ...r, 0, 0, ow, oh)
    else matteScratch.drawImage(m.bitmap, ...r, 0, 0, ow, oh)
    matte = matteScratch.canvas
  }
  return fx.look(scratch.canvas, ow, oh, clip, localUs / 1e6, lut?.lut ?? null, lut?.key ?? null, matte)
}

function drawMedia(ctx: Ctx2D, doc: Project, clip: MediaClip, v: Visual, W: number, H: number, scale: number, localUs: number) {
  const sw = v.kind === 'video' ? v.sample.displayWidth : v.bitmap.width
  const sh = v.kind === 'video' ? v.sample.displayHeight : v.bitmap.height
  const g = mediaGeometry(clip, localUs, sw, sh, W, H)
  if (g.w <= 0 || g.h <= 0 || g.opacity <= 0) return
  const looked = lookImage(doc, clip, v, g, scale, localUs)
  ctx.save()
  ctx.globalAlpha = g.opacity
  ctx.globalCompositeOperation = clip.blend === 'normal' ? 'source-over' : clip.blend
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.translate(g.cx, g.cy)
  if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180)
  if (g.flipH || g.flipV) ctx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1)
  if (looked) ctx.drawImage(looked.canvas, looked.sx, looked.sy, looked.w, looked.h, -g.w / 2, -g.h / 2, g.w, g.h)
  else if (v.kind === 'video') v.sample.draw(ctx, g.src.x, g.src.y, g.src.w, g.src.h, -g.w / 2, -g.h / 2, g.w, g.h)
  else ctx.drawImage(v.bitmap, g.src.x, g.src.y, g.src.w, g.src.h, -g.w / 2, -g.h / 2, g.w, g.h)
  ctx.restore()
}

const layerCanvases: OffscreenCanvasRenderingContext2D[] = []
function layerCtx(i: number, w: number, h: number) {
  let c = layerCanvases[i]
  if (!c) { c = new OffscreenCanvas(w, h).getContext('2d')!; layerCanvases[i] = c }
  if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, w, h)
  return c
}

/** Both clips drawn as full-frame layers (each with its own transform and look), then mixed by the transition shader. */
function drawTransition(ctx: Ctx2D, doc: Project, tr: ActiveTransition, visuals: Map<string, Visual>, W: number, H: number, scale: number, tUs: number) {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const a = layerCtx(0, cw, ch)
  const b = layerCtx(1, cw, ch)
  const va = visuals.get(tr.from.id)
  const vb = visuals.get(tr.to.id)
  if (va) drawMedia(a, doc, { ...tr.from, blend: 'normal' }, va, W, H, scale, tUs - tr.from.startUs)
  if (vb) drawMedia(b, doc, { ...tr.to, blend: 'normal' }, vb, W, H, scale, tUs - tr.to.startUs)
  const out = LookRenderer.get()?.transition(a.canvas, b.canvas, cw, ch, tr.kind, tr.progress)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.w, out.h, 0, 0, cw, ch)
  else {
    // no GPU: a plain cross-fade
    ctx.globalAlpha = 1 - tr.progress
    ctx.drawImage(a.canvas, 0, 0)
    ctx.globalAlpha = tr.progress
    ctx.drawImage(b.canvas, 0, 0)
  }
  ctx.restore()
}

/* ───────────────────────── text ───────────────────────── */

export function fontString(style: TextStyle) {
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", "Inter Variable", system-ui, sans-serif`
}

interface LaidWord { idx: number; word: string; w: number }
export interface TextLayout { lines: LaidWord[][]; lineWidths: number[]; lineH: number; blockW: number; blockH: number; space: number }

/** Wrap text into lines no wider than style.maxWidth × canvas width. Explicit newlines start a new line. */
export function layoutText(ctx: Ctx2D, text: string, style: TextStyle, W: number): TextLayout {
  ctx.font = fontString(style)
  ;(ctx as CanvasRenderingContext2D).letterSpacing = `${style.letterSpacing}px`
  const maxW = W * style.maxWidth
  const space = ctx.measureText(' ').width
  const lines: LaidWord[][] = []
  let idx = 0
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    let line: LaidWord[] = []
    let lineW = 0
    for (const word of words) {
      const w = ctx.measureText(word).width
      if (line.length && lineW + space + w > maxW) { lines.push(line); line = []; lineW = 0 }
      line.push({ idx: idx++, word, w })
      lineW += (line.length > 1 ? space : 0) + w
    }
    lines.push(line)
  }
  const lineWidths = lines.map((l) => l.reduce((s, x) => s + x.w, 0) + space * Math.max(0, l.length - 1))
  const lineH = style.fontSize * style.lineHeight
  return { lines, lineWidths, lineH, blockW: Math.max(0, ...lineWidths), blockH: lineH * lines.length, space }
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
/** Where a text clip sits on the canvas at clip-local time t (for the on-canvas handles). Ignores in/out animation. */
export function textGeometry(clip: TextClip, localUs: number, W: number, H: number) {
  measureCtx ??= new OffscreenCanvas(8, 8).getContext('2d')!
  const t = resolveAt(clip, localUs)
  const L = layoutText(measureCtx, clip.text.trim() || ' ', clip.style, W)
  const pad = clip.style.background ? clip.style.fontSize * 0.25 : 0
  return { cx: W / 2 + t.x, cy: H * clip.style.y + t.y, w: (L.blockW + pad * 2) * t.scale, h: L.blockH * t.scale, rotation: t.rotation }
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const backOut = (p: number) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2) }

/** In/out animation state at clip-local time t: extra offset, scale, alpha, how much text is revealed. */
function animState(clip: TextClip, localUs: number, W: number, H: number) {
  const st = { dx: 0, dy: 0, scale: 1, alpha: 1, reveal: 1, wipe: 1 }
  const apply = (kind: string, p: number, dir: 1 | -1) => {
    const e = easeOut(p)
    const d = (1 - e) * dir
    switch (kind) {
      case 'fade': st.alpha *= p; break
      case 'slide-up': st.dy += d * H * 0.08; st.alpha *= p; break
      case 'slide-down': st.dy -= d * H * 0.08; st.alpha *= p; break
      case 'slide-left': st.dx += d * W * 0.1; st.alpha *= p; break
      case 'slide-right': st.dx -= d * W * 0.1; st.alpha *= p; break
      case 'pop': st.scale *= Math.max(0, backOut(p)); st.alpha *= Math.min(1, p * 3); break
      case 'zoom-out': st.scale *= 1 + 0.6 * (1 - e); st.alpha *= p; break
      case 'typewriter': st.reveal = Math.min(st.reveal, p); break
      case 'wipe': st.wipe = Math.min(st.wipe, e); break
    }
  }
  const { in: ain, out: aout } = clip.anim
  if (ain.kind !== 'none' && localUs < ain.durationUs) apply(ain.kind, Math.max(0, localUs / ain.durationUs), 1)
  const left = clip.durationUs - localUs
  if (aout.kind !== 'none' && left < aout.durationUs) apply(aout.kind, Math.max(0, left / aout.durationUs), -1)
  return st
}

/**
 * Captions and text: wrapped lines with optional box, shadow, outline, underline; the spoken word is highlighted when
 * word timings exist. Text clips are positioned, scaled, rotated and animated; captions sit at style.y.
 */
function drawText(ctx: Ctx2D, clip: CaptionClip | TextClip, style: TextStyle, localUs: number, W: number, H: number) {
  let text = clip.text.trim()
  if (!text) return
  const timed = clip.kind === 'caption' && clip.words.length === text.split(/\s+/).length ? clip.words : null
  let active = timed ? timed.findIndex((w) => localUs >= w.startUs && localUs < w.endUs) : -1
  if (clip.kind === 'caption' && style.wordByWord && timed) {
    // one word at a time: the word being said, or the last one said during a short pause
    if (active < 0) for (let i = timed.length - 1; i >= 0; i--) if (timed[i]!.startUs <= localUs) { active = i; break }
    if (active < 0) return
    text = text.split(/\s+/)[active]!
    active = 0
  }
  ctx.save()
  const L = layoutText(ctx, text, style, W)
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  let ax = W / 2
  let ay = H * style.y
  let anim = { dx: 0, dy: 0, scale: 1, alpha: 1, reveal: 1, wipe: 1 }
  if (clip.kind === 'text') {
    const t = resolveAt(clip, localUs)
    anim = animState(clip, localUs, W, H)
    ax += t.x
    ay += t.y
    ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity * anim.alpha))
    ctx.translate(ax + anim.dx, ay + anim.dy)
    if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180)
    const sc = t.scale * anim.scale
    ctx.scale(sc, sc)
  } else {
    ctx.translate(ax, ay)
  }
  if (ctx.globalAlpha <= 0) { ctx.restore(); return }
  // shadow sizes are in device pixels, so follow the current scale
  const m = ctx.getTransform()
  const k = Math.hypot(m.a, m.b)
  if (anim.wipe < 1) {
    ctx.beginPath()
    ctx.rect(-L.blockW / 2 - style.fontSize, -L.blockH / 2 - style.fontSize, (L.blockW + style.fontSize * 2) * anim.wipe, L.blockH + style.fontSize * 2)
    ctx.clip()
  }
  const totalChars = L.lines.reduce((n, l) => n + l.reduce((a, w) => a + w.word.length, 0), 0)
  let charsLeft = anim.reveal >= 1 ? Infinity : Math.round(totalChars * anim.reveal)
  const top = -L.blockH / 2
  L.lines.forEach((line, li) => {
    const lw = L.lineWidths[li]!
    let x = style.align === 'left' ? -L.blockW / 2 : style.align === 'right' ? L.blockW / 2 - lw : -lw / 2
    const y = top + li * L.lineH + (L.lineH - style.fontSize) / 2 + style.fontSize * 0.9
    if (style.background && line.length) {
      const padX = style.fontSize * 0.25
      const padY = style.fontSize * 0.08
      ctx.save()
      ctx.fillStyle = style.background
      ctx.beginPath()
      ctx.roundRect(x - padX, y - style.fontSize * 0.92 - padY, lw + padX * 2, style.fontSize * 1.18 + padY * 2, style.backgroundRadius * style.fontSize)
      ctx.fill()
      ctx.restore()
    }
    const lineX = x
    for (const { idx, word, w } of line) {
      if (charsLeft <= 0) break
      const shown = charsLeft >= word.length ? word : word.slice(0, charsLeft)
      charsLeft -= word.length
      if (style.shadow) {
        ctx.shadowColor = style.shadow.color
        ctx.shadowBlur = style.shadow.blur * k
        ctx.shadowOffsetX = style.shadow.x * k
        ctx.shadowOffsetY = style.shadow.y * k
      }
      if (style.strokeWidth > 0) {
        ctx.strokeStyle = style.strokeColor
        ctx.lineWidth = style.strokeWidth * 2
        ctx.strokeText(shown, x, y)
        ctx.shadowColor = 'transparent'
      }
      ctx.fillStyle = idx === active && style.highlightColor ? style.highlightColor : style.color
      ctx.fillText(shown, x, y)
      ctx.shadowColor = 'transparent'
      x += w + L.space
    }
    if (style.underline && line.length) {
      ctx.fillStyle = style.color
      ctx.fillRect(lineX, y + style.fontSize * 0.12, lw, Math.max(1, style.fontSize * 0.06))
    }
  })
  ctx.restore()
}

/** Make sure canvas text uses the bundled font (not a fallback) before the first frame or an export. */
export async function ensureFonts(doc: Project) {
  await loadCustomFonts().catch(() => [])
  const families = new Set<string>(['Inter Variable'])
  for (const t of doc.tracks) {
    if (t.style) families.add(t.style.fontFamily)
    for (const c of t.clips) if (c.kind === 'text') families.add(c.style.fontFamily)
  }
  await Promise.all([...families].flatMap((f) => [400, 700, 900].flatMap((w) => [`${w} 48px "${f}"`, `italic ${w} 48px "${f}"`].map((spec) => document.fonts.load(spec).catch(() => [])))))
}
