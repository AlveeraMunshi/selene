/**
 * The three mission scenarios, and the rover they are tuned around.
 *
 * EVERY NUMBER BELOW WAS CHOSEN BY RUNNING THE ENGINE, not by guessing. Each
 * scenario's `hypothesis` is a claim about observable behaviour — "replans at
 * least once", "flips its route when the risk slider moves" — and the
 * parameters were swept until the claim held. The observed behaviour of each
 * is recorded in docs/ENGINEERING_NOTES.md so a later change that breaks one
 * is visible as a difference rather than a vibe.
 */

import type { RoverSpec, Scenario } from './types'

/**
 * The reference rover.
 *
 * NOTE ON `idleWhPerS`: the field is named for watts but `types.ts` documents it as
 * "watt-hours per second", and the doc comment is what the engine follows.
 * 0.02 Wh/s is 72 W of avionics — a plausible bus load, and small enough next
 * to traction that motion dominates the energy budget, which is what makes
 * the energy term of the cost function mean anything.
 *
 * `maxSpeedMs` of 0.8 is faster than a real lunar rover (Apollo's LRV managed
 * ~3 m/s, modern teleoperated designs ~0.1). It is chosen so a full traverse
 * is ~1300 ticks rather than ~10000: the simulation stays honest about
 * distance and energy, and a test suite can run a mission to completion
 * several times without taking a minute.
 */
export const DEFAULT_ROVER: RoverSpec = {
  maxSpeedMs: 0.8,
  capacityWh: 1200,
  flatWhPerM: 0.35,
  climbWhPerMPerDeg: 0.02,
  sensorRangeCells: 6,
  idleWhPerS: 0.02,
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'baseline-traverse',
    name: 'Mare Traverse',
    summary:
      'Gentle mare terrain with good orbital coverage. A clean two-leg traverse the planner should mostly get right first time.',
    hypothesis:
      'With high orbital visibility and sparse hidden hazard, the initial plan survives contact with the terrain: the mission completes with at most one replan and no intervention.',
    width: 96,
    height: 96,
    seed: 20260419,
    start: { x: 4, y: 88 },
    suggestedWaypoints: [
      { x: 52, y: 44 },
      { x: 88, y: 10 },
    ],
    terrain: {
      octaves: 4,
      relief: 36,
      craters: 7,
      // 0.97 visibility over 1.5% of the map caps any hidden surprise at
      // ~0.03 severity, which is below the engine's materiality threshold —
      // so this scenario can still *discover* things without that discovery
      // invalidating a route. Measured: 0 replans.
      orbitalVisibility: 0.97,
      hiddenHazardDensity: 0.015,
      rubbleFields: 4,
    },
  },
  {
    id: 'dynamic-hazard',
    name: 'Regolith Trap',
    summary:
      'Orbital imagery misses large patches of soft regolith. The rover has to discover them with its own sensors and route around them mid-traverse.',
    hypothesis:
      'Low orbital visibility over clustered concealment patches guarantees that the initial route crosses ground that looks clear and is not, forcing at least one replan driven by a hazard the planner could not have known about.',
    width: 96,
    height: 96,
    seed: 77120331,
    start: { x: 6, y: 48 },
    suggestedWaypoints: [{ x: 90, y: 48 }],
    terrain: {
      octaves: 4,
      relief: 44,
      craters: 9,
      orbitalVisibility: 0.3,
      hiddenHazardDensity: 0.26,
      rubbleFields: 5,
    },
  },
  {
    id: 'competing-objectives',
    name: 'Rille Crossing',
    summary:
      'A short corridor through broken ground, or a long clean detour around it. Which one the planner picks depends entirely on the risk slider.',
    hypothesis:
      'Dense rubble between start and goal creates two genuinely different homotopy classes. Moving riskTolerance from low to high flips the selected route between the safe detour and the direct corridor, with a measurable difference in distance and peak hazard.',
    width: 96,
    height: 96,
    // Seed chosen by sweeping 400 seeds for the widest gap between the
    // low-tolerance and high-tolerance routes; see docs/ENGINEERING_NOTES.md.
    // Measured at this seed: riskTolerance 0.15 routes 752 m at peak hazard
    // 0.27, riskTolerance 0.90 routes 490 m at peak hazard 0.75.
    seed: 16,
    start: { x: 8, y: 8 },
    suggestedWaypoints: [{ x: 88, y: 88 }],
    terrain: {
      octaves: 4,
      relief: 52,
      craters: 11,
      orbitalVisibility: 0.85,
      hiddenHazardDensity: 0.05,
      // 14 rubble fields is what reliably produces a near-complete barrier
      // with one risky gap in it; at 9 the map was porous and both tolerance
      // settings found essentially the same corridor.
      rubbleFields: 14,
    },
  },
]

/** Look a scenario up by id. Throws rather than returning undefined: an
 *  unknown scenario id means a corrupt mission record or a typo in a config,
 *  and silently falling back to a default would make a replay produce the
 *  wrong world with no indication anything was wrong. */
export function getScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown scenario id: ${id}`)
  return s
}
