/**
 * Pre-launch route preview.
 *
 * WHY THIS IS NOT IN A COMPONENT: moving the risk slider has to visibly move
 * the previewed line, and the only honest way to do that is to run the real
 * planner against the real pre-launch belief. That is engine orchestration,
 * so it lives next to the store rather than inside a view. Nothing here
 * computes a route property itself — every number is read off the `Route`
 * objects the planner returned, or summed across them.
 *
 * WHY IT PLANS LEG BY LEG: a mission is start -> wp0 -> wp1 -> ..., and the
 * engine drives it that way. Planning the whole chain as one search would
 * preview a route the rover will never take.
 */

import { plan } from '@/core/planner'
import { weightsFor, constraintsFor, routeStats } from '@/core/cost'
import { generateTerrain, createBelief } from '@/core/terrain'
import { getScenario } from '@/core/scenarios'
import type {
  Belief,
  Cell,
  CostBreakdown,
  MissionConfig,
  PlanFailure,
  PlanResult,
  Route,
  Terrain,
} from '@/core/types'

export interface PreviewLeg {
  from: Cell
  to: Cell
  /** Index into `config.waypoints` that this leg terminates at. */
  waypointIndex: number
  result: PlanResult
}

export interface RoutePreview {
  /** True only when every leg planned successfully. */
  ok: boolean
  legs: PreviewLeg[]
  /** Concatenated cells with the shared cell at each join dropped once. */
  cells: Cell[]
  /**
   * The concatenated cells scored as one route by the engine's own
   * `routeStats`, so the map can draw a real `Route` rather than a line the
   * app invented. Null when no leg planned, or when scoring the join failed.
   */
  fullRoute: Route | null
  /** Summed per-term cost across legs. Totals, not averages. */
  cost: CostBreakdown
  distanceM: number
  energyWh: number
  /** Worst value across legs, not a mean — a preview must not smooth a spike. */
  peakHazard: number
  peakSlopeDeg: number
  /** Search effort, so the UI can be honest about what the preview cost. */
  nodesExpanded: number
  elapsedMs: number
  /** The first leg that failed, which is where the preview line stops. */
  failure: { waypointIndex: number; from: Cell; to: Cell; reason: PlanFailure } | null
}

// ---------------------------------------------------------------------------
// Belief cache
// ---------------------------------------------------------------------------

/**
 * Terrain generation is the expensive part of a preview and depends only on
 * (scenario, seed), while the sliders change every keystroke. Caching the
 * pre-launch belief turns a slider drag into pure search.
 *
 * The cache is tiny and bounded: a user flips between three scenarios, not
 * three hundred, and an unbounded map of Float32Arrays is a real leak.
 */
const MAX_CACHED = 4
const beliefCache = new Map<string, { terrain: Terrain; belief: Belief }>()

function cacheKey(scenarioId: string, seed: number): string {
  return `${scenarioId}:${seed}`
}

/**
 * The belief a mission starts from: orbital hazard everywhere, nothing
 * observed. This is deliberately NOT the live mission belief — a preview is
 * what the operator can know before launch.
 */
export function getInitialBelief(
  scenarioId: string,
  seed: number,
): { terrain: Terrain; belief: Belief } | null {
  const key = cacheKey(scenarioId, seed)
  const hit = beliefCache.get(key)
  if (hit) return hit
  let scenario
  try {
    scenario = getScenario(scenarioId)
  } catch {
    // `getScenario` throws on an unknown id; a stale saved config must not
    // take the planner view down with it.
    return null
  }
  const terrain = generateTerrain(scenario.terrain, scenario.width, scenario.height, seed)
  const belief = createBelief(terrain)
  const entry = { terrain, belief }
  beliefCache.set(key, entry)
  if (beliefCache.size > MAX_CACHED) {
    const oldest = beliefCache.keys().next().value
    if (oldest !== undefined) beliefCache.delete(oldest)
  }
  return entry
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

const ZERO_COST: CostBreakdown = { distance: 0, slope: 0, hazard: 0, energy: 0, total: 0 }

function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    distance: a.distance + b.distance,
    slope: a.slope + b.slope,
    hazard: a.hazard + b.hazard,
    energy: a.energy + b.energy,
    total: a.total + b.total,
  }
}

/**
 * Plan every leg of the configured mission against the pre-launch belief.
 *
 * Returns null when there is nothing to preview (no waypoints, or a scenario
 * id the engine does not know). A failed leg is NOT null — it is a preview
 * with `ok: false` and a reason, because showing the operator where the route
 * died is the point.
 */
export function computePreview(config: MissionConfig): RoutePreview | null {
  if (config.waypoints.length === 0) return null
  const env = getInitialBelief(config.scenarioId, config.seed)
  if (!env) return null

  const weights = weightsFor(config)
  const constraints = constraintsFor(config)

  const legs: PreviewLeg[] = []
  const cells: Cell[] = []
  let cost = ZERO_COST
  let distanceM = 0
  let energyWh = 0
  let peakHazard = 0
  let peakSlopeDeg = 0
  let nodesExpanded = 0
  let elapsedMs = 0
  let failure: RoutePreview['failure'] = null

  let from = config.start
  for (let i = 0; i < config.waypoints.length; i++) {
    const to = config.waypoints[i]
    const result = plan({ belief: env.belief, start: from, goal: to, weights, constraints })
    legs.push({ from, to, waypointIndex: i, result })
    nodesExpanded += result.stats.nodesExpanded
    elapsedMs += result.stats.elapsedMs

    if (!result.ok) {
      // Stop at the first failure: legs after an unreachable waypoint would be
      // planned from a position the rover can never be in.
      failure = { waypointIndex: i, from, to, reason: result.reason }
      break
    }

    const route: Route = result.route
    appendRoute(cells, route.cells)
    cost = addCost(cost, route.cost)
    distanceM += route.distanceM
    energyWh += route.energyWh
    peakHazard = Math.max(peakHazard, route.peakHazard)
    peakSlopeDeg = Math.max(peakSlopeDeg, route.peakSlopeDeg)
    from = to
  }

  // Score the concatenation with the engine rather than stitching numbers
  // together, so what the map draws is a Route the cost model agrees with.
  let fullRoute: Route | null = null
  if (cells.length > 1) {
    try {
      fullRoute = routeStats(env.belief, cells, weights, constraints, config.rover)
    } catch {
      fullRoute = null
    }
  }

  return {
    ok: failure === null,
    legs,
    cells,
    fullRoute,
    cost,
    distanceM,
    energyWh,
    peakHazard,
    peakSlopeDeg,
    nodesExpanded,
    elapsedMs,
    failure,
  }
}

/** Routes are inclusive of both endpoints, so the join cell would double up. */
function appendRoute(into: Cell[], add: Cell[]): void {
  if (add.length === 0) return
  const start = into.length === 0 ? 0 : 1
  for (let i = start; i < add.length; i++) into.push(add[i])
}

/** Human-readable reason a leg could not be planned. */
export function planFailureMessage(reason: PlanFailure): string {
  switch (reason) {
    case 'goal-unreachable':
      return 'No route reaches this waypoint under the current constraints.'
    case 'goal-impassable':
      return 'The waypoint itself is on terrain the rover cannot occupy.'
    case 'start-impassable':
      return 'The start position is on terrain the rover cannot occupy.'
    case 'search-exhausted':
      return 'The search ran out of reachable cells before finding the waypoint.'
    default: {
      // Exhaustiveness: a new PlanFailure must be given prose, not a code.
      const never: never = reason
      return never
    }
  }
}
