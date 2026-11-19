/**
 * Battery and cumulative energy over the mission.
 *
 * WHERE THE DATA COMES FROM: a `MissionRecord` stores inputs, not frames
 * (D7), so there is no stored time series. These points are sampled from a
 * re-simulation of the record -- see `lib/replay.ts` -- which means they are
 * engine output rather than an interpolation drawn to look plausible.
 *
 * COLOUR: battery is the accent, cumulative energy is the informational
 * tone, and the only amber on the chart is the battery-reserve floor. Amber
 * and red are reserved for risk semantics by the design system's one
 * non-negotiable rule, so a second data series may not borrow them.
 *
 * TWO AXES, NOT TWO CHARTS: battery is a percentage that falls and energy is
 * watt-hours that rise, and the question the chart answers -- did the draw
 * accelerate before the battery got low -- needs them on one time axis.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Panel } from '@/ui'
import { fmtClock, fmtEnergy, fmtPercent } from '@/lib/format'
import type { ReplaySeriesPoint } from '@/lib/replay'

export interface EnergyChartProps {
  series: ReplaySeriesPoint[]
  /** Drawn as the amber floor line. */
  batteryReserveFrac: number
  /** Where the scrubber is parked, drawn as a vertical marker. */
  cursorElapsedS?: number | null
}

interface Point {
  elapsedS: number
  batteryPct: number
  energyWh: number
}

export function EnergyChart({ series, batteryReserveFrac, cursorElapsedS }: EnergyChartProps) {
  const data: Point[] = series.map((p) => ({
    elapsedS: p.elapsedS,
    // Recharts wants a number in the axis's own units; the percentage axis
    // is 0..100 rather than 0..1 so the ticks read as percentages.
    batteryPct: p.batteryFrac * 100,
    energyWh: p.energyWh,
  }))

  return (
    <Panel
      title="Power over time"
      subtitle="Sampled by re-running the recorded mission; the record itself stores no frames."
    >
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
            {/* Horizontal rules only: vertical ones compete with the cursor
                and the reserve line, which both carry meaning. */}
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="elapsedS"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => fmtClock(v)}
              stroke="var(--color-ink-faint)"
              tick={{ fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              yAxisId="battery"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              stroke="var(--color-accent-dim)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              width={44}
            />
            <YAxis
              yAxisId="energy"
              orientation="right"
              stroke="var(--color-info-dim)"
              tick={{ fontSize: 11 }}
              tickLine={false}
              width={52}
            />

            <ReferenceLine
              yAxisId="battery"
              y={batteryReserveFrac * 100}
              stroke="var(--color-warn)"
              strokeDasharray="4 3"
            />
            {typeof cursorElapsedS === 'number' ? (
              <ReferenceLine
                yAxisId="battery"
                x={cursorElapsedS}
                stroke="var(--color-ink-faint)"
                strokeDasharray="2 3"
              />
            ) : null}

            {/* The render-function form, not an element: Recharts types the
                element form as needing every injected prop up front. */}
            <Tooltip
              cursor={{ stroke: 'var(--color-line-strong)' }}
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload}
                />
              )}
            />

            <Line
              yAxisId="battery"
              type="monotone"
              dataKey="batteryPct"
              stroke="var(--color-accent)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              name="Battery"
            />
            <Line
              yAxisId="energy"
              type="monotone"
              dataKey="energyWh"
              stroke="var(--color-info)"
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              name="Energy drawn"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Legend reserveFrac={batteryReserveFrac} />
    </Panel>
  )
}

/**
 * A hand-written legend rather than Recharts' own, so the swatches use the
 * same tokens as the lines and the reserve line is explained rather than
 * left as an unlabelled dash.
 */
function Legend({ reserveFrac }: { reserveFrac: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-dim">
      <Swatch color="var(--color-accent)" label="Battery" />
      <Swatch color="var(--color-info)" label="Cumulative energy" />
      <Swatch color="var(--color-warn)" dashed label={`Reserve floor, ${fmtPercent(reserveFrac)}`} />
    </div>
  )
}

function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-0 w-4 border-t-2"
        style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }}
      />
      {label}
    </span>
  )
}

/**
 * Typed against what this tooltip actually reads rather than against
 * Recharts' generic `TooltipContentProps`, whose two type parameters are
 * inferred from the chart and do not survive being passed through a render
 * function. Three optional fields, each narrowed before use, is both safer
 * and shorter than fighting the inference.
 */
interface TooltipLike {
  active?: boolean
  label?: unknown
  payload?: readonly { dataKey?: unknown; value?: unknown }[]
}

function ChartTooltip({ active, payload, label }: TooltipLike) {
  if (!active || !payload || payload.length === 0) return null
  const battery = payload.find((p) => p.dataKey === 'batteryPct')?.value
  const energy = payload.find((p) => p.dataKey === 'energyWh')?.value
  return (
    <div className="rounded-control border border-line bg-surface-2 px-2.5 py-2 text-2xs shadow-panel">
      <p className="num text-ink-muted">{fmtClock(typeof label === 'number' ? label : null)}</p>
      <p className="num mt-1 text-accent">
        Battery {typeof battery === 'number' ? fmtPercent(battery / 100, 1) : '—'}
      </p>
      <p className="num text-info">
        Drawn {typeof energy === 'number' ? fmtEnergy(energy) : '—'}
      </p>
    </div>
  )
}
