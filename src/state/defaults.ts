/**
 * Starting values for a mission configuration and for the render layers.
 *
 * Separated from the store so the defaults can be read by a test or a reset
 * without instantiating the store, and so the one place that decides "what
 * does a fresh mission look like" is findable.
 */

import { DEFAULT_ROVER, SCENARIOS } from '@/core/scenarios'
import type { RenderOptions } from '@/render/scene'
import type { MissionConfig, Scenario } from '@/core/types'

/** Playback multipliers offered by the transport control. */
export const SPEEDS = [0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

/** Base simulation rate. Actual rate is BASE_TICK_HZ * speed. */
export const BASE_TICK_HZ = 2

/**
 * Mission defaults.
 *
 * The slider midpoints are deliberately not at the extremes: a mission that
 * starts at zero risk tolerance has no route at all in two of the three
 * scenarios, and the first thing a visitor sees should be a mission that flies.
 */
export function defaultConfigFor(scenario: Scenario): MissionConfig {
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    start: { ...scenario.start },
    waypoints: scenario.suggestedWaypoints.map((c) => ({ ...c })),
    riskTolerance: 0.45,
    energyPriority: 0.5,
    batteryReserveFrac: 0.15,
    maxSlopeDeg: 25,
    // Supervised by default because the interventions are the interesting
    // part of the system; autonomous is the comparison, not the baseline.
    autonomyLevel: 'supervised',
    rover: DEFAULT_ROVER,
  }
}

export function firstScenario(): Scenario {
  const s = SCENARIOS[0]
  if (!s) throw new Error('SCENARIOS is empty; the engine must ship at least one scenario.')
  return s
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showElevation: true,
  showSlope: false,
  showHazard: true,
  showObserved: true,
  showPlannedRoute: true,
  showTrail: true,
  showAbandoned: true,
  // Hover and selection are per-canvas interaction state, not a saved
  // preference; the store keeps them null and the map merges its own.
  hoverCell: null,
  selectedCell: null,
}

/**
 * The boolean layers only. Narrowed away from `keyof RenderOptions` on
 * purpose: `hoverCell` and `selectedCell` are also render options and are
 * emphatically not toggles, and a union key would let a checkbox write a Cell.
 */
export type LayerKey = {
  [K in keyof RenderOptions]: RenderOptions[K] extends boolean ? K : never
}[keyof RenderOptions]

/** The layer toggles a user can actually flip, with their labels. */
export const LAYER_TOGGLES: { key: LayerKey; label: string; hint: string }[] = [
  { key: 'showElevation', label: 'Elevation', hint: 'Shaded relief from the heightfield' },
  { key: 'showSlope', label: 'Slope', hint: 'Gradient in degrees' },
  { key: 'showHazard', label: 'Hazard', hint: 'Believed hazard severity' },
  { key: 'showObserved', label: 'Observed', hint: 'Cells the rover has sensed' },
  { key: 'showPlannedRoute', label: 'Planned route', hint: 'Route currently being driven' },
  { key: 'showTrail', label: 'Trail', hint: 'Cells actually traversed' },
  { key: 'showAbandoned', label: 'Abandoned routes', hint: 'Routes superseded by a replan' },
]
