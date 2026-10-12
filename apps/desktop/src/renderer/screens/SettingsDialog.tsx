import { Fragment, useEffect, useState } from 'react'
import { Button, Dialog, Kbd, Select, Switch, TextField, UnderlineTabs, TabPanel, Badge, useToast } from '@reel/ui'
import type { AgentSettings, McpConnectInfo } from '../../shared/api'
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
        <UnderlineTabs value={tab} onValueChange={setTab} label="Settings sections" tabs={[{ value: 'general', label: 'General' }, { value: 'agents', label: 'Agents & AI' }, { value: 'shortcuts', label: 'Shortcuts' }, { value: 'performance', label: 'Performance' }]}>
          <div className="min-h-[360px] px-5 pt-4">
            <TabPanel value="general"><General /></TabPanel>
            <TabPanel value="agents"><Agents /></TabPanel>
            <TabPanel value="shortcuts"><Shortcuts /></TabPanel>
            <TabPanel value="performance"><p className="text-sm text-muted">Hardware decoding and encoding are on (WebCodecs uses your GPU). Proxy and cache controls arrive in M6.</p></TabPanel>
          </div>
        </UnderlineTabs>
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
      <ConnectClaude />
      <section className="flex flex-col gap-2">
        <h3 className="text-base">Built-in agent panel (optional)</h3>
        <p className="text-sm text-muted">
          The agent panel inside Reel needs an Anthropic API key and is billed by Anthropic per use. Not needed if you use Claude Code above. The key is encrypted with Windows DPAPI and never written to your project files.
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
        <p className="text-sm text-muted">Coming next: add any MCP server (for example Higgsfield for AI video, or your own scripts) to the built-in agent. Tools that cost money always ask first.</p>
      </section>
    </div>
  )
}

/** S28 · Let Claude Code (or any MCP client) edit in Reel with its own login: no API key needed here. */
function ConnectClaude() {
  const [info, setInfo] = useState<McpConnectInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => { void window.reel.mcp.info().then(setInfo) }, [])
  if (!info) return null
  const copy = async () => { await navigator.clipboard.writeText(info.claudeCommand); toast({ tone: 'success', title: 'Command copied', description: 'Paste it in a terminal, then start a new Claude Code session.' }) }
  return (
    <section className="flex flex-col gap-2 rounded-md border border-agent/40 bg-agent-soft/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base">Use Reel from Claude Code</h3>
        {info.listening ? <Badge tone="success">Ready on {info.url.replace('http://', '')}</Badge> : info.enabled ? <Badge tone="danger">Not listening</Badge> : <Badge>Off</Badge>}
      </div>
      <p className="text-sm text-muted">
        Connect your Claude Code session and ask it to edit: “cut the silences in the open project and caption it”. It uses your Claude login, edits show up here live, and Ctrl+Z undoes each one. Only programs on this computer with the token below can connect.
      </p>
      {info.error && <p role="alert" className="text-sm text-danger">{info.error}</p>}
      <div className="flex gap-2">
        <Button variant="agent" loading={busy} disabled={!info.listening} onClick={async () => {
          setBusy(true)
          const r = await window.reel.mcp.connectClaudeCode()
          setBusy(false)
          toast({ tone: r.ok ? 'success' : 'warning', title: r.ok ? 'Connected to Claude Code' : "Couldn't add it automatically", description: r.message })
        }}>Add to Claude Code</Button>
        <Button onClick={() => void copy()}>Copy command</Button>
      </div>
      <code className="block break-all rounded-sm bg-bg p-2 font-mono text-xs text-muted [user-select:text]">{info.claudeCommand}</code>
      <div className="flex flex-wrap gap-3 text-sm">
        <Switch label="Allow connected agents" checked={info.enabled} onCheckedChange={async (v) => setInfo(await window.reel.mcp.setEnabled(v))} />
        <Button size="sm" variant="ghost" onClick={async () => { setInfo(await window.reel.mcp.resetToken()); toast({ tone: 'info', title: 'New token', description: 'Connected sessions must be added again with the new command.' }) }}>Reset token</Button>
      </div>
    </section>
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
