import { useEffect, useState } from 'react'
import { Badge, Button, Dialog, Select, Switch, TextField } from '@framevane/ui'
import type { BatchItem, ProjectSummary } from '../../shared/api'
import { useApp } from '../app/store'

const STATUS: Record<BatchItem['status'], { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'agent' }> = {
  queued: { label: 'Waiting', tone: 'neutral' },
  running: { label: 'Working…', tone: 'agent' },
  applied: { label: 'Edited', tone: 'success' },
  awaiting_review: { label: 'Ready to review', tone: 'accent' },
  no_changes: { label: 'No changes', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
}

/** F14 · Run one saved agent over several projects, one after another. */
export function BatchDialog({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const defs = useApp((s) => s.agentDefs)
  const [defId, setDefId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [autoApply, setAutoApply] = useState(false)
  const [items, setItems] = useState<BatchItem[] | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const def = defs.find((d) => d.id === defId)

  useEffect(() => { void useApp.getState().loadAgentDefs() }, [])
  useEffect(() => {
    if (!defId && defs.length) {
      const first = defs.find((d) => d.name === 'Silence cutter') ?? defs[0]!
      setDefId(first.id)
      setPrompt(first.starter ?? '')
      setAutoApply(first.reviewMode === 'auto_apply')
    }
  }, [defs, defId])
  useEffect(() => window.framevane.agent.onBatch((e) => {
    if (e.batchId !== batchId) return
    setItems(e.items)
    if (e.done) { setDone(true); void useApp.getState().loadProjects() }
  }), [batchId])

  const running = !!batchId && !done
  async function start() {
    if (!def || !prompt.trim()) return
    setItems(projects.map((p) => ({ projectId: p.id, name: p.name, status: 'queued' })))
    const { batchId } = await window.framevane.agent.batch(projects.map((p) => p.id), def.id, prompt.trim(), autoApply)
    setBatchId(batchId)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} busy={running} width={560}
      title={`Run an agent on ${projects.length} project${projects.length === 1 ? '' : 's'}`}
      description="Projects are edited one after another. Tools that need your approval are skipped in a batch."
      footer={items
        ? <Button variant="primary" disabled={running} onClick={onClose}>{done ? 'Done' : 'Working…'}</Button>
        : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="agent" disabled={!def || !prompt.trim()} onClick={() => void start()}>Run on {projects.length} project{projects.length === 1 ? '' : 's'}</Button></>}>
      {!items ? (
        <div className="flex flex-col gap-3">
          <Select label="Agent" value={defId} width={240} onValueChange={(id) => { const d = defs.find((x) => x.id === id); setDefId(id); if (d) { setPrompt(d.starter ?? ''); setAutoApply(d.reviewMode === 'auto_apply') } }}
            options={defs.map((d) => ({ value: d.id, label: d.name }))} />
          {def && <p className="text-sm text-muted">{def.description}</p>}
          <TextField label="Request" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should it do in each project?" />
          <Switch label="Apply the edits automatically" description={autoApply ? 'Each project is changed right away (Ctrl+Z in that project undoes it).' : 'Edits wait in each project’s agent panel for you to review.'}
            checked={autoApply} onCheckedChange={setAutoApply} />
        </div>
      ) : (
        <ul aria-label="Batch progress" className="flex flex-col divide-y divide-border">
          {items.map((it) => (
            <li key={it.projectId} aria-label={`${it.name}: ${STATUS[it.status].label}`} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
              {it.summary && <span className="truncate text-xs text-muted">{it.summary}</span>}
              {it.error && <span className="truncate text-xs text-danger" title={it.error}>{it.error}</span>}
              <Badge tone={STATUS[it.status].tone}>{STATUS[it.status].label}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
