import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  CUT_FRAME_BYTES, CUT_FRAME_H, CUT_FRAME_W, TEMPLATE_SCHEMA, Template, detectCuts, frameDifference, ocrSampleTimes, planFill, slotsFromCuts, snapToFrame, templateOps, textsFromOcr,
  type AssetRef, type OcrSample, type TemplateSound,
} from '@framevane/doc'
import type { TemplateCreateRequest, TemplateSummary, TemplateUseRequest, TemplateView } from '../shared/api'
import { uuid7 } from './db'
import { downloadVideo } from './downloader'
import { probe, runFfmpeg } from './ffmpeg'
import type { JobQueue } from './jobs'
import type { McpHub } from './mcp-hub'
import { describe, type Media } from './media'
import type { Projects } from './projects'

/**
 * The template library: userData/templates/<id>/ holds template.json, the reference video, the extracted sound and a
 * still per slot. Making one is a background job (download → probe → cuts → stills → sound → on-screen text); using
 * one copies the sound into a new project and lays the user's clips into the slots (packages/doc/src/template.ts).
 */

const MAX_SLOTS = 300
const MAX_SECONDS = 10 * 60
const FILE_RE = /^(reference\.[a-z0-9]{2,4}|sound\.m4a|slot-\d{3}\.jpg|cover\.jpg)$/

export class Templates {
  constructor(private dir: string, private jobs: JobQueue, private hub: McpHub, private media: Media, private projects: Projects) {}

  private folder(id: string) {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Bad template id')
    return join(this.dir, id)
  }

  /** A file of a template, for the media protocol (only the files a template is made of). */
  file(id: string, name: string): string | null {
    if (!FILE_RE.test(name)) return null
    try {
      const f = join(this.folder(id), name)
      return existsSync(f) ? f : null
    } catch {
      return null
    }
  }

  private read(id: string): Template | null {
    try { return Template.parse(JSON.parse(readFileSync(join(this.folder(id), 'template.json'), 'utf8'))) } catch { return null }
  }

  private async write(t: Template) {
    const f = join(this.folder(t.id), 'template.json')
    await writeFile(`${f}.part`, JSON.stringify(t, null, 1))
    await rename(`${f}.part`, f)
  }

  private url(id: string, file: string | null) {
    return file ? `framevane-media://template/${encodeURIComponent(id)}/${encodeURIComponent(file)}` : null
  }

  private summary(t: Template): TemplateSummary {
    return {
      id: t.id, name: t.name, createdAt: t.createdAt, width: t.canvas.width, height: t.canvas.height, durationUs: t.durationUs,
      slots: t.slots.length, texts: t.texts.length, hasSound: !!t.sound, coverUrl: this.url(t.id, t.cover), source: t.source, warnings: t.warnings,
    }
  }

  list(): TemplateSummary[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir).map((id) => (/^[\w-]{1,64}$/.test(id) ? this.read(id) : null)).filter((t): t is Template => !!t).sort((a, b) => b.createdAt - a.createdAt).map((t) => this.summary(t))
  }

  get(id: string): TemplateView {
    const t = this.read(id)
    if (!t) throw new Error('That template is gone.')
    return {
      ...this.summary(t),
      fps: t.canvas.fps,
      referenceUrl: this.url(id, t.reference),
      soundUrl: this.url(id, t.sound?.file ?? null),
      slotList: t.slots.map((s) => ({ id: s.id, startUs: s.startUs, durationUs: s.durationUs, thumbUrl: this.url(id, s.thumb) })),
      textList: t.texts.map((x) => ({ id: x.id, startUs: x.startUs, durationUs: x.durationUs, text: x.text })),
    }
  }

  async rename(id: string, name: string) {
    const t = this.read(id)
    if (!t) throw new Error('That template is gone.')
    const clean = name.trim().slice(0, 200)
    if (!clean) throw new Error('Give the template a name.')
    await this.write({ ...t, name: clean })
    return this.summary({ ...t, name: clean })
  }

  async remove(id: string) {
    await rm(this.folder(id), { recursive: true, force: true })
  }

  /** Make a template from a video file or a post link. Resolves when the analysis is done. */
  create(req: TemplateCreateRequest): { jobId: string; done: Promise<TemplateSummary> } {
    const id = uuid7()
    const label = req.link ? 'the link' : basename(req.path ?? 'video')
    const job = this.jobs.add({
      kind: 'scenes',
      title: `Making a template from ${label}`,
      lane: 'cpu',
      priority: 10,
      run: async ({ signal, progress }) => {
        const dir = this.folder(id)
        await mkdir(dir, { recursive: true })
        try {
          return await this.analyse(id, dir, req, signal, progress)
        } catch (e) {
          await rm(dir, { recursive: true, force: true }).catch(() => {})
          throw e
        }
      },
    })
    return { jobId: job.id, done: job.done }
  }

  private async analyse(id: string, dir: string, req: TemplateCreateRequest, signal: AbortSignal, progress: (p: number, detail?: string) => void): Promise<TemplateSummary> {
    const warnings: string[] = []
    /* 1. the reference video */
    let ref: string
    let source: Template['source']
    if (req.link) {
      progress(0.01, 'Downloading the video')
      const d = await downloadVideo(req.link, dir, { cookiesFrom: req.cookiesFrom ?? null, signal, onProgress: (p) => progress(0.02 + p * 0.28, 'Downloading the video') })
      ref = d.path
      source = { kind: 'link', url: req.link.trim(), ...(d.title ? { title: d.title.slice(0, 500) } : {}) }
    } else {
      if (!req.path || !existsSync(req.path)) throw new Error('That file is missing.')
      ref = join(dir, `reference${extname(req.path).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 5) || '.mp4'}`)
      progress(0.02, 'Copying the video')
      await copyFile(req.path, ref)
      source = { kind: 'file', fileName: basename(req.path).slice(0, 500) }
    }
    if (basename(ref) !== basename(ref).toLowerCase() || !FILE_RE.test(basename(ref))) {
      const fixed = join(dir, `reference${extname(ref).toLowerCase()}`)
      if (fixed !== ref) { await rename(ref, fixed); ref = fixed }
    }
    /* 2. what it is */
    const pr = await probe(ref)
    const meta = describe(ref, pr)
    if (meta.kind !== 'video' || !meta.width || !meta.height || !meta.durationUs) throw new Error('That isn\'t a video Framevane can read.')
    if (meta.durationUs > MAX_SECONDS * 1e6) throw new Error('Templates are for short videos (up to 10 minutes).')
    const rate = meta.fps && meta.fps.num / meta.fps.den <= 61 ? meta.fps : { num: 30, den: 1 }
    const fps = Math.abs(rate.num / rate.den - Math.round(rate.num / rate.den)) < 0.01 ? { num: Math.round(rate.num / rate.den), den: 1 } : rate
    const durationUs = Math.max(snapToFrame(meta.durationUs, fps), 100_000)
    const even = (n: number) => Math.max(16, Math.round(n / 2) * 2)
    const canvas = { width: even(meta.width), height: even(meta.height), fps }

    /* 3. cuts, from tiny frames piped out of ffmpeg */
    progress(0.32, 'Finding the cuts')
    const aFps = Math.min(30, Math.max(10, Math.round(fps.num / fps.den)))
    const scores: number[] = []
    let prev: Uint8Array | null = null
    let pending: Buffer = Buffer.alloc(0)
    await runFfmpeg(['-i', ref, '-an', '-sn', '-vf', `fps=${aFps},scale=${CUT_FRAME_W}:${CUT_FRAME_H}:flags=area,format=rgb24`, '-f', 'rawvideo', 'pipe:1'], {
      signal, durationUs: meta.durationUs, onProgress: (p) => progress(0.32 + p * 0.2, 'Finding the cuts'),
      stdout: (chunk) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
        while (pending.length >= CUT_FRAME_BYTES) {
          const f = new Uint8Array(pending.subarray(0, CUT_FRAME_BYTES))
          scores.push(prev ? frameDifference(prev, f) : 0)
          prev = f
          pending = pending.subarray(CUT_FRAME_BYTES)
        }
      },
    })
    if (scores.length < 2) throw new Error('Couldn\'t read the video frames.')
    const cutFrames = detectCuts(scores, aFps)
    let slots = slotsFromCuts(cutFrames.map((i) => Math.round((i / aFps) * 1e6)), durationUs, fps)
    if (slots.length > MAX_SLOTS) {
      warnings.push(`This edit has ${slots.length} cuts; the template keeps the first ${MAX_SLOTS}.`)
      slots = slots.slice(0, MAX_SLOTS)
    }

    /* 4. a still of each shot (one ffmpeg pass), the first one is the cover */
    progress(0.54, 'Saving a still of each shot')
    const mids = slots.map((s) => Math.min(scores.length - 1, Math.max(0, Math.round(((s.startUs + s.durationUs / 2) / 1e6) * aFps))))
    try {
      await runFfmpeg(['-i', ref, '-an', '-sn', '-vf', `fps=${aFps},select='${mids.map((n) => `eq(n,${n})`).join('+')}',scale=-2:360`, '-fps_mode', 'passthrough', '-q:v', '4', join(dir, 'slot-%03d.jpg')], { signal })
      slots = slots.map((s, i) => ({ ...s, thumb: existsSync(join(dir, `slot-${String(i + 1).padStart(3, '0')}.jpg`)) ? `slot-${String(i + 1).padStart(3, '0')}.jpg` : null }))
    } catch (e) {
      warnings.push('Couldn\'t save stills of the shots.')
      console.warn('[templates] stills failed', e)
    }
    let cover: string | null = null
    if (slots[0]?.thumb) { await copyFile(join(dir, slots[0].thumb), join(dir, 'cover.jpg')); cover = 'cover.jpg' }

    /* 5. the sound */
    let sound: Template['sound'] = null
    if (meta.hasAudio) {
      progress(0.6, 'Keeping the sound')
      try {
        const out = join(dir, 'sound.m4a')
        await runFfmpeg(['-i', ref, '-vn', '-sn', '-map', '0:a:0', ...(meta.audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']), '-movflags', '+faststart', out], { signal })
        const sp = await probe(out)
        const sd = Math.round(Number(sp.format.duration ?? 0) * 1e6)
        if (sd > 0) sound = { file: 'sound.m4a', durationUs: sd }
      } catch (e) {
        warnings.push('Couldn\'t keep the sound.')
        console.warn('[templates] sound failed', e)
      }
    } else {
      warnings.push('The video has no sound.')
    }

    /* 6. on-screen text, read by the local AI */
    let texts: Template['texts'] = []
    if (req.readText !== false) {
      const { times, intervalS } = ocrSampleTimes(durationUs)
      progress(0.62, 'Reading on-screen text (the first time, the local AI sets itself up)')
      try {
        const r = await this.hub.callTool<{ samples: OcrSample[] }>('local', 'read_text', { path: ref, times }, {
          signal, timeoutMs: 20 * 60_000, onProgress: (p) => progress(0.64 + Math.min(1, p) * 0.34, 'Reading on-screen text'),
        })
        texts = textsFromOcr(r.samples, intervalS, canvas, slots.slice(1).map((s) => s.startUs), durationUs)
      } catch (e) {
        if (signal.aborted) throw e
        const msg = e instanceof Error ? e.message : String(e)
        warnings.push(`On-screen text was skipped: ${msg.split('\n')[0]!.slice(0, 200)}`)
        console.warn('[templates] text failed', msg)
      }
    }

    const name = (req.name?.trim() || source.title || (source.fileName ? source.fileName.replace(/\.[^.]+$/, '') : '') || 'Template').slice(0, 200)
    const t = Template.parse({ schema: TEMPLATE_SCHEMA, id, name, createdAt: Date.now(), source, canvas, durationUs, slots, texts, sound, reference: basename(ref), cover, warnings })
    await this.write(t)
    progress(1)
    return this.summary(t)
  }

  /**
   * A new project from a template: `files` fill the slots in order (repeating when there are fewer than slots);
   * `slotFiles[i]` puts a particular file in slot i. Returns the project id.
   */
  async use(id: string, req: TemplateUseRequest): Promise<{ projectId: string; filled: number; slots: number }> {
    const t = this.read(id)
    if (!t) throw new Error('That template is gone.')
    const files = [...new Set([...req.files, ...(req.slotFiles ?? []).filter((f): f is string => !!f)])]
    if (!files.length) throw new Error('Add at least one clip or photo to fill the template.')
    for (const f of files) if (!existsSync(f)) throw new Error(`${basename(f)} is missing.`)
    const projectId = this.projects.create((req.name?.trim() || t.name).slice(0, 200), { width: t.canvas.width, height: t.canvas.height })
    const sound: TemplateSound = req.sound ?? (t.sound ? 'template' : 'clips')
    const infos = await this.media.import(projectId, files)
    const byPath = new Map(files.map((f, i) => [f, infos[i]!]))
    const usable = (f: string) => { const m = byPath.get(f); return m && m.status !== 'unsupported' && m.asset.kind !== 'audio' ? m.asset.id : null }
    const pool = req.files.map(usable).filter((x): x is string => !!x)
    const picked = (req.slotFiles ?? []).map((f) => (f ? usable(f) : null))
    if (!pool.length && !picked.some(Boolean)) throw new Error('None of those files is a video or photo Framevane can use.')
    const assets: AssetRef[] = infos.filter((m) => m.status !== 'unsupported').map((m) => m.asset)
    let soundAssetId: string | null = null
    if (t.sound && sound !== 'clips') {
      // the project gets its own copy, so deleting the template never breaks it
      const own = join(this.projects.dirOf(projectId), 'template-sound.m4a')
      await copyFile(join(this.folder(id), t.sound.file), own)
      const [s] = await this.media.import(projectId, [own])
      if (s && s.status !== 'unsupported') { assets.push(s.asset); soundAssetId = s.asset.id }
    }
    const fills = planFill(t.slots, assets, pool, picked)
    const ops = templateOps({ template: t, fills, assets, soundAssetId, sound, keepText: req.keepText !== false })
    const doc = this.projects.get(projectId)
    const r = this.projects.apply(projectId, doc.version, ops, 'load')
    if (!r.ok) throw new Error(r.message)
    this.projects.close(projectId)
    return { projectId, filled: fills.length, slots: t.slots.length }
  }
}
