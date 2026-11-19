/**
 * Mission Planner.
 *
 * The layout is three columns at desktop width — controls, map, verdict —
 * because the whole value of this screen is that a change on the left moves
 * the line in the middle and the numbers on the right at the same time. Below
 * ~1100px they stack in that same order, map first after the scenario, so the
 * thing being manipulated stays above the fold.
 *
 * No planning happens here. Every control calls a store action, the store
 * debounces and runs the real planner, and this view renders the result.
 */

import { useCallback, useMemo, useState } from 'react'

import type { Cell } from '@/core/types'
import type { RenderOptions } from '@/render/scene'
import { plannerDisplayState } from '@/lib/plannerState'
import { useMissionStore } from '@/state/missionStore'
import {
  useConfig,
  useConfigActions,
  useLaunchValidity,
  useLiveState,
  usePreview,
} from '@/state/selectors'
import { MapCanvas } from '@/views/shared/MapCanvas'

import { LaunchBar } from './planner/LaunchBar'
import { ScenarioPicker } from './planner/ScenarioPicker'
import { MissionParameters } from './planner/MissionParameters'
import { RoutePreviewPanel } from './planner/RoutePreviewPanel'
import { RoverSpecPanel } from './planner/RoverSpecPanel'
import { WaypointList, type MapClickMode } from './planner/WaypointList'

export interface PlannerViewProps {
  /**
   * Called after a successful launch, so the shell can move the operator to
   * the mission it just started.
   *
   * A callback rather than the shell watching `status`: a supervised mission
   * opens PAUSED, waiting for approval of its first route, so "status became
   * running" never fires for the common case.
   */
  onLaunched?: () => void
}

export function PlannerView({ onLaunched }: PlannerViewProps) {
  const config = useConfig()
  const actions = useConfigActions()
  const { preview, pending, error } = usePreview()
  const validity = useLaunchValidity()
  const missionInProgress = useLiveState() !== null

  // Which thing a map click places. Local because it is a tool selection, not
  // mission state — it does not belong in a MissionRecord.
  const [clickMode, setClickMode] = useState<MapClickMode>('waypoint')

  const handleLaunch = useCallback(() => {
    actions.launch()
    // The store refuses to launch an invalid config, so only report a launch
    // that actually produced a mission.
    if (useMissionStore.getState().state !== null) onLaunched?.()
  }, [actions, onLaunched])

  const handleCellClick = useCallback(
    (cell: Cell) => {
      if (clickMode === 'start') {
        actions.setStart(cell)
        // Placing a start is a one-shot action; staying in start mode makes
        // the next click move it again, which is never what was meant.
        setClickMode('waypoint')
        return
      }
      actions.toggleWaypoint(cell)
    },
    [actions, clickMode],
  )

  // The map draws the state the mission would begin from, with the previewed
  // route attached. Memoized on the inputs that actually change it so a
  // slider drag does not regenerate terrain.
  const displayState = useMemo(
    () => plannerDisplayState(config, preview?.fullRoute ?? null),
    [config, preview],
  )

  const overrides = useMemo<Partial<RenderOptions>>(
    () => ({
      // Trail and abandoned routes are mission history; there is none yet, and
      // leaving them on would imply the planner knows something it does not.
      showTrail: false,
      showAbandoned: false,
      showPlannedRoute: true,
      selectedCell: clickMode === 'start' ? config.start : null,
    }),
    [clickMode, config.start],
  )

  return (
    <div className="grid h-full gap-4 overflow-y-auto p-4 min-[1100px]:grid-cols-[320px_minmax(0,1fr)_340px] min-[1100px]:overflow-hidden">
      <div className="grid auto-rows-min grid-cols-[minmax(0,1fr)] content-start gap-4 min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
        <ScenarioPicker selectedId={config.scenarioId} onSelect={actions.setScenario} />
        <WaypointList
          start={config.start}
          waypoints={config.waypoints}
          mode={clickMode}
          onModeChange={setClickMode}
          onRemove={actions.toggleWaypoint}
          onClear={actions.clearWaypoints}
        />
      </div>

      <div className="min-h-[420px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <MapCanvas state={displayState} onCellClick={handleCellClick} overrides={overrides}>
          <MapHint mode={clickMode} />
        </MapCanvas>
      </div>

      <div className="grid auto-rows-min grid-cols-[minmax(0,1fr)] content-start gap-4 min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
        <RoutePreviewPanel preview={preview} pending={pending} error={error} config={config} />
        <MissionParameters
          config={config}
          onRisk={actions.setRisk}
          onEnergyPriority={actions.setEnergyPriority}
          onBatteryReserve={actions.setBatteryReserve}
          onMaxSlope={actions.setMaxSlope}
          onAutonomyLevel={actions.setAutonomyLevel}
        />
        <RoverSpecPanel rover={config.rover} />
        <LaunchBar
          seed={config.seed}
          onSeed={actions.setSeed}
          validity={validity}
          onLaunch={handleLaunch}
          missionInProgress={missionInProgress}
        />
      </div>
    </div>
  )
}

function MapHint({ mode }: { mode: MapClickMode }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 text-[11px] text-neutral-300 backdrop-blur-sm">
      {mode === 'start'
        ? 'Click to move the mission start'
        : 'Click to add a waypoint · click an existing one to remove it'}
    </div>
  )
}
