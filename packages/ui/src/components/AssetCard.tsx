import type { ReactNode } from 'react'
import { Plus, Check, AlertTriangle, Music, Type, Image as ImageIcon, Film, Sparkles } from 'lucide-react'
import { cn } from '../cn'
import { ProgressBar } from './Progress'

export type AssetKind = 'video' | 'image' | 'audio' | 'text' | 'effect' | 'filter' | 'transition' | 'sticker'
export type AssetState = 'ready' | 'generating' | 'added' | 'missing'

const kindIcon: Record<AssetKind, ReactNode> = {
  video: <Film />, image: <ImageIcon />, audio: <Music />, text: <Type />,
  effect: <Sparkles />, filter: <Sparkles />, transition: <Sparkles />, sticker: <Sparkles />,
}

export interface AssetCardProps {
  title: string
  kind: AssetKind
  /** CSS background for the thumbnail (image url or gradient). Missing → kind icon on surface. */
  thumb?: string
  duration?: string
  state?: AssetState
  progress?: number
  selected?: boolean
  usedInProject?: boolean
  badge?: ReactNode
  onSelect?: () => void
  onAdd?: () => void
  onPreview?: (hovering: boolean) => void
}

/**
 * Media / library card. The card body selects (and previews on hover); the "+" adds to the timeline at the playhead.
 * Draggable to the timeline. Two separate buttons so each has one job for keyboard and screen readers.
 */
export function AssetCard({ title, kind, thumb, duration, state = 'ready', progress, selected, usedInProject, badge, onSelect, onAdd, onPreview }: AssetCardProps) {
  const busy = state === 'generating'
  return (
    <div
      className="group relative flex w-[var(--fv-asset-card-w)] flex-col gap-1"
      draggable={state === 'ready' || state === 'added'}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${title}${duration ? `, ${duration}` : ''}${state === 'missing' ? ', file missing' : ''}`}
        onClick={onSelect}
        className={cn(
          'relative h-[var(--fv-asset-card-h)] overflow-hidden rounded-sm bg-surface-3 bg-cover bg-center outline-offset-1',
          selected ? 'ring-2 ring-accent' : 'ring-1 ring-border group-hover:ring-border-strong',
        )}
        style={thumb ? { background: thumb } : undefined}
      >
        {!thumb && <span className="absolute inset-0 grid place-items-center text-muted [&_svg]:size-5">{kindIcon[kind]}</span>}
        {busy && <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent)] bg-[length:200px_100%] animate-[framevane-shimmer_1.2s_linear_infinite]" />}
        {state === 'missing' && (
          <span className="absolute inset-0 grid place-items-center bg-scrim/60 text-warning"><AlertTriangle className="size-5" /></span>
        )}
        {duration && <span className="absolute bottom-1 right-1 rounded-xs bg-scrim/70 px-1 font-mono text-[10px] text-fg">{duration}</span>}
        {badge && <span className="absolute left-1 top-1">{badge}</span>}
        {usedInProject && <span className="absolute left-1 bottom-1 size-1.5 rounded-pill bg-success" title="Used in project" />}
      </button>
      {state !== 'missing' && onAdd && (
        <button
          type="button"
          aria-label={state === 'added' ? `${title} added` : `Add ${title} to timeline`}
          disabled={busy}
          onClick={onAdd}
          className={cn(
            'absolute right-1 top-1 grid size-5 place-items-center rounded-pill shadow-card transition-opacity',
            state === 'added' ? 'bg-success text-on-accent opacity-100' : 'bg-accent text-on-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            busy && 'hidden',
          )}
        >
          {state === 'added' ? <Check className="size-3" strokeWidth={3} /> : <Plus className="size-3.5" strokeWidth={3} />}
        </button>
      )}
      {busy && (
        <div className="absolute inset-x-1 top-[calc(var(--fv-asset-card-h)-8px)]">
          <ProgressBar value={progress} label={`Preparing ${title}`} />
        </div>
      )}
      <span className={cn('truncate text-xs', state === 'missing' ? 'text-warning' : 'text-muted')}>{title}</span>
    </div>
  )
}
