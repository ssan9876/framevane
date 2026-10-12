import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { AssetRef } from '@framevane/doc'
import type { MediaInfo } from '../shared/api'
import { now, uuid7, type Db } from './db'
import { hasEncoder, parseRate, probe, runFfmpeg, type ProbeResult } from './ffmpeg'
import type { JobQueue } from './jobs'
import type { AppPaths } from './paths'

/**
 * Media registry: content-hash de-duplicated assets (media_assets), linked to projects (project_media),
 * plus the background prep each asset needs: poster + filmstrip thumbnails, waveform peaks, and a mezzanine
 * transcode when the browser decoders (WebCodecs) can't read the original.
 */

const WEBCODECS_VIDEO = new Set(['h264', 'hevc', 'vp9', 'av1', 'vp8'])
const WEBCODECS_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_s16be', 'pcm_s32le'])
const CONTAINERS_OK = /(mov|mp4|m4a|3gp|3g2|mj2|matroska|webm|mp3|wav|flac|ogg|aac|adts)/
export const PEAKS_PER_SECOND = 100

interface AssetRow {
  id: string; hash: string; path: string; kind: 'video' | 'audio' | 'image' | 'gif' | 'lottie' | 'svg'
  duration_us: number | null; width: number | null; height: number | null; fps_num: number | null; fps_den: number | null
  video_codec: string | null; audio_codec: string | null; has_audio: number; webcodecs_ok: number
  mezzanine_path: string | null; proxy_path: string | null; thumbs_path: string | null; waveform_path: string | null; status: string
}

const PROXY_ABOVE = 1920 // long edge in px; bigger sources get a 1280px proxy for smooth preview

export class Media {
  constructor(private db: Db, private paths: AppPaths, private jobs: JobQueue, private notify: (projectId: string, m: MediaInfo) => void) {}

  /** Register files with a project. Returns immediately with probe data; prep jobs continue in the background. */
  async import(projectId: string, files: string[]): Promise<MediaInfo[]> {
    const out: MediaInfo[] = []
    for (const path of files) {
      const row = await this.register(path)
      this.db.prepare(`INSERT OR IGNORE INTO project_media (project_id, asset_id, added_at) VALUES (?, ?, ?)`).run(projectId, row.id, now())
      out.push(this.info(row))
      this.prepare(projectId, row)
    }
    return out
  }

  list(projectId: string): MediaInfo[] {
    const rows = this.db.prepare(`SELECT m.* FROM media_assets m JOIN project_media pm ON pm.asset_id = m.id WHERE pm.project_id = ? ORDER BY pm.added_at`).all(projectId) as unknown as AssetRow[]
    return rows.map((r) => this.info(this.checkExists(r)))
  }

  get(assetId: string): AssetRow | null {
    return (this.db.prepare(`SELECT * FROM media_assets WHERE id = ?`).get(assetId) as unknown as AssetRow | undefined) ?? null
  }

  /** The file the renderer should decode: the mezzanine when the original isn't WebCodecs-friendly. */
  playablePath(assetId: string): string | null {
    const r = this.get(assetId)
    if (!r) return null
    return r.webcodecs_ok ? r.path : r.mezzanine_path
  }

  /** Low-resolution stand-in for preview (never used for export). */
  proxyPath(assetId: string): string | null {
    const r = this.get(assetId)
    return r?.proxy_path && existsSync(r.proxy_path) ? r.proxy_path : null
  }

  /**
   * Render [inUs, outUs) of an asset backwards (picture and sound) as a new asset in this project.
   * Done in 2 s chunks (each reversed, then joined in reverse order) so memory stays bounded on long clips.
   */
  reverse(projectId: string, assetId: string, inUs: number, outUs: number): Promise<MediaInfo> {
    const row = this.get(assetId)
    if (!row) return Promise.reject(new Error('Unknown media'))
    const src = this.playablePath(assetId) ?? row.path
    const out = join(this.paths.mezzanine, `${assetId}.reversed.${inUs}-${outUs}.mp4`)
    const job = this.jobs.add({
      kind: 'agent_tool',
      title: `Reversing ${basename(row.path)}`,
      projectId,
      assetId,
      dedupeKey: `reverse:${assetId}:${inUs}:${outUs}`,
      run: async ({ signal, progress }) => {
        if (!existsSync(out)) {
          const dir = join(this.paths.mezzanine, `rev-${uuid7()}`)
          await mkdir(dir, { recursive: true })
          try {
            const seg = 2_000_000
            const parts: string[] = []
            const n = Math.max(1, Math.ceil((outUs - inUs) / seg))
            const venc = hasEncoder('h264_nvenc') ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17']
            for (let i = 0; i < n; i++) {
              const a = inUs + i * seg
              const len = Math.min(seg, outUs - a)
              const part = join(dir, `p${String(i).padStart(5, '0')}.mp4`)
              await runFfmpeg(['-ss', String(a / 1e6), '-t', String(len / 1e6), '-i', src, '-vf', 'reverse', ...(row.has_audio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '256k'] : ['-an']),
                ...venc, '-pix_fmt', 'yuv420p', '-g', '30', part], { signal })
              parts.push(part)
              progress((i + 1) / (n + 1))
            }
            const list = join(dir, 'list.txt')
            await writeFile(list, parts.reverse().map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join('\n'))
            await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal })
          } finally {
            await rm(dir, { recursive: true, force: true })
          }
        }
        const [info] = await this.import(projectId, [out])
        return info!
      },
    })
    return job.done
  }

  /** Point a missing asset at a file in its new location (same kind, about the same length). */
  async relink(projectId: string, assetId: string, newPath: string): Promise<MediaInfo> {
    const row = this.get(assetId)
    if (!row) throw new Error('Unknown media')
    const meta = describe(newPath, await probe(newPath))
    if (meta.kind !== row.kind) throw new Error(`That file is ${meta.kind === 'audio' ? 'audio' : `a ${meta.kind}`}, but the missing one was ${row.kind === 'audio' ? 'audio' : `a ${row.kind}`}.`)
    if (row.duration_us && meta.durationUs && Math.abs(row.duration_us - meta.durationUs) > 500_000) {
      throw new Error(`That file is ${(meta.durationUs / 1e6).toFixed(1)} s long; the missing one was ${(row.duration_us / 1e6).toFixed(1)} s.`)
    }
    const st = statSync(newPath)
    this.db.prepare(`UPDATE media_assets SET path = ?, hash = ?, size_bytes = ?, status = 'ok', updated_at = ? WHERE id = ?`)
      .run(newPath, await quickHash(newPath, st.size), st.size, now(), assetId)
    const fresh = this.get(assetId)!
    this.prepare(projectId, fresh)
    const info = this.info(fresh)
    this.notify(projectId, info)
    return info
  }

  private async register(path: string): Promise<AssetRow> {
    const st = statSync(path)
    const hash = await quickHash(path, st.size)
    const existing = this.db.prepare(`SELECT * FROM media_assets WHERE hash = ?`).get(hash) as unknown as AssetRow | undefined
    if (existing) {
      if (existing.path !== path || !existsSync(existing.path)) {
        this.db.prepare(`UPDATE media_assets SET path = ?, status = 'ok', updated_at = ? WHERE id = ?`).run(path, now(), existing.id)
        existing.path = path
      }
      return existing
    }
    const pr = await probe(path)
    const meta = describe(path, pr)
    const id = uuid7()
    const t = now()
    this.db.prepare(
      `INSERT INTO media_assets (id, hash, path, kind, size_bytes, duration_us, width, height, fps_num, fps_den, is_vfr, video_codec, audio_codec,
        has_audio, rotation, color_transfer, webcodecs_ok, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, hash, path, meta.kind, st.size, meta.durationUs, meta.width, meta.height, meta.fps?.num ?? null, meta.fps?.den ?? null,
      meta.vfr ? 1 : 0, meta.videoCodec, meta.audioCodec, meta.hasAudio ? 1 : 0, meta.rotation, meta.colorTransfer, meta.webcodecsOk ? 1 : 0,
      meta.supported ? 'ok' : 'unsupported', t, t)
    return this.get(id)!
  }

  private prepare(projectId: string, row: AssetRow) {
    if (row.status === 'unsupported') return
    const needMezz = !row.webcodecs_ok && !row.mezzanine_path && row.kind !== 'image'
    const needThumbs = !row.thumbs_path && row.kind !== 'audio'
    const needPeaks = !row.waveform_path && (row.has_audio === 1 || row.kind === 'audio')
    const needProxy = row.kind === 'video' && !row.proxy_path && Math.max(row.width ?? 0, row.height ?? 0) > PROXY_ABOVE
    if (!needMezz && !needThumbs && !needPeaks && !needProxy) return
    const job = this.jobs.add({
      kind: needMezz ? 'mezzanine' : 'thumbs',
      title: `Preparing ${basename(row.path)}`,
      projectId,
      assetId: row.id,
      dedupeKey: `prep:${row.id}`,
      priority: 5,
      run: async ({ signal, progress }) => {
        const steps = [needThumbs && 'thumbs', needPeaks && 'peaks', needMezz && 'mezz', needProxy && 'proxy'].filter(Boolean) as string[]
        let done = 0
        const step = (p: number) => progress((done + p) / steps.length)
        if (needThumbs) { await this.makeThumbs(row, signal); done++; step(0) }
        if (needPeaks) { await this.makePeaks(row, signal); done++; step(0) }
        if (needMezz) { await this.makeMezzanine(row, signal, step); done++ }
        if (needProxy) { await this.makeProxy(row, signal, step).catch((e) => console.warn('[media] proxy failed', e)); done++ }
        const fresh = this.get(row.id)!
        this.notify(projectId, this.info(fresh))
        return { assetId: row.id }
      },
    })
    job.done.catch((e) => {
      const fresh = this.get(row.id)
      if (fresh) this.notify(projectId, { ...this.info(fresh), status: needMezz ? 'unsupported' : this.info(fresh).status })
      console.warn('[media] prep failed', row.path, e instanceof Error ? e.message : e)
    })
  }

  private async makeThumbs(row: AssetRow, signal: AbortSignal) {
    const dir = this.paths.thumbs
    const poster = join(dir, `${row.id}.jpg`)
    const strip = join(dir, `${row.id}.strip.jpg`)
    if (row.kind === 'image') {
      await runFfmpeg(['-i', row.path, '-vf', 'scale=320:-2', '-frames:v', '1', poster], { signal })
    } else {
      const dur = (row.duration_us ?? 1e6) / 1e6
      await runFfmpeg(['-ss', String(Math.min(1, dur / 2)), '-i', row.path, '-frames:v', '1', '-vf', 'scale=320:-2', poster], { signal })
      // filmstrip: 24 frames, 160px tall, tiled horizontally; keyframes only for long files (fast)
      const n = 24
      const fast = dur > 600 ? ['-skip_frame', 'nokey'] : []
      await runFfmpeg([...fast, '-i', row.path, '-vf', `fps=${n}/${Math.max(dur, 0.1)},scale=-2:160,tile=${n}x1`, '-frames:v', '1', '-an', strip], { signal })
    }
    this.db.prepare(`UPDATE media_assets SET thumbs_path = ?, updated_at = ? WHERE id = ?`).run(poster, now(), row.id)
  }

  private async makePeaks(row: AssetRow, signal: AbortSignal) {
    const rate = 4000
    const per = rate / PEAKS_PER_SECOND
    const peaks: number[] = []
    let acc = 0
    let n = 0
    let carry: Buffer | null = null
    await runFfmpeg(['-i', row.path, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1'], {
      signal,
      stdout: (chunk) => {
        const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk
        const even = buf.length - (buf.length % 2)
        carry = even < buf.length ? buf.subarray(even) : null
        for (let i = 0; i < even; i += 2) {
          acc = Math.max(acc, Math.abs(buf.readInt16LE(i)))
          if (++n === per) { peaks.push(Math.min(255, Math.round((acc / 32768) * 255))); acc = 0; n = 0 }
        }
      },
    })
    const file = join(this.paths.peaks, `${row.id}.peaks`)
    await writeFile(file, Uint8Array.from(peaks))
    this.db.prepare(`UPDATE media_assets SET waveform_path = ?, updated_at = ? WHERE id = ?`).run(file, now(), row.id)
  }

  private async makeMezzanine(row: AssetRow, signal: AbortSignal, progress: (p: number) => void) {
    const isAudio = row.kind === 'audio'
    const out = join(this.paths.mezzanine, `${row.id}.${isAudio ? 'wav' : 'mp4'}`)
    const args = isAudio
      ? ['-i', row.path, '-vn', '-c:a', 'pcm_s16le', out]
      : ['-i', row.path, '-map', '0:v:0', '-map', '0:a:0?',
        ...(hasEncoder('h264_nvenc') ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17']),
        '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]
    await runFfmpeg(args, { signal, durationUs: row.duration_us ?? undefined, onProgress: progress })
    this.db.prepare(`UPDATE media_assets SET mezzanine_path = ?, updated_at = ? WHERE id = ?`).run(out, now(), row.id)
  }

  private async makeProxy(row: AssetRow, signal: AbortSignal, progress: (p: number) => void) {
    const out = join(this.paths.mezzanine, `${row.id}.proxy.mp4`)
    const src = this.playablePath(row.id) ?? row.path
    const portrait = (row.height ?? 0) > (row.width ?? 0)
    await runFfmpeg(['-i', src, '-map', '0:v:0', '-an', '-vf', portrait ? 'scale=-2:1280' : 'scale=1280:-2',
      ...(hasEncoder('h264_nvenc') ? ['-c:v', 'h264_nvenc', '-preset', 'p3', '-cq', '24'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24']),
      '-pix_fmt', 'yuv420p', '-g', '15', '-movflags', '+faststart', out], { signal, durationUs: row.duration_us ?? undefined, onProgress: progress })
    this.db.prepare(`UPDATE media_assets SET proxy_path = ?, updated_at = ? WHERE id = ?`).run(out, now(), row.id)
  }

  private checkExists(r: AssetRow): AssetRow {
    const ok = existsSync(r.path)
    if (!ok && r.status !== 'missing') this.db.prepare(`UPDATE media_assets SET status='missing' WHERE id=?`).run(r.id)
    return ok ? r : { ...r, status: 'missing' }
  }

  info(r: AssetRow): MediaInfo {
    const asset: AssetRef = {
      id: r.id,
      kind: r.kind === 'gif' || r.kind === 'svg' || r.kind === 'lottie' ? 'image' : r.kind,
      path: r.path,
      name: basename(r.path),
      durationUs: r.kind === 'image' ? undefined : r.duration_us ?? 0,
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      fps: r.fps_num && r.fps_den ? { num: r.fps_num, den: r.fps_den } : undefined,
      hasVideo: r.kind === 'video' || r.kind === 'image',
      hasAudio: r.has_audio === 1,
    }
    const ready = r.status === 'ok' && (r.webcodecs_ok === 1 || !!r.mezzanine_path || r.kind === 'image')
    return {
      asset,
      hasProxy: !!(r.proxy_path && existsSync(r.proxy_path)),
      urls: {
        media: `framevane-media://asset/${r.id}`,
        thumb: r.thumbs_path ? `framevane-media://thumb/${r.id}?v=${encodeURIComponent(String(r.thumbs_path.length))}` : null,
        filmstrip: r.thumbs_path && r.kind === 'video' ? `framevane-media://strip/${r.id}` : null,
        peaks: r.waveform_path ? `framevane-media://peaks/${r.id}` : null,
      },
      status: r.status === 'missing' ? 'missing' : r.status === 'unsupported' ? 'unsupported' : ready ? 'ready' : 'preparing',
    }
  }
}

/** Fast content hash: size + first and last 4 MB. Survives renames/moves, so relink can find the file again. */
async function quickHash(path: string, size: number) {
  const h = createHash('sha1')
  h.update(String(size))
  const fh = await open(path, 'r')
  try {
    const n = Math.min(size, 4 * 1024 * 1024)
    const buf = Buffer.alloc(n)
    await fh.read(buf, 0, n, 0)
    h.update(buf)
    if (size > n) {
      await fh.read(buf, 0, n, size - n)
      h.update(buf)
    }
  } finally {
    await fh.close()
  }
  return h.digest('hex')
}

function describe(path: string, pr: ProbeResult) {
  const v = pr.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = pr.streams.find((s) => s.codec_type === 'audio')
  const ext = extname(path).toLowerCase()
  const imageExt = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.avif']
  const durationS = Number(pr.format.duration ?? v?.duration ?? a?.duration ?? 0)
  const isImage = imageExt.includes(ext) || (v && (!durationS || /image2|png_pipe|jpeg_pipe|webp_pipe/.test(pr.format.format_name ?? '')) && !a)
  const kind = isImage ? (ext === '.gif' ? 'gif' : 'image') : v ? 'video' : a ? 'audio' : 'video'
  const r = parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate)
  const rr = parseRate(v?.r_frame_rate)
  const rotation = Math.abs(((v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? Number(v?.tags?.rotate ?? 0)) % 360 + 360) % 360)
  const container = pr.format.format_name ?? ''
  const containerOk = CONTAINERS_OK.test(container)
  const videoOk = !v || isImage || WEBCODECS_VIDEO.has(v.codec_name ?? '')
  const audioOk = !a || WEBCODECS_AUDIO.has(a.codec_name ?? '')
  const swapped = rotation === 90 || rotation === 270
  return {
    kind: kind as AssetRow['kind'],
    durationUs: isImage ? null : Math.round(durationS * 1e6),
    width: v ? (swapped ? v.height : v.width) ?? null : null,
    height: v ? (swapped ? v.width : v.height) ?? null : null,
    fps: r,
    vfr: !!(r && rr && Math.abs(r.num / r.den - rr.num / rr.den) > 0.5),
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    hasAudio: !!a,
    rotation: [0, 90, 180, 270].includes(rotation) ? rotation : 0,
    colorTransfer: v?.color_transfer ?? null,
    webcodecsOk: isImage || (containerOk && videoOk && audioOk),
    supported: !!(v || a),
  }
}
