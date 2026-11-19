/**
 * The cost model: what it costs the rover to move one cell, and what a whole
 * route costs.
 *
 * DESIGN PRINCIPLE — EVERY TERM IS NORMALISED TO ROUGHLY [0, 1].
 * The four weights are only comparable to each other if the quantities they
 * multiply are on the same scale. A raw step is 4 or 5.66 metres, a slope is
 * 0..90 degrees, hazard is 0..1 and energy is a couple of watt-hours; summing
 * those with weights would mean the weights silently encode unit conversions,
 * and moving a slider would do something unpredictable. So each term is
 * divided by the largest value it can legally take:
 *
 *   distance : L / √2                      L ∈ {1, √2} cell-lengths  → [0.707, 1]
 *   slope    : slopeDeg(to) / maxSlopeDeg  constraint-bounded        → [0, 1]
 *   hazard   : hazard(to)                  already 0..1              → [0, 1]
 *   energy   : stepEnergyWh / MAX_STEP_WH  MAX = diagonal at max slope → [0, 1]
 *
 * Because `weightsFor` also normalises the four weights to sum to 1, a single
 * step costs at most ~1 and a route's total cost is comparable across
 * different preference settings — which is what lets the engine pick the
 * argmin across candidates planned under different weights.
 */

import type {
  Belief,
  Cell,
  Constraints,
  CostBreakdown,
  CostWeights,
  MissionConfig,
  Route,
  RoverSpec,
} from './types'
import { METRES_PER_CELL } from './types'
import { idx, inBounds } from './terrain'

const SQRT2 = Math.SQRT2
const DEG = 180 / Math.PI

// ---------------------------------------------------------------------------
// Preference mapping
// ---------------------------------------------------------------------------

/**
 * Raw (pre-normalisation) weight shapes.
 *
 * `riskTolerance` falling has to be able to CHANGE the chosen route, not just
 * nudge its cost, so the hazard weight is quadratic in (1 - riskTolerance):
 * it spans 0.15 at full tolerance to 3.15 at zero, a factor of twenty-one.
 * Distance is held at a constant 1.0 and therefore gives way automatically as
 * the others grow, because everything is renormalised to sum to 1.
 */
const HAZARD_W_BASE = 0.15
const HAZARD_W_SPAN = 3.0
const ENERGY_W_BASE = 0.1
const ENERGY_W_SPAN = 1.6
/** Energy priority also buys slope aversion: climbing is where energy goes. */
const SLOPE_W_BASE = 0.3
const SLOPE_W_SPAN = 0.5
const DISTANCE_W = 1.0

export function weightsFor(config: MissionConfig): CostWeights {
  const risk = clamp01(config.riskTolerance)
  const energyPriority = clamp01(config.energyPriority)

  const hazard = HAZARD_W_BASE + HAZARD_W_SPAN * (1 - risk) ** 2
  // Exponent 1.5, intended so the first half of the slider does comparatively
  // little and the top end is decisive — the same shape as the hazard curve,
  //
  // MEASURED, AND IT DOES NOT BEHAVE THAT WAY. Sweeping energyPriority
  // 0.0 / 0.5 / 1.0 through the real planner moves the route by 482/482/482 m
  // on baseline-traverse (inert outright), 336/349/349 on dynamic-hazard and
  // 531/534/534 on competing-objectives — so it is the TOP half that is inert,
  // which is the opposite of the intent above.
  //
  // The cause is physical rather than a wiring fault: net elevation change is
  // fixed by the endpoints, and the climb term is only 12-19% of a route's
  // total energy, so weighting energy harder has very little left to trade
  // against. Raising the weight further would start distorting the route for a
  // median saving measured at 0.2-0.5%. Documented in docs/RESEARCH.md rather
  // than tuned away; a genuine fix needs an energy model with something
  // route-dependent in it (slip, thermal, solar incidence), not a new exponent.
  // which keeps the two sliders feeling alike.
  const energy = ENERGY_W_BASE + ENERGY_W_SPAN * energyPriority ** 1.5
  const slope = SLOPE_W_BASE + SLOPE_W_SPAN * energyPriority
  const distance = DISTANCE_W

  const sum = hazard + energy + slope + distance
  return {
    distance: distance / sum,
    slope: slope / sum,
    hazard: hazard / sum,
    energy: energy / sum,
  }
}

/**
 * Hard constraints from the mission config.
 *
 * maxHazard = 0.15 + 0.80 * riskTolerance
 *
 *   riskTolerance 0.0 → 0.15  only near-pristine ground is passable
 *   riskTolerance 0.5 → 0.55  most terrain passable, dense rubble is not
 *   riskTolerance 1.0 → 0.95  everything short of impassable rubble
 *
 * The floor of 0.15 stops a zero-tolerance mission from being trivially
 * unroutable on terrain with any slope-correlated instability at all, and the
 * ceiling of 0.95 preserves the type's own promise that hazard 1.0 means
 * impassable rubble no matter what the human asked for.
 *
 * NOTE the deliberate gap between this and `riskTolerance` itself: for any
 * tolerance below 0.75 there is a band of hazard that is *legal* but above the
 * stated preference. The engine treats a route in that band as grounds for a
 * `risk-exceeds-tolerance` intervention — legal, but worth a human glance.
 */
export const MAX_HAZARD_FLOOR = 0.15
export const MAX_HAZARD_SPAN = 0.8

export function constraintsFor(config: MissionConfig): Constraints {
  return {
    maxSlopeDeg: config.maxSlopeDeg,
    maxHazard: MAX_HAZARD_FLOOR + MAX_HAZARD_SPAN * clamp01(config.riskTolerance),
    batteryReserveFrac: config.batteryReserveFrac,
  }
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

/**
 * Watt-hours to drive `metres` while climbing `uphillDeg`.
 *
 * Downhill is modelled as flat rather than regenerative: a rover brakes
 * downhill, it does not recover energy, and over-crediting descent would let
 * the planner propose routes that gain free range by going over a ridge.
 */
export function stepEnergyWh(metres: number, uphillDeg: number, rover: RoverSpec): number {
  const climb = uphillDeg > 0 ? uphillDeg : 0
  return rover.flatWhPerM * metres + rover.climbWhPerMPerDeg * metres * climb
}

/**
 * The most expensive legal single step: a diagonal taken at the hard slope
 * limit. Used as the energy term's normaliser, which is what puts that term
 * on the same [0, 1] scale as the other three.
 */
export function maxStepEnergyWh(c: Constraints, rover: RoverSpec): number {
  const metres = SQRT2 * METRES_PER_CELL
  // Guard against a degenerate config where the normaliser would be zero and
  // every energy term would come out NaN.
  return Math.max(1e-9, stepEnergyWh(metres, c.maxSlopeDeg, rover))
}

// ---------------------------------------------------------------------------
// Step cost
// ---------------------------------------------------------------------------

/** Is this cell somewhere the rover is allowed to be at all? */
export function passable(belief: Belief, c: Constraints, x: number, y: number): boolean {
  if (!inBounds(belief.width, belief.height, x, y)) return false
  const i = idx(belief.width, x, y)
  if (belief.slopeDeg[i] > c.maxSlopeDeg) return false
  if (belief.hazard[i] > c.maxHazard) return false
  return true
}

/**
 * The cost terms of a step, computed WITHOUT the legality gate.
 *
 * Exists separately from `stepCost` so that `routeStats` can price a path it
 * did not plan — for example a route planned under tighter constraints being
 * re-costed, or a path supplied by a test. `stepCost` is this plus the gate.
 */
function stepTerms(
  belief: Belief,
  from: Cell,
  to: Cell,
  w: CostWeights,
  c: Constraints,
  rover: RoverSpec,
): CostBreakdown {
  const iFrom = idx(belief.width, from.x, from.y)
  const iTo = idx(belief.width, to.x, to.y)

  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthCells = dx !== 0 && dy !== 0 ? SQRT2 : 1
  const metres = lengthCells * METRES_PER_CELL

  const dz = belief.elevation[iTo] - belief.elevation[iFrom]
  const uphillDeg = dz > 0 ? Math.atan2(dz, metres) * DEG : 0
  const energyWh = stepEnergyWh(metres, uphillDeg, rover)

  // Each term is weight x normalised quantity; the fields of a CostBreakdown
  // are therefore already-weighted contributions, which is what makes `total`
  // a plain sum and makes route breakdowns additive.
  const distance = w.distance * (lengthCells / SQRT2)
  const slope = w.slope * (belief.slopeDeg[iTo] / Math.max(1e-9, c.maxSlopeDeg))
  const hazard = w.hazard * belief.hazard[iTo]
  const energy = w.energy * (energyWh / maxStepEnergyWh(c, rover))

  return { distance, slope, hazard, energy, total: distance + slope + hazard + energy }
}

/**
 * Cost of stepping `from` → `to`, or `null` when the step is not allowed.
 *
 * Null means impassable, and the planner treats it as the absence of an edge.
 * Only `to` is gated on slope and hazard: the rover is already standing on
 * `from`, and refusing to let it leave a cell it has discovered to be awful
 * would strand it there.
 */
export function stepCost(
  belief: Belief,
  from: Cell,
  to: Cell,
  w: CostWeights,
  c: Constraints,
  rover: RoverSpec,
): CostBreakdown | null {
  if (!inBounds(belief.width, belief.height, from.x, from.y)) return null
  if (!inBounds(belief.width, belief.height, to.x, to.y)) return null
  const iTo = idx(belief.width, to.x, to.y)
  if (belief.slopeDeg[iTo] > c.maxSlopeDeg) return null
  if (belief.hazard[iTo] > c.maxHazard) return null
  return stepTerms(belief, from, to, w, c, rover)
}

/**
 * A provable lower bound on the cost of moving ONE CELL-LENGTH.
 *
 * DERIVATION. For a step of length L cell-lengths:
 *
 *   distance term = w.distance * L / √2                       exactly linear in L
 *   slope term    = w.slope * slope(to)/maxSlope      >= 0
 *   hazard term   = w.hazard * hazard(to)             >= 0
 *   energy term   = w.energy * (flat*L*M + climb*L*M*up) / MAXE
 *                 >= w.energy * flat * L * M / MAXE           uphill >= 0, linear in L
 *
 * so stepCost >= L * ( w.distance/√2 + w.energy*flat*M/MAXE ), i.e. the cost
 * of a step is at least this constant times its length.
 *
 * Octile distance is the minimum achievable path LENGTH in cell-lengths on an
 * 8-connected grid, so (octile x this constant) is a lower bound on the cost
 * of any path to the goal — which makes the A* heuristic admissible, and the
 * uniform-cost oracle test asserts exactly that.
 *
 * It is also consistent: the bound is per-unit-length and octile satisfies the
 * triangle inequality, so no node is ever re-expanded with a better g.
 */
export function minCostPerCellStep(w: CostWeights, rover: RoverSpec, c?: Constraints): number {
  // Constraints only enter through the energy normaliser. When the caller has
  // none (the heuristic is scaled before a search is set up), fall back to the
  // most permissive slope limit, which makes MAXE largest and the bound
  // smallest — i.e. still admissible, just looser.
  const constraints: Constraints = c ?? {
    maxSlopeDeg: 90,
    maxHazard: 1,
    batteryReserveFrac: 0,
  }
  const flatStepWh = rover.flatWhPerM * METRES_PER_CELL
  const energyFloor = (w.energy * flatStepWh) / maxStepEnergyWh(constraints, rover)
  return w.distance / SQRT2 + energyFloor
}

// ---------------------------------------------------------------------------
// Whole routes
// ---------------------------------------------------------------------------

/**
 * Price a path and derive its physical statistics.
 *
 * The cost is summed in path order with the same per-step arithmetic the
 * planner's g-score uses, so `routeStats(path).cost.total` is bit-identical to
 * the g-score A* arrived at. That identity is what lets the planner return a
 * fully-populated Route without carrying four extra Float64Arrays through the
 * search.
 *
 * `meanHazard` is weighted by step length, so a long diagonal through bad
 * ground counts for more than a short orthogonal one — otherwise a route could
 * lower its mean simply by taking more, shorter steps.
 */
export function routeStats(
  belief: Belief,
  cells: Cell[],
  w: CostWeights,
  c: Constraints,
  rover: RoverSpec,
): Route {
  const cost: CostBreakdown = { distance: 0, slope: 0, hazard: 0, energy: 0, total: 0 }
  let distanceM = 0
  let energyWh = 0
  let peakHazard = 0
  let peakSlopeDeg = 0
  let hazardLengthSum = 0
  let lengthSum = 0

  if (cells.length > 0) {
    const i0 = idx(belief.width, cells[0].x, cells[0].y)
    peakHazard = belief.hazard[i0]
    peakSlopeDeg = belief.slopeDeg[i0]
  }

  for (let k = 1; k < cells.length; k++) {
    const from = cells[k - 1]
    const to = cells[k]
    const terms = stepTerms(belief, from, to, w, c, rover)
    cost.distance += terms.distance
    cost.slope += terms.slope
    cost.hazard += terms.hazard
    cost.energy += terms.energy
    cost.total += terms.total

    const lengthCells = from.x !== to.x && from.y !== to.y ? SQRT2 : 1
    const metres = lengthCells * METRES_PER_CELL
    distanceM += metres

    const iFrom = idx(belief.width, from.x, from.y)
    const iTo = idx(belief.width, to.x, to.y)
    const dz = belief.elevation[iTo] - belief.elevation[iFrom]
    const uphillDeg = dz > 0 ? Math.atan2(dz, metres) * DEG : 0
    energyWh += stepEnergyWh(metres, uphillDeg, rover)

    const hz = belief.hazard[iTo]
    if (hz > peakHazard) peakHazard = hz
    const sl = belief.slopeDeg[iTo]
    if (sl > peakSlopeDeg) peakSlopeDeg = sl
    hazardLengthSum += hz * lengthCells
    lengthSum += lengthCells
  }

  // A single-cell "route" (start === goal) has no steps; its mean hazard is
  // the hazard of the one cell it occupies, not a division by zero.
  const meanHazard =
    lengthSum > 0 ? hazardLengthSum / lengthSum : cells.length > 0 ? peakHazard : 0

  return { cells, cost, distanceM, energyWh, peakHazard, meanHazard, peakSlopeDeg }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
