/**
 * The rover's physical parameters.
 *
 * Read-only on purpose: the spec is fixed per mission and is what makes the
 * energy numbers in the preview mean something. Showing it beside the preview
 * is what lets a reader check that 0.42 Wh/m times 600 m is the figure above.
 */

import type { RoverSpec } from '@/core/types'
import { KeyValue, Panel } from '@/ui'
import { fmtNumber } from '@/lib/format'

export function RoverSpecPanel({ rover }: { rover: RoverSpec }) {
  const items = [
    { key: 'Top speed', value: `${fmtNumber(rover.maxSpeedMs, 2)} m/s` },
    { key: 'Battery', value: `${fmtNumber(rover.capacityWh, 0)} Wh` },
    { key: 'Flat draw', value: `${fmtNumber(rover.flatWhPerM, 3)} Wh/m` },
    { key: 'Climb penalty', value: `${fmtNumber(rover.climbWhPerMPerDeg, 4)} Wh/m/°` },
    { key: 'Sensor range', value: `${fmtNumber(rover.sensorRangeCells, 0)} cells` },
    { key: 'Idle draw', value: `${fmtNumber(rover.idleW, 2)} W` },
  ]
  return (
    <Panel title="Rover" subtitle="Fixed for the mission; the energy model reads these.">
      <KeyValue items={items} />
    </Panel>
  )
}
