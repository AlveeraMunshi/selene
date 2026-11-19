/**
 * Narrow subscriptions into the mission store.
 *
 * WHY THESE EXIST RATHER THAN `useMissionStore(s => s.state)` EVERYWHERE:
 * the live SimState changes identity on every tick, so any component that
 * selects it re-renders two to eight times a second. That is correct for a
 * battery meter and wasteful for a decision list that changes once a minute.
 *
 * The rule this file encodes: subscribe to the narrowest thing that actually
 * changes when the thing on screen changes. Because `step()` is pure and only
 * replaces the fields it touched, selecting `state.decisions` by reference is
 * genuinely stable between decisions.
 */

import { useShallow } from 'zustand/react/shallow'

import type {
  DecisionRecord,
  InterventionRequest,
  MissionConfig,
  RoverState,
  SimEvent,
  SimState,
} from '@/core/types'

import { observedFraction } from '@/core/terrain'

import { useMissionStore, type RunStatus } from './missionStore'
import { planFailureMessage } from '@/lib/preview'

// ---------------------------------------------------------------------------
// Whole-state access — for leaves only
// ---------------------------------------------------------------------------

/**
 * The full live SimState.
 *
 * Only the map canvas should use this, and only because the renderer needs
 * the whole thing. The canvas is a leaf that renders one element, so a tick
 * costs a near-empty re-render rather than a subtree.
 */
export function useLiveState(): SimState | null {
  return useMissionStore((s) => s.state)
}

/**
 * What the map should draw: the replay state when one is being scrubbed,
 * otherwise the live mission. One place decides this so the canvas, the
 * telemetry and the decision list cannot disagree about which mission is
 * on screen.
 */
export function useDisplayState(): SimState | null {
  return useMissionStore((s) => (s.replay?.active ? s.replay.state : s.state))
}

export function useIsReplaying(): boolean {
  return useMissionStore((s) => s.replay?.active === true)
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export interface PlaybackSlice {
  status: RunStatus
  speed: number
  hasMission: boolean
  canPlay: boolean
  canStep: boolean
  awaitingOperator: boolean
}

export function usePlayback(): PlaybackSlice {
  return useMissionStore(
    useShallow((s): PlaybackSlice => {
      const live = s.state
      const awaitingOperator = !!live?.pendingIntervention
      const running = s.status === 'running'
      const finished = live?.outcome != null
      return {
        status: s.status,
        speed: s.speed,
        hasMission: live !== null,
        canPlay: live !== null && !finished && !awaitingOperator && !running,
        canStep: live !== null && !finished && !awaitingOperator,
        awaitingOperator,
      }
    }),
  )
}

export function usePlaybackActions() {
  return useMissionStore(
    useShallow((s) => ({
      play: s.play,
      pause: s.pause,
      stepOnce: s.stepOnce,
      reset: s.reset,
      setSpeed: s.setSpeed,
      abort: s.abort,
    })),
  )
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * Only the scalars the telemetry rail prints. Shallow-compared, so a tick in
 * which nothing visible moved does not re-render the rail.
 */
export interface TelemetrySlice {
  tick: number
  elapsedS: number
  mode: RoverState['mode']
  battery: number
  odometerM: number
  energyUsedWh: number
  waypointIndex: number
  waypointsTotal: number
  replanCount: number
  routeEnergyWh: number | null
  routeDistanceM: number | null
  outcome: SimState['outcome']
  capacityWh: number
  maxSpeedMs: number
}

export function useTelemetry(): TelemetrySlice | null {
  return useMissionStore(
    useShallow((s): TelemetrySlice | null => {
      const st = s.replay?.active ? s.replay.state : s.state
      if (!st) return null
      return {
        tick: st.tick,
        elapsedS: st.elapsedS,
        mode: st.rover.mode,
        battery: st.rover.battery,
        odometerM: st.rover.odometerM,
        energyUsedWh: st.rover.energyUsedWh,
        waypointIndex: st.rover.waypointIndex,
        waypointsTotal: st.config.waypoints.length,
        replanCount: st.replanCount,
        routeEnergyWh: st.rover.route?.energyWh ?? null,
        routeDistanceM: st.rover.route?.distanceM ?? null,
        outcome: st.outcome,
        capacityWh: st.config.rover.capacityWh,
        maxSpeedMs: st.config.rover.maxSpeedMs,
      }
    }),
  )
}

/**
 * Fraction of the map the rover has sensed.
 *
 * Uses the engine's own `observedFraction` rather than counting here, so the
 * number on screen is the same one a DecisionRecord carries. It scans the
 * belief on every tick, which is cheap next to a render and is preferable to
 * caching a figure that can silently go stale.
 */
export function useObservedFraction(): number | null {
  return useMissionStore((s) => {
    const st = s.replay?.active ? s.replay.state : s.state
    if (!st) return null
    return observedFraction(st.belief)
  })
}

// ---------------------------------------------------------------------------
// Decisions, events, interventions
// ---------------------------------------------------------------------------

/** Stable between decisions: `step()` keeps the array identity when unchanged. */
export function useDecisions(): DecisionRecord[] {
  return useMissionStore((s) => (s.replay?.active ? s.replay.state : s.state)?.decisions ?? EMPTY_DECISIONS)
}

export function useEvents(): SimEvent[] {
  return useMissionStore((s) => (s.replay?.active ? s.replay.state : s.state)?.events ?? EMPTY_EVENTS)
}

export function useSelectedDecision(): DecisionRecord | null {
  return useMissionStore((s) => {
    const id = s.selectedDecisionId
    if (!id) return null
    const st = s.replay?.active ? s.replay.state : s.state
    return st?.decisions.find((d) => d.id === id) ?? null
  })
}

/**
 * The outstanding request, straight off the live state.
 *
 * Deliberately NOT read from the replay state: a replayed intervention was
 * already answered and must not offer the operator buttons that would do
 * nothing.
 */
export function usePendingIntervention(): InterventionRequest | null {
  return useMissionStore((s) => s.state?.pendingIntervention ?? null)
}

// ---------------------------------------------------------------------------
// Configuration and launch validity
// ---------------------------------------------------------------------------

export function useConfig(): MissionConfig {
  return useMissionStore((s) => s.config)
}

export function useConfigActions() {
  return useMissionStore(
    useShallow((s) => ({
      setScenario: s.setScenario,
      setStart: s.setStart,
      toggleWaypoint: s.toggleWaypoint,
      clearWaypoints: s.clearWaypoints,
      setRisk: s.setRisk,
      setEnergyPriority: s.setEnergyPriority,
      setBatteryReserve: s.setBatteryReserve,
      setMaxSlope: s.setMaxSlope,
      setAutonomyLevel: s.setAutonomyLevel,
      setSeed: s.setSeed,
      previewRoute: s.previewRoute,
      launch: s.launch,
    })),
  )
}

export interface LaunchValidity {
  canLaunch: boolean
  /** Why not, in one sentence the operator can act on. Null when launchable. */
  reason: string | null
  pending: boolean
}

/**
 * Whether Launch should be enabled, and the sentence explaining it.
 *
 * The authority is the preview: it ran the real planner against the real
 * pre-launch belief, so "unreachable" here means the same thing it will mean
 * to the engine. Nothing is re-derived.
 */
export function useLaunchValidity(): LaunchValidity {
  return useMissionStore(
    useShallow((s): LaunchValidity => {
      if (s.config.waypoints.length === 0) {
        return { canLaunch: false, reason: 'Add at least one waypoint on the map.', pending: false }
      }
      if (s.previewError) {
        return { canLaunch: false, reason: s.previewError, pending: false }
      }
      if (s.previewPending || !s.preview) {
        return { canLaunch: false, reason: null, pending: true }
      }
      const failure = s.preview.failure
      if (failure) {
        const which = `Waypoint ${failure.waypointIndex + 1}`
        return {
          canLaunch: false,
          reason: `${which}: ${planFailureMessage(failure.reason)}`,
          pending: false,
        }
      }
      return { canLaunch: true, reason: null, pending: false }
    }),
  )
}

export function usePreview() {
  return useMissionStore(
    useShallow((s) => ({
      preview: s.preview,
      pending: s.previewPending,
      error: s.previewError,
    })),
  )
}

// ---------------------------------------------------------------------------
// Render options
// ---------------------------------------------------------------------------

export function useRenderOptions() {
  return useMissionStore((s) => s.renderOptions)
}

export function useSetRenderOption() {
  return useMissionStore((s) => s.setRenderOption)
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function useMissions() {
  return useMissionStore((s) => s.missions)
}

export function useSelectedMission() {
  return useMissionStore((s) =>
    s.selectedMissionId ? (s.missions.find((m) => m.missionId === s.selectedMissionId) ?? null) : null,
  )
}

export function useReplay() {
  return useMissionStore((s) => s.replay)
}

export function useRecordActions() {
  return useMissionStore(
    useShallow((s) => ({
      loadRecord: s.loadRecord,
      startReplay: s.startReplay,
      seekReplay: s.seekReplay,
      stopReplay: s.stopReplay,
      exportRecord: s.exportRecord,
      saveMission: s.saveMission,
    })),
  )
}

export function useSelectDecision() {
  return useMissionStore((s) => s.selectDecision)
}

export function useResolveIntervention() {
  return useMissionStore((s) => s.resolveIntervention)
}

/** True when persistence is unavailable, so a view can say so once. */
export function usePersistenceAvailable(): boolean {
  return useMissionStore((s) => s.persistenceAvailable)
}

// Shared empty literals so an absent mission does not hand a new array to a
// reference-compared selector on every tick.
const EMPTY_DECISIONS: DecisionRecord[] = []
const EMPTY_EVENTS: SimEvent[] = []
