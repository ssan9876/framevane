import { app, BrowserWindow, dialog, ipcMain, shell, webContents } from 'electron'
import { mkdir, open as fsOpen, readFile, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDefInput, AudioPreset, AgentEvent, BatchEvent, DocEvent, ExternalActivity, JobEvent, MediaInfo, ProviderInput, ToolPermission } from '../shared/api'
import { AgentRunner } from './agent/runner'
import { AgentDefs } from './agent/defs'
import { TOOLS } from './agent/tools'
import { ToolRegistry } from './tool-registry'
import { EditorMcp, type UiState } from './editor-mcp'
import { Analysis } from './analysis'
import { openDb, uuid7 } from './db'
import { ffmpegPaths, runFfmpeg } from './ffmpeg'
import { JobQueue } from './jobs'
import { defaultSidecarDir, McpHub } from './mcp-hub'
import { Media } from './media'
import { appPaths } from './paths'
import { Projects } from './projects'
import { Fonts } from './fonts'
import { Luts } from './luts'
import { Ai } from './ai'
import { Storage } from './storage'
import { createPhotoProject } from './photo'
import type { Follow, ReframeRatio } from '@framevane/doc'
import { Tts } from './tts'
import { handleMediaProtocol, registerSchemePrivileges } from './protocol'

app.setName('Framevane')
// isolated profiles for tests and side-by-side dev
if (process.env.FRAMEVANE_USER_DATA) app.setPath('userData', process.env.FRAMEVANE_USER_DATA)
registerSchemePrivileges()

// Prefer the discrete GPU (RTX) for WebGPU/WebCodecs over the integrated one.
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,MediaFoundationD3D11VideoCapture')
// test hook: a synthetic microphone (a beep) and auto-accepted capture prompts for the voiceover e2e
if (process.env.FRAMEVANE_FAKE_MEDIA === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

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
  const hub = new McpHub({ sidecarDir: defaultSidecarDir(app.getAppPath(), app.isPackaged ? process.resourcesPath : undefined), modelsDir: paths.models, ...(app.isPackaged ? { venvDir: join(paths.userData, 'sidecar-env') } : {}) })
  const analysis = new Analysis(db, paths, jobs, media, hub)
  const registry = new ToolRegistry(db, hub)
  const defs = new AgentDefs(db)
  defs.seed()
  const agent = new AgentRunner(db, projects, analysis, media, registry, defs, (e: AgentEvent) => broadcast('agent:event', e), (e: BatchEvent) => broadcast('agent:batch', e))
  void registry.connectAll()
  const fonts = new Fonts(join(paths.userData, 'fonts'))
  const luts = new Luts(paths.userData)
  const storage = new Storage(db, paths, hub)
  const ai = new Ai(hub, media, jobs, paths, (assetId: string) => broadcast('ai:matte', assetId))
  const tts = new Tts(paths.cacheDir, hub)
  handleMediaProtocol(media, fonts, ai)

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
  agent.tts = tts
  agent.luts = luts
  agent.ai = ai
  const editorMcp = new EditorMcp({
    db, projects, media, analysis, tts, luts, ai,
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
  ipcMain.handle('app:pickFiles', async (e, opts: { kind: 'media' | 'image' | 'subtitle' | 'font' | 'lut' }) => {
    // test hook: e2e runs can't click native dialogs
    if (process.env.FRAMEVANE_TEST_PICK_FILES) return process.env.FRAMEVANE_TEST_PICK_FILES.split(';').filter(Boolean)
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: opts.kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'] }]
        : opts.kind === 'subtitle'
        ? [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }]
        : opts.kind === 'lut'
        ? [{ name: '3D LUTs', extensions: ['cube'] }]
        : opts.kind === 'font'
        ? [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
        : [{ name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }, { name: 'All files', extensions: ['*'] }],
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('app:pickFolder', async (e) => {
    if (process.env.FRAMEVANE_TEST_PICK_FOLDER) return process.env.FRAMEVANE_TEST_PICK_FOLDER
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('storage:usage', () => storage.usage())
  ipcMain.handle('storage:clear', (_e, id: Parameters<Storage['clear']>[0]) => storage.clear(id))
  ipcMain.handle('storage:projectsDir', () => storage.projectsDir())
  ipcMain.handle('storage:setProjectsDir', (_e, dir: string) => storage.setProjectsDir(dir))
  ipcMain.handle('storage:aiDevice', () => storage.aiDevice())
  ipcMain.handle('storage:setAiDevice', (_e, d: 'auto' | 'cpu') => storage.setAiDevice(d))
  ipcMain.handle('storage:aiHealth', () => storage.aiHealth())
  ipcMain.handle('app:pickSavePath', async (e, opts: { defaultName: string; ext: string }) => {
    if (process.env.FRAMEVANE_TEST_SAVE_DIR) return join(process.env.FRAMEVANE_TEST_SAVE_DIR, `${opts.defaultName}.${opts.ext}`)
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('videos'), `${opts.defaultName}.${opts.ext}`), filters: [{ name: opts.ext.toUpperCase(), extensions: [opts.ext] }] })
    return r.canceled ? null : r.filePath
  })
  ipcMain.handle('app:showItemInFolder', (_e, path: string) => shell.showItemInFolder(path))
  // only for files the user picked in a dialog: captions out (.srt/.txt) and in (.srt/.vtt)
  ipcMain.handle('app:writeTextFile', async (_e, path: string, text: string) => {
    if (!/\.(srt|vtt|txt)$/i.test(path)) throw new Error('Only caption files (.srt, .vtt, .txt) can be written')
    await writeFile(path, text, 'utf8')
  })
  ipcMain.handle('app:readTextFile', async (_e, path: string) => {
    if (!/\.(srt|vtt|txt)$/i.test(path)) throw new Error('Only caption files (.srt, .vtt, .txt) can be read')
    const st = await stat(path)
    if (st.size > 10 * 1024 * 1024) throw new Error('That file is too large to be a caption file')
    return readFile(path, 'utf8')
  })

  /* ── projects & doc ── */
  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:create', async (_e, opts: { name: string; width?: number; height?: number; fps?: number; files?: string[]; kind?: 'video' | 'photo' }) => {
    if (opts.kind === 'photo') return { projectId: await createPhotoProject(projects, media, opts.name, opts.files ?? [], opts) }
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
  ipcMain.handle('media:processAudio', (_e, projectId: string, assetId: string, preset: AudioPreset) => media.processAudio(projectId, assetId, preset))
  ipcMain.handle('media:saveRecording', (_e, projectId: string, data: Uint8Array) => media.saveRecording(projectId, data, projects.dirOf(projectId)))
  ipcMain.handle('ai:models', () => ai.models())
  ipcMain.handle('ai:installModel', (_e, id: string) => ai.installModel(id))
  ipcMain.handle('ai:removeModel', (_e, id: string) => ai.removeModel(id))
  ipcMain.handle('ai:mattes', () => ai.readyMattes())
  ipcMain.handle('ai:matte', async (_e, projectId: string, assetId: string) => { await ai.matte(projectId, assetId) })
  ipcMain.handle('ai:reframe', async (_e, projectId: string, opts: { ratio: ReframeRatio; follow: Follow; clipIds?: string[] }) => {
    const r = await ai.reframe(projects.get(projectId), opts)
    return { ops: r.ops, clips: r.clips, followed: r.followed }
  })
  ipcMain.handle('luts:import', (_e, paths: string[]) => luts.import(paths))
  ipcMain.handle('luts:read', (_e, file: string) => luts.read(file))
  ipcMain.handle('fonts:system', () => fonts.systemFamilies())
  ipcMain.handle('fonts:custom', () => fonts.custom())
  ipcMain.handle('fonts:import', (_e, paths: string[]) => fonts.import(paths))
  ipcMain.handle('fonts:remove', async (_e, file: string) => { await fonts.remove(file); return fonts.custom() })
  ipcMain.handle('tts:voices', () => tts.voices())
  ipcMain.handle('tts:installKokoro', () => jobs.add({ kind: 'tts', title: 'Downloading natural voices', run: ({ progress }) => tts.installKokoro((p) => progress(p)) }).done)
  ipcMain.handle('tts:speak', async (_e, projectId: string, text: string, voiceId: string, speed: number) => {
    const file = await jobs.add({ kind: 'tts', title: 'Generating speech', projectId, run: ({ signal }) => tts.synthesize(text, voiceId, speed, signal) }).done
    const [info] = await media.import(projectId, [file])
    return info!
  })
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
  ipcMain.handle('export:tempPath', async (_e, ext: string) => {
    if (!/^[a-z0-9]{2,4}$/.test(ext)) throw new Error('Bad extension')
    const dir = join(paths.cacheDir, 'export-tmp')
    await mkdir(dir, { recursive: true })
    return join(dir, `${uuid7()}.${ext}`)
  })
  ipcMain.handle('export:convert', async (_e, o: { kind: 'gif'; src: string; out: string; fps: number; width: number } | { kind: 'audio'; src: string; out: string; format: 'mp3' | 'm4a' }) => {
    // the source must be one of our scratch files
    if (!o.src.startsWith(join(paths.cacheDir, 'export-tmp'))) throw new Error('Unknown export source')
    try {
      if (o.kind === 'gif') {
        const fps = Math.max(5, Math.min(30, Math.round(o.fps)))
        const w = Math.max(64, Math.min(1920, Math.round(o.width)))
        await runFfmpeg(['-i', o.src, '-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', o.out])
      } else {
        await runFfmpeg(['-i', o.src, '-vn', ...(o.format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']), o.out])
      }
    } finally {
      await rm(o.src, { force: true })
    }
    return { path: o.out, bytes: (await stat(o.out)).size }
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
