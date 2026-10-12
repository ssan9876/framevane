import { projectDurationUs } from '@reel/doc'
import type { ExternalActivity } from '../../shared/api'
import { exportProject } from '../engine/export'
import { useApp } from './store'

/**
 * Renderer side of "Reel as an MCP server": tells the main process what is open (so connected agents edit the right
 * project and know the playhead/selection), opens projects and runs exports on request (WebCodecs lives here).
 */
export function connectMcpBridge(onActivity: (a: ExternalActivity) => void) {
  let last = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const report = () => {
    const s = useApp.getState()
    const state = { projectId: s.route.name === 'editor' && s.doc ? s.doc.id : null, playheadUs: Math.round(s.playheadUs), selection: s.selection }
    const key = JSON.stringify(state)
    if (key === last) return
    last = key
    window.reel.mcp.reportUiState(state)
  }
  // project switches are reported at once; playhead/selection changes are throttled
  const unsub = useApp.subscribe((s, prev) => {
    if (s.doc?.id !== prev.doc?.id || s.route !== prev.route) { report(); return }
    if (!timer) timer = setTimeout(() => { timer = null; report() }, 150)
  })
  report()

  const offOpen = window.reel.mcp.onOpenProject(async ({ requestId, projectId }) => {
    const s = useApp.getState()
    if (s.dialog) s.openDialog(null)
    s.go({ name: 'editor', projectId })
    const ok = await new Promise<boolean>((resolve) => {
      const done = (v: boolean) => { clearTimeout(t); off(); resolve(v) }
      const t = setTimeout(() => done(false), 15_000)
      const off = useApp.subscribe((x) => { if (x.doc?.id === projectId) { report(); done(true) } })
      if (useApp.getState().doc?.id === projectId) done(true)
    })
    window.reel.mcp.replyOpenProject(requestId, ok)
  })

  const offExport = window.reel.mcp.onExport(async (req) => {
    const doc = useApp.getState().doc
    if (!doc || doc.id !== req.projectId) return window.reel.mcp.replyExport(req.requestId, { ok: false, error: 'That project is not open in Reel.' })
    if (projectDurationUs(doc) === 0) return window.reel.mcp.replyExport(req.requestId, { ok: false, error: 'The timeline is empty.' })
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
    const portrait = doc.canvas.height > doc.canvas.width
    const ar = doc.canvas.width / doc.canvas.height
    const width = even(portrait ? req.height : req.height * ar)
    const height = even(portrait ? req.height / ar : req.height)
    try {
      onActivity({ id: req.requestId, client: 'Connected agent', tool: 'export_video', summary: `${width}×${height} · rendering`, status: 'running', mutates: false })
      const r = await exportProject(doc, { projectId: doc.id, outputPath: req.outputPath, width, height, fps: req.fps, bitrate: Math.round(width * height * req.fps * 0.12), codec: req.codec }, () => {}, new AbortController().signal)
      window.reel.mcp.replyExport(req.requestId, { ok: true, path: r.path, bytes: r.bytes })
    } catch (e) {
      window.reel.mcp.replyExport(req.requestId, { ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  const offActivity = window.reel.mcp.onActivity(onActivity)
  return () => { unsub(); offOpen(); offExport(); offActivity(); if (timer) clearTimeout(timer) }
}
