/**
 * Running one mission and classifying how it ended.
 *
 * WHY THE OUTCOME IS NOT JUST `SimState.outcome`. Three different things all
 * arrive as `failed`, and averaging over them would be meaningless:
 *
 *  - `unroutable`  — the mission had no route at tick 0. The start cell or
 *                    the goal is above the hazard ceiling on this seed, or
 *                    there is no connected corridor at all. Nothing was
 *                    driven, so the distance and energy for this run are 0
 *                    and including them in a median would drag it toward 0.
 *  - `failed`      — the rover drove and then could not continue: it ran the
 *                    battery below the reserve, or replanned into a pocket it
 *                    could not route out of. This is a real autonomy failure
 *                    and is the interesting one.
 *  - `held`        — supervised only. `outcome` is null and an intervention
 *                    is outstanding; the mission is waiting for a human and
 *                    is neither a success nor a failure.
 *
 * A fourth, `stalled`, is the tick budget running out with no outcome, which
 * should not happen and is reported loudly rather than silently bucketed.
 */

import {
  computeMetrics,
  createSimulation,
  runToCompletion,
} from '../../src/core/engine'
import type {
  InterventionReason,
  MissionConfig,
  MissionMetrics,
  SimState,
} from '../../src/core/types'

export type RunOutcome = 'complete' | 'failed' | 'unroutable' | 'aborted' | 'held' | 'stalled'

export interface MissionRun {
  config: MissionConfig
  state: SimState
  metrics: MissionMetrics
  outcome: RunOutcome
  /** Engine's own failure text, when there is one. */
  failureReason: string | null
  /** Why a supervised mission is waiting, when it is. */
  heldOn: InterventionReason | null
}

export function classify(state: SimState): RunOutcome {
  if (state.outcome === 'complete') return 'complete'
  if (state.outcome === 'aborted') return 'aborted'
  if (state.outcome === 'failed') {
    // Nothing was driven: the mission never had a route to begin with.
    return state.tick === 0 && state.rover.odometerM === 0 ? 'unroutable' : 'failed'
  }
  if (state.pendingIntervention !== null) return 'held'
  return 'stalled'
}

export function runMission(config: MissionConfig): MissionRun {
  const state = runToCompletion(createSimulation(config))
  const failed = state.events.find((e) => e.type === 'mission-failed')
  return {
    config,
    state,
    metrics: computeMetrics(state),
    outcome: classify(state),
    failureReason: failed && failed.type === 'mission-failed' ? failed.reason : null,
    heldOn: state.pendingIntervention?.reason ?? null,
  }
}

/** Did this run actually drive? Continuous metrics are only pooled over these. */
export function drove(run: MissionRun): boolean {
  return run.outcome !== 'unroutable' && run.metrics.distanceM > 0
}
