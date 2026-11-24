import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * FFmpeg/ffprobe as child processes. Arguments are always arrays (paths with spaces are safe; nothing goes through a shell).
 * Lookup: FRAMEVANE_FFMPEG env → bundled resources/ffmpeg → PATH (on a Mac also Homebrew's folders, which an app
 * started from the Finder doesn't have on its PATH).
 */

const EXE = process.platform === 'win32' ? '.exe' : ''

/** Folders where command-line tools live on a Mac but that a Finder-launched app's PATH leaves out. */
export function extraToolDirs(): string[] {
  if (process.platform !== 'darwin') return []
  const home = process.env.HOME ?? ''
  return ['/opt/homebrew/bin', '/usr/local/bin', ...(home ? [`${home}/.local/bin`, `${home}/.cargo/bin`] : [])]
}

/** Add those folders to PATH once at startup, so child processes (claude, uv, ffmpeg) are found as in a terminal. */
export function widenPath() {
  const dirs = extraToolDirs()
  if (!dirs.length) return
  const cur = (process.env.PATH ?? '').split(':').filter(Boolean)
  process.env.PATH = [...cur, ...dirs.filter((d) => !cur.includes(d))].join(':')
}

let resolved: { ffmpeg: string; ffprobe: string } | null | undefined

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } | null {
  if (resolved !== undefined) return resolved
  const candidates: string[] = []
  if (process.env.FRAMEVANE_FFMPEG) candidates.push(process.env.FRAMEVANE_FFMPEG)
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'ffmpeg', `ffmpeg${EXE}`))
  const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' })
  if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean))
  candidates.push(...extraToolDirs().map((d) => join(d, 'ffmpeg')))
  for (const ff of candidates) {
    const probe = join(dirname(ff), `ffprobe${EXE}`)
    if (existsSync(ff) && existsSync(probe)) return (resolved = { ffmpeg: ff, ffprobe: probe })
  }
  return (resolved = null)
}

function need() {
  const p = ffmpegPaths()
  if (!p) throw new Error(process.platform === 'darwin' ? 'FFmpeg was not found. Install it (brew install ffmpeg) or set FRAMEVANE_FFMPEG.' : 'FFmpeg was not found. Install it or set FRAMEVANE_FFMPEG to ffmpeg.exe.')
  return p
}

/**
 * H.264 encoder arguments for intermediate files (reverse, mezzanine, proxy): NVIDIA's encoder when there is one, Apple's
 * VideoToolbox on a Mac, else x264. 'master' is for files we edit from, 'proxy' for preview-only copies.
 */
export function h264Args(quality: 'master' | 'proxy'): string[] {
  if (encoderWorks('h264_nvenc')) return quality === 'master' ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18'] : ['-c:v', 'h264_nvenc', '-preset', 'p3', '-cq', '24']
  if (process.platform === 'darwin' && encoderWorks('h264_videotoolbox')) return ['-c:v', 'h264_videotoolbox', '-q:v', quality === 'master' ? '75' : '55', '-allow_sw', '1']
  return quality === 'master' ? ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24']
}

export interface RunOptions {
  signal?: AbortSignal
  /** Called with 0..1 when durationUs is known (parses -progress output). */
  onProgress?: (p: number) => void
  durationUs?: number
  stdout?: (chunk: Buffer) => void
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<{ stderr: string }> {
  const { ffmpeg } = need()
  const full = ['-hide_banner', '-nostdin', '-y', ...(opts.onProgress ? ['-progress', 'pipe:2', '-stats_period', '0.25'] : []), ...args]
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, full, { windowsHide: true })
    let stderr = ''
    p.stderr.setEncoding('utf8')
    p.stderr.on('data', (s: string) => {
      stderr = (stderr + s).slice(-200_000)
      if (opts.onProgress && opts.durationUs) {
        const m = /out_time_us=(\d+)/g
        let last: RegExpExecArray | null = null
        for (let r; (r = m.exec(s)); ) last = r
        if (last) opts.onProgress(Math.min(1, Number(last[1]) / opts.durationUs))
      }
    })
    if (opts.stdout) p.stdout.on('data', opts.stdout)
    else p.stdout.resume()
    const abort = () => p.kill('SIGKILL')
    opts.signal?.addEventListener('abort', abort, { once: true })
    p.on('error', reject)
    p.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort)
      if (opts.signal?.aborted) reject(new Error('cancelled'))
      else if (code === 0) resolve({ stderr })
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ')}`))
    })
  })
}

export interface ProbeResult {
  format: { duration?: string; format_name?: string; size?: string }
  streams: {
    codec_type: 'video' | 'audio' | 'subtitle' | 'data'
    codec_name?: string
    width?: number
    height?: number
    r_frame_rate?: string
    avg_frame_rate?: string
    duration?: string
    pix_fmt?: string
    color_transfer?: string
    disposition?: { attached_pic?: number }
    side_data_list?: { rotation?: number }[]
    tags?: { rotate?: string }
    sample_rate?: string
    channels?: number
  }[]
}

export function probe(path: string): Promise<ProbeResult> {
  const { ffprobe } = need()
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.setEncoding('utf8').on('data', (s: string) => (out += s))
    p.stderr.setEncoding('utf8').on('data', (s: string) => (err += s))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err.trim() || code}`))
      try { resolve(JSON.parse(out) as ProbeResult) } catch (e) { reject(e) }
    })
  })
}

export const parseRate = (r?: string) => {
  if (!r) return null
  const [n, d] = r.split('/').map(Number)
  return n && d ? { num: n, den: d } : null
}

/** Encoders compiled into this ffmpeg, cached. Used to pick h264_nvenc over libx264. */
let encoders: Set<string> | null = null
export function hasEncoder(name: string): boolean {
  if (!encoders) {
    const r = spawnSync(need().ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true })
    encoders = new Set([...r.stdout.matchAll(/^\s*[VAS][.A-Z]{5}\s+(\S+)/gm)].map((m) => m[1]!))
  }
  return encoders.has(name)
}

/**
 * Whether a (hardware) encoder actually runs here, not just whether it's compiled in: the bundled FFmpeg builds include
 * h264_nvenc everywhere, and on a PC without an NVIDIA GPU it fails to open ("Cannot load nvcuda.dll"), which made
 * every reverse, proxy and legacy-format conversion fail on AMD, Intel and ARM machines. Checked once with a tiny
 * encode and cached.
 */
const working = new Map<string, boolean>()
export function encoderWorks(name: string): boolean {
  if (!hasEncoder(name)) return false
  let ok = working.get(name)
  if (ok === undefined) {
    const r = spawnSync(need().ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30:d=0.2', '-pix_fmt', 'yuv420p', '-c:v', name, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    ok = r.status === 0
    if (!ok) console.warn(`[ffmpeg] ${name} is built in but doesn't run here; using libx264 (${(r.stderr || r.error?.message || '').trim().split(/\r?\n/)[0]})`)
    working.set(name, ok)
  }
  return ok
}
