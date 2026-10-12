import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Lock, Unlock, Eye, EyeOff, Volume2, VolumeX, Film, Music, Type, Sparkles, Captions, SlidersHorizontal, AlertTriangle, Image as ImageIcon, Sticker, Palette } from 'lucide-react'
import { cn } from '../cn'
import { IconToggle } from './Button'
import { Diamond } from './Keyframe'

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'caption' | 'sticker' | 'effect' | 'filter' | 'adjustment'

const clipFill: Record<ClipKind, string> = {
  video: 'bg-clip-video', image: 'bg-clip-image', audio: 'bg-clip-audio', text: 'bg-clip-text', caption: 'bg-clip-caption',
  sticker: 'bg-clip-sticker', effect: 'bg-clip-effect', filter: 'bg-clip-filter', adjustment: 'bg-clip-adjustment',
}
const clipIcon: Record<ClipKind, ReactNode> = {
  video: <Film />, image: <ImageIcon />, audio: <Music />, text: <Type />, caption: <Captions />, sticker: <Sticker />,
  effect: <Sparkles />, filter: <Palette />, adjustment: <SlidersHorizontal />,
}

export interface TimelineClipProps {
  kind: ClipKind
  label: string
  width: number
  height: number
  selected?: boolean
  /** Disabled with V: still visible, hatched, skipped by preview/export. */
  disabled?: boolean
  missing?: boolean
  /** AI job running on this clip (0..1 or undefined = indeterminate). */
  processing?: number | 'indeterminate'
  /** Keyframe positions as 0..1 of clip width; the one under the playhead is filled. */
  keyframes?: { at: number; on?: boolean }[]
  /** Seed for the placeholder waveform (real peaks come from the waveform job). */
  waveformSeed?: number
  /** Thumbnail strip backgrounds for video clips. */
  thumbs?: string[]
  /** One background for the whole clip body (e.g. a positioned filmstrip sprite). */
  stripStyle?: CSSProperties
  /** Real waveform peaks (0..1), already sliced to this clip's source range. Overrides waveformSeed. */
  waveform?: ArrayLike<number>
  speedLabel?: string
  /** Proposed by an agent and not yet applied (S29 preview): dashed agent outline. */
  proposed?: boolean
}

/**
 * One clip on the timeline. Visual only: dragging, trimming and snapping live in the timeline controller.
 * a11y: the timeline is a role="grid" of tracks; each clip is a focusable gridcell announced as
 * "<label>, <kind>, <start>–<end>, selected". Arrow keys move between clips, Enter opens it in the inspector.
 */
export function TimelineClip({ kind, label, width, height, selected, disabled, missing, processing, keyframes, waveformSeed, thumbs, stripStyle, waveform: peaks, speedLabel, proposed }: TimelineClipProps) {
  const bars = useMemo(() => {
    if (peaks) return resample(peaks, Math.max(4, Math.floor(width / 3)))
    return kind === 'audio' || waveformSeed !== undefined ? waveform(Math.floor(width / 3), waveformSeed ?? 1) : null
  }, [kind, width, waveformSeed, peaks])
  const compact = height <= 28
  return (
    <div
      role="gridcell"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`${label}, ${kind}${disabled ? ', disabled' : ''}${missing ? ', media missing' : ''}`}
      style={{ width, height }}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-sm text-fg',
        clipFill[kind],
        selected ? 'outline-2 outline-selection -outline-offset-1'
          : proposed ? 'outline-2 outline-dashed outline-agent -outline-offset-2'
          : 'outline-1 outline-scrim/40 -outline-offset-1',
      )}
    >
      {stripStyle && !compact && <div className="absolute inset-0 opacity-75" style={stripStyle} />}
      {thumbs && !compact && (
        <div className="absolute inset-0 flex opacity-70">
          {thumbs.map((t, i) => <div key={i} className="h-full flex-1 bg-cover bg-center" style={{ background: t }} />)}
        </div>
      )}
      {bars && (
        <svg className="absolute inset-x-0 bottom-0 h-3/5 w-full" preserveAspectRatio="none" viewBox={`0 0 ${bars.length} 1`} aria-hidden>
          {bars.map((b, i) => <rect key={i} x={i + 0.15} width={0.7} y={(1 - b) / 2} height={b} className="fill-clip-audio-wave" />)}
        </svg>
      )}
      <div className={cn('relative flex items-center gap-1 px-1.5 [&_svg]:size-3 [&_svg]:shrink-0', compact ? 'h-full' : 'h-5 bg-gradient-to-b from-scrim/50 to-transparent')}>
        {clipIcon[kind]}
        <span className="truncate text-xs">{label}</span>
        {speedLabel && <span className="ml-auto rounded-xs bg-scrim/50 px-1 text-[10px]">{speedLabel}</span>}
      </div>
      {keyframes?.map((k, i) => (
        <Diamond key={i} state={k.on ? 'on' : 'has'} size={9} className="absolute bottom-1 -translate-x-1/2" style={{ left: `${k.at * 100}%` }} />
      ))}
      {disabled && <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,.45)_0_4px,transparent_4px_8px)]" />}
      {missing && (
        <div className="absolute inset-0 flex items-center justify-center gap-1 bg-scrim/60 text-xs text-warning"><AlertTriangle className="size-3" />Media offline</div>
      )}
      {processing !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-scrim/50">
          <div className={cn('h-full bg-agent', processing === 'indeterminate' && 'w-1/3 animate-[reel-indeterminate_1.1s_linear_infinite]')} style={processing === 'indeterminate' ? undefined : { width: `${processing * 100}%` }} />
        </div>
      )}
      {/* trim handles (visible on hover/selection) */}
      <span className={cn('absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-selection/0 group-hover:bg-selection/40', selected && 'bg-selection/70')} aria-hidden />
      <span className={cn('absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-selection/0 group-hover:bg-selection/40', selected && 'bg-selection/70')} aria-hidden />
    </div>
  )
}

function resample(p: ArrayLike<number>, n: number) {
  const out: number[] = []
  const step = p.length / n
  for (let i = 0; i < n; i++) {
    let m = 0
    for (let j = Math.floor(i * step); j < Math.min(p.length, Math.floor((i + 1) * step) || 1); j++) m = Math.max(m, p[j]!)
    out.push(Math.max(0.04, Math.min(1, m)))
  }
  return out
}

function waveform(n: number, seed: number) {
  let s = seed * 9301 + 49297
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  return Array.from({ length: Math.max(4, n) }, (_, i) => Math.min(1, 0.15 + Math.abs(Math.sin(i / 5 + seed)) * 0.5 + rnd() * 0.35))
}

/* ─────────── Track header ─────────── */
export function TrackHeader({ name, kind, height, locked, hidden, muted, onLocked, onHidden, onMuted, main }: {
  name: string
  kind: ClipKind
  height: number
  locked: boolean
  hidden?: boolean
  muted?: boolean
  onLocked: (v: boolean) => void
  onHidden?: (v: boolean) => void
  onMuted?: (v: boolean) => void
  main?: boolean
}) {
  return (
    <div role="rowheader" style={{ height }} className="flex w-[var(--reel-track-header-w)] shrink-0 items-center gap-0.5 border-b border-border bg-surface px-1.5">
      <span className="mr-auto flex min-w-0 items-center gap-1 text-xs text-muted [&_svg]:size-3">
        {clipIcon[kind]}
        <span className="truncate">{name}</span>
        {main && <span role="img" aria-label="Main track" title="Main track (magnet)" className="size-1.5 shrink-0 rounded-pill bg-accent" />}
      </span>
      <IconToggle size="sm" tone="warning" label={locked ? `Unlock ${name}` : `Lock ${name}`} pressed={locked} onPressedChange={onLocked} icon={locked ? <Lock /> : <Unlock />} />
      {onHidden && <IconToggle size="sm" tone="warning" label={hidden ? `Show ${name}` : `Hide ${name}`} pressed={!!hidden} onPressedChange={onHidden} icon={hidden ? <EyeOff /> : <Eye />} />}
      {onMuted && <IconToggle size="sm" tone="warning" label={muted ? `Unmute ${name}` : `Mute ${name}`} pressed={!!muted} onPressedChange={onMuted} icon={muted ? <VolumeX /> : <Volume2 />} />}
    </div>
  )
}

/* ─────────── Ruler + playhead ─────────── */
export interface RulerMarker { at: number; color: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'; label?: string }

/** Time ruler. pxPerSec drives tick density; labels are mm:ss (or frames when zoomed in, handled by the caller's formatter). */
export function Ruler({ width, pxPerSec, offsetSec = 0, markers = [], format = fmt }: { width: number; pxPerSec: number; offsetSec?: number; markers?: RulerMarker[]; format?: (s: number) => string }) {
  const major = pickStep(pxPerSec)
  const ticks: { x: number; s: number; major: boolean }[] = []
  const minor = major / 5
  const start = Math.floor(offsetSec / minor) * minor
  for (let s = start; (s - offsetSec) * pxPerSec <= width; s += minor) {
    const isMajor = Math.abs(s / major - Math.round(s / major)) < 1e-6
    ticks.push({ x: (s - offsetSec) * pxPerSec, s, major: isMajor })
  }
  return (
    <svg width={width} height={24} className="block bg-timeline-bg" aria-hidden>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} x2={t.x} y1={t.major ? 12 : 18} y2={24} className="stroke-border-strong" />
          {t.major && <text x={t.x + 3} y={10} className="fill-muted font-mono text-[10px]">{format(t.s)}</text>}
        </g>
      ))}
      {markers.map((m, i) => (
        <path key={i} d={`M${(m.at - offsetSec) * pxPerSec - 4},14 h8 v5 l-4,4 l-4,-4z`} style={{ fill: `var(--reel-color-marker-${m.color})` }}>
          {m.label && <title>{m.label}</title>}
        </path>
      ))}
    </svg>
  )
}

/** Playhead line with grab handle. Positioned by the timeline; this is just the visual. */
export function Playhead({ x, height }: { x: number; height: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 z-[var(--reel-z-timeline-overlay)]" style={{ left: x, height }}>
      <svg width={12} height={12} className="absolute -left-[6px] top-0"><path d="M0 0h12v6l-6 6-6-6z" className="fill-playhead" /></svg>
      <div className="absolute left-[-0.5px] top-0 h-full w-px bg-playhead" />
    </div>
  )
}

/** Vertical snap guide shown while dragging/trimming when an edge snaps to playhead, clip edge or marker. */
export function SnapGuide({ x, height }: { x: number; height: number }) {
  return <div aria-hidden className="pointer-events-none absolute top-0 w-px bg-snap-guide" style={{ left: x, height }} />
}

function pickStep(pxPerSec: number) {
  for (const s of [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pxPerSec >= 70) return s
  return 1200
}
function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${String(m).padStart(2, '0')}:${sec % 1 ? sec.toFixed(1).padStart(4, '0') : String(sec).padStart(2, '0')}`
}
