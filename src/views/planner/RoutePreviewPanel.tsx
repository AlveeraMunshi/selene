/**
 * What the planner would do with the current configuration.
 *
 * Every figure comes off the `Route` objects the planner returned for each
 * leg -- nothing is estimated. The search cost is shown too, because a
 * preview that silently runs A* several times a second should say so.
 */

import type { MissionConfig } from '@/core/types'
import { Badge, EmptyState, Panel, Spinner, Stat } from '@/ui'
import { fmtDegrees, fmtDistance, fmtEnergy, fmtNumber, fmtPercent } from '@/lib/format'
import { planFailureMessage, type RoutePreview } from '@/lib/preview'
import { CostBreakdown } from '@/views/shared/CostBreakdown'

export interface RoutePreviewPanelProps {
  preview: RoutePreview | null
  pending: boolean
  error: string | null
  config: MissionConfig
}

export function RoutePreviewPanel(props: RoutePreviewPanelProps) {
  return (
    <Panel
      title="Route preview"
      subtitle="Planned against the pre-launch belief: orbital hazard only, nothing sensed yet."
      actions={props.pending ? <Spinner label="Planning" /> : null}
    >
      <PreviewBody {...props} />
    </Panel>
  )
}

function PreviewBody({ preview, pending, error, config }: RoutePreviewPanelProps) {
  if (error) {
    return (
      <EmptyState
        compact
        title="The planner failed"
        body={`${error} That is a bug rather than an infeasible route.`}
      />
    )
  }
  if (!preview) {
    return pending ? (
      <EmptyState compact title="Planning" body="Running A* over each leg of the route." />
    ) : (
      <EmptyState
        compact
        title="Nothing to preview"
        body="Add a waypoint and the planner will route to it."
      />
    )
  }

  const route = preview.fullRoute
  // Battery share is predicted drive energy over the rover's capacity: a
  // restatement of two engine numbers, not a second energy model. It excludes
  // idle draw, which the hint says.
  const capacity = config.rover.capacityWh
  const batteryShare = capacity > 0 ? preview.energyWh / capacity : null

  return (
    <div className="grid gap-4">
      {preview.failure ? (
        <div className="rounded-control border border-warn/35 bg-warn/10 p-3">
          <p className="eyebrow text-warn-strong">
            Leg {preview.failure.waypointIndex + 1} cannot be planned
          </p>
          <p className="mt-1 text-[0.8125rem] leading-5 text-ink-muted">
            {planFailureMessage(preview.failure.reason)}
          </p>
          <p className="mt-1 text-2xs text-ink-dim">
            The figures below cover only the legs that did plan.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Distance" value={fmtDistance(preview.distanceM)} compact />
        <Stat
          label="Predicted energy"
          value={fmtEnergy(preview.energyWh)}
          compact
          hint={
            batteryShare !== null ? `${fmtPercent(batteryShare)} of capacity, drive only` : undefined
          }
        />
        <Stat
          label="Peak hazard"
          value={fmtPercent(preview.peakHazard)}
          compact
          tone={preview.peakHazard > 0.6 ? 'warn' : 'default'}
        />
        <Stat label="Peak slope" value={fmtDegrees(preview.peakSlopeDeg)} compact />
      </div>

      {route ? (
        <div>
          <p className="eyebrow mb-2">Cost breakdown</p>
          <CostBreakdown cost={route.cost} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <Badge mono>
          {preview.legs.length} leg{preview.legs.length === 1 ? '' : 's'}
        </Badge>
        <Badge mono>{fmtNumber(preview.cells.length)} cells</Badge>
        <Badge mono>{fmtNumber(preview.nodesExpanded)} nodes</Badge>
        <Badge mono>{fmtNumber(preview.elapsedMs, 1)} ms</Badge>
      </div>
    </div>
  )
}
