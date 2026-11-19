/**
 * What the planner would do with the current configuration.
 *
 * Every figure here comes off the `Route` objects the planner returned for
 * each leg — nothing is estimated. The search cost is shown too, because a
 * preview that silently runs A* four times a second should say so.
 */

import type { MissionConfig } from '@/core/types'
import { Badge, EmptyState, Panel, Spinner, Stat } from '@/ui'
import { fmtDistance, fmtEnergy, fmtNumber, fmtPercent, fmtDegrees } from '@/lib/format'
import { planFailureMessage, type RoutePreview } from '@/lib/preview'
import { CostBreakdown } from '@/views/shared/CostBreakdown'

export interface RoutePreviewPanelProps {
  preview: RoutePreview | null
  pending: boolean
  error: string | null
  config: MissionConfig
}

export function RoutePreviewPanel({ preview, pending, error, config }: RoutePreviewPanelProps) {
  return (
    <Panel
      title="Route preview"
      subtitle="Planned against the pre-launch belief: orbital hazard only, nothing sensed yet."
      actions={pending ? <Spinner /> : null}
    >
      <PreviewBody preview={preview} pending={pending} error={error} config={config} />
    </Panel>
  )
}

function PreviewBody({ preview, pending, error, config }: RoutePreviewPanelProps) {
  if (error) {
    return (
      <EmptyState
        title="The planner failed"
        description={`${error} This is a bug rather than an infeasible route.`}
      />
    )
  }
  if (!preview) {
    return pending ? (
      <EmptyState title="Planning…" description="Running A* over each leg of the route." />
    ) : (
      <EmptyState
        title="Nothing to preview"
        description="Add a waypoint and the planner will route to it."
      />
    )
  }

  const route = preview.fullRoute
  // Battery share is the predicted drive energy over the rover's capacity —
  // a restatement of two engine numbers, not a new estimate. It excludes
  // idle draw, which the label says.
  const capacity = config.rover.capacityWh
  const batteryShare = capacity > 0 ? preview.energyWh / capacity : null

  return (
    <div className="grid gap-4">
      {preview.failure ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-400">
            Leg {preview.failure.waypointIndex + 1} cannot be planned
          </p>
          <p className="mt-1 text-sm text-neutral-300">
            {planFailureMessage(preview.failure.reason)}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            The preview below covers only the legs that did plan.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Distance" value={fmtDistance(preview.distanceM)} />
        <Stat
          label="Predicted energy"
          value={fmtEnergy(preview.energyWh)}
          hint={batteryShare !== null ? `${fmtPercent(batteryShare)} of capacity, drive only` : undefined}
        />
        <Stat label="Peak hazard" value={fmtPercent(preview.peakHazard)} />
        <Stat label="Peak slope" value={fmtDegrees(preview.peakSlopeDeg)} />
      </div>

      {route ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Cost breakdown
          </p>
          <CostBreakdown cost={route.cost} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
        <Badge variant="outline">
          {preview.legs.length} leg{preview.legs.length === 1 ? '' : 's'}
        </Badge>
        <Badge variant="outline">{fmtNumber(preview.cells.length)} cells</Badge>
        <Badge variant="outline">{fmtNumber(preview.nodesExpanded)} nodes expanded</Badge>
        <Badge variant="outline">{fmtNumber(preview.elapsedMs, 1)} ms</Badge>
      </div>
    </div>
  )
}
