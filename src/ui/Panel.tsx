/**
 * Panel — the container every other thing lives in.
 *
 * WHY IT OWNS ITS OWN SCROLL: a mission-control layout is a fixed grid of
 * regions that must all stay visible at once; the page itself never scrolls,
 * individual panels do. Pushing `overflow` down here (rather than letting
 * callers wrap children in a scrolling div) is what guarantees a panel's
 * header stays pinned while its body moves, and what stops one long event log
 * from growing the whole viewport.
 *
 * The header is only rendered when there is something to put in it, so a
 * Panel used purely as a surface costs no vertical space.
 */
import { useId, type ReactNode } from 'react'
import { cn } from './cn'

export interface PanelProps {
  title?: ReactNode
  subtitle?: ReactNode
  /** Controls for this panel. Rendered right-aligned in the header. */
  actions?: ReactNode
  /** Give the body its own scroll container instead of growing. */
  scroll?: boolean
  className?: string
  bodyClassName?: string
  /** Remove body padding — for a canvas, a table, or a full-bleed list. */
  flush?: boolean
  children?: ReactNode
}

export function Panel({
  title,
  subtitle,
  actions,
  scroll = false,
  className,
  bodyClassName,
  flush = false,
  children,
}: PanelProps) {
  const headingId = useId()
  const hasHeader = Boolean(title || subtitle || actions)

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'relative flex min-h-0 flex-col',
        'rounded-panel border border-line bg-surface-1 shadow-panel',
        className,
      )}
    >
      {hasHeader && (
        <header
          className={cn(
            'flex shrink-0 items-start justify-between gap-3',
            'border-b border-line px-3.5 py-2.5',
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="eyebrow truncate text-ink-muted">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate text-2xs text-ink-dim">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
          )}
        </header>
      )}

      <div
        className={cn(
          'min-h-0 flex-1',
          flush ? 'p-0' : 'p-3.5',
          scroll && 'overflow-y-auto overscroll-contain',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
