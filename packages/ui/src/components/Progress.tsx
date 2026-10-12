import { Loader2 } from 'lucide-react'
import { cn } from '../cn'

/** Determinate when value is 0..1, indeterminate when undefined. */
export function ProgressBar({ value, label, tone = 'accent', className }: { value?: number; label: string; tone?: 'accent' | 'agent' | 'danger'; className?: string }) {
  const fill = tone === 'agent' ? 'bg-agent' : tone === 'danger' ? 'bg-danger' : 'bg-accent'
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
      className={cn('relative h-1 w-full overflow-hidden rounded-pill bg-surface-3', className)}
    >
      {value === undefined ? (
        <span className={cn('absolute inset-y-0 w-2/5 rounded-pill animate-[framevane-indeterminate_1.1s_var(--fv-ease)_infinite]', fill)} />
      ) : (
        <span className={cn('absolute inset-y-0 left-0 rounded-pill transition-[width] duration-150', fill)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      )}
    </div>
  )
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn('size-4 animate-spin text-muted', className)} />
}

/** Labeled job progress used in modals and the background-job tray: title · % · ETA · cancel. */
export function JobProgress({ title, value, detail, onCancel }: { title: string; value?: number; detail?: string; onCancel?: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate">{title}</span>
        <span className="tabular-nums text-muted">{value === undefined ? '' : `${Math.round(value * 100)}%`}</span>
      </div>
      <ProgressBar value={value} label={title} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{detail}</span>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-xs px-1 hover:bg-surface-3 hover:text-fg">Cancel</button>}
      </div>
    </div>
  )
}
