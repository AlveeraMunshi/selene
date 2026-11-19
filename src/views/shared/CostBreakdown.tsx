/**
 * The four cost terms of a route, with each term's share of the total.
 *
 * WHY A SHARED COMPONENT: the same breakdown appears in the pre-launch
 * preview and against every candidate in the decision inspector, and the
 * whole point of carrying `CostBreakdown` on a route is that those two places
 * can be compared term by term. Two renderings would defeat it.
 *
 * The only arithmetic here is `term / total`, a restatement of numbers the
 * cost model produced rather than a new metric.
 */

import type { CostBreakdown as CostBreakdownValue } from '@/core/types'
import { cn, Meter } from '@/ui'
import { fmtCost, fmtPercent } from '@/lib/format'

const TERMS: { key: keyof Omit<CostBreakdownValue, 'total'>; label: string }[] = [
  { key: 'distance', label: 'Distance' },
  { key: 'slope', label: 'Slope' },
  { key: 'hazard', label: 'Hazard' },
  { key: 'energy', label: 'Energy' },
]

export interface CostBreakdownProps {
  cost: CostBreakdownValue
  className?: string
  /** Drops the share bars for a dense candidate list. */
  compact?: boolean
}

export function CostBreakdown({ cost, className, compact }: CostBreakdownProps) {
  const total = cost.total
  // A zero or negative total makes every share meaningless; show the absolute
  // terms and no bars rather than dividing by it.
  const shareable = Number.isFinite(total) && total > 0

  return (
    <div className={cn('grid gap-2', className)}>
      {TERMS.map(({ key, label }) => {
        const value = cost[key]
        const share = shareable ? value / total : 0
        return (
          <div key={key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-2xs">
              <span className="text-ink-dim">{label}</span>
              <span className="num text-ink-muted">
                {fmtCost(value)}
                {shareable ? <span className="ml-2 text-ink-faint">{fmtPercent(share)}</span> : null}
              </span>
            </div>
            {!compact && shareable ? <Meter value={share} showPct={false} /> : null}
          </div>
        )
      })}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-2xs">
        <span className="font-medium text-ink-muted">Total cost</span>
        <span className="num font-medium text-ink">{fmtCost(total)}</span>
      </div>
    </div>
  )
}
