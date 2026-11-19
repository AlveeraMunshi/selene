/**
 * The mission's metrics.
 *
 * EVERY FIGURE IS A FIELD OF `MissionMetrics`. There is no efficiency score,
 * no success percentage and no composite index, because the engine does not
 * compute one and inventing it here would make the number unfalsifiable.
 * The only arithmetic is the mean plan time, which is `planMsTotal` over
 * `planCount` and is labelled as such.
 */

import type { MissionMetrics } from '@/core/types'
import { Panel, Stat } from '@/ui'
import { fmtClock, fmtDistance, fmtEnergy, fmtNumber, fmtPercent } from '@/lib/format'

export function MetricsSummary({ metrics }: { metrics: MissionMetrics }) {
  const meanPlanMs = metrics.planCount > 0 ? metrics.planMsTotal / metrics.planCount : null

  return (
    <Panel title="Metrics" subtitle="As computed by the engine when the mission ended.">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <Stat
          label="Waypoints"
          compact
          value={`${metrics.waypointsReached} / ${metrics.waypointsTotal}`}
          tone={metrics.completed ? 'good' : 'warn'}
        />
        <Stat label="Distance" compact value={fmtDistance(metrics.distanceM)} />
        <Stat label="Energy used" compact value={fmtEnergy(metrics.energyWh)} />
        <Stat
          label="Battery left"
          compact
          value={fmtPercent(metrics.batteryRemaining, 1)}
          tone={metrics.batteryRemaining < 0.15 ? 'danger' : 'default'}
        />
        <Stat label="Elapsed" compact value={fmtClock(metrics.elapsedS)} hint={`${metrics.ticks} ticks`} />
        <Stat label="Replans" compact value={fmtNumber(metrics.replans)} />
        <Stat
          label="Hazards found"
          compact
          value={fmtNumber(metrics.hazardsDiscovered)}
          hint={`${metrics.hazardsOnRoute} on the driven route`}
        />
        <Stat
          label="Interventions"
          compact
          value={fmtNumber(metrics.interventions)}
          tone={metrics.interventions > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Peak hazard driven"
          compact
          value={fmtPercent(metrics.peakHazardTraversed)}
          tone={metrics.peakHazardTraversed > 0.6 ? 'warn' : 'default'}
        />
        <Stat
          label="Planning time"
          compact
          value={`${fmtNumber(metrics.planMsTotal, 1)} ms`}
          hint={
            meanPlanMs !== null
              ? `${metrics.planCount} plans, ${fmtNumber(meanPlanMs, 1)} ms mean`
              : 'no plans recorded'
          }
        />
      </div>
    </Panel>
  )
}
