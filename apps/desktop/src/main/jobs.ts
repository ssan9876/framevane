import type { JobEvent } from '../shared/api'
import { now, uuid7, type Db } from './db'

/**
 * One background queue for proxies, thumbnails, waveforms, transcription, AI work and exports.
 * Rows live in the `jobs` table; the same dedupe_key never runs twice at once (unique partial index).
 * Concurrency is per lane: 'cpu' work (ffmpeg) and 'gpu' work (sidecar models) run in separate lanes.
 */

type Lane = 'cpu' | 'gpu'
export interface JobSpec<T> {
  kind: string
  title: string
  lane?: Lane
  projectId?: string
  assetId?: string
  agentRunId?: string
  dedupeKey?: string
  priority?: number
  params?: unknown
  run: (ctx: { signal: AbortSignal; progress: (p: number, detail?: string) => void }) => Promise<T>
}

interface Running { spec: JobSpec<unknown>; abort: AbortController; resolve: (v: unknown) => void; reject: (e: unknown) => void; id: string }

export class JobQueue {
  private queue: Running[] = []
  private active: Record<Lane, number> = { cpu: 0, gpu: 0 }
  private limits: Record<Lane, number> = { cpu: 2, gpu: 1 }
  private byDedupe = new Map<string, Promise<unknown>>()
  private live = new Map<string, Running>()

  constructor(private db: Db, private emit: (e: JobEvent) => void) {
    // jobs left running by a crash are failed, not resumed
    db.prepare(`UPDATE jobs SET status='failed', error='Interrupted (app closed)', finished_at=? WHERE status IN ('queued','running')`).run(now())
  }

  add<T>(spec: JobSpec<T>): { id: string; done: Promise<T> } {
    if (spec.dedupeKey && this.byDedupe.has(spec.dedupeKey)) {
      const existing = [...this.live.values()].find((r) => r.spec.dedupeKey === spec.dedupeKey)
      return { id: existing?.id ?? '', done: this.byDedupe.get(spec.dedupeKey) as Promise<T> }
    }
    const id = uuid7()
    this.db.prepare(
      `INSERT INTO jobs (id, kind, project_id, asset_id, agent_run_id, dedupe_key, status, priority, params, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    ).run(id, normalizeKind(spec.kind), spec.projectId ?? null, spec.assetId ?? null, spec.agentRunId ?? null, spec.dedupeKey ?? null, spec.priority ?? 0, JSON.stringify(spec.params ?? {}), now())
    let entry!: Running
    const done = new Promise<T>((resolve, reject) => {
      entry = { spec: spec as JobSpec<unknown>, abort: new AbortController(), resolve: resolve as (v: unknown) => void, reject, id }
    })
    if (spec.dedupeKey) {
      this.byDedupe.set(spec.dedupeKey, done)
      done.finally(() => this.byDedupe.delete(spec.dedupeKey!)).catch(() => {})
    }
    this.live.set(id, entry)
    this.queue.push(entry)
    this.queue.sort((a, b) => (b.spec.priority ?? 0) - (a.spec.priority ?? 0))
    this.event(entry, 'queued', 0)
    this.pump()
    return { id, done }
  }

  cancel(id: string) {
    const r = this.live.get(id)
    if (!r) return
    r.abort.abort()
    const qi = this.queue.indexOf(r)
    if (qi >= 0) {
      this.queue.splice(qi, 1)
      this.finish(r, 'cancelled', undefined, new Error('cancelled'))
    }
  }

  private pump() {
    for (const lane of ['cpu', 'gpu'] as Lane[]) {
      while (this.active[lane] < this.limits[lane]) {
        const i = this.queue.findIndex((r) => (r.spec.lane ?? 'cpu') === lane)
        if (i < 0) break
        const r = this.queue.splice(i, 1)[0]!
        this.active[lane]++
        this.start(r).finally(() => { this.active[lane]--; this.pump() })
      }
    }
  }

  private async start(r: Running) {
    this.db.prepare(`UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?`).run(now(), r.id)
    this.event(r, 'running', 0)
    let lastEmit = 0
    try {
      const value = await r.spec.run({
        signal: r.abort.signal,
        progress: (p, detail) => {
          const t = Date.now()
          if (t - lastEmit < 100 && p < 1) return
          lastEmit = t
          this.db.prepare(`UPDATE jobs SET progress=? WHERE id=?`).run(Math.max(0, Math.min(1, p)), r.id)
          this.event(r, 'running', p, detail)
        },
      })
      this.finish(r, 'done', value)
    } catch (e) {
      this.finish(r, r.abort.signal.aborted ? 'cancelled' : 'failed', undefined, e)
    }
  }

  private finish(r: Running, status: 'done' | 'failed' | 'cancelled', value?: unknown, err?: unknown) {
    const msg = err instanceof Error ? err.message : err ? String(err) : null
    this.db.prepare(`UPDATE jobs SET status=?, progress=?, result=?, error=?, finished_at=? WHERE id=?`)
      .run(status, status === 'done' ? 1 : 0, status === 'done' ? JSON.stringify(summarize(value)) : null, msg, now(), r.id)
    this.live.delete(r.id)
    this.event(r, status, status === 'done' ? 1 : 0, undefined, msg ?? undefined)
    if (status === 'done') r.resolve(value)
    else r.reject(err ?? new Error(status))
  }

  private event(r: Running, status: JobEvent['status'], progress: number, detail?: string, error?: string) {
    this.emit({ id: r.id, kind: r.spec.kind, status, progress, title: r.spec.title, detail, error, assetId: r.spec.assetId, projectId: r.spec.projectId })
  }
}

// the jobs.kind CHECK constraint lists known kinds; map sub-kinds onto them
function normalizeKind(kind: string) {
  const known = ['probe', 'proxy', 'mezzanine', 'thumbs', 'waveform', 'transcribe', 'scenes', 'beats', 'silences', 'matte', 'upscale', 'interpolate', 'stabilize', 'denoise', 'enhance_voice', 'stems', 'tts', 'reframe_track', 'inpaint', 'expand', 'export', 'agent_tool']
  return known.includes(kind) ? kind : 'agent_tool'
}

function summarize(v: unknown) {
  const s = JSON.stringify(v ?? null)
  return s && s.length > 4000 ? { truncated: true } : v ?? null
}
