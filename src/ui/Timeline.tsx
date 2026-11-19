/**
 * Timeline — the mission's decision and event log, newest or oldest first as
 * the caller supplies it.
 *
 * WHY THE TICK IS PINNED IN A FIXED-WIDTH MONOSPACE COLUMN: this list is read
 * by scanning down the left edge for when something happened, then across to
 * what it was. With proportional figures the ticks form a ragged edge and the
 * scan fails. The column is tabular monospace and the same width for every
 * row, which is what turns a list of sentences into a log.
 *
 * WHY A ROW IS A <button> ONLY WHEN IT HAS AN onClick: making every row
 * focusable would put the whole log in the tab order, so a keyboard operator
 * would Tab through two hundred events to reach the controls below it. Rows
 * that genuinely select a decision are buttons; the rest are inert.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { toneFill, toneText, type ToneExtended } from './tones'
import { EmptyState } from './EmptyState'

export interface TimelineItem {
  id: string
  /** Simulation tick. Rendered in the fixed left column. */
  tick: number
  title: ReactNode
  /** Second line: the reason, the numbers, the caveat. */
  detail?: ReactNode
  tone?: ToneExtended
  icon?: LucideIcon
  onClick?(): void
  /** The currently inspected entry. */
  active?: boolean
}

export interface TimelineProps {
  items: TimelineItem[]
  /** Shown instead of the list when there is nothing yet. */
  emptyLabel?: string
  className?: string
}

export function Timeline({ items, emptyLabel, className }: TimelineProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title={emptyLabel ?? 'No events yet'}
        body="Decisions and discoveries appear here as the mission runs."
        className={className}
      />
    )
  }

  return (
    <ol className={cn('relative', className)}>
      {/* The rail sits behind the dots and stops short of the last row so the
          log does not look like it continues past its end. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-3 bottom-3 left-[3.125rem] w-px bg-line"
      />

      {items.map((item) => {
        const tone = item.tone ?? 'default'
        const Icon = item.icon
        const interactive = typeof item.onClick === 'function'

        const content = (
          <>
            <span className="num w-10 shrink-0 pt-px text-right text-2xs text-ink-faint">
              {item.tick}
            </span>

            {/* Dot, centred on the rail. */}
            <span className="relative flex w-5 shrink-0 justify-center pt-1">
              <span
                aria-hidden="true"
                className={cn(
                  'z-10 size-1.5 rounded-pill ring-2 ring-surface-1',
                  toneFill[tone],
                  item.active && 'ring-accent/40',
                )}
              />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {Icon && (
                  <Icon
                    size={12}
                    strokeWidth={2}
                    aria-hidden="true"
                    className={cn('shrink-0', toneText[tone])}
                  />
                )}
                <span
                  className={cn(
                    'truncate text-[0.8125rem] leading-5',
                    tone === 'default' ? 'text-ink' : toneText[tone],
                  )}
                >
                  {item.title}
                </span>
              </span>
              {item.detail && (
                <span className="mt-0.5 block text-2xs leading-4 text-ink-dim">
                  {item.detail}
                </span>
              )}
            </span>
          </>
        )

        const rowClass = cn(
          'flex w-full gap-2 rounded-control py-1.5 pr-2 pl-1 text-left',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-instrument)]',
          item.active && 'bg-accent/8 ring-1 ring-accent/25',
        )

        return (
          <li key={item.id}>
            {interactive ? (
              <button
                type="button"
                onClick={item.onClick}
                aria-current={item.active ? 'true' : undefined}
                className={cn(rowClass, 'focus-ring hover:bg-surface-2')}
              >
                {content}
              </button>
            ) : (
              <div className={rowClass}>{content}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
