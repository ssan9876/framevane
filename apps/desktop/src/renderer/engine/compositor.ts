import { clipEnd, DEFAULT_CAPTION_STYLE, resolveAt, sourceTimeAt, type CaptionClip, type Clip, type MediaClip, type Project, type TextClip, type TextStyle } from '@framevane/doc'
import type { VideoSample } from 'mediabunny'
import { loadCustomFonts } from './fonts'
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
