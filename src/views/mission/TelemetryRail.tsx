/**
 * Live telemetry.
 *
 * EVERY FIGURE HERE IS AN ENGINE READING OR A RESTATEMENT OF TWO OF THEM.
 * Energy remaining is battery fraction times the spec's capacity; average
 * speed is the odometer over elapsed simulated seconds. Neither is a model
 * of its own. There is deliberately no instantaneous speed: `RoverState`
 * does not carry a velocity, and differencing the odometer across renders
 * would produce a number that depends on when React happened to run.
 *
 * It subscribes through `useTelemetry`, which selects only these scalars and
 * compares them shallowly, so a tick in which nothing visible moved does not
 * re-render the rail.
 */

import { Badge, Meter, Panel, Stat } from '@/ui'
import {
  fmtClock,
  fmtDistance,
  fmtEnergy,
  fmtNumber,
  fmtPercent,
  fmtSpeed,
  humanizeCode,
} from '@/lib/format'
import { useObservedFraction, useTelemetry } from '@/state/selectors'
import type { RoverMode, SimState } from '@/core/types'

export function TelemetryRail() {
  const t = useTelemetry()
  const observed = useObservedFraction()

  if (!t) return null

  const energyRemainingWh = t.battery * t.capacityWh
  const averageSpeedMs = t.elapsedS > 0 ? t.odometerM / t.elapsedS : null

  return (
    <div className="grid gap-4">
      <Panel title="Rover">
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <ModeBadge mode={t.mode} outcome={t.outcome} />
            <span className="font-mono text-sm tabular-nums text-neutral-300">
              {fmtClock(t.elapsedS)}
            </span>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-neutral-400">Battery</span>
              <span className="font-mono tabular-nums text-neutral-200">
                {fmtPercent(t.battery, 1)} &middot; {fmtEnergy(energyRemainingWh)}
              </span>
            </div>
            <Meter
              value={t.battery}
              tone={t.battery < 0.2 ? 'danger' : t.battery < 0.4 ? 'warn' : 'default'}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-neutral-400">Map observed</span>
              <span className="font-mono tabular-nums text-neutral-200">
                {fmtPercent(observed, 1)}
              </span>
            </div>
            <Meter value={observed ?? 0} />
          </div>
        </div>
      </Panel>

      <Panel title="Objective">
        <div className="grid gap-3">
          <Stat
            label="Current waypoint"
            value={
              t.waypointsTotal === 0
                ? '—'
                : `${Math.min(t.waypointIndex + 1, t.waypointsTotal)} of ${t.waypointsTotal}`
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Route predicts"
              value={fmtEnergy(t.routeEnergyWh)}
              hint={t.routeDistanceM !== null ? `over ${fmtDistance(t.routeDistanceM)}` : undefined}
            />
            <Stat label="Replans" value={fmtNumber(t.replanCount)} />
          </div>
        </div>
      </Panel>

      <Panel title="Traverse">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Distance" value={fmtDistance(t.odometerM)} />
          <Stat label="Energy used" value={fmtEnergy(t.energyUsedWh)} />
          <Stat
            label="Average speed"
            value={fmtSpeed(averageSpeedMs)}
            hint={`top ${fmtSpeed(t.maxSpeedMs)}`}
          />
          <Stat label="Ticks" value={fmtNumber(t.tick)} />
        </div>
      </Panel>
    </div>
  )
}

/**
 * The outcome wins over the mode when a mission has ended: 'complete' as a
 * rover mode and 'complete' as a mission outcome mean the same thing here,
 * and showing both reads as two different claims.
 */
function ModeBadge({ mode, outcome }: { mode: RoverMode; outcome: SimState['outcome'] }) {
  const label = outcome ?? mode
  const variant =
    outcome === 'failed' || mode === 'failed'
      ? 'danger'
      : outcome === 'aborted' || mode === 'aborted'
        ? 'warn'
        : outcome === 'complete' || mode === 'complete'
          ? 'success'
          : mode === 'awaiting-approval'
            ? 'warn'
            : 'default'
  return <Badge variant={variant}>{humanizeCode(label)}</Badge>
}
