import { app, BrowserWindow, dialog, ipcMain, shell, webContents } from 'electron'
import { open as fsOpen, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDefInput, AgentEvent, BatchEvent, DocEvent, ExternalActivity, JobEvent, MediaInfo, ProviderInput, ToolPermission } from '../shared/api'
import { AgentRunner } from './agent/runner'
import { AgentDefs } from './agent/defs'
import { TOOLS } from './agent/tools'
import { ToolRegistry } from './tool-registry'
import { EditorMcp, type UiState } from './editor-mcp'
import { Analysis } from './analysis'
import { openDb, uuid7 } from './db'
import { ffmpegPaths } from './ffmpeg'
import { JobQueue } from './jobs'
import { defaultSidecarDir, McpHub } from './mcp-hub'
import { Media } from './media'
import { appPaths } from './paths'
import { Projects } from './projects'
import { handleMediaProtocol, registerSchemePrivileges } from './protocol'

app.setName('Framevane')
// isolated profiles for tests and side-by-side dev
if (process.env.FRAMEVANE_USER_DATA) app.setPath('userData', process.env.FRAMEVANE_USER_DATA)
registerSchemePrivileges()

// Prefer the discrete GPU (RTX) for WebGPU/WebCodecs over the integrated one.
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,MediaFoundationD3D11VideoCapture')

const isDev = !!process.env.VITE_DEV_SERVER_URL

function broadcast(channel: string, payload: unknown) {
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send(channel, payload)
}

async function main() {
  await app.whenReady()
  const paths = appPaths()
  const db = openDb(paths.db)
  const jobs = new JobQueue(db, (e: JobEvent) => broadcast('jobs:event', e))
  const media = new Media(db, paths, jobs, (projectId: string, m: MediaInfo) => broadcast('media:change', { projectId, ...m }))
  const projects = new Projects(db, paths, (e: DocEvent) => broadcast('doc:change', e))
  const hub = new McpHub({ sidecarDir: defaultSidecarDir(app.getAppPath(), app.isPackaged ? process.resourcesPath : undefined), modelsDir: paths.models })
  const analysis = new Analysis(db, paths, jobs, media, hub)
  const registry = new ToolRegistry(db, hub)
  const defs = new AgentDefs(db)
  defs.seed()
  const agent = new AgentRunner(db, projects, analysis, media, registry, defs, (e: AgentEvent) => broadcast('agent:event', e), (e: BatchEvent) => broadcast('agent:batch', e))
  void registry.connectAll()
  handleMediaProtocol(media)

  /* ── Framevane as an MCP server (Claude Code connects here) ── */
  let ui: UiState = { projectId: null, playheadUs: 0, selection: [] }
  const uiWaiters: ((s: UiState) => void)[] = []
  ipcMain.on('mcp:ui-state', (_e, s: UiState) => { ui = s; for (const w of uiWaiters.splice(0)) w(s) })
  const pending = new Map<string, (v: unknown) => void>()
  ipcMain.on('mcp:open-project:reply', (_e, id: string, ok: boolean) => pending.get(id)?.(ok))
  ipcMain.on('mcp:export:reply', (_e, id: string, result: unknown) => pending.get(id)?.(result))
  const ask = <T>(channel: string, payload: Record<string, unknown>, timeoutMs: number) => new Promise<T>((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return reject(new Error('The Framevane window is closed.'))
    const requestId = uuid7()
    const t = setTimeout(() => { pending.delete(requestId); reject(new Error('The Framevane window did not respond in time.')) }, timeoutMs)
    pending.set(requestId, (v) => { clearTimeout(t); pending.delete(requestId); resolve(v as T) })
    win.webContents.send(channel, { requestId, ...payload })
  })
  const editorMcp = new EditorMcp({
    db, projects, media, analysis,
    emitActivity: (a: ExternalActivity) => broadcast('mcp:activity', a),
    ui: () => ui,
    openInUi: async (projectId) => {
      if (ui.projectId === projectId) return
      projects.list().find((p) => p.id === projectId) ?? (() => { throw new Error(`No project with id ${projectId}`) })()
      const ok = await ask<boolean>('mcp:open-project', { projectId }, 20_000)
      if (!ok) throw new Error('Framevane could not open that project.')
    },
    exportInUi: async (projectId, s) => {
      const r = await ask<{ ok: true; path: string; bytes: number } | { ok: false; error: string }>('mcp:export', { projectId, ...s }, 60 * 60_000)
      if (!r.ok) throw new Error(r.error)
      return { path: r.path, bytes: r.bytes }
    },
  })
  ipcMain.handle('mcp:info', () => editorMcp.info())
  ipcMain.handle('mcp:setEnabled', (_e, on: boolean) => editorMcp.setEnabled(on))
  ipcMain.handle('mcp:resetToken', () => editorMcp.resetToken())
  ipcMain.handle('mcp:connectClaudeCode', () => editorMcp.connectClaudeCode())
  void editorMcp.start()

  /* ── app ── */
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), userData: paths.userData, projectsDir: paths.projectsDir,
    ffmpeg: ffmpegPaths()?.ffmpeg ?? null, sidecar: hub.sidecarStatus,
  }))
  ipcMain.handle('app:pickFiles', async (e, opts: { kind: 'media' | 'image' }) => {
    // test hook: e2e runs can't click native dialogs
    if (process.env.FRAMEVANE_TEST_PICK_FILES) return process.env.FRAMEVANE_TEST_PICK_FILES.split(';').filter(Boolean)
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: opts.kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }]
        : [{ name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }, { name: 'All files', extensions: ['*'] }],
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('app:pickSavePath', async (e, opts: { defaultName: string; ext: string }) => {
    if (process.env.FRAMEVANE_TEST_SAVE_DIR) return join(process.env.FRAMEVANE_TEST_SAVE_DIR, `${opts.defaultName}.${opts.ext}`)
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('videos'), `${opts.defaultName}.${opts.ext}`), filters: [{ name: opts.ext.toUpperCase(), extensions: [opts.ext] }] })
    return r.canceled ? null : r.filePath
  })
  ipcMain.handle('app:showItemInFolder', (_e, path: string) => shell.showItemInFolder(path))

  /* ── projects & doc ── */
  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:create', async (_e, opts: { name: string; width?: number; height?: number; fps?: number; files?: string[] }) => {
    const projectId = projects.create(opts.name, opts)
    if (opts.files?.length) {
      const infos = await media.import(projectId, opts.files)
      const doc = projects.get(projectId)
      let t = 0
      const ops = infos.flatMap((m) => {
        const add = [{ type: 'add_asset' as const, asset: m.asset }]
        if (m.status === 'unsupported') return add
        const dur = m.asset.durationUs ?? 5_000_000
        const clip = m.asset.kind === 'audio'
          ? null
          : { type: 'add_clip' as const, trackId: 'track-main', clip: { id: `clip-${uuid7().slice(-12)}`, kind: m.asset.kind === 'image' ? ('image' as const) : ('video' as const), assetId: m.asset.id, startUs: t, durationUs: dur } }
        if (clip) t += dur
        return clip ? [...add, clip] : add
      })
      // match the canvas to the first video (an "Original" ratio project)
      const first = infos.find((m) => m.asset.kind === 'video' && m.asset.width && m.asset.height)
      const canvas = first && !opts.width ? [{ type: 'set_canvas' as const, canvas: { width: first.asset.width!, height: first.asset.height!, ...(first.asset.fps ? { fps: first.asset.fps } : {}) } }] : []
      projects.apply(projectId, doc.version, [...canvas, ...ops], 'load')
      projects.close(projectId)
    }
    return { projectId }
  })
  ipcMain.handle('projects:open', (_e, id: string) => projects.load(id))
  ipcMain.handle('projects:close', (_e, id: string) => projects.close(id))
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => projects.rename(id, name))
  ipcMain.handle('projects:duplicate', (_e, id: string) => ({ projectId: projects.duplicate(id) }))
  ipcMain.handle('projects:remove', async (_e, id: string) => {
    const dir = projects.remove(id)
    await shell.trashItem(dir).catch(() => rm(dir, { recursive: true, force: true }))
  })
  ipcMain.handle('doc:apply', (_e, id: string, base: number, ops: unknown[]) => projects.apply(id, base, ops as never))
  ipcMain.handle('doc:undo', (_e, id: string) => projects.undo(id))
  ipcMain.handle('doc:redo', (_e, id: string) => projects.redo(id))

  /* ── media, jobs, analysis ── */
  ipcMain.handle('media:import', (_e, projectId: string, files: string[]) => media.import(projectId, files))
  ipcMain.handle('media:list', (_e, projectId: string) => media.list(projectId))
  ipcMain.handle('media:reverse', (_e, projectId: string, assetId: string, inUs: number, outUs: number) => media.reverse(projectId, assetId, inUs, outUs))
  ipcMain.handle('media:relink', (_e, projectId: string, assetId: string, newPath: string) => media.relink(projectId, assetId, newPath))
  ipcMain.handle('jobs:cancel', (_e, id: string) => jobs.cancel(id))
  ipcMain.handle('analysis:transcript', (_e, projectId: string, assetId: string, opts) => analysis.transcript(projectId, assetId, opts ?? {}))
  ipcMain.handle('analysis:silences', (_e, projectId: string, assetId: string, opts) => analysis.silences(projectId, assetId, opts ?? {}))

  /* ── export: the renderer encodes; main writes bytes at positions (StreamTarget) ── */
  const exports = new Map<string, { fh: FileHandle; path: string; bytes: number }>()
  ipcMain.handle('export:open', async (_e, path: string) => {
    const handle = uuid7()
    exports.set(handle, { fh: await fsOpen(path, 'w'), path, bytes: 0 })
    return { handle }
  })
  ipcMain.handle('export:write', async (_e, handle: string, position: number, data: Uint8Array) => {
    const x = exports.get(handle)
    if (!x) throw new Error('Export is not open')
    await x.fh.write(data, 0, data.byteLength, position)
    x.bytes = Math.max(x.bytes, position + data.byteLength)
  })
  ipcMain.handle('export:close', async (_e, handle: string, opts: { abort?: boolean }) => {
    const x = exports.get(handle)
    if (!x) throw new Error('Export is not open')
    await x.fh.close()
    exports.delete(handle)
    if (opts.abort) await rm(x.path, { force: true })
    return { path: x.path, bytes: x.bytes }
  })

  /* ── agent ── */
  ipcMain.handle('agent:settings', () => agent.settings())
  ipcMain.handle('agent:setApiKey', (_e, key: string | null) => agent.setApiKey(key))
  ipcMain.handle('agent:setModel', (_e, model: string, effort) => agent.setModel(model, effort))
  ipcMain.handle('agent:run', (_e, projectId: string, prompt: string, context, agentDefId?: string) => agent.start(projectId, prompt, context, agentDefId))
  ipcMain.handle('agent:pending', (_e, projectId: string) => agent.pending(projectId))
  ipcMain.handle('agent:defs', () => defs.list())
  ipcMain.handle('agent:toolList', () => [
    ...TOOLS.map((t) => ({ name: t.name, provider: 'editor', description: t.description })).sort((a, b) => a.name.localeCompare(b.name)),
    ...registry.agentTools().map((t) => ({ name: t.fullName, provider: t.provider, description: t.description })),
  ])
  ipcMain.handle('agent:saveDef', (_e, id: string | null, def: AgentDefInput) => defs.save(id, def))
  ipcMain.handle('agent:deleteDef', (_e, id: string) => defs.delete(id))
  ipcMain.handle('agent:batch', (_e, projectIds: string[], agentDefId: string, prompt: string, autoApply: boolean) => agent.batch(projectIds, agentDefId, prompt, autoApply))
  ipcMain.handle('agent:cancel', (_e, runId: string) => agent.cancel(runId))
  ipcMain.handle('agent:permission', (_e, runId: string, toolCallId: string, allow: boolean, remember?: boolean) => agent.permission(runId, toolCallId, allow, remember))
  ipcMain.handle('agent:review', (_e, runId: string, ids: string[], action: 'apply' | 'reject') => agent.review(runId, ids, action))
  ipcMain.handle('agent:previewDoc', (_e, runId: string, ids: string[]) => agent.previewDoc(runId, ids))

  /* ── tool providers: MCP servers the user added for the built-in agent ── */
  ipcMain.handle('tools:providers', () => registry.list())
  ipcMain.handle('tools:add', (_e, input: ProviderInput) => registry.add(input))
  ipcMain.handle('tools:update', (_e, id: string, input: ProviderInput) => registry.update(id, input))
  ipcMain.handle('tools:remove', (_e, id: string) => registry.remove(id))
  ipcMain.handle('tools:refresh', (_e, id: string) => registry.refresh(id))
  ipcMain.handle('tools:setEnabled', (_e, id: string, on: boolean) => registry.setEnabled(id, on))
  ipcMain.handle('tools:setToolPermission', (_e, id: string, tool: string, p: ToolPermission) => registry.setToolPermission(id, tool, p))
  ipcMain.handle('tools:setToolCostsMoney', (_e, id: string, tool: string, on: boolean) => registry.setToolCostsMoney(id, tool, on))

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  app.on('before-quit', () => { projects.closeAll(); void hub.closeAll(); void editorMcp.stop() })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0e0f11',
    title: 'Framevane',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  // links open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file:')) e.preventDefault() })
  if (isDev) void win.loadURL(process.env.VITE_DEV_SERVER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  if (process.env.FRAMEVANE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

main().catch((e) => {
  dialog.showErrorBox('Framevane could not start', e instanceof Error ? `${e.message}\n\n${e.stack}` : String(e))
  app.quit()
})
