import { useEffect, useId, useState } from 'react'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge, Button, Checkbox, IconButton, Segmented, Select, Switch, TextField, useToast } from '@framevane/ui'
import type { ProviderInput, ToolPermission, ToolProviderView } from '../../shared/api'

/**
 * S28 · Tools from other apps: MCP servers the user adds for the built-in agent (a local command or a URL),
 * with a permission per tool (Auto / Ask / Never) and a "costs money" flag that always asks.
 */
export function ToolServers() {
  const [list, setList] = useState<ToolProviderView[] | null>(null)
  const [editing, setEditing] = useState<ToolProviderView | 'new' | null>(null)
  const reload = async () => setList(await window.framevane.tools.providers())
  useEffect(() => { void reload() }, [])
  const replace = (p: ToolProviderView) => setList((l) => l?.map((x) => (x.id === p.id ? p : x)) ?? null)

  return (
    <section aria-labelledby="tool-servers-h" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="tool-servers-h" className="text-base">Tools from other apps (MCP)</h3>
        {editing === null && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>Add server</Button>}
      </div>
      <p className="text-sm text-muted">
        Give the built-in agent more tools: any MCP server, such as an AI video service or your own scripts. Tools ask before they run unless you allow them; tools marked as costing money always ask.
      </p>
      {editing !== null && (
        <ServerForm initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setList((l) => (l?.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...(l ?? []), p])) }} />
      )}
      {list?.map((p) => <ProviderCard key={p.id} p={p} onChange={replace} onRemoved={() => setList((l) => l?.filter((x) => x.id !== p.id) ?? null)} onEdit={() => setEditing(p)} />)}
    </section>
  )
}

function statusBadge(p: ToolProviderView) {
  if (!p.enabled || p.status === 'disabled') return <Badge>Off</Badge>
  if (p.status === 'connected') return <Badge tone="success">Connected</Badge>
  if (p.status === 'error') return <Badge tone="danger">Can’t connect</Badge>
  return <Badge>Not started</Badge>
}

function ProviderCard({ p, onChange, onRemoved, onEdit }: { p: ToolProviderView; onChange: (p: ToolProviderView) => void; onRemoved: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const act = async (fn: () => Promise<ToolProviderView>) => {
    setBusy(true)
    try { onChange(await fn()) } catch (e) { toast({ tone: 'error', title: 'That didn’t work', description: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }
  const where = p.builtin ? 'Bundled with Framevane, runs on your GPU' : p.kind === 'mcp_stdio' ? [p.command, ...p.args].join(' ') : p.url
  return (
    <article aria-label={`Server ${p.name}`} className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{p.name}</span>
        {statusBadge(p)}
        <span className="ml-auto flex items-center gap-1">
          {!p.builtin && <>
            <IconButton size="sm" label={`Reconnect ${p.name}`} icon={<RefreshCw className={busy ? 'animate-spin' : ''} />} disabled={busy || !p.enabled} onClick={() => void act(() => window.framevane.tools.refresh(p.id))} />
            <IconButton size="sm" label={`Edit ${p.name}`} icon={<Pencil />} onClick={onEdit} />
            <IconButton size="sm" label={`Remove ${p.name}`} icon={<Trash2 />} onClick={async () => { await window.framevane.tools.remove(p.id); onRemoved(); toast({ tone: 'info', title: `Removed ${p.name}` }) }} />
          </>}
        </span>
      </div>
      <p className="truncate font-mono text-xs text-muted" title={where ?? ''}>{where}</p>
      {p.error && p.enabled && <p role="alert" className="text-sm text-danger">{p.error}</p>}
      {!p.builtin && <Switch label="Enabled" checked={p.enabled} disabled={busy} onCheckedChange={(v) => void act(() => window.framevane.tools.setEnabled(p.id, v))} />}
      {p.tools.length > 0 && (
        <ul aria-label={`Tools from ${p.name}`} className="flex flex-col divide-y divide-border">
          {p.tools.map((t) => (
            <li key={t.name} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs">{t.name}{t.readOnly && <span className="ml-1.5 font-sans text-muted">read-only</span>}</p>
                {t.description && <p className="truncate text-xs text-muted" title={t.description}>{t.description}</p>}
              </div>
              {!p.builtin && <>
                <Checkbox label={`${t.name} costs money`} hideLabel checked={t.costsMoney} onCheckedChange={(v) => void act(() => window.framevane.tools.setToolCostsMoney(p.id, t.name, v))} />
                <span className="text-xs text-muted" aria-hidden>$</span>
                <Select label={`Permission for ${t.name}`} hideLabel width={96} value={t.permission}
                  onValueChange={(v) => void act(() => window.framevane.tools.setToolPermission(p.id, t.name, v as ToolPermission))}
                  options={[{ value: 'auto', label: 'Auto' }, { value: 'ask', label: 'Ask' }, { value: 'never', label: 'Never' }]} />
              </>}
            </li>
          ))}
        </ul>
      )}
      {p.enabled && p.status === 'connected' && p.tools.length === 0 && <p className="text-sm text-muted">This server has no tools.</p>}
    </article>
  )
}

/** "KEY=value" (env) or "Header: value" lines → record. Empty value means "remove the stored one". */
function parsePairs(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(sep)
    if (i <= 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function TextArea({ label, hint, ...rest }: { label: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">{label}</label>
      <textarea id={id} rows={3} spellCheck={false} aria-describedby={hint ? `${id}-h` : undefined}
        className="rounded-sm border border-border-input bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg placeholder:text-muted hover:border-border-strong focus-visible:border-focus focus-visible:outline-none" {...rest} />
      {hint && <p id={`${id}-h`} className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

function ServerForm({ initial, onCancel, onSaved }: { initial: ToolProviderView | null; onCancel: () => void; onSaved: (p: ToolProviderView) => void }) {
  const [kind, setKind] = useState<ProviderInput['kind']>(initial?.kind === 'mcp_http' ? 'mcp_http' : 'mcp_stdio')
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args.join('\n') ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const valid = /^[a-z][a-z0-9_]{0,23}$/.test(name.trim().toLowerCase()) && (kind === 'mcp_stdio' ? command.trim() !== '' : /^https?:\/\/\S+$/.test(url.trim()))

  async function save() {
    setBusy(true)
    setError(null)
    const input: ProviderInput = {
      name: name.trim().toLowerCase(), kind,
      ...(kind === 'mcp_stdio' ? { command: command.trim(), args: args.split(/\r?\n/).map((a) => a.trim()).filter(Boolean), env: parsePairs(env, '=') } : { url: url.trim(), headers: parsePairs(headers, ':') }),
    }
    try {
      const p = initial ? await window.framevane.tools.update(initial.id, input) : await window.framevane.tools.add(input)
      onSaved(p)
      toast(p.status === 'connected'
        ? { tone: 'success', title: `${p.name} connected`, description: `${p.tools.length} tool${p.tools.length === 1 ? '' : 's'} available to the agent.` }
        : { tone: 'warning', title: `Saved ${p.name}, but it didn’t connect`, description: p.error ?? undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  const stored = (keys: string[]) => (keys.length ? `Stored: ${keys.join(', ')}. Enter a line to change one, or "KEY=" to remove it.` : undefined)
  return (
    <form aria-label={initial ? `Edit ${initial.name}` : 'Add an MCP server'} className="flex flex-col gap-3 rounded-md border border-accent/40 bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void save() }}>
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!!initial} placeholder="higgsfield" hint="Short id used to name its tools: lowercase, digits, _" className="w-48" />
        {!initial && <Segmented label="Connection" value={kind} onValueChange={(v) => setKind(v as ProviderInput['kind'])} options={[{ value: 'mcp_stdio', label: 'Command' }, { value: 'mcp_http', label: 'URL' }]} />}
      </div>
      {kind === 'mcp_stdio' ? (
        <>
          <TextField label="Command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
          <TextArea label="Arguments (one per line)" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={'-y\n@scope/some-mcp-server'} />
          <TextArea label="Environment variables" value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=…" hint={stored(initial?.envKeys ?? []) ?? 'KEY=value per line. Stored encrypted on this PC.'} />
        </>
      ) : (
        <>
          <TextField label="Server URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          <TextArea label="Headers" value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" hint={stored(initial?.headerKeys ?? []) ?? 'Header: value per line. Stored encrypted on this PC. Servers that need a browser sign-in (OAuth) aren’t supported yet.'} />
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!valid}>{initial ? 'Save and reconnect' : 'Add and connect'}</Button>
      </div>
    </form>
  )
}
