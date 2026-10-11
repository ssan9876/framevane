import type { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../cn'

export type KeyframeState = 'none' | 'has' | 'on'

/** The diamond. 'none' = no keyframes · 'has' = keyframes exist (outline) · 'on' = keyframe at playhead (filled). */
export function Diamond({ state, size = 10, className, style }: { state: KeyframeState; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} className={className} style={style} aria-hidden>
      <path
        d="M5 .8 9.2 5 5 9.2 .8 5Z"
        className={cn(
          state === 'on' ? 'fill-keyframe stroke-keyframe' : 'fill-none',
          state === 'has' && 'stroke-keyframe',
          state === 'none' && 'stroke-muted',
        )}
        strokeWidth={1.3}
      />
    </svg>
  )
}

/**
 * Keyframe toggle next to an animatable property, with optional previous/next keyframe navigation.
 * Clicking adds a keyframe at the playhead ('none'/'has' → 'on') or removes the one at the playhead ('on' → 'has'/'none').
 */
export function KeyframeButton({ state, property, onToggle, onPrev, onNext }: {
  state: KeyframeState
  property: string
  onToggle: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const nav = state !== 'none' && (onPrev || onNext)
  return (
    <div className="flex items-center">
      {nav && (
        <button type="button" aria-label={`Previous ${property} keyframe`} onClick={onPrev} className="rounded-xs p-0.5 text-muted hover:text-fg">
          <ChevronLeft className="size-3" />
        </button>
      )}
      <button
        type="button"
        aria-label={state === 'on' ? `Remove ${property} keyframe at playhead` : `Add ${property} keyframe at playhead`}
        aria-pressed={state === 'on'}
        onClick={onToggle}
        className="grid size-5 place-items-center rounded-xs hover:bg-surface-3"
      >
        <Diamond state={state} />
      </button>
      {nav && (
        <button type="button" aria-label={`Next ${property} keyframe`} onClick={onNext} className="rounded-xs p-0.5 text-muted hover:text-fg">
          <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  )
}
