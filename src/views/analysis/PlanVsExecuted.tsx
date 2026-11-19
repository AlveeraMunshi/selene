/**
 * What the opening plan predicted against what the mission actually did.
 *
 * WHY THIS IS THE INTERESTING TABLE: the planner plans on belief and the
 * rover drives on ground truth (D4), so the gap between these two columns is
 * the cost of what the rover could not see from orbit. A mission with a zero
 * gap learned nothing on the way.
 *
 * The planned column comes from the route the FIRST decision selected, which
 * is the only prediction made before any hazard was discovered. The executed
 * column is the stored `MissionMetrics`. The delta is one subtraction; there
 * is no modelled expectation anywhere.
 */

import type { DecisionRecord, MissionMetrics, Route } from '@/core/types'
import { EmptyState, KeyValue, Panel, type Tone } from '@/ui'
import { fmtDistance, fmtEnergy, fmtPercent } from '@/lib/format'

export interface PlanVsExecutedProps {
  decisions: DecisionRecord[]
  metrics: MissionMetrics
}

/**
 * The route the mission set out to drive.
 *
 * Only the initial plan counts: a replan's route was chosen with knowledge
 * the first one did not have, so comparing against it would hide exactly the
 * thing this table exists to show.
 */
function initialRoute(decisions: DecisionRecord[]): Route | null {
  const first = decisions.find((d) => d.kind === 'initial-plan')
  if (!first || !first.selectedId) return null
  return first.candidates.find((c) => c.id === first.selectedId)?.route ?? null
}

export function PlanVsExecuted({ decisions, metrics }: PlanVsExecutedProps) {
  const planned = initialRoute(decisions)

  if (!planned) {
    return (
      <Panel title="Planned against executed">
        <EmptyState
          compact
          title="No opening plan recorded"
          body="This mission has no initial-plan decision with a selected route, so there is nothing to compare against."
        />
      </Panel>
    )
  }

  const distanceDelta = metrics.distanceM - planned.distanceM
  const energyDelta = metrics.energyWh - planned.energyWh
  const hazardDelta = metrics.peakHazardTraversed - planned.peakHazard

  return (
    <Panel
      title="Planned against executed"
      subtitle="The opening plan was made before anything had been sensed. The gap is what the rover found."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Column title="Planned">
          <KeyValue
            rows={[
              { k: 'Distance', v: fmtDistance(planned.distanceM) },
              { k: 'Energy', v: fmtEnergy(planned.energyWh) },
              { k: 'Peak hazard', v: fmtPercent(planned.peakHazard) },
            ]}
          />
        </Column>
        <Column title="Executed">
          <KeyValue
            rows={[
              { k: 'Distance', v: fmtDistance(metrics.distanceM) },
              { k: 'Energy', v: fmtEnergy(metrics.energyWh) },
              { k: 'Peak hazard', v: fmtPercent(metrics.peakHazardTraversed) },
            ]}
          />
        </Column>
        <Column title="Difference">
          <KeyValue
            rows={[
              {
                k: 'Distance',
                v: signed(fmtDistance(Math.abs(distanceDelta)), distanceDelta),
                tone: overrunTone(distanceDelta),
              },
              {
                k: 'Energy',
                v: signed(fmtEnergy(Math.abs(energyDelta)), energyDelta),
                tone: overrunTone(energyDelta),
              },
              {
                k: 'Peak hazard',
                v: signed(fmtPercent(Math.abs(hazardDelta)), hazardDelta),
                tone: overrunTone(hazardDelta),
              },
            ]}
          />
        </Column>
      </div>

      {!metrics.completed ? (
        <p className="mt-4 text-2xs leading-4 text-ink-dim">
          This mission did not reach every waypoint, so the executed column is a partial traverse
          and the difference is not a like-for-like overrun.
        </p>
      ) : null}
    </Panel>
  )
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      {children}
    </div>
  )
}

function signed(text: string, delta: number): string {
  if (Math.abs(delta) < 1e-9) return text
  return `${delta > 0 ? '+' : '−'}${text}`
}

/**
 * Amber only for an overrun, never for coming in under. Under-running the
 * plan is not a risk, and amber is reserved for things that are.
 */
function overrunTone(delta: number): Tone {
  return delta > 0 ? 'warn' : 'default'
}
