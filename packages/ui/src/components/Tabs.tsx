import type { ReactNode } from 'react'
import { Tabs as RTabs, ToggleGroup as RToggleGroup } from 'radix-ui'
import { cn } from '../cn'

export interface TabDef { value: string; label: string; icon?: ReactNode; badge?: ReactNode; disabled?: boolean }

/**
 * Top-level asset panel tabs (Media, Audio, Text, …): icon over label, horizontal strip.
 * Radix Tabs = arrow-key navigation, roving focus, aria-selected.
 */
export function PanelTabs({ tabs, value, onValueChange, children, className }: { tabs: TabDef[]; value: string; onValueChange: (v: string) => void; children?: ReactNode; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={cn('flex min-h-0 flex-col', className)}>
      <RTabs.List aria-label="Asset library" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-1.5 pt-1.5">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className="group relative flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-t-sm px-2 text-xs text-muted hover:bg-surface-3 hover:text-fg data-[state=active]:text-accent [&_svg]:size-4"
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge && <span className="absolute right-1 top-1">{t.badge}</span>}
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill bg-accent opacity-0 group-data-[state=active]:opacity-100" />
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  )
}

export const TabPanel = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <RTabs.Content value={value} className={cn('min-h-0 flex-1 outline-none', className)}>{children}</RTabs.Content>
)

/** Inspector tabs (Video · Audio · Speed · Animation · Adjust): text, underline indicator. */
export function UnderlineTabs({ tabs, value, onValueChange, children, label = 'Properties' }: { tabs: TabDef[]; value: string; onValueChange: (v: string) => void; children?: ReactNode; label?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className="flex min-h-0 flex-col">
      <RTabs.List aria-label={label} className="flex shrink-0 gap-3 border-b border-border px-3">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className="relative flex h-8 items-center gap-1 text-sm text-muted hover:text-fg data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent disabled:text-disabled"
          >
            {t.label}
            {t.badge}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  )
}

/** Segmented control for sub-modes (Basic | Remove BG | Mask; Normal | Curve; In | Out | Combo). Single select. */
export function Segmented({ options, value, onValueChange, label, size = 'md' }: { options: TabDef[]; value: string; onValueChange: (v: string) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <RToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      className="inline-flex rounded-md bg-bg p-0.5"
    >
      {options.map((o) => (
        <RToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cn(
            'flex items-center gap-1 rounded-sm px-2.5 text-sm text-muted hover:text-fg data-[state=on]:bg-surface-3 data-[state=on]:text-fg data-[state=on]:shadow-card disabled:text-disabled [&_svg]:size-3.5',
            size === 'md' ? 'h-6' : 'h-5 text-xs',
          )}
        >
          {o.icon}
          {o.label}
        </RToggleGroup.Item>
      ))}
    </RToggleGroup.Root>
  )
}

/** Vertical sub-category nav inside an asset tab (Audio → Local, SFX, Extracted, Free library). */
export function CategoryList({ items, value, onValueChange, label }: { items: { value: string; label: string; count?: number }[]; value: string; onValueChange: (v: string) => void; label: string }) {
  return (
    <nav aria-label={label} className="flex w-28 shrink-0 flex-col gap-0.5 border-r border-border p-1.5">
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => onValueChange(it.value)}
            className={cn('flex h-7 items-center justify-between rounded-sm px-2 text-left text-sm', active ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}
          >
            <span className="truncate">{it.label}</span>
            {it.count !== undefined && <span className="text-xs text-muted">{it.count}</span>}
          </button>
        )
      })}
    </nav>
  )
}
