/**
 * The rover's physical parameters.
 *
 * Read-only on purpose: the spec is fixed per mission and is what makes the
 * energy numbers in the preview mean something. Showing it beside the preview
 * is what lets a reader check that 0.42 Wh/m over 600 m is the figure above.
 */

import type { RoverSpec } from '@/core/types'
import { KeyValue, Panel } from '@/ui'
import { fmtNumber } from '@/lib/format'

export function RoverSpecPanel({ rover }: { rover: RoverSpec }) {
  const rows = [
    { k: 'Top speed', v: `${fmtNumber(rover.maxSpeedMs, 2)} m/s` },
    { k: 'Battery', v: `${fmtNumber(rover.capacityWh, 0)} Wh` },
    { k: 'Flat draw', v: `${fmtNumber(rover.flatWhPerM, 3)} Wh/m` },
    { k: 'Climb penalty', v: `${fmtNumber(rover.climbWhPerMPerDeg, 4)} Wh/m/°` },
    { k: 'Sensor range', v: `${fmtNumber(rover.sensorRangeCells, 0)} cells` },
    // Stored as Wh/s; watts is what a reader expects, so convert at the edge.
    { k: 'Idle draw', v: `${fmtNumber(rover.idleWhPerS * 3600, 0)} W` },
  ]
  return (
    <Panel title="Rover" subtitle="Fixed for the mission; the energy model reads these.">
      <KeyValue rows={rows} divided />
    </Panel>
  )
}
