/**
 * The four cost terms of a route, with their share of the total.
 *
 * WHY A SHARED COMPONENT: the same breakdown appears in the pre-launch
 * preview and against every candidate in the decision inspector, and the
 * whole point of carrying `CostBreakdown` on a route is that the user can
 * compare those two places term by term. Two renderings would defeat it.
 *
 * The only arithmetic here is `term / total`, which is a restatement of
 * numbers the cost model produced rather than a new metric.
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
  /** Compact drops the share bars; used inside a dense candidate list. */
  compact?: boolean
}

export function CostBreakdown({ cost, className, compact }: CostBreakdownProps) {
  const total = cost.total
  // A zero or negative total would make every share meaningless; show the
  // absolute terms and no bars rather than dividing by it.
  const shareable = Number.isFinite(total) && total > 0

  return (
    <div className={cn('grid gap-2', className)}>
      {TERMS.map(({ key, label }) => {
        const value = cost[key]
        const share = shareable ? value / total : 0
        return (
          <div key={key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-neutral-400">{label}</span>
              <span className="font-mono tabular-nums text-neutral-300">
                {fmtCost(value)}
                {shareable ? (
                  <span className="ml-2 text-neutral-500">{fmtPercent(share)}</span>
                ) : null}
              </span>
            </div>
            {!compact && shareable ? <Meter value={share} /> : null}
          </div>
        )
      })}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-neutral-800 pt-2 text-xs">
        <span className="font-medium text-neutral-300">Total cost</span>
        <span className="font-mono tabular-nums font-medium text-neutral-100">
          {fmtCost(total)}
        </span>
      </div>
    </div>
  )
}
