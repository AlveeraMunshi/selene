/**
 * The decision stream: every autonomy decision, newest first.
 *
 * Reverse-chronological because during a live mission the thing you want is
 * what just happened; the history is what the inspector and the analysis view
 * are for.
 *
 * It subscribes to `state.decisions` by reference. `step()` is pure and keeps
 * that array's identity when it has not added to it, so this list re-renders
 * when a decision is taken rather than twice a second.
 */

import { useMemo } from 'react'

import { reasonCodeLabel } from '@/core/explain'
import type { DecisionKind, DecisionRecord } from '@/core/types'
import { Badge, Panel, Timeline, type TimelineItem, type ToneExtended } from '@/ui'
import { fmtCell, fmtPercent, humanizeCode } from '@/lib/format'

export interface DecisionStreamProps {
  decisions: DecisionRecord[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  className?: string
}

export function DecisionStream({
  decisions,
  selectedId,
  onSelect,
  className,
}: DecisionStreamProps) {
  const items = useMemo<TimelineItem[]>(
    () =>
      decisions
        .slice()
        .reverse()
        .map((d) => ({
          id: d.id,
          tick: d.tick,
          tone: kindTone(d.kind),
          active: d.id === selectedId,
          title: (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={kindTone(d.kind)}>{humanizeCode(d.kind)}</Badge>
              <span className="text-[0.8125rem] text-ink">{reasonCodeLabel(d.reasonCode)}</span>
            </span>
          ),
          detail: <DecisionDetail decision={d} />,
          // Clicking the selected row clears it, so the inspector can be
          // dismissed without hunting for a close control.
          onClick: () => onSelect(d.id === selectedId ? null : d.id),
        })),
    [decisions, selectedId, onSelect],
  )

  return (
    <Panel
      title="Decision stream"
      subtitle="Newest first. Select one to see the candidates it weighed."
      scroll
      className={className}
    >
      <Timeline items={items} emptyLabel="No decisions yet" />
    </Panel>
  )
}

/**
 * One line of context under the title: what it chose, how much it could see,
 * and how much battery it had. Those are the three numbers that make a
 * decision reconstructable later, so they are in the list and not only in
 * the detail panel.
 */
function DecisionDetail({ decision }: { decision: DecisionRecord }) {
  const chosen = decision.candidates.find((c) => c.id === decision.selectedId)
  const n = decision.candidates.length
  return (
    <span>
      {fmtCell(decision.position)} &middot; {n} candidate{n === 1 ? '' : 's'} &middot;{' '}
      {chosen ? `took ${chosen.label}` : 'none selected'} &middot;{' '}
      {fmtPercent(decision.observedFraction)} observed &middot;{' '}
      {fmtPercent(decision.batteryFrac)} battery
    </span>
  )
}

function kindTone(kind: DecisionKind): ToneExtended {
  switch (kind) {
    case 'abort':
      return 'danger'
    case 'intervention-required':
      return 'warn'
    case 'replan':
    case 'intervention-resolved':
      return 'warn'
    case 'mission-complete':
    case 'waypoint-reached':
      return 'good'
    case 'initial-plan':
      return 'info'
    default:
      return 'default'
  }
}
