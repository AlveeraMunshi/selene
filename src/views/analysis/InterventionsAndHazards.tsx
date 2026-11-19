/**
 * Two things the event log buries: what the operator was asked, and what the
 * rover found that it could not see from orbit.
 *
 * Both are reconstructed by joining events rather than stored separately --
 * an intervention is an `intervention-required` event and an
 * `intervention-resolved` event sharing a `requestId`, and a hazard is a
 * `hazard-discovered` event that knows whether it was on the driven route.
 * Pulling them out of the log is presentation; none of it is recomputed.
 */

import { useMemo } from 'react'

import type { SimEvent } from '@/core/types'
import { Badge, EmptyState, Panel, cn } from '@/ui'
import { fmtCell, fmtPercent, humanizeCode } from '@/lib/format'

interface InterventionPair {
  requestId: string
  reason: string
  requestedTick: number
  resolvedTick: number | null
  optionId: string | null
}

interface HazardFind {
  tick: number
  cell: { x: number; y: number }
  severity: number
  onRoute: boolean
}

function collect(events: SimEvent[]): {
  interventions: InterventionPair[]
  hazards: HazardFind[]
} {
  const byId = new Map<string, InterventionPair>()
  const hazards: HazardFind[] = []

  for (const e of events) {
    if (e.type === 'intervention-required') {
      byId.set(e.requestId, {
        requestId: e.requestId,
        reason: e.reason,
        requestedTick: e.tick,
        resolvedTick: null,
        optionId: null,
      })
    } else if (e.type === 'intervention-resolved') {
      const existing = byId.get(e.requestId)
      if (existing) {
        existing.resolvedTick = e.tick
        existing.optionId = e.optionId
      }
    } else if (e.type === 'hazard-discovered') {
      hazards.push({ tick: e.tick, cell: e.cell, severity: e.severity, onRoute: e.onRoute })
    }
  }

  return { interventions: [...byId.values()], hazards }
}

export function InterventionsAndHazards({ events }: { events: SimEvent[] }) {
  const { interventions, hazards } = useMemo(() => collect(events), [events])
  const onRoute = hazards.filter((h) => h.onRoute)

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="Interventions"
        subtitle={`${interventions.length} request${interventions.length === 1 ? '' : 's'}`}
      >
        {interventions.length === 0 ? (
          <EmptyState
            compact
            title="None"
            body="The rover never met a situation outside its tolerances, or the mission was run autonomously."
          />
        ) : (
          <ul className="grid gap-2">
            {interventions.map((i) => (
              <li
                key={i.requestId}
                className="rounded-control border border-line bg-surface-2 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warn">{humanizeCode(i.reason)}</Badge>
                  <span className="num text-2xs text-ink-dim">tick {i.requestedTick}</span>
                </div>
                <p className="mt-1 text-2xs text-ink-muted">
                  {i.optionId ? (
                    <>
                      Operator chose <span className="num text-ink">{i.optionId}</span>
                      {i.resolvedTick !== null ? (
                        <span className="text-ink-dim"> at tick {i.resolvedTick}</span>
                      ) : null}
                    </>
                  ) : (
                    // A request with no resolution means the mission ended
                    // while it was outstanding. Saying so is better than
                    // leaving the row looking incomplete.
                    'Never answered; the mission ended while this was outstanding.'
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Hazards discovered"
        subtitle={`${hazards.length} found, ${onRoute.length} on the route being driven`}
        scroll
      >
        {hazards.length === 0 ? (
          <EmptyState
            compact
            title="None"
            body="Nothing was hidden from orbit along the path the rover actually sensed."
          />
        ) : (
          <ul className="grid gap-1">
            {hazards.map((h, i) => (
              <li
                key={`${h.tick}-${h.cell.x}-${h.cell.y}-${i}`}
                className={cn(
                  'num flex items-center justify-between gap-2 rounded-control px-2 py-1 text-2xs',
                  h.onRoute ? 'bg-warn/10 text-warn-strong' : 'text-ink-dim',
                )}
              >
                <span>
                  tick {h.tick} &middot; {fmtCell(h.cell)}
                </span>
                <span>
                  {fmtPercent(h.severity)}
                  {h.onRoute ? ' · on route' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
