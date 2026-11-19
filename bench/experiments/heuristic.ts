/**
 * Weighted A*: what inflating the heuristic buys and what it costs.
 *
 * `PlanRequest.heuristicWeight` multiplies an admissible heuristic by w. At
 * w = 1 the search is optimal; above 1 it is w-suboptimal in the worst case
 * and usually much better than that in practice. This experiment measures
 * both halves on the project's own terrain rather than quoting the bound.
 *
 * SUBOPTIMALITY IS MEASURED AGAINST THE UNIFORM-COST ORACLE, not against
 * A* at w = 1. Those two are the same number — that is the admissibility
 * claim — but measuring against the oracle makes this experiment independent
 * of the claim instead of assuming it, so a broken heuristic at w = 1 shows
 * up here as a non-zero suboptimality rather than being silently used as the
 * reference.
 *
 * EXPECT NON-MONOTONICITY. Weighted A* gives no guarantee that a larger w
 * produces a worse route, only that it may; a bigger w changes the expansion
 * order and can stumble onto a better path. The tables report what happened.
 */

import { createSimulation } from '../../src/core/engine'
import { plan, planUniformCost } from '../../src/core/planner'
import { constraintsFor, weightsFor } from '../../src/core/cost'
import type { Cell, MissionConfig } from '../../src/core/types'
import { configFor, HEURISTIC_GRID, SCENARIO_LIST, seedsFor } from '../lib/config'
import { summarise, type Summary } from '../lib/stats'

export interface HeuristicCell {
  scenarioId: string
  heuristicWeight: number
  seeds: number
  routed: number
  nodesExpanded: Summary
  /** Percent above the uniform-cost optimum. Zero at w = 1 iff admissible. */
  suboptimalityPct: Summary
  /** Nodes expanded as a fraction of the uniform-cost search's, in percent. */
  nodesVsOraclePct: Summary
  distanceM: Summary
  peakHazard: Summary
}

export interface HeuristicResult {
  cells: HeuristicCell[]
  oracleNodes: { scenarioId: string; nodesExpanded: Summary }[]
  grid: readonly number[]
}

function legFor(config: MissionConfig): { start: Cell; goal: Cell } {
  const goal = config.waypoints[config.waypoints.length - 1]
  if (!goal) throw new Error('heuristic: scenario has no waypoints')
  return { start: config.start, goal }
}

export function runHeuristicSweep(seedCount: number): HeuristicResult {
  const cells: HeuristicCell[] = []
  const oracleNodes: HeuristicResult['oracleNodes'] = []

  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)

    // Per-seed oracle results, computed once and reused by every w.
    const oracle: ({ cost: number; nodes: number } | null)[] = []
    const requests: ({ req: Parameters<typeof plan>[0]; rover: MissionConfig['rover'] } | null)[] =
      []

    for (const seed of seeds) {
      const config = configFor(scenario, { seed })
      const sim = createSimulation(config)
      const { start, goal } = legFor(config)
      const req = {
        belief: sim.belief,
        start,
        goal,
        weights: weightsFor(config),
        constraints: constraintsFor(config),
      }
      const ucs = planUniformCost(req, config.rover)
      oracle.push(ucs.ok ? { cost: ucs.route.cost.total, nodes: ucs.stats.nodesExpanded } : null)
      requests.push({ req, rover: config.rover })
    }

    oracleNodes.push({
      scenarioId: scenario.id,
      nodesExpanded: summarise(
        oracle.filter((o): o is { cost: number; nodes: number } => o !== null).map((o) => o.nodes),
      ),
    })

    for (const heuristicWeight of HEURISTIC_GRID) {
      const nodes: number[] = []
      const subopt: number[] = []
      const vsOracle: number[] = []
      const dist: number[] = []
      const peak: number[] = []

      for (let i = 0; i < seeds.length; i++) {
        const entry = requests[i]
        const ref = oracle[i]
        if (!entry || !ref) continue
        const r = plan({ ...entry.req, heuristicWeight }, entry.rover)
        if (!r.ok) continue
        nodes.push(r.stats.nodesExpanded)
        subopt.push((r.route.cost.total / ref.cost - 1) * 100)
        vsOracle.push((r.stats.nodesExpanded / ref.nodes) * 100)
        dist.push(r.route.distanceM)
        peak.push(r.route.peakHazard)
      }

      cells.push({
        scenarioId: scenario.id,
        heuristicWeight,
        seeds: seeds.length,
        routed: nodes.length,
        nodesExpanded: summarise(nodes),
        suboptimalityPct: summarise(subopt),
        nodesVsOraclePct: summarise(vsOracle),
        distanceM: summarise(dist),
        peakHazard: summarise(peak),
      })
    }
  }

  return { cells, oracleNodes, grid: HEURISTIC_GRID }
}
