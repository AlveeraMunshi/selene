/**
 * Saved missions.
 *
 * Each row carries the outcome and the two figures that distinguish one run
 * from another at a glance -- how far it got and how many waypoints it
 * reached. Both come from the record's stored `MissionMetrics`.
 */

import { getScenario } from '@/core/scenarios'
import type { MissionRecord } from '@/core/types'
import { Badge, Button, cn, EmptyState, Panel, type ToneExtended } from '@/ui'
import { fmtDistance, fmtTimestamp, humanizeCode } from '@/lib/format'

export interface MissionListProps {
  missions: MissionRecord[]
  selectedId: string | null
  onSelect: (missionId: string) => void
  onExport: (missionId: string) => void
  /** Shown once when localStorage is unavailable, not once per row. */
  persistenceAvailable: boolean
}

export function MissionList({
  missions,
  selectedId,
  onSelect,
  onExport,
  persistenceAvailable,
}: MissionListProps) {
  return (
    <Panel
      title="Saved missions"
      subtitle={
        persistenceAvailable
          ? undefined
          : 'Storage is unavailable in this browser, so these are kept only until the page reloads.'
      }
      scroll
      className="min-h-0"
    >
      {missions.length === 0 ? (
        <EmptyState
          compact
          title="No missions yet"
          body="A mission is saved automatically the moment it completes, fails or is aborted."
        />
      ) : (
        <ul className="grid gap-2">
          {missions.map((m) => (
            <li key={m.missionId}>
              <MissionRow
                record={m}
                selected={m.missionId === selectedId}
                onSelect={onSelect}
                onExport={onExport}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function MissionRow({
  record,
  selected,
  onSelect,
  onExport,
}: {
  record: MissionRecord
  selected: boolean
  onSelect: (id: string) => void
  onExport: (id: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-control border transition-colors duration-[var(--duration-fast)]',
        selected ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface-2',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(record.missionId)}
        aria-current={selected ? 'true' : undefined}
        className="focus-ring block w-full rounded-control p-3 text-left"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[0.8125rem] font-medium text-ink">
            {scenarioName(record)}
          </span>
          <Badge tone={outcomeTone(record.outcome)}>{humanizeCode(record.outcome)}</Badge>
        </span>
        <span className="num mt-1 block text-2xs text-ink-dim">
          {fmtTimestamp(record.createdAt)}
        </span>
        <span className="num mt-1 block text-2xs text-ink-muted">
          {record.metrics.waypointsReached}/{record.metrics.waypointsTotal} waypoints &middot;{' '}
          {fmtDistance(record.metrics.distanceM)} &middot; {record.metrics.replans} replans
        </span>
      </button>
      <div className="flex justify-end border-t border-line px-2 py-1.5">
        <Button variant="ghost" size="sm" onClick={() => onExport(record.missionId)}>
          Export JSON
        </Button>
      </div>
    </div>
  )
}

/**
 * The record stores a scenario id, not a name. Resolving it can throw if a
 * saved mission references a scenario that no longer exists, which is a
 * reason to show the id rather than to lose the row.
 */
function scenarioName(record: MissionRecord): string {
  try {
    return getScenario(record.config.scenarioId).name
  } catch {
    return record.config.scenarioId
  }
}

function outcomeTone(outcome: MissionRecord['outcome']): ToneExtended {
  switch (outcome) {
    case 'complete':
      return 'good'
    case 'failed':
      return 'danger'
    case 'aborted':
      return 'warn'
    default:
      return 'default'
  }
}
