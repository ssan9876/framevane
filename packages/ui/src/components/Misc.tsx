import { useState, type ReactNode, type DragEvent } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '../cn'

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border-strong bg-surface px-1 font-mono text-[10px] leading-none text-muted">
      {children}
    </kbd>
  )
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'agent'
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-surface-3 text-success',
  warning: 'bg-surface-3 text-warning',
  danger: 'bg-surface-3 text-danger',
  agent: 'bg-agent-soft text-agent',
}

/** Small status label: "Local", "AI", "Costs credits", "4K", durations on cards. */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-4 items-center gap-1 rounded-xs px-1 text-xs [&_svg]:size-3', badgeTones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

export function PanelHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-[var(--fv-panel-header-h)] shrink-0 items-center justify-between gap-2 border-b border-border px-3', className)}>
      <h2 className="truncate text-base">{title}</h2>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  )
}

/** Empty state with one primary action. Copy is ours; keep it short and say what to do. */
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icon && <div className="mb-1 text-muted [&_svg]:size-7">{icon}</div>}
      <p className="text-base">{title}</p>
      {body && <p className="max-w-64 text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * File drop target. The visible button is the keyboard path (drag and drop is never the only way).
 * States: idle, drag-over (accent dashed border), disabled.
 */
export function DropZone({ onFiles, onBrowse, label = 'Drop video, photos or audio here', hint = 'or browse your files', disabled, className, forceDragOver }: {
  onFiles: (files: File[]) => void
  onBrowse: () => void
  label?: string
  hint?: string
  disabled?: boolean
  className?: string
  forceDragOver?: boolean
}) {
  const [over, setOver] = useState(false)
  const active = over || forceDragOver
  const stop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
  return (
    <div
      onDragEnter={(e) => { stop(e); if (!disabled) setOver(true) }}
      onDragOver={stop}
      onDragLeave={(e) => { stop(e); setOver(false) }}
      onDrop={(e) => { stop(e); setOver(false); if (!disabled) onFiles([...e.dataTransfer.files]) }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-8 text-center transition-colors duration-100',
        active ? 'border-accent bg-accent-soft' : 'border-border-input bg-surface-2/50',
        disabled && 'opacity-45',
        className,
      )}
    >
      <Upload className={cn('size-6', active ? 'text-accent' : 'text-muted')} aria-hidden />
      <p className="text-base">{active ? 'Release to import' : label}</p>
      <button type="button" disabled={disabled} onClick={onBrowse} className="text-sm text-accent underline-offset-2 hover:underline">
        {hint}
      </button>
    </div>
  )
}
