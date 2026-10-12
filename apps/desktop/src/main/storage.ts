import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { access, constants, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CacheUsage } from '../shared/api'
import { now, type Db } from './db'
import type { McpHub } from './mcp-hub'
import type { AppPaths } from './paths'

/**
 * S23 · Performance and storage settings: where new projects go, which processor the local AI uses, and the caches
 * (what they hold, how big they are, and clearing the ones that rebuild themselves).
 */

type CacheId = 'previews' | 'proxies' | 'transcripts' | 'mattes' | 'tracks' | 'generated'

function dirSize(dir: string, filter: (name: string) => boolean = () => true): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) total += dirSize(p, filter)
    else if (filter(e.name)) { try { total += statSync(p).size } catch { /* vanished */ } }
  }
  return total
}

function emptyDir(dir: string, filter: (name: string) => boolean = () => true) {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && filter(e.name)) rmSync(join(dir, e.name), { force: true })
    else if (e.isDirectory() && filter(e.name)) rmSync(join(dir, e.name), { recursive: true, force: true })
  }
}

const isProxy = (n: string) => n.endsWith('.proxy.mp4')

export class Storage {
  constructor(private db: Db, private paths: AppPaths, private hub: McpHub) {
    // a projects folder chosen in Settings applies from the next start too (tests pin theirs with the env var)
    const dir = this.get<string>('projects.dir')
    if (dir && !process.env.FRAMEVANE_PROJECTS_DIR && existsSync(dir)) paths.projectsDir = dir
    hub.forceCpu = this.aiDevice() === 'cpu'
  }

  private get<T>(key: string): T | undefined {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined
    return r ? (JSON.parse(r.value) as T) : undefined
  }
  private set(key: string, value: unknown) {
    this.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, JSON.stringify(value), now())
  }

  /* ───────────── projects folder ───────────── */

  projectsDir() { return this.paths.projectsDir }

  /** New projects go here; existing projects stay where they are. */
  async setProjectsDir(dir: string) {
    await mkdir(dir, { recursive: true })
    await access(dir, constants.W_OK).catch(() => { throw new Error("Framevane can't write to that folder. Pick another one.") })
    this.paths.projectsDir = dir
    this.set('projects.dir', dir)
    return dir
  }

  /* ───────────── AI device ───────────── */

  aiDevice(): 'auto' | 'cpu' { return this.get<'auto' | 'cpu'>('ai.device') ?? 'auto' }

  /** Switch the local AI between the GPU (when there is one) and the CPU; the sidecar restarts on its next use. */
  async setAiDevice(device: 'auto' | 'cpu') {
    this.set('ai.device', device)
    this.hub.forceCpu = device === 'cpu'
    await this.hub.disconnect('local')
    return device
  }

  /** What the local AI can use, as reported by the sidecar. */
  async aiHealth(): Promise<{ gpu: boolean; providers: string[]; cudaDevices: number }> {
    const h = await this.hub.callTool<{ onnx_providers?: string[]; cuda_devices?: number }>('local', 'health', {}, { timeoutMs: 120_000 })
    const providers = h.onnx_providers ?? []
    return { gpu: providers.includes('DmlExecutionProvider') || (h.cuda_devices ?? 0) > 0, providers, cudaDevices: h.cuda_devices ?? 0 }
  }

  /* ───────────── caches ───────────── */

  usage(): CacheUsage[] {
    const c = this.paths.cacheDir
    return [
      { id: 'previews', label: 'Thumbnails and waveforms', bytes: dirSize(this.paths.thumbs) + dirSize(this.paths.peaks), clearable: true, note: 'Made again when you open a project.' },
      { id: 'proxies', label: 'Preview proxies', bytes: dirSize(this.paths.mezzanine, isProxy), clearable: true, note: 'Light copies of big videos for smooth preview. Made again when needed.' },
      { id: 'transcripts', label: 'Transcripts', bytes: dirSize(this.paths.transcripts), clearable: true, note: 'Speech found in your media. Captions you already added stay.' },
      { id: 'mattes', label: 'Background removal', bytes: dirSize(join(c, 'mattes')), clearable: true, note: 'Clips with background removal make theirs again when shown.' },
      { id: 'tracks', label: 'Subject tracking', bytes: dirSize(join(c, 'tracks')), clearable: true, note: 'Used by auto reframe; reframed clips keep their keyframes.' },
      { id: 'generated', label: 'Converted and generated media', bytes: dirSize(this.paths.mezzanine, (n) => !isProxy(n)) + dirSize(join(c, 'tts')), clearable: false, note: 'Reversed clips, cleaned-up audio, speech and converted files your projects use. Kept.' },
    ]
  }

  clear(id: CacheId): CacheUsage[] {
    const c = this.paths.cacheDir
    if (id === 'previews') {
      emptyDir(this.paths.thumbs)
      emptyDir(this.paths.peaks)
      this.db.prepare(`UPDATE media_assets SET thumbs_path = NULL, waveform_path = NULL`).run()
    } else if (id === 'proxies') {
      emptyDir(this.paths.mezzanine, isProxy)
      this.db.prepare(`UPDATE media_assets SET proxy_path = NULL`).run()
    } else if (id === 'transcripts') {
      emptyDir(this.paths.transcripts)
      this.db.prepare(`DELETE FROM analyses WHERE kind IN ('transcript', 'silences')`).run()
    } else if (id === 'mattes' || id === 'tracks') {
      emptyDir(join(c, id))
      mkdirSync(join(c, id), { recursive: true })
    } else throw new Error('That cache holds media your projects use, so it is kept.')
    return this.usage()
  }
}
