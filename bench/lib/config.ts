/**
 * Mission configurations, seed ensembles and parameter grids.
 *
 * ONE BUILDER, USED BY EVERY EXPERIMENT. If each experiment wrote its own
 * config literal, two of them would drift apart on some field nobody is
 * looking at (battery reserve, say) and the comparison between their results
 * would quietly stop meaning anything.
 */

import { DEFAULT_ROVER, SCENARIOS } from '../../src/core/scenarios'
import type { CostWeights, MissionConfig, Scenario } from '../../src/core/types'

/**
 * The reference configuration. These are the values the repository's
 * documented baseline numbers were taken at, so anything compared against
 * them has to start here and change one thing.
 *
 * `autonomous` rather than the product's `supervised` default: a supervised
 * mission stops and waits for a human, which is the right product default and
 * the wrong benchmark default — it would turn most cells of the sweep into
 * "held at tick 60" and measure nothing downstream of the first hard choice.
 * Supervised behaviour is measured separately, in its own experiment.
 */
export const REFERENCE = {
  riskTolerance: 0.45,
  energyPriority: 0.4,
  batteryReserveFrac: 0.15,
  maxSlopeDeg: 25,
  autonomyLevel: 'autonomous',
} as const

export function configFor(scenario: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    start: { ...scenario.start },
    waypoints: scenario.suggestedWaypoints.map((c) => ({ ...c })),
    riskTolerance: REFERENCE.riskTolerance,
    energyPriority: REFERENCE.energyPriority,
    batteryReserveFrac: REFERENCE.batteryReserveFrac,
    maxSlopeDeg: REFERENCE.maxSlopeDeg,
    autonomyLevel: REFERENCE.autonomyLevel,
    rover: DEFAULT_ROVER,
    ...over,
  }
}

/**
 * The seed ensemble for a scenario.
 *
 * Index 0 is always the scenario's own hand-picked seed, so the canonical
 * numbers remain visible inside the ensemble rather than being a separate
 * experiment. The rest are offsets by a prime stride, which keeps the
 * ensemble reproducible from (scenario, count) alone — no seed list to
 * maintain, and no accidental overlap between two scenarios' ensembles.
 *
 * `config.seed` is what `createSimulation` feeds to the terrain generator, so
 * a different seed is a genuinely different world under the SAME scenario
 * parameters. It is not a different scenario: start and waypoints stay fixed,
 * which is why some seeds turn out to have no mission at all (see the
 * `unroutable` column in the sweep).
 */
const SEED_STRIDE = 1009

export function seedsFor(scenario: Scenario, count: number): number[] {
  const out: number[] = []
  for (let k = 0; k < count; k++) out.push(scenario.seed + k * SEED_STRIDE)
  return out
}

export const SCENARIO_LIST: readonly Scenario[] = SCENARIOS

/** Risk-tolerance levels swept by the closed-loop grid. */
export const RISK_GRID = [0.15, 0.3, 0.45, 0.6, 0.85] as const

/** Energy-priority levels swept by the closed-loop grid. */
export const ENERGY_GRID = [0.1, 0.4, 0.8] as const

/** Heuristic multipliers swept by the planner comparison. 1 is admissible. */
export const HEURISTIC_GRID = [1, 1.25, 1.5, 2, 3] as const

/**
 * The shortest-distance baseline's weights.
 *
 * Distance only. Note what this does NOT do: the hard constraints
 * (`maxSlopeDeg`, `maxHazard`) are supplied separately and are applied to
 * this arm exactly as they are to the risk-aware arm, so this is "shortest
 * path subject to the same legality gate", not "shortest path ignoring
 * hazard". The experiment runs a third arm with the hazard ceiling opened to
 * its maximum precisely so the two sources of safety can be told apart.
 */
export const DISTANCE_ONLY_WEIGHTS: CostWeights = {
  distance: 1,
  slope: 0,
  hazard: 0,
  energy: 0,
}

/**
 * The most distance-dominant configuration the shipped engine can be put in.
 *
 * `weightsFor` cannot produce distance-only weights: the hazard, slope and
 * energy weights have non-zero floors by construction, and the engine's
 * candidate selection additionally charges peak hazard above the stated
 * tolerance. At riskTolerance 1.0 that exceedance charge is identically zero
 * and the weights reach their most distance-heavy point
 * (distance 0.645, slope 0.194, hazard 0.097, energy 0.065).
 *
 * So the CLOSED-LOOP comparison is risk-aware against distance-dominant, and
 * the strict distance-only baseline is measured open-loop where the planner
 * can be called with arbitrary weights. Both are reported; neither is
 * described as the other.
 */
export const DISTANCE_DOMINANT: Partial<MissionConfig> = {
  riskTolerance: 1,
  energyPriority: 0,
}
