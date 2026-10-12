import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Transcript } from '../shared/api'
import { now, uuid7, type Db } from './db'
import { runFfmpeg } from './ffmpeg'
import type { JobQueue } from './jobs'
import type { McpHub } from './mcp-hub'
import type { Media } from './media'
import type { AppPaths } from './paths'

/**
 * Per-asset analyses, computed once and cached in `analyses` (big results as JSON files):
 *   transcript  local Whisper via the sidecar (word timings, source seconds)
 *   silences    ffmpeg silencedetect (source seconds)
 */

export const DEFAULT_WHISPER = 'large-v3-turbo'

export class Analysis {
  constructor(private db: Db, private paths: AppPaths, private jobs: JobQueue, private media: Media, private hub: McpHub) {}

  cachedTranscript(assetId: string, model = DEFAULT_WHISPER): Transcript | null {
    const row = this.db.prepare(`SELECT result, result_path, language FROM analyses WHERE asset_id=? AND kind='transcript' AND model=?`).get(assetId, `faster-whisper:${model}`) as
      { result: string; result_path: string | null; language: string | null } | undefined
    if (!row) return null
    if (row.result_path && existsSync(row.result_path)) return JSON.parse(readFileSync(row.result_path, 'utf8')) as Transcript
    return null
  }

  transcript(projectId: string, assetId: string, opts: { language?: string; force?: boolean; model?: string; agentRunId?: string } = {}): Promise<Transcript> {
    const model = opts.model ?? process.env.REEL_WHISPER_MODEL ?? DEFAULT_WHISPER
    if (!opts.force) {
      const hit = this.cachedTranscript(assetId, model)
      if (hit) return Promise.resolve(hit)
    }
    const row = this.media.get(assetId)
    if (!row) return Promise.reject(new Error('Unknown media'))
    if (!row.has_audio && row.kind !== 'audio') return Promise.reject(new Error(`${basename(row.path)} has no audio to transcribe`))
    const job = this.jobs.add({
      kind: 'transcribe',
      lane: 'gpu',
      title: `Transcribing ${basename(row.path)}`,
      projectId,
      assetId,
      agentRunId: opts.agentRunId,
      dedupeKey: `transcribe:${assetId}:${model}`,
      priority: 10,
      run: async ({ signal, progress }) => {
        progress(0, 'Starting local AI')
        const r = await this.hub.callTool<{ language: string; model: string; words: { text: string; start: number; end: number }[] }>(
          'local', 'transcribe', { path: this.media.playablePath(assetId) ?? row.path, ...(opts.language ? { language: opts.language } : {}), model },
          { signal, onProgress: (p, m) => progress(p, m), timeoutMs: 10 * 60_000 },
        )
        const t: Transcript = { assetId, language: r.language, model: r.model, words: r.words.map((w) => ({ text: w.text, start: w.start, end: w.end })) }
        const file = join(this.paths.transcripts, `${assetId}.${model}.json`)
        writeFileSync(file, JSON.stringify(t))
        this.db.prepare(
          `INSERT INTO analyses (id, asset_id, kind, model, language, result, result_path, created_at) VALUES (?, ?, 'transcript', ?, ?, ?, ?, ?)
           ON CONFLICT(asset_id, kind, model) DO UPDATE SET language=excluded.language, result=excluded.result, result_path=excluded.result_path, created_at=excluded.created_at`,
        ).run(uuid7(), assetId, `faster-whisper:${model}`, t.language, JSON.stringify({ words: t.words.length }), file, now())
        return t
      },
    })
    return job.done
  }

  async silences(projectId: string, assetId: string, opts: { thresholdDb?: number; minMs?: number } = {}): Promise<{ start: number; end: number }[]> {
    const thresholdDb = opts.thresholdDb ?? -35
    const minMs = opts.minMs ?? 500
    const model = `ffmpeg-silencedetect:${thresholdDb}dB:${minMs}ms`
    const hit = this.db.prepare(`SELECT result FROM analyses WHERE asset_id=? AND kind='silences' AND model=?`).get(assetId, model) as { result: string } | undefined
    if (hit) return JSON.parse(hit.result) as { start: number; end: number }[]
    const row = this.media.get(assetId)
    if (!row) throw new Error('Unknown media')
    if (!row.has_audio && row.kind !== 'audio') return []
    const job = this.jobs.add({
      kind: 'silences',
      title: `Finding silences in ${basename(row.path)}`,
      projectId,
      assetId,
      dedupeKey: `silences:${assetId}:${model}`,
      run: async ({ signal, progress }) => {
        const { stderr } = await runFfmpeg(['-i', this.media.playablePath(assetId) ?? row.path, '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minMs / 1000}`, '-f', 'null', '-'], {
          signal, durationUs: row.duration_us ?? undefined, onProgress: progress,
        })
        const out: { start: number; end: number }[] = []
        let start: number | null = null
        for (const line of stderr.split(/\r?\n/)) {
          const s = /silence_start: (-?[\d.]+)/.exec(line)
          const e = /silence_end: ([\d.]+)/.exec(line)
          if (s) start = Math.max(0, Number(s[1]))
          if (e && start !== null) { out.push({ start, end: Number(e[1]) }); start = null }
        }
        // a silence still open at the end of the file runs to the end
        if (start !== null && row.duration_us) out.push({ start, end: row.duration_us / 1e6 })
        this.db.prepare(`INSERT OR REPLACE INTO analyses (id, asset_id, kind, model, result, created_at) VALUES (?, ?, 'silences', ?, ?, ?)`)
          .run(uuid7(), assetId, model, JSON.stringify(out), now())
        return out
      },
    })
    return job.done
  }
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p
