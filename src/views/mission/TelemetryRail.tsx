/**
 * Live telemetry.
 *
 * EVERY FIGURE HERE IS AN ENGINE READING OR A RESTATEMENT OF TWO OF THEM.
 * Energy remaining is battery fraction times the spec's capacity; average
 * speed is the odometer over elapsed simulated seconds. Neither is a model of
 * its own. There is deliberately no instantaneous speed: `RoverState` carries
 * no velocity, and differencing the odometer across renders would produce a
 * number that depends on when React happened to run.
 *
 * It subscribes through `useTelemetry`, which selects only these scalars and
 * compares them shallowly, so a tick in which nothing visible moved does not
 * re-render the rail.
 */

import type { RoverMode, SimState } from '@/core/types'
import { Badge, Meter, Panel, Stat } from '@/ui'
import type { Tone, ToneExtended } from '@/ui'
import {
  fmtClock,
  fmtDistance,
  fmtEnergy,
  fmtNumber,
  fmtSpeed,
  humanizeCode,
} from '@/lib/format'
import { useObservedFraction, useTelemetry } from '@/state/selectors'

export function TelemetryRail() {
  const t = useTelemetry()
  const observed = useObservedFraction()

  if (!t) return null

  const energyRemainingWh = t.battery * t.capacityWh
  const averageSpeedMs = t.elapsedS > 0 ? t.odometerM / t.elapsedS : null

  return (
    <div className="grid gap-3">
      <Panel title="Rover">
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <ModeBadge mode={t.mode} outcome={t.outcome} />
            <span className="num text-[0.8125rem] text-ink-muted">{fmtClock(t.elapsedS)}</span>
          </div>

          <Meter
            label="Battery"
            value={t.battery}
            tone={batteryTone(t.battery)}
            caption={`${fmtEnergy(energyRemainingWh)} of ${fmtEnergy(t.capacityWh)}`}
          />

          <Meter
            label="Map observed"
            value={observed ?? 0}
            caption="Cells that have been inside sensor range"
          />
        </div>
      </Panel>

      <Panel title="Objective">
        <div className="grid gap-3">
          <Stat
            label="Current waypoint"
            compact
            value={
              t.waypointsTotal === 0
                ? '—'
                : `${Math.min(t.waypointIndex + 1, t.waypointsTotal)} of ${t.waypointsTotal}`
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Route predicts"
              compact
              value={fmtEnergy(t.routeEnergyWh)}
              hint={
                t.routeDistanceM !== null ? `over ${fmtDistance(t.routeDistanceM)}` : 'no route'
              }
            />
            <Stat label="Replans" compact value={fmtNumber(t.replanCount)} />
          </div>
        </div>
      </Panel>

      <Panel title="Traverse">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Distance" compact value={fmtDistance(t.odometerM)} />
          <Stat label="Energy used" compact value={fmtEnergy(t.energyUsedWh)} />
          <Stat
            label="Average speed"
            compact
            value={fmtSpeed(averageSpeedMs)}
            hint={`top ${fmtSpeed(t.maxSpeedMs)}`}
          />
          <Stat label="Ticks" compact value={fmtNumber(t.tick)} />
        </div>
      </Panel>
    </div>
  )
}

/** Amber is caution and red is a breach, here as everywhere else. */
function batteryTone(frac: number): Tone {
  if (frac < 0.15) return 'danger'
  if (frac < 0.35) return 'warn'
  return 'default'
}

/**
 * The outcome wins over the mode once a mission has ended: 'complete' as a
 * rover mode and 'complete' as a mission outcome mean the same thing, and
 * showing both reads as two separate claims.
 */
function ModeBadge({ mode, outcome }: { mode: RoverMode; outcome: SimState['outcome'] }) {
  const label = outcome ?? mode
  return <Badge tone={modeTone(label)}>{humanizeCode(label)}</Badge>
}

function modeTone(label: RoverMode | NonNullable<SimState['outcome']>): ToneExtended {
  switch (label) {
    case 'failed':
      return 'danger'
    case 'aborted':
    case 'awaiting-approval':
    case 'replanning':
      return 'warn'
    case 'complete':
      return 'good'
    case 'driving':
      return 'info'
    default:
      return 'default'
  }
}
