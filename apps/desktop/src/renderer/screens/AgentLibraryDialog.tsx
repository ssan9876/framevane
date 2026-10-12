import { useEffect, useId, useState } from 'react'
import { Bot, Copy, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Checkbox, Dialog, Segmented, Select, TextField, useToast } from '@framevane/ui'
import type { AgentDefInput, AgentDefView } from '../../shared/api'
import { useApp } from '../app/store'

/** S31 · Agent library: the built-in agents and your own (instructions, tools, model, review mode). */
export function AgentLibraryDialog() {
  const defs = useApp((s) => s.agentDefs)
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [tools, setTools] = useState<{ name: string; provider: string; description: string }[]>([])
  const close = () => useApp.getState().openDialog(null)
  useEffect(() => {
    void useApp.getState().loadAgentDefs()
    void window.framevane.agent.toolList().then(setTools)
  }, [])
  const current = selected === 'new' ? null : defs.find((d) => d.id === selected) ?? defs[0] ?? null

  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Agent library" description="Saved agents for jobs you repeat. Pick one in the agent panel, or run it on many projects from Home." width={820}>
      <div className="flex min-h-[440px] gap-4">
        <nav aria-label="Agents" className="flex w-52 shrink-0 flex-col gap-1">
          {defs.map((d) => (
            <button key={d.id} type="button" aria-current={selected !== 'new' && current?.id === d.id ? 'true' : undefined} onClick={() => setSelected(d.id)}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-3 hover:text-fg aria-[current=true]:bg-accent-soft aria-[current=true]:text-fg">
              <Bot className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{d.name}</span>
              {d.builtin && <span className="ml-auto text-xs text-muted">built-in</span>}
            </button>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} className="mt-1 justify-start" onClick={() => setSelected('new')}>New agent</Button>
        </nav>
        <div className="min-w-0 flex-1 border-l border-border pl-4">
          {selected === 'new'
            ? <DefForm key="new" initial={null} tools={tools} onSaved={(d) => setSelected(d.id)} onCancel={() => setSelected(null)} />
            : current && (current.builtin
              ? <BuiltinView key={current.id} def={current} onDuplicate={(d) => setSelected(d.id)} />
              : <DefForm key={current.id} initial={current} tools={tools} onSaved={(d) => setSelected(d.id)} onDeleted={() => setSelected(null)} />)}
        </div>
      </div>
    </Dialog>
  )
}

async function duplicate(def: AgentDefView, existing: AgentDefView[]) {
  let name = `${def.name} (my copy)`
  for (let n = 2; existing.some((d) => d.name.toLowerCase() === name.toLowerCase()); n++) name = `${def.name} (my copy ${n})`
  const { id: _id, builtin: _b, ...input } = def
  const saved = await window.framevane.agent.saveDef(null, { ...input, name })
  await useApp.getState().loadAgentDefs()
  return saved
}

function BuiltinView({ def, onDuplicate }: { def: AgentDefView; onDuplicate: (d: AgentDefView) => void }) {
  const defs = useApp((s) => s.agentDefs)
  const toast = useToast()
  return (
    <section aria-label={def.name} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base">{def.name}</h3>
        <Badge>Built-in</Badge>
        <Button size="sm" className="ml-auto" icon={<Copy className="size-3.5" />} onClick={async () => {
          const d = await duplicate(def, defs)
          toast({ tone: 'success', title: `Made “${d.name}”`, description: 'Change it however you like.' })
          onDuplicate(d)
        }}>Duplicate to edit</Button>
      </div>
      <p className="text-sm text-muted">{def.description}</p>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Tools</dt><dd className="font-mono text-xs">{def.allowedTools.includes('*') ? 'All tools' : def.allowedTools.join(', ')}</dd>
        <dt className="text-muted">Model</dt><dd>{def.model === 'default' ? 'From Settings' : def.model}</dd>
        <dt className="text-muted">Edits</dt><dd>{def.reviewMode === 'auto_apply' ? 'Apply automatically' : 'You review first'}</dd>
        {def.starter && <><dt className="text-muted">Try</dt><dd>“{def.starter}”</dd></>}
      </dl>
      {def.instructions && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-bg p-3 text-sm text-muted">{def.instructions}</pre>}
    </section>
  )
}

const MODELS = [
  { value: 'default', label: 'From Settings' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { value: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
]

function DefForm({ initial, tools, onSaved, onCancel, onDeleted }: {
  initial: AgentDefView | null
  tools: { name: string; provider: string; description: string }[]
  onSaved: (d: AgentDefView) => void
  onCancel?: () => void
  onDeleted?: () => void
}) {
  const [d, setD] = useState<AgentDefInput>(() => initial
    ? { name: initial.name, description: initial.description, instructions: initial.instructions, model: initial.model, effort: initial.effort, allowedTools: initial.allowedTools, reviewMode: initial.reviewMode, starter: initial.starter }
    : { name: '', description: '', instructions: '', model: 'default', effort: 'medium', allowedTools: ['*'], reviewMode: 'propose', starter: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const insId = useId()
  const set = (patch: Partial<AgentDefInput>) => setD((x) => ({ ...x, ...patch }))
  const all = d.allowedTools.includes('*')
  // patterns saved earlier that aren't a tool name on this computer (e.g. "someserver__*") stay listed
  const extra = d.allowedTools.filter((g) => g !== '*' && !tools.some((t) => t.name === g))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.framevane.agent.saveDef(initial?.id ?? null, d)
      await useApp.getState().loadAgentDefs()
      toast({ tone: 'success', title: initial ? 'Agent saved' : `Added “${saved.name}”` })
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form aria-label={initial ? `Edit ${initial.name}` : 'New agent'} className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="flex gap-3">
        <TextField label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} className="w-56" required />
        <TextField label="What it does" value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} className="flex-1" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={insId} className="text-sm text-muted">Instructions</label>
        <textarea id={insId} rows={6} value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="How this agent should edit: steps, style, what to leave alone."
          className="rounded-sm border border-border-input bg-surface-2 px-2 py-1.5 text-sm text-fg placeholder:text-muted hover:border-border-strong focus-visible:border-focus focus-visible:outline-none" />
      </div>
      <TextField label="Suggested request" value={d.starter ?? ''} onChange={(e) => set({ starter: e.target.value })} placeholder="Make this a vertical short." hint="Shown as a one-click suggestion in the agent panel." />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">Tools it may use</legend>
        <Segmented label="Tools it may use" value={all ? 'all' : 'some'} onValueChange={(v) => set({ allowedTools: v === 'all' ? ['*'] : tools.filter((t) => t.provider === 'editor' && t.name.startsWith('get_')).map((t) => t.name) })}
          options={[{ value: 'all', label: 'All tools' }, { value: 'some', label: 'Only these' }]} />
        {!all && (
          <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-3 overflow-auto rounded-sm border border-border p-2">
            {[...tools.map((t) => t.name), ...extra].map((name) => (
              <Checkbox key={name} label={name} checked={d.allowedTools.includes(name)}
                onCheckedChange={(v) => set({ allowedTools: v ? [...d.allowedTools, name] : d.allowedTools.filter((x) => x !== name) })} />
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <Select label="Model" value={d.model} width={170} onValueChange={(v) => set({ model: v })} options={MODELS} />
        <Select label="Effort" value={d.effort} width={100} onValueChange={(v) => set({ effort: v as AgentDefInput['effort'] })} options={['low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({ value: v, label: v }))} />
        <Segmented label="Edits" value={d.reviewMode} onValueChange={(v) => set({ reviewMode: v as AgentDefInput['reviewMode'] })}
          options={[{ value: 'propose', label: 'I review first' }, { value: 'auto_apply', label: 'Apply automatically' }]} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        {initial && (
          <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={async () => {
            await window.framevane.agent.deleteDef(initial.id)
            await useApp.getState().loadAgentDefs()
            toast({ tone: 'info', title: `Deleted “${initial.name}”` })
            onDeleted?.()
          }}>Delete</Button>
        )}
        <span className="flex-1" />
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={busy} disabled={!d.name.trim()}>{initial ? 'Save' : 'Create agent'}</Button>
      </div>
    </form>
  )
}
