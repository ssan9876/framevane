import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyOps, emptyProject, Op, OpError, Project, projectDurationUs, type OpInput, type Project as ProjectT,
} from '@framevane/doc'
import type { DocEvent, ProjectSummary } from '../shared/api'
import { now, uuid7, type Db } from './db'
import type { AppPaths } from './paths'

/**
 * Projects: a folder per project holding project.json (snapshot) + ops.jsonl (journal of committed op batches since
 * the snapshot). The main process owns the authoritative document of every open project; the renderer and agents
 * change it only through apply() with the version they started from.
 */

interface Open {
  doc: ProjectT
  dir: string
  undo: { ops: OpInput[]; inverse: OpInput[] }[]
  redo: { ops: OpInput[]; inverse: OpInput[] }[]
  saveTimer: NodeJS.Timeout | null
}

interface ProjectRow {
  id: string; type: 'video' | 'photo'; name: string; dir_path: string; cover_path: string | null; width: number; height: number
  fps_num: number | null; fps_den: number | null; duration_us: number; doc_version: number; status: ProjectSummary['status']
  created_at: number; updated_at: number; opened_at: number | null
}

const UNDO_LIMIT = 300

export class Projects {
  private open = new Map<string, Open>()

  constructor(private db: Db, private paths: AppPaths, private emit: (e: DocEvent) => void) {}

  list(): ProjectSummary[] {
    const rows = this.db.prepare(
      `SELECT p.*, m.thumbs_path AS cover_thumb FROM projects p LEFT JOIN media_assets m ON m.id = p.cover_path ORDER BY COALESCE(p.opened_at, p.updated_at) DESC`,
    ).all() as unknown as (ProjectRow & { cover_thumb: string | null })[]
    return rows.map((r) => this.summary(r))
  }

  create(name: string, canvas?: { width?: number; height?: number; fps?: number }): string {
    const id = uuid7()
    const dir = join(this.paths.projectsDir, `${slug(name)}-${id.slice(-6)}`)
    mkdirSync(dir, { recursive: true })
    const doc = emptyProject(id, name.trim() || 'Untitled', {
      ...(canvas?.width ? { width: canvas.width } : {}),
      ...(canvas?.height ? { height: canvas.height } : {}),
      ...(canvas?.fps ? { fps: { num: canvas.fps, den: 1 } } : {}),
    })
    writeAtomic(join(dir, 'project.json'), JSON.stringify(doc, null, 1))
    const t = now()
    this.db.prepare(
      `INSERT INTO projects (id, type, name, dir_path, width, height, fps_num, fps_den, duration_us, doc_version, status, created_at, updated_at, opened_at)
       VALUES (?, 'video', ?, ?, ?, ?, ?, ?, 0, 0, 'ok', ?, ?, ?)`,
    ).run(id, doc.name, dir, doc.canvas.width, doc.canvas.height, doc.canvas.fps.num, doc.canvas.fps.den, t, t, t)
    return id
  }

  load(projectId: string): DocEvent {
    const cur = this.open.get(projectId)
    if (cur) return this.event(projectId, cur, 'load')
    const row = this.row(projectId)
    const file = join(row.dir_path, 'project.json')
    if (!existsSync(file)) {
      this.db.prepare(`UPDATE projects SET status='missing_dir' WHERE id=?`).run(projectId)
      throw new Error(`The project folder is missing: ${row.dir_path}`)
    }
    let doc: ProjectT
    try {
      doc = Project.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch (e) {
      this.db.prepare(`UPDATE projects SET status='corrupt' WHERE id=?`).run(projectId)
      throw new Error(`project.json could not be read: ${e instanceof Error ? e.message : e}`)
    }
    doc = replayJournal(doc, join(row.dir_path, 'ops.jsonl'))
    const o: Open = { doc, dir: row.dir_path, undo: [], redo: [], saveTimer: null }
    this.open.set(projectId, o)
    this.db.prepare(`UPDATE projects SET opened_at=?, status='ok' WHERE id=?`).run(now(), projectId)
    return this.event(projectId, o, 'load')
  }

  get(projectId: string): ProjectT {
    const o = this.open.get(projectId) ?? (this.load(projectId), this.open.get(projectId)!)
    return o.doc
  }

  /** Commit an op batch. Rejects (without changing anything) when baseVersion is stale or an op is invalid. */
  apply(projectId: string, baseVersion: number, ops: OpInput[], source: DocEvent['source'] = 'user'): { ok: true; version: number } | { ok: false; code: string; message: string } {
    const o = this.mustOpen(projectId)
    if (baseVersion !== o.doc.version) return { ok: false, code: 'stale', message: `Document changed (now v${o.doc.version}, you sent v${baseVersion}).` }
    try {
      const parsed = ops.map((x) => Op.parse(x))
      const { doc, inverse } = applyOps(o.doc, parsed)
      this.commit(projectId, o, doc, parsed, source)
      o.undo.push({ ops: parsed, inverse })
      if (o.undo.length > UNDO_LIMIT) o.undo.shift()
      o.redo = []
      this.emit(this.event(projectId, o, source))
      return { ok: true, version: doc.version }
    } catch (e) {
      if (e instanceof OpError) return { ok: false, code: e.code, message: e.message }
      return { ok: false, code: 'invalid', message: e instanceof Error ? e.message : String(e) }
    }
  }

  undo(projectId: string) { this.step(projectId, 'undo') }
  redo(projectId: string) { this.step(projectId, 'redo') }

  private step(projectId: string, dir: 'undo' | 'redo') {
    const o = this.mustOpen(projectId)
    const entry = (dir === 'undo' ? o.undo : o.redo).pop()
    if (!entry) return
    const ops = dir === 'undo' ? entry.inverse : entry.ops
    try {
      const { doc, inverse } = applyOps(o.doc, ops)
      this.commit(projectId, o, doc, ops, dir)
      ;(dir === 'undo' ? o.redo : o.undo).push(dir === 'undo' ? { ops: entry.ops, inverse } : { ops: entry.ops, inverse })
    } catch (e) {
      // history no longer applies (should not happen: inverses are full restores). Drop it rather than corrupt the doc.
      console.error('[projects] could not', dir, e)
      o.undo = []
      o.redo = []
    }
    this.emit(this.event(projectId, o, dir))
  }

  close(projectId: string) {
    const o = this.open.get(projectId)
    if (!o) return
    this.flush(projectId, o)
    this.open.delete(projectId)
  }

  closeAll() { for (const id of [...this.open.keys()]) this.close(id) }

  /** Projects currently loaded in memory (the one in the editor, plus any an agent opened). */
  openIds(): string[] { return [...this.open.keys()] }

  rename(projectId: string, name: string) {
    const clean = name.trim().slice(0, 200)
    if (!clean) throw new Error('Name cannot be empty')
    const o = this.open.get(projectId)
    if (o) {
      o.doc = { ...o.doc, name: clean }
      this.scheduleSave(projectId, o)
      this.emit(this.event(projectId, o, 'user'))
    } else {
      const row = this.row(projectId)
      const file = join(row.dir_path, 'project.json')
      const doc = Project.parse(JSON.parse(readFileSync(file, 'utf8')))
      writeAtomic(file, JSON.stringify({ ...doc, name: clean }, null, 1))
    }
    this.db.prepare(`UPDATE projects SET name=?, updated_at=? WHERE id=?`).run(clean, now(), projectId)
  }

  duplicate(projectId: string): string {
    const src = this.row(projectId)
    const o = this.open.get(projectId)
    if (o) this.flush(projectId, o)
    const id = uuid7()
    const name = `${src.name} copy`
    const dir = join(this.paths.projectsDir, `${slug(name)}-${id.slice(-6)}`)
    cpSync(src.dir_path, dir, { recursive: true })
    const file = join(dir, 'project.json')
    const doc = replayJournal(Project.parse(JSON.parse(readFileSync(file, 'utf8'))), join(dir, 'ops.jsonl'))
    writeAtomic(file, JSON.stringify({ ...doc, id, name }, null, 1))
    rmSync(join(dir, 'ops.jsonl'), { force: true })
    const t = now()
    this.db.prepare(
      `INSERT INTO projects (id, type, name, dir_path, cover_path, width, height, fps_num, fps_den, duration_us, doc_version, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)`,
    ).run(id, src.type, name, dir, src.cover_path, src.width, src.height, src.fps_num, src.fps_den, src.duration_us, doc.version, t, t)
    this.db.prepare(`INSERT INTO project_media (project_id, asset_id, added_at) SELECT ?, asset_id, ? FROM project_media WHERE project_id = ?`).run(id, t, projectId)
    return id
  }

  /** Removes the project from the app and moves its folder to the OS trash (the caller does the trashing). */
  remove(projectId: string): string {
    const row = this.row(projectId)
    this.close(projectId)
    this.db.prepare(`DELETE FROM projects WHERE id=?`).run(projectId)
    return row.dir_path
  }

  /* ── internals ── */

  private commit(projectId: string, o: Open, doc: ProjectT, ops: OpInput[], source: string) {
    o.doc = doc
    try {
      appendFileSync(join(o.dir, 'ops.jsonl'), JSON.stringify({ v: doc.version, t: now(), source, ops }) + '\n')
    } catch (e) {
      console.error('[projects] journal write failed', e)
    }
    this.scheduleSave(projectId, o)
  }

  private scheduleSave(projectId: string, o: Open) {
    if (o.saveTimer) clearTimeout(o.saveTimer)
    o.saveTimer = setTimeout(() => this.flush(projectId, o), 2000)
  }

  private flush(projectId: string, o: Open) {
    if (o.saveTimer) { clearTimeout(o.saveTimer); o.saveTimer = null }
    writeAtomic(join(o.dir, 'project.json'), JSON.stringify(o.doc, null, 1))
    rmSync(join(o.dir, 'ops.jsonl'), { force: true })
    const firstVideo = o.doc.tracks.find((t) => t.main)?.clips.find((c) => c.kind === 'video' || c.kind === 'image')
    const cover = firstVideo && 'assetId' in firstVideo ? firstVideo.assetId : null
    this.db.prepare(`UPDATE projects SET name=?, width=?, height=?, fps_num=?, fps_den=?, duration_us=?, doc_version=?, cover_path=?, updated_at=? WHERE id=?`)
      .run(o.doc.name, o.doc.canvas.width, o.doc.canvas.height, o.doc.canvas.fps.num, o.doc.canvas.fps.den, projectDurationUs(o.doc), o.doc.version, cover, now(), projectId)
  }

  private mustOpen(projectId: string): Open {
    if (!this.open.has(projectId)) this.load(projectId)
    return this.open.get(projectId)!
  }

  /** The project's folder (recordings and other project-owned files live here). */
  dirOf(projectId: string): string { return this.row(projectId).dir_path }

  private row(projectId: string): ProjectRow {
    const r = this.db.prepare(`SELECT * FROM projects WHERE id=?`).get(projectId) as unknown as ProjectRow | undefined
    if (!r) throw new Error('Project not found')
    return r
  }

  private event(projectId: string, o: Open, source: DocEvent['source']): DocEvent {
    return { projectId, doc: o.doc, canUndo: o.undo.length > 0, canRedo: o.redo.length > 0, source }
  }

  private summary(r: ProjectRow & { cover_thumb?: string | null }): ProjectSummary {
    return {
      id: r.id, type: r.type, name: r.name, dirPath: r.dir_path,
      // cover_path holds the asset id of the first main-track clip; its poster is served by the media protocol
      coverUrl: r.cover_path && r.cover_thumb && existsSync(r.cover_thumb) ? `framevane-media://thumb/${r.cover_path}` : null,
      width: r.width, height: r.height, durationUs: r.duration_us,
      status: existsSync(r.dir_path) ? r.status : 'missing_dir',
      updatedAt: r.updated_at, openedAt: r.opened_at,
    }
  }
}

function replayJournal(doc: ProjectT, journal: string): ProjectT {
  if (!existsSync(journal)) return doc
  let cur = doc
  for (const line of readFileSync(journal, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as { v: number; ops: OpInput[] }
      if (entry.v <= cur.version) continue
      cur = applyOps(cur, entry.ops).doc
    } catch (e) {
      console.warn('[projects] stopped replaying journal at a bad entry', e)
      break
    }
  }
  return cur
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project'
}
