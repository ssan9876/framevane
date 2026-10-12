import { useState, type ReactNode } from 'react'
import { Bot, User, ChevronRight, Check, X, Loader2, ShieldQuestion, AlertCircle, Coins, Wrench, CircleSlash } from 'lucide-react'
import { cn } from '../cn'
import { Button } from './Button'
import { Badge } from './Misc'
import { Checkbox } from './Field'

/* ─────────── Chat message ─────────── */
export function ChatMessage({ role, children, streaming, meta }: { role: 'user' | 'agent'; children: ReactNode; streaming?: boolean; meta?: ReactNode }) {
  const agent = role === 'agent'
  return (
    <article aria-label={agent ? 'Agent message' : 'Your message'} aria-busy={streaming || undefined} className={cn('flex gap-2', !agent && 'flex-row-reverse')}>
      <span className={cn('grid size-6 shrink-0 place-items-center rounded-pill [&_svg]:size-3.5', agent ? 'bg-agent-soft text-agent' : 'bg-surface-3 text-muted')}>
        {agent ? <Bot /> : <User />}
      </span>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', !agent && 'items-end')}>
        <div className={cn('rounded-md px-3 py-2 text-md leading-[18px] [user-select:text]', agent ? 'bg-surface-2' : 'bg-accent-soft')}>
          {children}
          {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-agent" aria-hidden />}
        </div>
        {meta && <div className="text-xs text-muted">{meta}</div>}
      </div>
    </article>
  )
}

/** Progress note between tool calls (from the model's "updates" thinking display). One line, muted. */
export function AgentNote({ children }: { children: ReactNode }) {
  return <p className="pl-8 text-sm italic text-muted">{children}</p>
}

/* ─────────── Tool step ─────────── */
export type ToolStatus = 'running' | 'done' | 'error' | 'awaiting' | 'denied'

const statusIcon: Record<ToolStatus, ReactNode> = {
  running: <Loader2 className="animate-spin text-agent" />,
  done: <Check className="text-success" />,
  error: <AlertCircle className="text-danger" />,
  awaiting: <ShieldQuestion className="text-warning" />,
  denied: <CircleSlash className="text-muted" />,
}

/**
 * One tool call in the agent transcript: provider · tool · one-line summary, expandable to raw input/output.
 * Collapsed by default; errors start expanded.
 */
export function ToolStep({ provider, tool, summary, status, detail, durationMs }: { provider: string; tool: string; summary: string; status: ToolStatus; detail?: string; durationMs?: number }) {
  const [open, setOpen] = useState(status === 'error')
  return (
    <div className="ml-8 rounded-sm border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-sm [&_svg]:size-3.5 [&_svg]:shrink-0"
      >
        <ChevronRight className={cn('text-muted transition-transform', open && 'rotate-90')} />
        {statusIcon[status]}
        <span className="text-muted">{provider}</span>
        <span className="font-mono text-xs">{tool}</span>
        <span className="truncate text-muted">· {summary}</span>
        {durationMs !== undefined && <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">{(durationMs / 1000).toFixed(1)}s</span>}
      </button>
      {open && detail && (
        <pre className="max-h-48 overflow-auto border-t border-border px-2 py-1.5 font-mono text-xs text-muted [user-select:text] whitespace-pre-wrap">{detail}</pre>
      )}
    </div>
  )
}

/* ─────────── Permission prompt ─────────── */
/** Shown inline in the transcript when a tool with permission "ask" is called. Focus moves here (it is an alertdialog). */
export function PermissionPrompt({ provider, tool, reason, costsMoney, onAllowOnce, onAlwaysAllow, onDeny }: {
  provider: string
  tool: string
  reason: string
  costsMoney?: boolean
  onAllowOnce: () => void
  onAlwaysAllow: () => void
  onDeny: () => void
}) {
  return (
    <div role="alertdialog" aria-label={`Allow ${tool}?`} className="ml-8 flex flex-col gap-2 rounded-md border border-warning/50 bg-surface-2 p-3">
      <div className="flex items-center gap-2 text-sm">
        <ShieldQuestion className="size-4 text-warning" aria-hidden />
        <span>Allow <span className="font-mono text-xs">{provider}.{tool}</span>?</span>
        {costsMoney && <Badge tone="warning" icon={<Coins />}>Uses paid credits</Badge>}
      </div>
      <p className="text-sm text-muted">{reason}</p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={onAllowOnce} autoFocus>Allow once</Button>
        {!costsMoney && <Button size="sm" onClick={onAlwaysAllow}>Always allow</Button>}
        <Button size="sm" variant="ghost" onClick={onDeny}>Deny</Button>
      </div>
    </div>
  )
}

/* ─────────── Proposal card (end of a run) ─────────── */
export function ProposalCard({ opCount, summary, cost, onReview, onDiscard }: { opCount: number; summary: string; cost?: string; onReview: () => void; onDiscard: () => void }) {
  return (
    <div className="ml-8 flex flex-col gap-2 rounded-md border border-agent/50 bg-agent-soft p-3">
      <div className="flex items-center gap-2 text-sm">
        <Wrench className="size-4 text-agent" aria-hidden />
        <span className="font-medium">{opCount} edits ready to review</span>
        {cost && <span className="ml-auto text-xs text-muted">{cost}</span>}
      </div>
      <p className="text-sm text-muted">{summary}</p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={onReview}>Review edits</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
      </div>
    </div>
  )
}

/* ─────────── Op row (S29 edit review list) ─────────── */
export type OpStatus = 'proposed' | 'applied' | 'rejected' | 'failed' | 'conflicted'

const opBadge: Record<OpStatus, ReactNode> = {
  proposed: null,
  applied: <Badge tone="success" icon={<Check />}>Applied</Badge>,
  rejected: <Badge icon={<X />}>Rejected</Badge>,
  failed: <Badge tone="danger" icon={<AlertCircle />}>Failed</Badge>,
  conflicted: <Badge tone="warning" icon={<AlertCircle />}>Conflict</Badge>,
}

/** A single proposed edit: include toggle · label · target · time · status. Clicking the row seeks the preview to it. */
export function OpRow({ label, target, time, included, onIncludedChange, status = 'proposed', thumb, onFocusOp }: {
  label: string
  target: string
  time?: string
  included: boolean
  onIncludedChange: (v: boolean) => void
  status?: OpStatus
  thumb?: string
  onFocusOp?: () => void
}) {
  return (
    <li className={cn('flex h-10 items-center gap-2 border-b border-border px-2', !included && 'opacity-55')}>
      <Checkbox hideLabel label={`Include: ${label}`} checked={included} onCheckedChange={onIncludedChange} disabled={status !== 'proposed'} />
      {thumb !== undefined && <span className="h-7 w-12 shrink-0 rounded-xs bg-surface-3 bg-cover" style={thumb ? { background: thumb } : undefined} />}
      <button type="button" onClick={onFocusOp} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={cn('truncate text-sm', !included && 'line-through')}>{label}</span>
        <span className="truncate text-xs text-muted">{target}</span>
      </button>
      {time && <span className="shrink-0 font-mono text-xs text-muted">{time}</span>}
      {opBadge[status]}
    </li>
  )
}

/** Composer at the bottom of the agent panel. Enter sends, Shift+Enter new line. Context chips show what the agent will see. */
export function AgentComposer({ id, value, onChange, onSend, onStop, running, chips, placeholder = 'Describe the edit… e.g. "cut the silences and add captions"' }: {
  id?: string
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  running?: boolean
  chips?: string[]
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border p-2">
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Context sent to the agent">
          {chips.map((c) => <Badge key={c} tone="agent">{c}</Badge>)}
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-md border border-border-input bg-surface-2 p-1.5 focus-within:border-focus">
        <textarea
          id={id}
          aria-label="Message the agent"
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!running && value.trim()) onSend() } }}
          className="min-h-9 flex-1 resize-none bg-transparent px-1 text-md text-fg placeholder:text-muted focus:outline-none"
        />
        {running ? (
          <Button size="sm" variant="secondary" onClick={onStop}>Stop</Button>
        ) : (
          <Button size="sm" variant="agent" onClick={onSend} disabled={!value.trim()}>Send</Button>
        )}
      </div>
    </div>
  )
}
