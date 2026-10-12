import { effectParams, filterDef, type ColorAdjust, type MediaClip } from '@framevane/doc'
import { EFFECT_GLSL, GRADE_GLSL, PRELUDE, TRANSITION_GLSL, TRANSITION_PRELUDE } from './shaders'

/**
 * The look pipeline: WebGL2 shader passes over one clip's picture (chroma key → filter → LUT → colour → effects), and
 * the transition mixer for two layers. Synchronous, so the compositor stays one function for preview and export.
 * GLSL ES 3.0 on WebGL2 rather than WGSL on WebGPU: WebGPU is async to submit/read back, which would split the shared
 * draw path; WebGL2 runs inside it and is available on every Windows GPU (and in software for tests).
 *
 * Every texture stores the image top row first (t = 0 is the top). Passes into a framebuffer write vUv.y = 0 at the
 * bottom of the viewport (row 0); the last pass into the canvas flips so the image is upright there.
 */

export interface LutTexture { size: number; data: Float32Array }

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const VERT = `#version 300 es
in vec2 aPos;
uniform float uToCanvas;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, uToCanvas > 0.5 ? 0.5 - aPos.y * 0.5 : aPos.y * 0.5 + 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const hex3 = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

/** Colour settings as the 12 normalised grade inputs the shader reads. */
function gradeVector(c: Partial<ColorAdjust>, mono = false, split = 0): number[] {
  const v = (k: keyof ColorAdjust) => (c[k] ?? 0) / 100
  return [v('exposure'), v('brightness'), v('contrast'), v('saturation'), v('vibrance'), v('temperature'), v('tint'), v('highlights'), v('shadows'), v('fade'), mono ? 1 : 0, split]
}

export class LookRenderer {
  readonly canvas: OffscreenCanvas
  private gl: WebGL2RenderingContext
  private progs = new Map<string, Prog | null>()
  private quad: WebGLBuffer
  private srcTex: WebGLTexture
  private srcTex2: WebGLTexture
  private matteTex: WebGLTexture
  private targets: [Target | null, Target | null] = [null, null]
  private luts = new Map<string, { tex: WebGLTexture; size: number; data: Float32Array }>()
  private blankLut: WebGLTexture

  private static instance: LookRenderer | null | undefined
  /** The shared renderer, or null when WebGL2 isn't available (looks are then skipped, never fatal). */
  static get(): LookRenderer | null {
    if (LookRenderer.instance === undefined) {
      try { LookRenderer.instance = new LookRenderer() } catch (e) { console.warn('[looks] WebGL2 unavailable; effects are off', e); LookRenderer.instance = null }
    }
    return LookRenderer.instance
  }

  private constructor() {
    this.canvas = new OffscreenCanvas(16, 16)
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false })
    if (!gl) throw new Error('no webgl2')
    this.gl = gl
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[looks] GL context lost') })
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.srcTex = this.texture()
    this.srcTex2 = this.texture()
    this.matteTex = this.texture()
    this.blankLut = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_3D, this.blankLut)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }

  /* ───────────── public ───────────── */

  /**
   * Run a clip's look over its picture (already cropped and sized to w×h on `source`). Returns the region of
   * this.canvas holding the result; valid until the next call.
   */
  look(source: TexImageSource, w: number, h: number, clip: MediaClip, localSec: number, lut: LutTexture | null, lutKey: string | null, matte: TexImageSource | null = null) {
    const gl = this.gl
    this.ensureCanvas(w, h)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    if (matte) {
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, this.matteTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, matte)
      gl.activeTexture(gl.TEXTURE0)
    }

    const effects = clip.effects.filter((e) => EFFECT_GLSL[e.kind])
    const passes: { prog: Prog; set: (p: Prog) => void }[] = []
    const grade = this.prog('grade', GRADE_GLSL)
    if (grade) passes.push({ prog: grade, set: (p) => this.setGrade(p, clip, lut, lutKey, !!matte) })
    for (const e of effects) {
      const prog = this.prog(`fx:${e.kind}`, EFFECT_GLSL[e.kind]!)
      if (!prog) continue
      const params = Object.values(effectParams(e))
      passes.push({ prog, set: (p) => gl.uniform1fv(p.u.get('uP')!, new Float32Array([...params, 0, 0, 0, 0].slice(0, 4))) })
    }
    let input: { tex: WebGLTexture; sx: number; sy: number } = { tex: this.srcTex, sx: 1, sy: 1 }
    passes.forEach((pass, i) => {
      const last = i === passes.length - 1
      const target = last ? null : this.target(i % 2, w, h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fb ?? null)
      gl.viewport(0, 0, w, h)
      this.use(pass.prog, input, w, h, localSec, last)
      pass.set(pass.prog)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (target) input = { tex: target.tex, sx: w / target.w, sy: h / target.h }
    })
    return { canvas: this.canvas, sx: 0, sy: this.canvas.height - h, w, h }
  }

  /** Mix two canvas-sized layers with a transition at progress p (0 → 1). */
  transition(a: TexImageSource, b: TexImageSource, w: number, h: number, kind: string, p: number) {
    const gl = this.gl
    const src = TRANSITION_GLSL[kind] ?? TRANSITION_GLSL.dissolve!
    const prog = this.prog(`tr:${kind}`, src, TRANSITION_PRELUDE)
    if (!prog) return null
    this.ensureCanvas(w, h)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex2)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    this.use(prog, { tex: this.srcTex, sx: 1, sy: 1 }, w, h, 0, true)
    gl.uniform1i(prog.u.get('uTexB')!, 1)
    gl.uniform1f(prog.u.get('uPremulIn')!, 1)
    gl.uniform1f(prog.u.get('uProg')!, Math.max(0, Math.min(1, p)))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.activeTexture(gl.TEXTURE0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    return { canvas: this.canvas, sx: 0, sy: this.canvas.height - h, w, h }
  }

  /** Shader compile errors, for tests and diagnostics. */
  compileAll(kinds: { effects: string[]; transitions: string[] }): string[] {
    const errors: string[] = []
    const check = (key: string, src: string, prelude?: string) => { if (!this.prog(key, src, prelude)) errors.push(key) }
    check('grade', GRADE_GLSL)
    for (const k of kinds.effects) check(`fx:${k}`, EFFECT_GLSL[k] ?? 'missing')
    for (const k of kinds.transitions) check(`tr:${k}`, TRANSITION_GLSL[k] ?? 'missing', TRANSITION_PRELUDE)
    return errors
  }

  /* ───────────── internals ───────────── */

  private setGrade(p: Prog, clip: MediaClip, lut: LutTexture | null, lutKey: string | null, hasMatte: boolean) {
    const gl = this.gl
    const cut = clip.cutout
    gl.uniform1i(p.u.get('uMatte')!, 3)
    gl.uniform3f(p.u.get('uCut')!, cut && hasMatte ? 1 : 0, cut?.invert ? 1 : 0, cut ? 0.5 - cut.edge * 0.47 : 0.5)
    const f = clip.filter ? filterDef(clip.filter.id) : undefined
    const fmix = f && clip.filter ? clip.filter.intensity : 0
    gl.uniform1fv(p.u.get('uF')!, new Float32Array(gradeVector(f?.color ?? {}, f?.mono, f?.split?.amount ?? 0)))
    gl.uniform3fv(p.u.get('uFS')!, hex3(f?.split?.shadows ?? '#808080'))
    gl.uniform3fv(p.u.get('uFH')!, hex3(f?.split?.highlights ?? '#808080'))
    gl.uniform1f(p.u.get('uFMix')!, fmix)
    gl.uniform1fv(p.u.get('uA')!, new Float32Array(gradeVector(clip.color)))
    gl.uniform1f(p.u.get('uSharpen')!, clip.color.sharpen / 100)
    gl.uniform1f(p.u.get('uVig')!, clip.color.vignette / 100 + ((f?.color.vignette ?? 0) / 100) * fmix)
    gl.uniform1f(p.u.get('uGrain')!, clip.color.grain / 100 + ((f?.color.grain ?? 0) / 100) * fmix)
    const k = clip.chroma
    gl.uniform4f(p.u.get('uChroma')!, k ? 1 : 0, k ? 0.01 + k.intensity * 0.4 : 0, k ? 0.005 + k.edge * 0.15 : 0, k ? k.shadow : 0)
    gl.uniform3fv(p.u.get('uKey')!, hex3(k?.color ?? '#00ff00'))
    gl.uniform1f(p.u.get('uSpill')!, k ? k.spill : 0)
    // LUT on unit 2
    gl.activeTexture(gl.TEXTURE2)
    const lt = lut && lutKey ? this.lutTexture(lutKey, lut) : null
    gl.bindTexture(gl.TEXTURE_3D, lt?.tex ?? this.blankLut)
    gl.uniform1i(p.u.get('uLut')!, 2)
    gl.uniform1f(p.u.get('uLutSize')!, lt?.size ?? 1)
    gl.uniform1f(p.u.get('uLutMix')!, lt && clip.lut ? clip.lut.intensity : 0)
    gl.activeTexture(gl.TEXTURE0)
  }

  private use(prog: Prog, input: { tex: WebGLTexture; sx: number; sy: number }, w: number, h: number, time: number, toCanvas: boolean) {
    const gl = this.gl
    gl.useProgram(prog.p)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    const loc = gl.getAttribLocation(prog.p, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input.tex)
    gl.uniform1i(prog.u.get('uTex')!, 0)
    gl.uniform2f(prog.u.get('uInScale')!, input.sx, input.sy)
    gl.uniform2f(prog.u.get('uRes')!, w, h)
    gl.uniform1f(prog.u.get('uTime')!, time)
    gl.uniform1f(prog.u.get('uToCanvas')!, toCanvas ? 1 : 0)
    gl.uniform1f(prog.u.get('uPremulIn')!, 0)
    gl.disable(gl.BLEND)
  }

  private ensureCanvas(w: number, h: number) {
    // grow only: resizing reallocates the drawing buffer, and clips of different sizes alternate every frame
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w)
      this.canvas.height = Math.max(this.canvas.height, h)
    }
  }

  private texture() {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private target(i: 0 | 1 | number, w: number, h: number): Target {
    const gl = this.gl
    const cur = this.targets[i as 0 | 1]
    if (cur && cur.w >= w && cur.h >= h) return cur
    if (cur) { gl.deleteFramebuffer(cur.fb); gl.deleteTexture(cur.tex) }
    const tw = Math.max(w, cur?.w ?? 0)
    const th = Math.max(h, cur?.h ?? 0)
    const tex = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const t = { fb, tex, w: tw, h: th }
    this.targets[i as 0 | 1] = t
    return t
  }

  private lutTexture(key: string, lut: LutTexture) {
    const hit = this.luts.get(key)
    if (hit && hit.data === lut.data) return hit
    const gl = this.gl
    if (hit) gl.deleteTexture(hit.tex)
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    const entry = { tex, size: lut.size, data: lut.data }
    this.luts.set(key, entry)
    return entry
  }

  private prog(key: string, body: string, prelude = PRELUDE): Prog | null {
    if (this.progs.has(key)) return this.progs.get(key)!
    const gl = this.gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(`[looks] ${key}:`, gl.getShaderInfoLog(s)); return null }
      return s
    }
    const vs = sh(gl.VERTEX_SHADER, VERT)
    const fs = sh(gl.FRAGMENT_SHADER, `${prelude}\n${body}\n${MAIN}`)
    let out: Prog | null = null
    if (vs && fs) {
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const u = new Map<string, WebGLUniformLocation | null>()
        for (const name of ['uTex', 'uTexB', 'uInScale', 'uRes', 'uTime', 'uToCanvas', 'uPremulIn', 'uP', 'uProg', 'uF', 'uFS', 'uFH', 'uFMix', 'uA', 'uSharpen', 'uVig', 'uGrain', 'uChroma', 'uKey', 'uSpill', 'uLut', 'uLutSize', 'uLutMix', 'uMatte', 'uCut']) {
          u.set(name, gl.getUniformLocation(p, name))
        }
        out = { p, u }
      } else console.error(`[looks] ${key} link:`, gl.getProgramInfoLog(p))
    }
    this.progs.set(key, out)
    return out
  }
}

const MAIN = `
void main() {
  vec4 c = clamp(effect(vUv), 0.0, 1.0);
  // looks work in straight alpha and premultiply for the canvas; transitions mix premultiplied layers as they are
  o = uToCanvas > 0.5 && uPremulIn < 0.5 ? vec4(c.rgb * c.a, c.a) : c;
}`
