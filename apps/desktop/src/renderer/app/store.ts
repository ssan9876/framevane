import { create } from 'zustand'
import type { Clip, OpInput, Project, TrackKind } from '@framevane/doc'
import type { AgentEvent, AgentRunStatus, ExternalActivity, JobEvent, MediaInfo, ProjectSummary, ProposedOp } from '../../shared/api'

/**
 * Renderer state. The project document is owned by the main process; this store mirrors it from doc:change events.
 * UI-only state (playhead, selection, zoom, panels) lives here.
 */

export type Route =
  | { name: 'home' }
  | { name: 'editor'; projectId: string }
  | { name: 'photo' }
  | { name: 'ai-maker' }

export interface AgentTurn {
  id: string
  role: 'user' | 'agent'
  text: string
  streaming?: boolean
  meta?: string
}
export interface AgentToolStep { toolCallId: string; provider: string; tool: string; summary: string; status: 'running' | 'done' | 'error' | 'awaiting' | 'denied'; detail?: string; durationMs?: number }
export interface AgentRunView {
  runId: string
  status: AgentRunStatus
  error?: string
  items: ({ type: 'turn'; turn: AgentTurn } | { type: 'note'; text: string } | { type: 'tool'; step: AgentToolStep })[]
  proposal?: { ops: ProposedOp[]; summary: string; costMicroUsd: number }
  usage?: { inputTokens: number; outputTokens: number; costMicroUsd: number }
}

interface State {
  route: Route
  projects: ProjectSummary[]
  doc: Project | null
  canUndo: boolean
  canRedo: boolean
  media: MediaInfo[]
  /** The media list for the open project has arrived (until then, readiness is unknown). */
  mediaLoaded: boolean
  jobs: Record<string, JobEvent>
  playheadUs: number
  playing: boolean
  selection: string[]
  pxPerSec: number
  magnet: boolean
  snapping: boolean
  /** Video and its detached audio select, move and cut together. */
  linkage: boolean
  /** Preview decodes 1280px proxies of big media (saved per computer). */
  useProxies: boolean
  clipboard: { items: { trackId: string; trackKind: TrackKind; clip: Clip }[]; originUs: number } | null
  dialog: null | 'export' | 'settings' | 'project-settings' | 'review' | 'shortcuts'
  dialogArg: string | null
  agentRuns: AgentRunView[]
  reviewRunId: string | null
  /** Tool calls from connected MCP clients (Claude Code…), newest last. */
  externalActivity: ExternalActivity[]
  error: string | null

  go(route: Route): void
  loadProjects(): Promise<void>
  setDoc(doc: Project, canUndo: boolean, canRedo: boolean): void
  apply(ops: OpInput[]): Promise<boolean>
  setPlayhead(us: number): void
  select(ids: string[]): void
  setZoom(pxPerSec: number): void
  openDialog(d: State['dialog'], arg?: string | null): void
  setError(e: string | null): void
  agentEvent(e: AgentEvent): void
  startAgentRun(runId: string, prompt: string): void
  pushActivity(a: ExternalActivity): void
}

export const useApp = create<State>((set, get) => ({
  route: { name: 'home' },
  projects: [],
  doc: null,
  canUndo: false,
  canRedo: false,
  media: [],
  mediaLoaded: false,
  jobs: {},
  playheadUs: 0,
  playing: false,
  selection: [],
  pxPerSec: 60,
  magnet: true,
  snapping: true,
  linkage: true,
  useProxies: (() => { try { return localStorage.getItem('framevane.useProxies') !== 'false' } catch { return true } })(),
  clipboard: null,
  dialog: null,
  dialogArg: null,
  agentRuns: [],
  reviewRunId: null,
  externalActivity: [],
  error: null,

  go(route) {
    const cur = get().route
    if (cur.name === 'editor' && (route.name !== 'editor' || route.projectId !== cur.projectId)) void window.framevane.projects.close(cur.projectId)
    set({ route, ...(route.name !== 'editor' ? { doc: null, media: [], mediaLoaded: false, selection: [], playheadUs: 0, agentRuns: [] } : {}) })
  },

  async loadProjects() {
    set({ projects: await window.framevane.projects.list() })
  },

  setDoc(doc, canUndo, canRedo) {
    const ids = new Set(doc.tracks.flatMap((t) => t.clips.map((c) => c.id)))
    set((s) => ({ doc, canUndo, canRedo, selection: s.selection.filter((id) => ids.has(id)) }))
  },

  async apply(ops) {
    const { doc } = get()
    if (!doc || !ops.length) return false
    const r = await window.framevane.doc.apply(doc.id, doc.version, ops)
    if (!r.ok) {
      // a stale version means another edit landed first (e.g. an agent); the next doc:change brings us up to date
      if (r.code !== 'stale') set({ error: r.message })
      return false
    }
    return true
  },

  setPlayhead(us) { set({ playheadUs: Math.max(0, Math.round(us)) }) },
  select(ids) { set({ selection: ids }) },
  setZoom(pxPerSec) { set({ pxPerSec: Math.min(600, Math.max(2, pxPerSec)) }) },
  openDialog(dialog, dialogArg = null) { set({ dialog, dialogArg }) },
  setError(error) { set({ error }) },

  pushActivity(a) {
    set((s) => {
      const i = s.externalActivity.findIndex((x) => x.id === a.id)
      const list = i >= 0 ? s.externalActivity.map((x, j) => (j === i ? a : x)) : [...s.externalActivity, a]
      return { externalActivity: list.slice(-40) }
    })
  },

  startAgentRun(runId, prompt) {
    set((s) => ({ agentRuns: [...s.agentRuns, { runId, status: 'running', items: [{ type: 'turn', turn: { id: `${runId}-u`, role: 'user', text: prompt } }] }] }))
  },

  agentEvent(e) {
    set((s) => ({
      agentRuns: s.agentRuns.map((r) => {
        if (r.runId !== e.runId) return r
        const items = r.items.slice()
        switch (e.type) {
          case 'status':
            return { ...r, status: e.status, error: e.error, items: items.map((it) => (it.type === 'turn' && it.turn.streaming ? { ...it, turn: { ...it.turn, streaming: false } } : it)) }
          case 'text': {
            const last = items[items.length - 1]
            if (last?.type === 'turn' && last.turn.role === 'agent' && last.turn.streaming) {
              items[items.length - 1] = { type: 'turn', turn: { ...last.turn, text: last.turn.text + e.text, streaming: !e.done } }
            } else if (e.text) {
              items.push({ type: 'turn', turn: { id: `${e.runId}-${items.length}`, role: 'agent', text: e.text, streaming: !e.done } })
            }
            return { ...r, items }
          }
          case 'note':
            items.push({ type: 'note', text: e.text })
            return { ...r, items }
          case 'tool': {
            const i = items.findIndex((it) => it.type === 'tool' && it.step.toolCallId === e.toolCallId)
            const step: AgentToolStep = { toolCallId: e.toolCallId, provider: e.provider, tool: e.tool, summary: e.summary, status: e.status, detail: e.detail, durationMs: e.durationMs }
            if (i >= 0) items[i] = { type: 'tool', step }
            else items.push({ type: 'tool', step })
            return { ...r, items }
          }
          case 'proposal':
            return { ...r, proposal: { ops: e.ops, summary: e.summary, costMicroUsd: e.costMicroUsd } }
          case 'usage':
            return { ...r, usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens, costMicroUsd: e.costMicroUsd } }
        }
      }),
    }))
  },
}))

/** Wire main-process events into the store once. */
export function connectEvents() {
  const offs = [
    window.framevane.doc.onChange((e) => {
      const { route } = useApp.getState()
      if (route.name === 'editor' && route.projectId === e.projectId) useApp.getState().setDoc(e.doc, e.canUndo, e.canRedo)
    }),
    window.framevane.media.onChange((m) => {
      const mm = m as MediaInfo & { projectId: string }
      const { route, media } = useApp.getState()
      if (route.name !== 'editor' || route.projectId !== mm.projectId) return
      useApp.setState({ media: media.some((x) => x.asset.id === mm.asset.id) ? media.map((x) => (x.asset.id === mm.asset.id ? mm : x)) : [...media, mm] })
    }),
    window.framevane.jobs.onEvent((j) => {
      useApp.setState((s) => {
        const jobs = { ...s.jobs, [j.id]: j }
        // keep finished jobs briefly for the tray, then drop them
        if (j.status === 'done' || j.status === 'cancelled') setTimeout(() => useApp.setState((x) => { const n = { ...x.jobs }; delete n[j.id]; return { jobs: n } }), 4000)
        return { jobs }
      })
    }),
    window.framevane.agent.onEvent((e) => useApp.getState().agentEvent(e)),
  ]
  return () => offs.forEach((f) => f())
}
