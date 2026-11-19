/**
 * Live Autonomous Mission.
 *
 * LAYOUT REASONING: telemetry left, map centre, decisions right. The map is
 * the widest thing because it is what you watch; the decision stream is
 * beside it rather than under it because the whole claim of this project is
 * that you can see *why* the rover did the thing you just watched it do, and
 * scrolling between the two breaks that. Under ~1100px the columns stack in
 * reading order, map first, with the decision stream below it.
 *
 * RENDER COST: nothing in this file subscribes to the ticking SimState. The
 * map is a leaf that does; the telemetry rail selects only the scalars it
 * prints; the decision stream selects the decisions array by reference. A
 * tick therefore re-renders the canvas wrapper and the rail, and not this
 * component.
 */

import { useMemo } from 'react'

import { EmptyState, Panel } from '@/ui'
import {
  useDecisions,
  useDisplayState,
  useIsReplaying,
  usePendingIntervention,
  usePlayback,
  usePlaybackActions,
  useResolveIntervention,
  useSelectDecision,
  useSelectedDecision,
} from '@/state/selectors'
import { MapCanvas } from '@/views/shared/MapCanvas'

import { DecisionInspector } from './mission/DecisionInspector'
import { DecisionStream } from './mission/DecisionStream'
import { InterventionPanel } from './mission/InterventionPanel'
import { OutcomeBanner } from './mission/OutcomeBanner'
import { LayerToggles } from './mission/LayerToggles'
import { TelemetryRail } from './mission/TelemetryRail'
import { TransportControls } from './mission/TransportControls'

export interface MissionViewProps {
  /** Lets the empty state send the operator to the planner. */
  onGoToPlanner: () => void
}

export function MissionView({ onGoToPlanner }: MissionViewProps) {
  const state = useDisplayState()
  const playback = usePlayback()
  const actions = usePlaybackActions()
  const replaying = useIsReplaying()

  const decisions = useDecisions()
  const selected = useSelectedDecision()
  const selectDecision = useSelectDecision()
  const pending = usePendingIntervention()
  const resolve = useResolveIntervention()

  // Selecting a decision pins its position on the map, which is how you find
  // where a replan happened without reading coordinates off the record.
  const overrides = useMemo(
    () => ({ selectedCell: selected ? selected.position : null }),
    [selected],
  )

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Panel className="max-w-md">
          <EmptyState
            title="No mission running"
            body="Configure a route in the planner and launch it. The map, the telemetry and the decision stream all fill in from there."
            action={
              <button
                type="button"
                onClick={onGoToPlanner}
                className="focus-ring rounded-control border border-line bg-surface-2 px-3 py-1.5 text-2xs text-ink hover:bg-surface-3"
              >
                Open the planner
              </button>
            }
          />
        </Panel>
      </div>
    )
  }

  // auto-rows-min is load-bearing below 1100px. Stacked, this is a
  // single-column grid with a definite height whose children all carry
  // min-h-0 for their own internal scrolling — which drops every row's
  // minimum to zero, so the three rows split the height equally and each
  // one's content spills over the row after it. Panels paint on top of
  // one another and the transport controls end up underneath the decision
  // stream, un-clickable while still passing every visibility check.
  // Sizing rows to their content makes the total legitimately exceed the
  // height, which is what the overflow-y-auto here was always for. Above
  // 1100px it is one row of three columns and rows must stretch again.
  return (
    <div className="grid h-full min-h-0 auto-rows-min gap-3 overflow-y-auto p-3 min-[1100px]:auto-rows-auto min-[1100px]:grid-cols-[260px_minmax(0,1fr)_380px] min-[1100px]:overflow-hidden">
      <div className="min-h-0 min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
        <TelemetryRail />
      </div>

      {/* Flex rather than an explicit grid-rows template: the intervention
          panel is conditional, and a three-row template silently reassigns
          the map's row to the transport bar on the (common) ticks where
          there is no request outstanding. */}
      <div className="flex min-h-0 flex-col gap-3 min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
        {/* The intervention sits above the map rather than in a sidebar: it
            is the only thing on screen that stops the mission, so it gets the
            position nothing else can be mistaken for. */}
        {pending && !replaying ? (
          <InterventionPanel request={pending} onResolve={resolve} className="shrink-0" />
        ) : null}

        {/* A finished mission said so only via a small badge in the telemetry
            rail; the engine's reason for a failure lived solely in the event
            log on another screen. */}
        {state.outcome && !replaying ? (
          <OutcomeBanner
            outcome={state.outcome}
            events={state.events}
            waypointsReached={state.rover.waypointIndex}
            waypointsTotal={state.config.waypoints.length}
            className="shrink-0"
          />
        ) : null}

        <Panel flush className="min-h-[360px] shrink-0 grow basis-[360px] overflow-hidden">
          <MapCanvas state={state} overrides={overrides} />
        </Panel>

        <Panel className="shrink-0">
          <div className="grid gap-3">
            <TransportControls
              playback={playback}
              onPlay={actions.play}
              onPause={actions.pause}
              onStep={actions.stepOnce}
              onReset={actions.reset}
              onAbort={actions.abort}
              onSpeed={actions.setSpeed}
              replaying={replaying}
            />
            <div className="border-t border-line pt-3">
              <LayerToggles />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid min-h-0 grid-rows-[minmax(200px,2fr)_minmax(200px,3fr)] gap-3">
        <DecisionStream
          decisions={decisions}
          selectedId={selected?.id ?? null}
          onSelect={selectDecision}
          className="min-h-0"
        />
        <DecisionInspector decision={selected} className="min-h-0" />
      </div>
    </div>
  )
}
