/**
 * The admissibility check, run wider than the unit test runs it.
 *
 * THE CLAIM. `minCostPerCellStep` returns a per-unit-length lower bound on
 * step cost; octile distance is the minimum achievable path length on an
 * 8-connected grid; their product is therefore a lower bound on the cost of
 * any path to the goal, which makes the heuristic admissible — and because
 * the bound is per-unit-length and octile obeys the triangle inequality, it
 * is also consistent. An admissible, consistent heuristic means A* must
 * return exactly the uniform-cost optimum.
 *
 * `src/core/__tests__/planner.test.ts` asserts this over 24 independently
 * generated terrains (it requests 24 and asserts at least 20; seeds 1..24 all
 * yield a routable problem, so the realised N is 24). That is a unit test,
 * and it runs at one preference setting.
 *
 * THIS EXPERIMENT EXISTS TO WIDEN IT IN THE DIRECTION THE PROOF IS WEAKEST.
 * The bound is `w.distance/√2 + w.energy·flat·M/MAXE` — it uses only two of
 * the four weights, and drops slope and hazard entirely. So the heuristic
 * gets relatively weaker as the hazard weight grows, and the setting most
 * likely to expose a subtly inadmissible bound is a LOW risk tolerance, where
 * the hazard weight is twenty-one times its minimum. The unit test runs at
 * riskTolerance 0.55; this runs the same comparison across the whole slider.
 *
 * A failure here is a disagreement in cost, reported as the worst absolute
 * and relative gap seen. Dijkstra cannot be wrong about optimality, so any
 * gap is A*'s.
 */

import { constraintsFor, weightsFor } from '../../src/core/cost'
import { plan, planUniformCost } from '../../src/core/planner'
import { DEFAULT_ROVER, SCENARIOS } from '../../src/core/scenarios'
import { createBelief, generateTerrain, idx } from '../../src/core/terrain'
import type { Belief, Cell, MissionConfig, TerrainParams } from '../../src/core/types'
import { summarise, type Summary } from '../lib/stats'

/** Matches the unit test's terrain so the two are measuring the same family. */
const VARIED: TerrainParams = {
  octaves: 4,
  relief: 45,
  craters: 9,
  orbitalVisibility: 0.6,
  hiddenHazardDensity: 0.15,
  rubbleFields: 7,
}
const SIZE = 48

/** Risk tolerances swept. 0.05 drives the hazard weight to near its maximum. */
const RISK_LEVELS = [0.05, 0.25, 0.55, 0.85] as const

export interface AdmissibilityCell {
  riskTolerance: number
  /** Terrains attempted. */
  attempted: number
  /** Terrains where both searches found a route and could be compared. */
  compared: number
  /** Worst |A* cost - oracle cost| seen. Admissible iff this is ~0. */
  maxAbsGap: number
  /** Worst (A* - oracle)/oracle, in percent. */
  maxRelGapPct: number
  /** Count of terrains where A* was strictly worse than the oracle. */
  violations: number
  /** Nodes expanded by A* as a percentage of the oracle's. */
  nodesVsOraclePct: Summary
  /** Terrains where A* expanded strictly fewer nodes than the oracle. */
  aStarWins: number
}

export interface AdmissibilityResult {
  cells: AdmissibilityCell[]
  terrainsPerCell: number
  /** The tolerance used for an equality claim, matching the unit test's. */
  tolerance: number
  pass: boolean
  /** The realised N of the unit test, stated so the doc can quote it. */
  unitTestN: number
}

/** Equality tolerance: the unit test's 1e-9 absolute, on totals of order 10-50. */
const EQUALITY_TOLERANCE = 1e-9

function nearestPassable(b: Belief, near: Cell, maxSlope: number, maxHaz: number): Cell | null {
  let best: Cell | null = null
  let bestD = Infinity
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const i = idx(b.width, x, y)
      if (b.hazard[i] > maxHaz || b.slopeDeg[i] > maxSlope) continue
      const d = (x - near.x) ** 2 + (y - near.y) ** 2
      if (d < bestD) {
        bestD = d
        best = { x, y }
      }
    }
  }
  return best
}

function probeConfig(riskTolerance: number): MissionConfig {
  return {
    scenarioId: SCENARIOS[0].id,
    seed: 1,
    start: { x: 0, y: 0 },
    waypoints: [],
    riskTolerance,
    energyPriority: 0.45,
    batteryReserveFrac: 0.15,
    maxSlopeDeg: 25,
    autonomyLevel: 'autonomous',
    rover: DEFAULT_ROVER,
  }
}

export function runAdmissibility(terrainsPerCell: number): AdmissibilityResult {
  const cells: AdmissibilityCell[] = []
  let pass = true

  for (const riskTolerance of RISK_LEVELS) {
    const config = probeConfig(riskTolerance)
    const weights = weightsFor(config)
    const constraints = constraintsFor(config)

    let compared = 0
    let attempted = 0
    let maxAbsGap = 0
    let maxRelGapPct = 0
    let violations = 0
    let aStarWins = 0
    const nodesRatio: number[] = []

    for (let seed = 1; compared < terrainsPerCell && seed < terrainsPerCell * 8; seed++) {
      attempted++
      const terrain = generateTerrain(VARIED, SIZE, SIZE, seed)
      const belief = createBelief(terrain)
      const start = nearestPassable(belief, { x: 4, y: 4 }, constraints.maxSlopeDeg, constraints.maxHazard)
      const goal = nearestPassable(
        belief,
        { x: SIZE - 5, y: SIZE - 5 },
        constraints.maxSlopeDeg,
        constraints.maxHazard,
      )
      if (!start || !goal) continue
      const req = { belief, start, goal, weights, constraints }
      const a = plan(req, DEFAULT_ROVER)
      const d = planUniformCost(req, DEFAULT_ROVER)
      if (!a.ok || !d.ok) continue

      compared++
      const gap = a.route.cost.total - d.route.cost.total
      const abs = Math.abs(gap)
      if (abs > maxAbsGap) maxAbsGap = abs
      const rel = (abs / Math.max(1e-12, d.route.cost.total)) * 100
      if (rel > maxRelGapPct) maxRelGapPct = rel
      if (gap > EQUALITY_TOLERANCE) violations++
      nodesRatio.push((a.stats.nodesExpanded / Math.max(1, d.stats.nodesExpanded)) * 100)
      if (a.stats.nodesExpanded < d.stats.nodesExpanded) aStarWins++
    }

    if (maxAbsGap > EQUALITY_TOLERANCE) pass = false

    cells.push({
      riskTolerance,
      attempted,
      compared,
      maxAbsGap,
      maxRelGapPct,
      violations,
      nodesVsOraclePct: summarise(nodesRatio),
      aStarWins,
    })
  }

  return { cells, terrainsPerCell, tolerance: EQUALITY_TOLERANCE, pass, unitTestN: 24 }
}
