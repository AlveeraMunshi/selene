/**
 * EmptyState — a region with nothing in it yet, saying why.
 *
 * WHY IT EXISTS AS A COMPONENT: before a mission is started, most of this
 * interface is empty — no route, no decisions, no events, no metrics. Empty
 * regions that just sit blank read as broken, and the obvious fix (a greyed
 * placeholder chart) is worse, because an operator must never be shown
 * fabricated telemetry. A sentence saying what will appear here and what to
 * do to make it appear is honest and takes the same space.
 *
 * It is deliberately quiet: dim text, no accent, no illustration. An empty
 * panel is not an event.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  /** One or two sentences: what goes here, and what produces it. */
  body?: ReactNode
  /** A single control that resolves the emptiness, if one exists. */
  action?: ReactNode
  className?: string
  /** Tighter variant for a short panel. */
  compact?: boolean
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      {Icon && (
        <Icon
          size={compact ? 16 : 20}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-ink-faint"
        />
      )}
      <p className="text-[0.8125rem] leading-5 font-medium text-ink-muted">{title}</p>
      {body && <p className="max-w-[44ch] text-2xs leading-4 text-ink-dim">{body}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
