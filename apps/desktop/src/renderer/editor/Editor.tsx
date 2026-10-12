import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bot, Download, Redo2, Settings, Undo2, Loader2, Check } from 'lucide-react'
import { Badge, Button, IconButton, JobProgress, Popover, Spinner, EmptyState } from '@reel/ui'
import { projectDurationUs, type Project } from '@reel/doc'
import { useApp } from '../app/store'
import { Player } from '../engine/player'
import { AssetPanel } from './AssetPanel'
import { Viewer } from './Viewer'
import { Inspector } from './Inspector'
import { Timeline } from './Timeline'
import { AgentPanel } from './AgentPanel'
import { ExportDialog } from './ExportDialog'
import { ReviewDialog } from './ReviewDialog'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import { useEditorShortcuts } from './shortcuts'

/** S03 · Editor shell: assets | viewer | inspector (+ agent dock) over the timeline. */

interface EditorCtx { player: Player; seek(us: number): void; togglePlay(): void }
const Ctx = createContext<EditorCtx | null>(null)
export const useEditor = () => useContext(Ctx)!

export function Editor({ projectId }: { projectId: string }) {
  const doc = useApp((s) => s.doc)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.reel.projects.open(projectId).then((e) => { if (alive) useApp.getState().setDoc(e.doc, e.canUndo, e.canRedo) }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
    window.reel.media.list(projectId).then((m) => alive && useApp.setState({ media: m })).catch(() => {})
    return () => { alive = false }
  }, [projectId])

  if (loadError) {
    return (
      <EmptyState className="flex-1" title="This project couldn't be opened" body={loadError}
        action={<Button onClick={() => useApp.getState().go({ name: 'home' })}>Back to projects</Button>} />
    )
  }
  if (!doc || doc.id !== projectId) return <div className="grid flex-1 place-items-center"><Spinner label="Opening project" className="size-6" /></div>
  return <EditorLoaded doc={doc} />
}

function EditorLoaded({ doc }: { doc: Project }) {
  const playerRef = useRef<Player | null>(null)
  if (!playerRef.current) {
    playerRef.current = new Player(doc, (us) => useApp.getState().setPlayhead(us), () => useApp.setState({ playing: false }))
  }
  const player = playerRef.current
  const dialog = useApp((s) => s.dialog)
  const [agentOpen, setAgentOpen] = useState(true)

  useEffect(() => { player.setDoc(doc) }, [doc, player])
  useEffect(() => () => { void player.dispose() }, [player])

  const seek = useCallback((us: number) => {
    const t = Math.max(0, Math.min(us, projectDurationUs(useApp.getState().doc ?? doc)))
    useApp.getState().setPlayhead(t)
    player.seek(t)
  }, [player, doc])
  const togglePlay = useCallback(() => {
    if (player.isPlaying) { player.pause(); useApp.setState({ playing: false }) }
    else { void player.play(useApp.getState().playheadUs); useApp.setState({ playing: true }) }
  }, [player])
  const ctx = useMemo(() => ({ player, seek, togglePlay }), [player, seek, togglePlay])

  useEditorShortcuts(ctx)

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">
        <TopBar doc={doc} agentOpen={agentOpen} onToggleAgent={() => setAgentOpen(!agentOpen)} />
        <div className="flex min-h-0 flex-[1_1_62%]">
          <section aria-label="Media and assets" className="flex w-[var(--reel-asset-panel-w-default)] min-w-[var(--reel-asset-panel-w-min)] shrink-0 flex-col border-r border-border bg-surface">
            <AssetPanel />
          </section>
          <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col bg-bg">
            <Viewer />
          </section>
          <section aria-label="Properties" className="flex w-[var(--reel-inspector-w-default)] shrink-0 flex-col border-l border-border bg-surface">
            <Inspector />
          </section>
          {agentOpen && (
            <section aria-label="Agent" className="flex w-[var(--reel-agent-dock-w-default)] shrink-0 flex-col border-l border-border bg-surface">
              <AgentPanel />
            </section>
          )}
        </div>
        <section aria-label="Timeline" className="flex min-h-[var(--reel-timeline-h-min)] flex-[1_1_38%] flex-col border-t border-border bg-timeline-bg">
          <Timeline />
        </section>
      </div>
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'review' && <ReviewDialog />}
      {dialog === 'project-settings' && <ProjectSettingsDialog />}
    </Ctx.Provider>
  )
}

function TopBar({ doc, agentOpen, onToggleAgent }: { doc: Project; agentOpen: boolean; onToggleAgent: () => void }) {
  const canUndo = useApp((s) => s.canUndo)
  const canRedo = useApp((s) => s.canRedo)
  const empty = projectDurationUs(doc) === 0
  return (
    <header className="flex h-[var(--reel-titlebar-h)] shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => useApp.getState().go({ name: 'home' })}>Projects</Button>
      <span className="mx-1 h-4 w-px bg-border" />
      <IconButton size="sm" label="Undo" shortcut="Ctrl+Z" icon={<Undo2 />} disabled={!canUndo} onClick={() => void window.reel.doc.undo(doc.id)} />
      <IconButton size="sm" label="Redo" shortcut="Ctrl+Shift+Z" icon={<Redo2 />} disabled={!canRedo} onClick={() => void window.reel.doc.redo(doc.id)} />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <h1 className="truncate text-sm" title={doc.name}>{doc.name}</h1>
        <SaveState version={doc.version} />
      </div>
      <JobsTray />
      <Button size="sm" variant={agentOpen ? 'agent' : 'ghost'} icon={<Bot className="size-3.5" />} aria-pressed={agentOpen} onClick={onToggleAgent}>Agent</Button>
      <IconButton size="sm" label="Settings" icon={<Settings />} onClick={() => useApp.getState().openDialog('settings')} />
      <Button size="sm" variant="primary" icon={<Download className="size-3.5" />} disabled={empty} onClick={() => useApp.getState().openDialog('export')}>Export</Button>
    </header>
  )
}

/** Autosave status: every edit is journaled immediately; the snapshot is written 2 s after the last edit. */
function SaveState({ version }: { version: number }) {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (version === 0) return
    setSaving(true)
    const t = setTimeout(() => setSaving(false), 2200)
    return () => clearTimeout(t)
  }, [version])
  return (
    <span className="flex items-center gap-1 text-xs text-muted" aria-live="polite">
      {saving ? <><Loader2 className="size-3 animate-spin" aria-hidden />Saving</> : <><Check className="size-3" aria-hidden />Saved</>}
    </span>
  )
}

function JobsTray() {
  const jobs = useApp((s) => s.jobs)
  const list = Object.values(jobs)
  const active = list.filter((j) => j.status === 'running' || j.status === 'queued')
  const failed = list.filter((j) => j.status === 'failed')
  if (!list.length) return null
  return (
    <Popover trigger={
      <button type="button" className="flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:bg-surface-3 hover:text-fg">
        {active.length ? <Loader2 className="size-3 animate-spin text-agent" aria-hidden /> : null}
        {active.length ? `${active.length} task${active.length > 1 ? 's' : ''} running` : failed.length ? <Badge tone="danger">{failed.length} failed</Badge> : 'Tasks done'}
      </button>
    } align="end">
      <div className="flex w-80 flex-col gap-3">
        {list.map((j) => (
          <div key={j.id}>
            <JobProgress title={j.title} value={j.status === 'queued' ? undefined : j.progress} detail={j.status === 'failed' ? j.error : j.status === 'queued' ? 'Waiting' : j.detail}
              onCancel={j.status === 'running' || j.status === 'queued' ? () => void window.reel.jobs.cancel(j.id) : undefined} />
          </div>
        ))}
      </div>
    </Popover>
  )
}
