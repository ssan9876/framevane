import { useEffect, useRef, useState } from 'react'
import { Bot, KeyRound, AlertCircle, Library } from 'lucide-react'
import { AgentComposer, AgentNote, Button, ChatMessage, EmptyState, PanelHeader, Popover, ProposalCard, ToolStep, Badge, IconButton } from '@reel/ui'
import { formatUs } from '@reel/doc'
import type { AgentSettings } from '../../shared/api'
import { useApp, type AgentRunView } from '../app/store'

const SUGGESTIONS = [
  'Cut the silences and add captions',
  'Remove every pause longer than half a second',
  'Caption this video in big yellow text',
  'Find where I say “free shipping” and cut everything before it',
]

/** S27 · Agent panel: talk to the editing agent; its edits come back as a proposal to review (S29). */
export function AgentPanel() {
  const doc = useApp((s) => s.doc)!
  const runs = useApp((s) => s.agentRuns)
  const selection = useApp((s) => s.selection)
  const playheadUs = useApp((s) => s.playheadUs)
  const [draft, setDraft] = useState('')
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const running = runs.some((r) => r.status === 'running')

  useEffect(() => { void window.reel.agent.settings().then(setSettings) }, [])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [runs])

  async function send(text = draft) {
    const prompt = text.trim()
    if (!prompt || running) return
    setDraft('')
    try {
      const { runId } = await window.reel.agent.run(doc.id, prompt, { selection, playheadUs })
      useApp.getState().startAgentRun(runId, prompt)
    } catch (e) {
      useApp.getState().setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stop = () => { for (const r of runs) if (r.status === 'running') void window.reel.agent.cancel(r.runId) }
  const chips = [selection.length ? `${selection.length} clip${selection.length > 1 ? 's' : ''} selected` : 'Whole project', `Playhead ${formatUs(playheadUs)}`]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title={<span className="flex items-center gap-1.5"><Bot className="size-4 text-agent" />Agent</span>}
        actions={<>
          {settings && <Badge tone={settings.hasApiKey ? 'agent' : 'warning'}>{settings.hasApiKey ? settings.model.replace('claude-', '') : 'No key'}</Badge>}
          <Popover align="end" trigger={<IconButton size="sm" label="Agent library" icon={<Library />} tooltip={false} />}>
            <div className="w-64 text-sm">
              <p className="font-medium">Agent library (S31)</p>
              <p className="mt-1 text-muted">Saved agents and recipes (Captioner, Silence cutter, Ad-cut maker, Reframer, Photo retoucher) and your own custom agents arrive as a should-have. For now, describe the edit below.</p>
            </div>
          </Popover>
        </>} />
      <div ref={log} role="log" aria-live="polite" aria-label="Agent conversation" className="scroll-y flex flex-1 flex-col gap-2.5 p-3">
        {runs.length === 0 && (
          settings && !settings.hasApiKey ? (
            <EmptyState icon={<KeyRound />} title="Connect an AI model" body="The agent uses Claude through your own Anthropic API key. It's stored encrypted on this computer."
              action={<Button size="sm" variant="agent" onClick={() => useApp.getState().openDialog('settings', 'agents')}>Add API key</Button>} />
          ) : (
            <div className="flex flex-col gap-3">
              <EmptyState icon={<Bot />} title="Ask for an edit" body="The agent edits a copy of your project. You review every change before it's applied." className="py-4" />
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="rounded-md border border-border bg-surface-2 px-3 py-2 text-left text-sm text-muted hover:border-agent/50 hover:text-fg">{s}</button>
                ))}
              </div>
            </div>
          )
        )}
        {runs.map((r) => <RunView key={r.runId} run={r} />)}
      </div>
      <AgentComposer id="agent-composer" value={draft} onChange={setDraft} onSend={() => void send()} onStop={stop} running={running} chips={chips} />
    </div>
  )
}

function RunView({ run }: { run: AgentRunView }) {
  return (
    <>
      {run.items.map((it, i) => {
        if (it.type === 'turn') {
          const meta = it.turn.role === 'agent' && i === lastAgentIndex(run) && run.usage ? `${(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens · $${(run.usage.costMicroUsd / 1e6).toFixed(3)}` : undefined
          return <ChatMessage key={it.turn.id} role={it.turn.role} streaming={it.turn.streaming} meta={meta}>{it.turn.text}</ChatMessage>
        }
        if (it.type === 'note') return <AgentNote key={i}>{it.text}</AgentNote>
        return <ToolStep key={it.step.toolCallId} provider={it.step.provider} tool={it.step.tool} summary={it.step.summary || '…'} status={it.step.status} detail={it.step.detail} durationMs={it.step.durationMs} />
      })}
      {run.status === 'failed' && (
        <div role="alert" className="ml-8 flex items-start gap-2 rounded-md border border-danger/40 bg-surface-2 p-3 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span>{run.error ?? 'The agent stopped with an error.'}</span>
        </div>
      )}
      {run.status === 'cancelled' && <AgentNote>Stopped.</AgentNote>}
      {run.proposal && run.status === 'awaiting_review' && (
        <ProposalCard opCount={run.proposal.ops.length} summary={run.proposal.summary} cost={`$${(run.proposal.costMicroUsd / 1e6).toFixed(3)}`}
          onReview={() => { useApp.setState({ reviewRunId: run.runId }); useApp.getState().openDialog('review') }}
          onDiscard={() => void window.reel.agent.review(run.runId, [], 'reject')} />
      )}
      {(run.status === 'applied' || run.status === 'partially_applied') && run.proposal && <AgentNote>{run.status === 'applied' ? 'Edits applied. Undo with Ctrl+Z.' : 'Some edits applied. Undo with Ctrl+Z.'}</AgentNote>}
      {run.status === 'rejected' && <AgentNote>Edits discarded.</AgentNote>}
    </>
  )
}

const lastAgentIndex = (run: AgentRunView) => {
  for (let i = run.items.length - 1; i >= 0; i--) { const it = run.items[i]!; if (it.type === 'turn' && it.turn.role === 'agent') return i }
  return -1
}
