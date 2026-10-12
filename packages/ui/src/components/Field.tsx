import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type PointerEvent, type ReactNode } from 'react'
import { Slider as RSlider, Switch as RSwitch, Checkbox as RCheckbox, Select as RSelect } from 'radix-ui'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { cn } from '../cn'
import { KeyframeButton, type KeyframeState } from './Keyframe'

const inputBase =
  'h-7 rounded-sm border border-border-input bg-surface-2 px-2 text-md text-fg placeholder:text-muted hover:border-border-strong focus-visible:border-focus focus-visible:outline-none aria-[invalid=true]:border-danger disabled:opacity-45'

/* ─────────── Text field ─────────── */
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hideLabel?: boolean
  error?: string
  hint?: string
  leading?: ReactNode
}

export function TextField({ label, hideLabel, error, hint, leading, className, id, ...rest }: TextFieldProps) {
  const autoId = useId()
  const fid = id ?? autoId
  const msgId = `${fid}-msg`
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={fid} className={cn('text-sm text-muted', hideLabel && 'sr-only')}>{label}</label>
      <div className="relative flex items-center">
        {leading && <span className="pointer-events-none absolute left-2 text-muted [&_svg]:size-3.5">{leading}</span>}
        <input id={fid} aria-invalid={!!error || undefined} aria-describedby={error || hint ? msgId : undefined} className={cn(inputBase, 'w-full', leading && 'pl-7')} {...rest} />
      </div>
      {(error || hint) && <p id={msgId} className={cn('text-sm', error ? 'text-danger' : 'text-muted')}>{error ?? hint}</p>}
    </div>
  )
}

/* ─────────── Number field (type a value, arrows step, drag the label to scrub) ─────────── */
export interface NumberFieldProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  precision?: number
  ariaLabel: string
  width?: number
}

export function NumberField({ value, onChange, min = -Infinity, max = Infinity, step = 1, unit, precision = 0, ariaLabel, width = 72 }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const commit = () => {
    if (draft === null) return
    const n = Number.parseFloat(draft)
    if (Number.isFinite(n)) onChange(clamp(n))
    setDraft(null)
  }
  return (
    <div className="relative" style={{ width }}>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        value={draft ?? value.toFixed(precision)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * mult))
            setDraft(null)
          }
        }}
        className={cn(inputBase, 'w-full text-right tabular-nums', unit && 'pr-6')}
      />
      {unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">{unit}</span>}
    </div>
  )
}

/* ─────────── Slider field: label · slider · number · reset · keyframe ─────────── */
export interface SliderFieldProps {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  precision?: number
  /** Value considered "unchanged"; the reset arrow shows when value differs from it. */
  defaultValue?: number
  /** Fill grows from the center (e.g. −100…100 temperature) instead of from the left. */
  bipolar?: boolean
  keyframe?: { state: KeyframeState; onToggle: () => void; onPrev?: () => void; onNext?: () => void }
  disabled?: boolean
}

export function SliderField({ label, value, onChange, min, max, step = 1, unit, precision = 0, defaultValue, bipolar, keyframe, disabled }: SliderFieldProps) {
  const id = useId()
  const modified = defaultValue !== undefined && value !== defaultValue
  const scrub = useScrub(value, onChange, { min, max, step })
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const center = bipolar ? pct(defaultValue ?? (min + max) / 2) : 0
  const lo = Math.min(center, pct(value))
  const hi = Math.max(center, pct(value))
  return (
    <div className={cn('grid grid-cols-[88px_1fr_auto_16px_auto] items-center gap-2', disabled && 'pointer-events-none opacity-45')}>
      <label id={id} {...scrub} className="cursor-ew-resize truncate text-sm text-muted" title="Drag to adjust">
        {label}
      </label>
      <RSlider.Root
        aria-labelledby={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => v !== undefined && onChange(v)}
        className="relative flex h-5 touch-none items-center select-none"
      >
        <RSlider.Track className="relative h-[3px] grow rounded-pill bg-border-strong">
          {/* custom range so bipolar sliders fill from their center */}
          <span className="absolute h-full rounded-pill bg-accent" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        </RSlider.Track>
        <RSlider.Thumb aria-label={label} className="block size-3 rounded-pill bg-fg shadow-card hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus" />
      </RSlider.Root>
      <NumberField value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} precision={precision} ariaLabel={label} width={60} />
      {modified ? (
        <button type="button" aria-label={`Reset ${label}`} onClick={() => onChange(defaultValue!)} className="text-muted hover:text-fg">
          <RotateCcw className="size-3" />
        </button>
      ) : <span />}
      {keyframe ? <KeyframeButton property={label} {...keyframe} /> : <span className="w-5" />}
    </div>
  )
}

/** Drag on a label to scrub a value (like pro editors). Pointer capture, Shift = ×10, Alt = fine. */
function useScrub(value: number, onChange: (v: number) => void, { min, max, step }: { min: number; max: number; step: number }) {
  const start = useRef<{ x: number; v: number } | null>(null)
  const latest = useRef(value)
  useEffect(() => { latest.current = value }, [value])
  return {
    onPointerDown: (e: PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, v: latest.current }
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const raw = start.current.v + ((e.clientX - start.current.x) / 2) * step * mult
      onChange(Math.min(max, Math.max(min, Math.round(raw / step) * step)))
    },
    onPointerUp: () => { start.current = null },
  }
}

/* ─────────── Switch / Checkbox ─────────── */
export function Switch({ label, checked, onCheckedChange, disabled, description }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; description?: string }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <label htmlFor={id} className="text-sm">{label}</label>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-4 w-7 shrink-0 rounded-pill border border-border-input bg-surface-3 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45"
      >
        <RSwitch.Thumb className="block size-3 translate-x-px rounded-pill bg-fg transition-transform duration-100 data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-on-accent" />
      </RSwitch.Root>
    </div>
  )
}

export function Checkbox({ label, checked, onCheckedChange, disabled, hideLabel }: { label: string; checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; disabled?: boolean; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="grid size-3.5 shrink-0 place-items-center rounded-xs border border-border-input bg-surface-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:opacity-45"
      >
        <RCheckbox.Indicator className="text-on-accent">
          {checked === 'indeterminate' ? <span className="block h-0.5 w-2 bg-on-accent" /> : <Check className="size-3" strokeWidth={3} />}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className={cn('text-sm', hideLabel && 'sr-only')}>{label}</label>
    </div>
  )
}

/* ─────────── Select ─────────── */
export interface SelectOption { value: string; label: string; disabled?: boolean; hint?: string }

export function Select({ label, value, onValueChange, options, hideLabel, width = 160, disabled }: { label: string; value: string; onValueChange: (v: string) => void; options: SelectOption[]; hideLabel?: boolean; width?: number; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <span id={id} className={cn('text-sm text-muted', hideLabel && 'sr-only')}>{label}</span>
      <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RSelect.Trigger aria-labelledby={id} style={{ width }} className={cn(inputBase, 'flex items-center justify-between gap-1 text-left')}>
          <RSelect.Value />
          <RSelect.Icon><ChevronDown className="size-3.5 text-muted" /></RSelect.Icon>
        </RSelect.Trigger>
        <RSelect.Portal>
          <RSelect.Content position="popper" sideOffset={4} className="z-[var(--reel-z-popover)] max-h-72 min-w-[var(--radix-select-trigger-width)] rounded-md bg-surface-2 p-1 shadow-pop">
            <RSelect.Viewport>
              {options.map((o) => (
                <RSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="flex h-7 cursor-default items-center gap-2 rounded-sm pr-2 pl-6 text-sm outline-none relative data-[highlighted]:bg-accent-soft data-[disabled]:text-disabled">
                  <RSelect.ItemIndicator className="absolute left-1.5"><Check className="size-3 text-accent" /></RSelect.ItemIndicator>
                  <RSelect.ItemText>{o.label}</RSelect.ItemText>
                  {o.hint && <span className="ml-auto text-xs text-muted">{o.hint}</span>}
                </RSelect.Item>
              ))}
            </RSelect.Viewport>
          </RSelect.Content>
        </RSelect.Portal>
      </RSelect.Root>
    </div>
  )
}
