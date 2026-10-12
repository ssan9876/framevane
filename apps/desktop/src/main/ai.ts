import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { canvasForRatio, findClip, reframeOps, type Follow, type MediaClip, type OpInput, type Project, type ReframeRatio, type SubjectSample } from '@framevane/doc'
import type { AiModel } from '../shared/api'
import type { JobQueue } from './jobs'
import type { McpHub } from './mcp-hub'
import type { Media } from './media'
import type { AppPaths } from './paths'

/**
 * Local AI vision work (M5): background removal mattes, subject tracking for auto reframe, and the model manager.
 * The models run in the Python sidecar; this side runs them as jobs, caches results per asset, and serves mattes.
 * A matte is per media file (the whole file, once), so every clip of that file can use it.
 */

/** Bump when matte output changes so old caches are ignored. */
const MATTE_VERSION = 1

export class Ai {
  private dir: string
  private tracks: string

  constructor(private hub: McpHub, private media: Media, private jobs: JobQueue, paths: AppPaths, private notify: (assetId: string) => void) {
    this.dir = join(paths.cacheDir, 'mattes')
    this.tracks = join(paths.cacheDir, 'tracks')
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.tracks, { recursive: true })
  }

  /* ───────────── models ───────────── */

  models(): Promise<AiModel[]> {
    return this.hub.callTool<AiModel[]>('local', 'models_status', {}, { timeoutMs: 120_000 })
  }

  installModel(id: string): Promise<AiModel> {
    return this.jobs.add({
      kind: 'agent_tool', lane: 'cpu', dedupeKey: `model:${id}`, title: `Downloading ${id === 'rvm' ? 'the video background model' : id === 'birefnet' ? 'the photo background model' : `the ${id} model`}`,
      run: ({ signal, progress }) => this.hub.callTool<AiModel>('local', 'model_install', { model_id: id }, { signal, onProgress: (p, m) => progress(p, m), timeoutMs: 60 * 60_000 }),
    }).done
  }

  removeModel(id: string): Promise<AiModel> {
    return this.hub.callTool<AiModel>('local', 'model_remove', { model_id: id }, { timeoutMs: 60_000 })
  }

  /** Download a model inside a running job if it isn't there yet. */
  private async ensureModel(id: string, signal: AbortSignal, progress: (p: number, detail?: string) => void) {
    const list = await this.models()
    if (list.find((m) => m.id === id)?.ready) return
    await this.hub.callTool('local', 'model_install', { model_id: id }, { signal, onProgress: (p) => progress(p * 0.3, 'Downloading the model (once)'), timeoutMs: 60 * 60_000 })
  }

  /* ───────────── mattes ───────────── */

  private mattePath(assetId: string, kind: 'video' | 'image') {
    return join(this.dir, `${assetId}-v${MATTE_VERSION}.${kind === 'image' ? 'png' : 'mp4'}`)
  }

  /** The finished matte file of an asset, if any (for the media protocol). */
  matteFile(assetId: string): string | null {
    for (const k of ['video', 'image'] as const) { const p = this.mattePath(assetId, k); if (existsSync(p)) return p }
    return null
  }

  /** Asset ids that have a finished matte. */
  readyMattes(): string[] {
    const suffix = new RegExp(`-v${MATTE_VERSION}\\.(mp4|png)$`)
    return readdirSync(this.dir).filter((f) => suffix.test(f)).map((f) => f.replace(suffix, ''))
  }

  /** Make (or reuse) the background matte of a video or photo. Resolves with the matte file. */
  matte(projectId: string, assetId: string, agentRunId?: string): Promise<string> {
    const row = this.media.get(assetId)
    if (!row) return Promise.reject(new Error('Unknown media'))
    if (row.kind === 'audio') return Promise.reject(new Error('Audio has no picture to cut out'))
    const kind = row.kind === 'image' ? 'image' : 'video'
    const out = this.mattePath(assetId, kind)
    if (existsSync(out)) return Promise.resolve(out)
    return this.jobs.add({
      kind: 'matte', lane: 'gpu', projectId, assetId, agentRunId, dedupeKey: `matte:${assetId}`,
      title: `Removing background · ${basename(row.path)}`,
      run: async ({ signal, progress }) => {
        const model = kind === 'image' ? 'birefnet' : 'rvm'
        await this.ensureModel(model, signal, progress)
        progress(0.3, 'Finding people')
        await this.hub.callTool('local', kind === 'image' ? 'matte_image' : 'matte_video', { path: kind === 'image' ? row.path : this.media.playablePath(assetId) ?? row.path, out }, {
          signal, onProgress: (p, m) => progress(0.3 + p * 0.7, m), timeoutMs: 60 * 60_000,
        })
        this.notify(assetId)
        return out
      },
    }).done
  }

  /* ───────────── subject tracking and reframe ───────────── */

  /** Where the person is in an asset between two source times (cached per asset and range). */
  async track(projectId: string, assetId: string, startUs: number, endUs: number, agentRunId?: string): Promise<SubjectSample[]> {
    const row = this.media.get(assetId)
    if (!row || row.kind !== 'video') return []
    const s = Math.max(0, Math.floor(startUs / 1e5) / 10)
    const e = Math.ceil(endUs / 1e5) / 10
    const file = join(this.tracks, `${assetId}-${s}-${e}.json`)
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as SubjectSample[]
    const r = await this.jobs.add({
      kind: 'reframe_track', lane: 'gpu', projectId, assetId, agentRunId, dedupeKey: `track:${assetId}:${s}:${e}`,
      title: `Following the subject · ${basename(row.path)}`,
      run: async ({ signal, progress }) => {
        await this.ensureModel('rvm', signal, progress)
        return this.hub.callTool<{ samples: SubjectSample[] }>('local', 'track_subject', { path: this.media.playablePath(assetId) ?? row.path, start: s, end: e, fps: 5 }, {
          signal, onProgress: (p, m) => progress(0.3 + p * 0.7, m), timeoutMs: 60 * 60_000,
        })
      },
    }).done
    writeFileSync(file, JSON.stringify(r.samples))
    return r.samples
  }

  /**
   * Ops that switch the project to a new ratio and reframe video/photo clips (all visual clips when none are given):
   * each clip covers the new frame and, with follow "subject", pans to keep the person in it.
   */
  async reframe(doc: Project, opts: { ratio: ReframeRatio; follow: Follow; clipIds?: string[]; agentRunId?: string }): Promise<{ ops: OpInput[]; canvas: { width: number; height: number }; clips: number; followed: number }> {
    const canvas = canvasForRatio(doc.canvas, opts.ratio)
    const ids = opts.clipIds?.length ? opts.clipIds : doc.tracks.filter((t) => t.kind === 'video' && !t.locked).flatMap((t) => t.clips.filter((c) => c.kind === 'video' || c.kind === 'image').map((c) => c.id))
    const ops: OpInput[] = [{ type: 'set_canvas', canvas }]
    let followed = 0
    for (const id of ids) {
      const f = findClip(doc, id)
      if (!f || (f.clip.kind !== 'video' && f.clip.kind !== 'image')) throw new Error(`${id} is not a video or photo clip`)
      const c = f.clip as MediaClip
      const samples = opts.follow === 'subject' && c.kind === 'video' && c.freezeAtUs === undefined
        ? await this.track(doc.id, c.assetId, c.inUs, c.inUs + c.durationUs * c.speed, opts.agentRunId)
        : []
      const clipOps = reframeOps(doc, id, canvas, samples, opts.follow)
      if (clipOps.some((o) => o.type === 'set_keyframes' && o.keyframes.length) || clipOps.some((o) => o.type === 'set_clip_props' && (o.transform?.x || o.transform?.y))) followed++
      ops.push(...clipOps)
    }
    return { ops, canvas, clips: ids.length, followed }
  }
}
