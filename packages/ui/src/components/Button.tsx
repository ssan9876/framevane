import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../cn'
import { Tooltip } from './Overlay'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'agent'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-surface-3 text-fg hover:bg-border-strong border border-border-strong',
  ghost: 'text-fg hover:bg-surface-3',
  danger: 'bg-danger-solid text-on-danger hover:brightness-110',
  agent: 'bg-agent-soft text-agent hover:brightness-125 border border-agent/40',
}
const sizes: Record<Size, string> = {
  sm: 'h-6 px-2 text-sm gap-1 rounded-sm',
  md: 'h-7 px-3 text-sm gap-1.5 rounded-md font-medium',
  lg: 'h-9 px-4 text-base gap-2 rounded-md',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

/** Text button. Loading keeps the label (screen readers still hear it) and sets aria-busy. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors duration-100 select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: becomes aria-label and the tooltip text. */
  label: string
  shortcut?: string
  icon: ReactNode
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary'
  tooltip?: boolean
}

/** Square icon-only button. Always has an accessible name and a tooltip (with shortcut). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, icon, size = 'md', variant = 'ghost', tooltip = true, className, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm text-muted transition-colors duration-100',
        'hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        variant === 'secondary' && 'bg-surface-3 border border-border-strong text-fg',
        size === 'md' ? 'size-7 [&_svg]:size-4' : 'size-6 [&_svg]:size-3.5',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
  return tooltip ? <Tooltip content={label} shortcut={shortcut}>{btn}</Tooltip> : btn
})

export interface IconToggleProps extends Omit<IconButtonProps, 'onChange'> {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  /** 'accent' for mode toggles (magnet, snapping); 'warning' for track lock/mute style states. */
  tone?: 'accent' | 'warning'
}

/** Two-state icon button (aria-pressed). Used for timeline toggles and track lock/hide/mute. */
export const IconToggle = forwardRef<HTMLButtonElement, IconToggleProps>(function IconToggle(
  { pressed, onPressedChange, tone = 'accent', className, ...rest },
  ref,
) {
  return (
    <IconButton
      ref={ref}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        pressed && tone === 'accent' && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent-hover',
        pressed && tone === 'warning' && 'text-warning hover:text-warning',
        className,
      )}
      {...rest}
    />
  )
})
