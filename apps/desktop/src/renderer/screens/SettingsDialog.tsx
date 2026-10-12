import { Fragment, useEffect, useState } from 'react'
import { Button, Dialog, Kbd, Select, TextField, UnderlineTabs, Badge, useToast } from '@reel/ui'
import type { AgentSettings } from '../../shared/api'
import { useApp } from '../app/store'
import { SHORTCUTS } from '../editor/shortcuts'

/** S23 Settings · S24 Shortcuts · S28 Agents & tools (M0: Claude key + model; MCP servers arrive in M2). */
export function SettingsDialog() {
  const arg = useApp((s) => s.dialogArg)
  const dialog = useApp((s) => s.dialog)
  const [tab, setTab] = useState(dialog === 'shortcuts' ? 'shortcuts' : arg ?? 'general')
  const close = () => useApp.getState().openDialog(null)
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Settings" width={640}>
      <div className="-mx-5 -mt-4">
        <UnderlineTabs value={tab} onValueChange={setTab} label="Settings sections" tabs={[{ value: 'general', label: 'General' }, { value: 'agents', label: 'Agents & AI' }, { value: 'shortcuts', label: 'Shortcuts' }, { value: 'performance', label: 'Performance' }]} />
      </div>
      <div className="min-h-[360px] pt-4">
        {tab === 'general' && <General />}
        {tab === 'agents' && <Agents />}
        {tab === 'shortcuts' && <Shortcuts />}
        {tab === 'performance' && <p className="text-sm text-muted">Hardware decoding and encoding are on (WebCodecs uses your GPU). Proxy and cache controls arrive in M6.</p>}
      </div>
    </Dialog>
  )
}

function General() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.reel.app.info>> | null>(null)
  useEffect(() => { void window.reel.app.info().then(setInfo) }, [])
  if (!info) return null
  const rows: [string, string][] = [['Version', info.version], ['Projects folder', info.projectsDir], ['App data', info.userData], ['FFmpeg', info.ffmpeg ?? 'Not found'], ['Local AI', info.sidecar]]
  return (
    <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className="break-all [user-select:text]">{v}</dd></Fragment>)}
    </dl>
  )
}

function Agents() {
  const [s, setS] = useState<AgentSettings | null>(null)
  const [key, setKey] = useState('')
  const toast = useToast()
  useEffect(() => { void window.reel.agent.settings().then(setS) }, [])
  if (!s) return null
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-base">Claude</h3>
        <p className="text-sm text-muted">
          The agent runs on your own Anthropic account and is billed by Anthropic per use. The key is encrypted with Windows DPAPI and never written to your project files.
        </p>
        <div className="flex items-center gap-2 text-sm">
          Status: {s.credentialSource === 'app_key' ? <Badge tone="success">Key saved in Reel</Badge> : s.credentialSource === 'environment' ? <Badge tone="accent">Using ANTHROPIC_API_KEY from the environment</Badge> : <Badge tone="warning">No key</Badge>}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1"><TextField label="Anthropic API key" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></div>
          <Button variant="primary" disabled={!key.trim().startsWith('sk-')} onClick={async () => { setS(await window.reel.agent.setApiKey(key)); setKey(''); toast({ tone: 'success', title: 'API key saved' }) }}>Save key</Button>
          {s.credentialSource === 'app_key' && <Button variant="ghost" onClick={async () => setS(await window.reel.agent.setApiKey(null))}>Remove</Button>}
        </div>
        <div className="flex gap-4">
          <Select label="Model" value={s.model} width={200} onValueChange={async (m) => setS(await window.reel.agent.setModel(m, s.effort))}
            options={[{ value: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'default' }, { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'cheaper' }, { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'cheapest' }, { value: 'claude-fable-5-1', label: 'Claude Fable 5.1', hint: 'most capable' }]} />
          <Select label="Effort" value={s.effort} width={120} onValueChange={async (e) => setS(await window.reel.agent.setModel(s.model, e as AgentSettings['effort']))}
            options={['low', 'medium', 'high', 'xhigh', 'max'].map((v) => ({ value: v, label: v }))} />
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="text-base">Tools from other apps (MCP)</h3>
        <p className="text-sm text-muted">Coming in M2: add any MCP server (for example Higgsfield for AI video, or your own scripts) and the agent can use its tools. Tools that cost money always ask first. The editor will also expose itself as an MCP server so Claude Code can edit your project directly.</p>
      </section>
    </div>
  )
}

function Shortcuts() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-1 text-sm text-muted">{g}</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <Fragment key={s.action}><dt>{s.action}</dt><dd className="flex gap-1">{s.keys.split(' / ').map((k) => <Kbd key={k}>{k}</Kbd>)}</dd></Fragment>
            ))}
          </dl>
        </section>
      ))}
      <p className="text-xs text-muted">Rebinding arrives as a should-have.</p>
    </div>
  )
}
