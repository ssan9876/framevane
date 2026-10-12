import type { AssetRef, OpInput, Project } from '@framevane/doc'

/** The typed bridge between renderer and main (exposed as window.framevane by the preload). */

export interface ProjectSummary {
  id: string
  type: 'video' | 'photo'
  name: string
  dirPath: string
  coverUrl: string | null
  width: number
  height: number
  durationUs: number
  status: 'ok' | 'missing_media' | 'missing_dir' | 'corrupt'
  updatedAt: number
  openedAt: number | null
}

export interface MediaInfo {
  asset: AssetRef
  /** framevane-media:// URLs the renderer can fetch. */
  urls: { media: string; thumb: string | null; peaks: string | null; filmstrip: string | null }
  status: 'ready' | 'preparing' | 'missing' | 'unsupported'
  /** A 1280px proxy exists (preview may use it; export never does). */
  hasProxy?: boolean
  /** Present while a background job prepares the asset (mezzanine transcode, thumbnails, waveform). */
  jobId?: string
}

export interface JobEvent {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  title: string
  detail?: string
  error?: string
  assetId?: string
  projectId?: string
}

export type DocEvent = { projectId: string; doc: Project; canUndo: boolean; canRedo: boolean; source: 'user' | 'agent' | 'undo' | 'redo' | 'load' }

export interface ApplyResult { ok: true; version: number }
export interface ApplyConflict { ok: false; code: string; message: string }

export interface TranscriptWord { text: string; start: number; end: number } // seconds, source time
export interface Transcript { assetId: string; language: string; model: string; words: TranscriptWord[] }

export interface ExportSettings {
  projectId: string
  outputPath: string
  width: number
  height: number
  fps: number
  bitrate: number // bits per second
  codec: 'avc' | 'hevc'
}

/* ── agent ── */
export type AgentEvent =
  | { runId: string; type: 'status'; status: AgentRunStatus; error?: string }
  | { runId: string; type: 'text'; text: string; done: boolean }
  | { runId: string; type: 'note'; text: string }
  | { runId: string; type: 'tool'; toolCallId: string; provider: string; tool: string; summary: string; status: 'running' | 'done' | 'error' | 'awaiting' | 'denied'; detail?: string; durationMs?: number; costsMoney?: boolean; reason?: string }
  | { runId: string; type: 'started'; agentName: string; model: string }
  | { runId: string; type: 'proposal'; ops: ProposedOp[]; summary: string; costMicroUsd: number }
  | { runId: string; type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number; costMicroUsd: number }

export type AgentRunStatus = 'running' | 'awaiting_permission' | 'awaiting_review' | 'applied' | 'partially_applied' | 'rejected' | 'failed' | 'cancelled'

export interface ProposedOp { id: string; seq: number; label: string; op: OpInput; included: boolean; status: 'proposed' | 'applied' | 'rejected' | 'failed' | 'conflicted' }

export interface AgentContext { selection: string[]; playheadUs: number }

export interface AgentSettings { hasApiKey: boolean; credentialSource: 'app_key' | 'environment' | 'none'; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }

/** Something a connected MCP client (Claude Code etc.) did in this project. */
export interface ExternalActivity { id: string; client: string; tool: string; summary: string; status: 'running' | 'done' | 'error'; mutates: boolean; durationMs?: number }
export interface McpConnectInfo { enabled: boolean; listening: boolean; url: string; token: string; error: string | null; claudeCommand: string }
export interface McpExportRequest { requestId: string; projectId: string; outputPath: string; height: number; fps: number; codec: 'avc' | 'hevc' }

/* ── M2: tool providers (MCP servers), agent library, batch ── */
export type ToolPermission = 'auto' | 'ask' | 'never'
export interface ProviderTool { name: string; description: string; permission: ToolPermission; costsMoney: boolean; readOnly: boolean }
export interface ToolProviderView {
  id: string
  name: string
  kind: 'local_ai' | 'mcp_stdio' | 'mcp_http'
  command: string | null
  args: string[]
  url: string | null
  /** Names of stored secrets (values never leave the main process). */
  envKeys: string[]
  headerKeys: string[]
  enabled: boolean
  status: 'unknown' | 'connected' | 'error' | 'disabled'
  error: string | null
  tools: ProviderTool[]
  builtin: boolean
}
export interface ProviderInput {
  name: string
  kind: 'mcp_stdio' | 'mcp_http'
  command?: string
  args?: string[]
  url?: string
  /** Only sent when set or changed; omitted values keep what's stored. */
  env?: Record<string, string>
  headers?: Record<string, string>
}
export interface AgentDefView {
  id: string
  name: string
  description: string
  instructions: string
  model: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  allowedTools: string[]
  reviewMode: 'propose' | 'auto_apply'
  builtin: boolean
  /** Suggested first message for one-click use. */
  starter?: string
}
export type AgentDefInput = Omit<AgentDefView, 'id' | 'builtin'>
export interface BatchItem { projectId: string; name: string; status: 'queued' | 'running' | 'applied' | 'awaiting_review' | 'no_changes' | 'failed'; runId?: string; summary?: string; error?: string }
export interface BatchEvent { batchId: string; items: BatchItem[]; done: boolean }

export interface ReelApi {
  app: {
    info(): Promise<{ version: string; userData: string; projectsDir: string; ffmpeg: string | null; sidecar: 'unknown' | 'ready' | 'starting' | 'error'; gpu?: string }>
    pickFiles(opts: { kind: 'media' | 'image' }): Promise<string[]>
    pickSavePath(opts: { defaultName: string; ext: string }): Promise<string | null>
    showItemInFolder(path: string): Promise<void>
    pathForFile(file: File): string
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    create(opts: { name: string; width?: number; height?: number; fps?: number; files?: string[] }): Promise<{ projectId: string }>
    open(projectId: string): Promise<DocEvent>
    close(projectId: string): Promise<void>
    rename(projectId: string, name: string): Promise<void>
    duplicate(projectId: string): Promise<{ projectId: string }>
    remove(projectId: string): Promise<void>
  }
  doc: {
    apply(projectId: string, baseVersion: number, ops: OpInput[]): Promise<ApplyResult | ApplyConflict>
    undo(projectId: string): Promise<void>
    redo(projectId: string): Promise<void>
    onChange(cb: (e: DocEvent) => void): () => void
  }
  media: {
    import(projectId: string, paths: string[]): Promise<MediaInfo[]>
    list(projectId: string): Promise<MediaInfo[]>
    reverse(projectId: string, assetId: string, inUs: number, outUs: number): Promise<MediaInfo>
    relink(projectId: string, assetId: string, newPath: string): Promise<MediaInfo>
    onChange(cb: (m: MediaInfo) => void): () => void
  }
  jobs: {
    onEvent(cb: (e: JobEvent) => void): () => void
    cancel(jobId: string): Promise<void>
  }
  analysis: {
    transcript(projectId: string, assetId: string, opts?: { language?: string; force?: boolean }): Promise<Transcript>
    silences(projectId: string, assetId: string, opts?: { thresholdDb?: number; minMs?: number }): Promise<{ start: number; end: number }[]>
  }
  export: {
    open(path: string): Promise<{ handle: string }>
    write(handle: string, position: number, data: Uint8Array): Promise<void>
    close(handle: string, opts: { abort?: boolean }): Promise<{ path: string; bytes: number }>
  }
  agent: {
    settings(): Promise<AgentSettings>
    setApiKey(key: string | null): Promise<AgentSettings>
    setModel(model: string, effort: AgentSettings['effort']): Promise<AgentSettings>
    run(projectId: string, prompt: string, context: AgentContext, agentDefId?: string): Promise<{ runId: string; agentName: string }>
    /** Runs of this project that are still waiting for review (e.g. from a batch). */
    pending(projectId: string): Promise<{ runId: string; prompt: string; agentName: string; summary: string; ops: ProposedOp[]; costMicroUsd: number }[]>
    defs(): Promise<AgentDefView[]>
    /** Every tool an agent can be given: the editor's own and those from enabled MCP servers. */
    toolList(): Promise<{ name: string; provider: string; description: string }[]>
    saveDef(id: string | null, def: AgentDefInput): Promise<AgentDefView>
    deleteDef(id: string): Promise<void>
    batch(projectIds: string[], agentDefId: string, prompt: string, autoApply: boolean): Promise<{ batchId: string }>
    onBatch(cb: (e: BatchEvent) => void): () => void
    cancel(runId: string): Promise<void>
    permission(runId: string, toolCallId: string, allow: boolean, remember?: boolean): Promise<void>
    review(runId: string, includeOpIds: string[], action: 'apply' | 'reject'): Promise<{ ok: boolean; applied: number; conflicted: number; message?: string }>
    previewDoc(runId: string, includeOpIds: string[]): Promise<Project | null>
    onEvent(cb: (e: AgentEvent) => void): () => void
  }
  /** MCP servers the user added for the built-in agent (Settings → Agents & AI). */
  tools: {
    providers(): Promise<ToolProviderView[]>
    add(input: ProviderInput): Promise<ToolProviderView>
    update(id: string, input: ProviderInput): Promise<ToolProviderView>
    remove(id: string): Promise<void>
    refresh(id: string): Promise<ToolProviderView>
    setEnabled(id: string, enabled: boolean): Promise<ToolProviderView>
    setToolPermission(providerId: string, tool: string, permission: ToolPermission): Promise<ToolProviderView>
    setToolCostsMoney(providerId: string, tool: string, costsMoney: boolean): Promise<ToolProviderView>
  }
  mcp: {
    info(): Promise<McpConnectInfo>
    setEnabled(on: boolean): Promise<McpConnectInfo>
    resetToken(): Promise<McpConnectInfo>
    connectClaudeCode(): Promise<{ ok: boolean; message: string }>
    onActivity(cb: (a: ExternalActivity) => void): () => void
    /** The window reports which project is open, the playhead and the selection (agents read it). */
    reportUiState(state: { projectId: string | null; playheadUs: number; selection: string[] }): void
    onOpenProject(cb: (req: { requestId: string; projectId: string }) => void): () => void
    replyOpenProject(requestId: string, ok: boolean): void
    onExport(cb: (req: McpExportRequest) => void): () => void
    replyExport(requestId: string, result: { ok: true; path: string; bytes: number } | { ok: false; error: string }): void
  }
}

declare global {
  interface Window { framevane: ReelApi }
}
