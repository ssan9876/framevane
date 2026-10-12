import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * FFmpeg/ffprobe as child processes. Arguments are always arrays (paths with spaces are safe; nothing goes through a shell).
 * Lookup: REEL_FFMPEG env → bundled resources/ffmpeg → PATH.
 */

let resolved: { ffmpeg: string; ffprobe: string } | null | undefined

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } | null {
  if (resolved !== undefined) return resolved
  const candidates: string[] = []
  if (process.env.REEL_FFMPEG) candidates.push(process.env.REEL_FFMPEG)
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'))
  const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' })
  if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean))
  for (const ff of candidates) {
    const probe = join(dirname(ff), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (existsSync(ff) && existsSync(probe)) return (resolved = { ffmpeg: ff, ffprobe: probe })
  }
  return (resolved = null)
}

function need() {
  const p = ffmpegPaths()
  if (!p) throw new Error('FFmpeg was not found. Install it or set REEL_FFMPEG to ffmpeg.exe.')
  return p
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
