/**
 * Tabs — switch which inspector is showing in a fixed region.
 *
 * WHY THE ARROW-KEY HANDLING IS HAND-WRITTEN AND NOT LEFT TO TAB ORDER: the
 * WAI-ARIA tabs pattern puts exactly one tab in the tab order and moves
 * between tabs with Left/Right. Leaving all six tabs tabbable instead means a
 * keyboard operator presses Tab six times to get past the tab strip to the
 * content, every single time. The roving tabindex below is the whole reason
 * this is a component rather than a row of buttons.
 *
 * `aria-controls` is deliberately NOT set: this component does not own the
 * panel it switches, so it cannot know a real id, and pointing at an absent
 * element is worse for a screen reader than omitting the optional attribute.
 * Callers that render a panel should give it `role="tabpanel"` and
 * `aria-labelledby={`selene-tab-${active}`}`.
 */
import { useRef, type ReactNode, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface TabItem {
  id: string
  label: string
  icon?: LucideIcon
  /** A count or a state dot, rendered after the label. */
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange(id: string): void
  className?: string
  /** Accessible name for the strip when several sets of tabs are on screen. */
  'aria-label'?: string
}

export function Tabs({ tabs, active, onChange, className, 'aria-label': ariaLabel }: TabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)

  function move(dir: 1 | -1 | 'first' | 'last') {
    const enabled = tabs.filter((t) => !t.disabled)
    if (enabled.length === 0) return

    const here = enabled.findIndex((t) => t.id === active)
    const index =
      dir === 'first'
        ? 0
        : dir === 'last'
          ? enabled.length - 1
          : // Wrap, which is what the ARIA pattern specifies for a tab strip.
            (here + dir + enabled.length) % enabled.length

    const next = enabled[index]
    if (!next || next.id === active) return
    const nextId = next.id
    onChange(nextId)
    // Focus has to follow selection or the keyboard user loses their place.
    requestAnimationFrame(() => {
      stripRef.current
        ?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(nextId)}"]`)
        ?.focus()
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        move(1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        move('first')
        break
      case 'End':
        e.preventDefault()
        move('last')
        break
      default:
        break
    }
  }

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={ariaLabel ?? 'Views'}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center gap-0.5 rounded-control border border-line bg-surface-0 p-0.5',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            id={`selene-tab-${tab.id}`}
            data-tab-id={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            // Roving tabindex: only the selected tab is in the tab order.
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            className={cn(
              'focus-ring inline-flex min-w-0 flex-1 items-center justify-center gap-1.5',
              'rounded-[4px] px-2.5 py-1 text-2xs font-medium whitespace-nowrap',
              'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-instrument)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'bg-surface-2 text-ink shadow-panel'
                : 'text-ink-dim hover:bg-surface-1 hover:text-ink-muted',
            )}
          >
            {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{tab.label}</span>
            {tab.badge != null && <span className="num shrink-0 text-ink-dim">{tab.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
