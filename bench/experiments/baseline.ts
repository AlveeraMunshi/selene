/**
 * Risk-aware A* against a shortest-distance baseline.
 *
 * THE HYPOTHESIS UNDER TEST: risk-aware planning buys a measurable reduction
 * in hazard exposure, and pays for it in distance and in search effort. The
 * experiment is designed so that it can come back negative — if the routes
 * are the same, the tables will say they are the same, and the cost model is
 * then decoration.
 *
 * TWO EXPERIMENTS, BECAUSE THE QUESTION HAS TWO HALVES.
 *
 * OPEN LOOP (`runOpenLoop`) isolates the cost model. One belief, one start,
 * one goal, three weight settings, nothing else different:
 *
 *   risk-aware        weightsFor(config)      constraintsFor(config)
 *   shortest-distance {distance:1, 0,0,0}     constraintsFor(config)   <- same gate
 *   shortest-uncapped {distance:1, 0,0,0}     maxHazard raised to 0.95
 *
 * The third arm exists to separate the two sources of safety. The hard
 * `maxHazard` gate is doing some of the work in the second arm, so without
 * the third one, "the cost model made the route safer" could really be "the
 * constraint made the route safer" and the weights could be doing nothing.
 *
 * CLOSED LOOP (`runClosedLoop`) asks whether any of that survives execution,
 * where the rover discovers hazards it could not see and replans. The engine
 * cannot be given distance-only weights — `weightsFor` has non-zero floors on
 * the other three terms, and candidate selection adds a peak-hazard charge —
 * so the comparison there is risk-aware (0.45) against the most
 * distance-dominant setting the shipped engine admits (risk 1.0, energy 0.0).
 * That is a weaker contrast than the open-loop one and is labelled as such
 * everywhere it appears.
 *
 * EVERYTHING IS PAIRED BY SEED. Between-seed variation in route length is far
 * larger than the effect, so per-seed differences are taken first and
 * summarised second. An unpaired comparison of medians would be noise.
 */

import { createSimulation } from '../../src/core/engine'
import { plan } from '../../src/core/planner'
import { constraintsFor, routeStats, weightsFor } from '../../src/core/cost'
import type { Cell, Constraints, CostWeights, MissionConfig, Scenario } from '../../src/core/types'
import {
  configFor,
  DISTANCE_DOMINANT,
  DISTANCE_ONLY_WEIGHTS,
  SCENARIO_LIST,
  seedsFor,
} from '../lib/config'
import { drove, runMission, type MissionRun } from '../lib/mission'
import { pairedDelta, pairedPercentDelta, summarise, type Summary, winRate } from '../lib/stats'

// ---------------------------------------------------------------------------
// Open loop
// ---------------------------------------------------------------------------

export type ArmId = 'risk-aware' | 'shortest-distance' | 'shortest-uncapped'

export const ARM_IDS: readonly ArmId[] = ['risk-aware', 'shortest-distance', 'shortest-uncapped']

/** One planned route's measured properties. */
interface PlanSample {
  distanceM: number
  energyWh: number
  peakHazard: number
  meanHazard: number
  peakSlopeDeg: number
  nodesExpanded: number
  /** Cost re-priced under the risk-aware weights, so arms are comparable. */
  commonCost: number
  /**
   * Percentage of this route's energy that is the CLIMB term rather than the
   * flat term.
   *
   * Measured because it bounds what an energy-aware planner can possibly
   * achieve. `stepEnergyWh` is `flat*m + climb*m*uphillDeg`, the flat part is
   * proportional to distance and therefore nearly fixed for a traverse
   * between two given cells, and only the climb part is addressable by
   * choosing a different path. A planner cannot save more energy than this
   * share, whatever weight the energy term carries.
   */
  climbSharePct: number
}

export interface ArmSummary {
  arm: ArmId
  /** Seeds on which this arm found a route at all. */
  routed: number
  attempted: number
  distanceM: Summary
  energyWh: Summary
  peakHazard: Summary
  meanHazard: Summary
  peakSlopeDeg: Summary
  nodesExpanded: Summary
  commonCost: Summary
  climbSharePct: Summary
}

export interface PairedComparison {
  treatment: ArmId
  baseline: ArmId
  /** Seeds where BOTH arms routed; the only ones that can be paired. */
  pairs: number
  distancePct: Summary
  energyPct: Summary
  peakHazardPct: Summary
  meanHazardPct: Summary
  peakHazardAbs: Summary
  meanHazardAbs: Summary
  nodesExpandedPct: Summary
  /** How often the treatment's peak hazard is strictly lower. */
  peakHazardWins: { wins: number; ties: number; losses: number; n: number }
  meanHazardWins: { wins: number; ties: number; losses: number; n: number }
  /** How often the treatment is strictly shorter (expected: rarely). */
  distanceWins: { wins: number; ties: number; losses: number; n: number }
}

export interface OpenLoopScenario {
  scenarioId: string
  seeds: number
  arms: ArmSummary[]
  comparisons: PairedComparison[]
  /** The canonical hand-picked seed, reported on its own as well. */
  canonicalSeed: number
  canonical: Record<ArmId, PlanSample | null>
}

export interface OpenLoopResult {
  scenarios: OpenLoopScenario[]
  riskTolerance: number
  energyPriority: number
}

/**
 * Plan one leg under one arm, and re-price it in a common currency.
 *
 * The CELLS come from the arm's own search under its own weights; only the
 * pricing is unified, using the risk-aware weights for all three arms. That
 * is the same move the engine makes when it compares candidate postures, and
 * it is what makes `commonCost` a number you can put in one column.
 */
function planArm(
  config: MissionConfig,
  belief: ReturnType<typeof createSimulation>['belief'],
  start: Cell,
  goal: Cell,
  weights: CostWeights,
  constraints: Constraints,
): PlanSample | null {
  const result = plan({ belief, start, goal, weights, constraints }, config.rover)
  if (!result.ok) return null
  const common = routeStats(
    belief,
    result.route.cells,
    weightsFor(config),
    constraintsFor(config),
    config.rover,
  )
  const flatWh = config.rover.flatWhPerM * result.route.distanceM
  const climbWh = result.route.energyWh - flatWh
  return {
    distanceM: result.route.distanceM,
    energyWh: result.route.energyWh,
    climbSharePct:
      result.route.energyWh > 0 ? (climbWh / result.route.energyWh) * 100 : 0,
    peakHazard: result.route.peakHazard,
    meanHazard: result.route.meanHazard,
    peakSlopeDeg: result.route.peakSlopeDeg,
    nodesExpanded: result.stats.nodesExpanded,
    commonCost: common.cost.total,
  }
}

/**
 * The hazard ceiling for the uncapped arm.
 *
 * 0.95 is `MAX_HAZARD_FLOOR + MAX_HAZARD_SPAN`, the value `constraintsFor`
 * produces at riskTolerance 1.0 — the most permissive gate the system admits.
 * Hard-coding 1.0 instead would let the planner route through cells the type
 * documents as impassable rubble, which is not a baseline anyone would ship.
 */
const UNCAPPED_MAX_HAZARD = 0.95

function armsFor(config: MissionConfig): Record<ArmId, { w: CostWeights; c: Constraints }> {
  const c = constraintsFor(config)
  return {
    'risk-aware': { w: weightsFor(config), c },
    'shortest-distance': { w: DISTANCE_ONLY_WEIGHTS, c },
    'shortest-uncapped': {
      w: DISTANCE_ONLY_WEIGHTS,
      c: { ...c, maxHazard: UNCAPPED_MAX_HAZARD },
    },
  }
}

/**
 * The leg planned for the open-loop comparison.
 *
 * The FINAL waypoint, from the mission start, on the belief the rover holds
 * at tick 0 (orbital hazard everywhere, plus one sensor sweep around the
 * start). Planning the whole traverse as one leg rather than waypoint by
 * waypoint keeps the comparison to a single number per arm, and the belief is
 * the real one the engine would plan its first leg on.
 */
function legFor(config: MissionConfig): { start: Cell; goal: Cell } {
  const goal = config.waypoints[config.waypoints.length - 1]
  if (!goal) throw new Error('baseline: scenario has no waypoints')
  return { start: config.start, goal }
}

function summariseArm(arm: ArmId, samples: readonly (PlanSample | null)[]): ArmSummary {
  const ok = samples.filter((s): s is PlanSample => s !== null)
  const pick = (f: (s: PlanSample) => number) => summarise(ok.map(f))
  return {
    arm,
    routed: ok.length,
    attempted: samples.length,
    distanceM: pick((s) => s.distanceM),
    energyWh: pick((s) => s.energyWh),
    peakHazard: pick((s) => s.peakHazard),
    meanHazard: pick((s) => s.meanHazard),
    peakSlopeDeg: pick((s) => s.peakSlopeDeg),
    nodesExpanded: pick((s) => s.nodesExpanded),
    commonCost: pick((s) => s.commonCost),
    climbSharePct: pick((s) => s.climbSharePct),
  }
}

function compare(
  treatment: ArmId,
  baseline: ArmId,
  byArm: Record<ArmId, (PlanSample | null)[]>,
): PairedComparison {
  const t: PlanSample[] = []
  const b: PlanSample[] = []
  const ts = byArm[treatment]
  const bs = byArm[baseline]
  for (let i = 0; i < ts.length; i++) {
    const a = ts[i]
    const c = bs[i]
    if (a && c) {
      t.push(a)
      b.push(c)
    }
  }
  const col = (xs: PlanSample[], f: (s: PlanSample) => number) => xs.map(f)
  return {
    treatment,
    baseline,
    pairs: t.length,
    distancePct: pairedPercentDelta(col(t, (s) => s.distanceM), col(b, (s) => s.distanceM)),
    energyPct: pairedPercentDelta(col(t, (s) => s.energyWh), col(b, (s) => s.energyWh)),
    peakHazardPct: pairedPercentDelta(col(t, (s) => s.peakHazard), col(b, (s) => s.peakHazard)),
    meanHazardPct: pairedPercentDelta(col(t, (s) => s.meanHazard), col(b, (s) => s.meanHazard)),
    peakHazardAbs: pairedDelta(col(t, (s) => s.peakHazard), col(b, (s) => s.peakHazard)),
    meanHazardAbs: pairedDelta(col(t, (s) => s.meanHazard), col(b, (s) => s.meanHazard)),
    nodesExpandedPct: pairedPercentDelta(
      col(t, (s) => s.nodesExpanded),
      col(b, (s) => s.nodesExpanded),
    ),
    peakHazardWins: winRate(col(t, (s) => s.peakHazard), col(b, (s) => s.peakHazard), 1e-9),
    meanHazardWins: winRate(col(t, (s) => s.meanHazard), col(b, (s) => s.meanHazard), 1e-9),
    distanceWins: winRate(col(t, (s) => s.distanceM), col(b, (s) => s.distanceM), 1e-9),
  }
}

export function runOpenLoop(seedCount: number): OpenLoopResult {
  const scenarios: OpenLoopScenario[] = []
  let riskTolerance = 0
  let energyPriority = 0

  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)
    const byArm: Record<ArmId, (PlanSample | null)[]> = {
      'risk-aware': [],
      'shortest-distance': [],
      'shortest-uncapped': [],
    }
    const canonical: Record<ArmId, PlanSample | null> = {
      'risk-aware': null,
      'shortest-distance': null,
      'shortest-uncapped': null,
    }

    for (const seed of seeds) {
      const config = configFor(scenario, { seed })
      riskTolerance = config.riskTolerance
      energyPriority = config.energyPriority
      // `createSimulation` is the only way to obtain the belief the engine
      // would actually plan on: the orbital layer plus one sweep at the start.
      // It also runs the initial plan, which is wasted work here and is
      // cheaper than reimplementing belief construction and risking a
      // benchmark that measures something the product does not do.
      const sim = createSimulation(config)
      const { start, goal } = legFor(config)
      const arms = armsFor(config)
      for (const arm of ARM_IDS) {
        const { w, c } = arms[arm]
        const sample = planArm(config, sim.belief, start, goal, w, c)
        byArm[arm].push(sample)
        if (seed === scenario.seed) canonical[arm] = sample
      }
    }

    scenarios.push({
      scenarioId: scenario.id,
      seeds: seeds.length,
      arms: ARM_IDS.map((a) => summariseArm(a, byArm[a])),
      comparisons: [
        compare('risk-aware', 'shortest-distance', byArm),
        compare('risk-aware', 'shortest-uncapped', byArm),
      ],
      canonicalSeed: scenario.seed,
      canonical,
    })
  }

  return { scenarios, riskTolerance, energyPriority }
}

// ---------------------------------------------------------------------------
// Closed loop
// ---------------------------------------------------------------------------

export interface ClosedLoopArm {
  arm: 'risk-aware' | 'distance-dominant'
  riskTolerance: number
  energyPriority: number
  seeds: number
  completed: number
  failed: number
  unroutable: number
  completionRate: number
  distanceM: Summary
  energyWh: Summary
  replans: Summary
  hazardsDiscovered: Summary
  hazardsOnRoute: Summary
  peakHazardTraversed: Summary
  planCount: Summary
  interventions: Summary
}

export interface ClosedLoopScenario {
  scenarioId: string
  arms: ClosedLoopArm[]
  /** Paired over seeds where both arms completed. */
  pairs: number
  distancePct: Summary
  peakHazardAbs: Summary
  peakHazardPct: Summary
  replansAbs: Summary
  hazardsOnRouteAbs: Summary
  peakHazardWins: { wins: number; ties: number; losses: number; n: number }
}

export interface ClosedLoopResult {
  scenarios: ClosedLoopScenario[]
  note: string
}

function summariseArmRuns(
  arm: ClosedLoopArm['arm'],
  riskTolerance: number,
  energyPriority: number,
  runs: readonly MissionRun[],
): ClosedLoopArm {
  const driven = runs.filter(drove)
  const pick = (f: (r: MissionRun) => number) => summarise(driven.map(f))
  const completed = runs.filter((r) => r.outcome === 'complete').length
  return {
    arm,
    riskTolerance,
    energyPriority,
    seeds: runs.length,
    completed,
    failed: runs.filter((r) => r.outcome === 'failed').length,
    unroutable: runs.filter((r) => r.outcome === 'unroutable').length,
    completionRate: runs.length > 0 ? completed / runs.length : NaN,
    distanceM: pick((r) => r.metrics.distanceM),
    energyWh: pick((r) => r.metrics.energyWh),
    replans: pick((r) => r.metrics.replans),
    hazardsDiscovered: pick((r) => r.metrics.hazardsDiscovered),
    hazardsOnRoute: pick((r) => r.metrics.hazardsOnRoute),
    peakHazardTraversed: pick((r) => r.metrics.peakHazardTraversed),
    planCount: pick((r) => r.metrics.planCount),
    interventions: pick((r) => r.metrics.interventions),
  }
}

function runArm(scenario: Scenario, seeds: readonly number[], over: Partial<MissionConfig>) {
  return seeds.map((seed) => runMission(configFor(scenario, { seed, ...over })))
}

export function runClosedLoop(seedCount: number): ClosedLoopResult {
  const scenarios: ClosedLoopScenario[] = []

  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)
    const riskRuns = runArm(scenario, seeds, {})
    const distRuns = runArm(scenario, seeds, DISTANCE_DOMINANT)

    // Pair only where BOTH completed: a failed mission's distance is the
    // distance driven before it gave up, which is not comparable with a
    // completed traverse's.
    const t: MissionRun[] = []
    const b: MissionRun[] = []
    for (let i = 0; i < seeds.length; i++) {
      const a = riskRuns[i]
      const c = distRuns[i]
      if (a.outcome === 'complete' && c.outcome === 'complete') {
        t.push(a)
        b.push(c)
      }
    }
    const col = (xs: MissionRun[], f: (r: MissionRun) => number) => xs.map(f)
    const refConfig = configFor(scenario)

    scenarios.push({
      scenarioId: scenario.id,
      arms: [
        summariseArmRuns(
          'risk-aware',
          refConfig.riskTolerance,
          refConfig.energyPriority,
          riskRuns,
        ),
        summariseArmRuns(
          'distance-dominant',
          DISTANCE_DOMINANT.riskTolerance ?? 1,
          DISTANCE_DOMINANT.energyPriority ?? 0,
          distRuns,
        ),
      ],
      pairs: t.length,
      distancePct: pairedPercentDelta(
        col(t, (r) => r.metrics.distanceM),
        col(b, (r) => r.metrics.distanceM),
      ),
      peakHazardAbs: pairedDelta(
        col(t, (r) => r.metrics.peakHazardTraversed),
        col(b, (r) => r.metrics.peakHazardTraversed),
      ),
      peakHazardPct: pairedPercentDelta(
        col(t, (r) => r.metrics.peakHazardTraversed),
        col(b, (r) => r.metrics.peakHazardTraversed),
      ),
      replansAbs: pairedDelta(
        col(t, (r) => r.metrics.replans),
        col(b, (r) => r.metrics.replans),
      ),
      hazardsOnRouteAbs: pairedDelta(
        col(t, (r) => r.metrics.hazardsOnRoute),
        col(b, (r) => r.metrics.hazardsOnRoute),
      ),
      peakHazardWins: winRate(
        col(t, (r) => r.metrics.peakHazardTraversed),
        col(b, (r) => r.metrics.peakHazardTraversed),
        1e-9,
      ),
    })
  }

  return {
    scenarios,
    note:
      'The distance-dominant arm is riskTolerance 1.0 / energyPriority 0.0, which is the most ' +
      'distance-heavy setting weightsFor() admits (distance 0.645, slope 0.194, hazard 0.097, ' +
      'energy 0.065). It is NOT distance-only; the engine cannot be configured that way. The ' +
      'strict distance-only baseline is open-loop.',
  }
}
