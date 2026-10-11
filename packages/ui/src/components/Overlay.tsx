import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Tooltip as RTooltip, Dialog as RDialog, Popover as RPopover, ContextMenu as RContextMenu, DropdownMenu as RDropdown, Toast as RToast } from 'radix-ui'
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react'
import { cn } from '../cn'
import { Kbd } from './Misc'

const popSurface = 'z-[var(--reel-z-popover)] rounded-md bg-surface-2 shadow-pop animate-[reel-pop-in_var(--reel-dur-fast)_var(--reel-ease)]'

/* ─────────── Tooltip ─────────── */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={500} skipDelayDuration={200}>{children}</RTooltip.Provider>
}

export function Tooltip({ content, shortcut, side = 'top', children }: { content: ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactNode }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[var(--reel-z-tooltip)] flex items-center gap-2 rounded-sm bg-surface-3 px-2 py-1 text-sm text-fg shadow-pop"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

/* ─────────── Dialog / Modal ─────────── */
export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** While busy, closing with Esc/overlay is blocked (export running, applying edits). */
  busy?: boolean
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 520, busy }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => (!busy || o) && onOpenChange(o)}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[var(--reel-z-modal)] bg-scrim/60" />
        <RDialog.Content
          style={{ width }}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed left-1/2 top-1/2 z-[var(--reel-z-modal)] max-h-[85vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-lg bg-surface shadow-modal animate-[reel-pop-in_var(--reel-dur-base)_var(--reel-ease)]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RDialog.Title className="text-lg">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button type="button" aria-label="Close" disabled={busy} className="rounded-sm p-1 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40">
                <X className="size-4" />
              </button>
            </RDialog.Close>
          </div>
          <div className="scroll-y px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/* ─────────── Popover ─────────── */
export function Popover({ trigger, children, side = 'bottom', align = 'start' }: { trigger: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content side={side} align={align} sideOffset={6} className={cn(popSurface, 'p-3')}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

/* ─────────── Menus (context + dropdown share item styles) ─────────── */
export interface MenuItem {
  label: string
  shortcut?: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
  separatorBefore?: boolean
}

const itemCls =
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-fg data-[disabled]:text-disabled [&_svg]:size-3.5 [&_svg]:text-muted'

function renderItems(Item: typeof RContextMenu.Item, Sep: typeof RContextMenu.Separator, items: MenuItem[]) {
  return items.map((it, i) => (
    <div key={i} role="none">
      {it.separatorBefore && <Sep className="my-1 h-px bg-border" />}
      <Item className={cn(itemCls, it.danger && 'text-danger')} disabled={it.disabled} onSelect={it.onSelect}>
        {it.icon}
        <span className="flex-1">{it.label}</span>
        {it.shortcut && <span className="text-xs text-muted">{it.shortcut}</span>}
      </Item>
    </div>
  ))
}

export function ContextMenu({ items, children }: { items: MenuItem[]; children: ReactNode }) {
  return (
    <RContextMenu.Root>
      <RContextMenu.Trigger asChild>{children}</RContextMenu.Trigger>
      <RContextMenu.Portal>
        <RContextMenu.Content className={cn(popSurface, 'min-w-48 p-1')}>
          {renderItems(RContextMenu.Item, RContextMenu.Separator, items)}
        </RContextMenu.Content>
      </RContextMenu.Portal>
    </RContextMenu.Root>
  )
}

export function DropdownMenu({ items, trigger }: { items: MenuItem[]; trigger: ReactNode }) {
  return (
    <RDropdown.Root>
      <RDropdown.Trigger asChild>{trigger}</RDropdown.Trigger>
      <RDropdown.Portal>
        <RDropdown.Content sideOffset={4} align="start" className={cn(popSurface, 'min-w-48 p-1')}>
          {renderItems(RDropdown.Item as unknown as typeof RContextMenu.Item, RDropdown.Separator, items)}
        </RDropdown.Content>
      </RDropdown.Portal>
    </RDropdown.Root>
  )
}

/* ─────────── Toast ─────────── */
type ToastTone = 'info' | 'success' | 'warning' | 'error'
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string; action?: { label: string; onClick: () => void } }

const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const toneIcon: Record<ToastTone, ReactNode> = {
  info: <Info className="size-4 text-accent" aria-hidden />,
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  error: <XCircle className="size-4 text-danger" aria-hidden />,
}

/** Errors stay until dismissed; others auto-dismiss after 4 s (paused on hover/focus by Radix). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: Omit<ToastItem, 'id'>) => setItems((xs) => [...xs, { ...t, id: Date.now() + Math.random() }]), [])
  return (
    <ToastCtx.Provider value={push}>
      <RToast.Provider swipeDirection="right">
        {children}
        {items.map((t) => (
          <RToast.Root
            key={t.id}
            type={t.tone === 'error' ? 'foreground' : 'background'}
            duration={t.tone === 'error' ? Infinity : 4000}
            onOpenChange={(o) => !o && setItems((xs) => xs.filter((x) => x.id !== t.id))}
            className="flex w-80 items-start gap-2.5 rounded-md bg-surface-2 p-3 shadow-pop data-[state=open]:animate-[reel-pop-in_var(--reel-dur-base)_var(--reel-ease)]"
          >
            {toneIcon[t.tone]}
            <div className="min-w-0 flex-1">
              <RToast.Title className="text-sm font-medium">{t.title}</RToast.Title>
              {t.description && <RToast.Description className="mt-0.5 text-sm text-muted">{t.description}</RToast.Description>}
            </div>
            {t.action && (
              <RToast.Action altText={t.action.label} asChild>
                <button type="button" onClick={t.action.onClick} className="rounded-sm px-1.5 text-sm font-medium text-accent hover:bg-surface-3">
                  {t.action.label}
                </button>
              </RToast.Action>
            )}
            <RToast.Close aria-label="Dismiss" className="rounded-sm text-muted hover:text-fg">
              <X className="size-3.5" />
            </RToast.Close>
          </RToast.Root>
        ))}
        <RToast.Viewport className="fixed bottom-4 right-4 z-[var(--reel-z-toast)] flex flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}
