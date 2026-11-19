/**
 * The simulation loop: sensing, replanning, driving, and human-in-the-loop.
 *
 * THE CENTRAL ARRANGEMENT. The planner plans against `state.belief`; the
 * driving and sensing code advances against `state.terrain`. Nothing here ever
 * shows the planner ground truth. A replan happens because `observe()`
 * reported that a cell the rover is about to drive over is worse than the
 * orbital survey claimed — never because a script said so at tick 300.
 *
 * PURITY AND COPY-ON-WRITE. `step()` must not mutate its argument, and the
 * state contains four typed arrays that are expensive to clone. The approach:
 *
 *   - `terrain` is shared by reference. Nothing ever writes to it.
 *   - `belief` is shared by reference UNTIL a sensor sweep would actually
 *     change something, at which point it is cloned (and only `observed` and
 *     `hazard` are copied — `slopeDeg` and `elevation` have no writer, see
 *     `cloneBelief`). At 0.8 m/s over 4 m cells the rover's cell changes about
 *     every fourth tick, so most ticks skip the copy entirely.
 *   - Every array field (`events`, `decisions`, `trail`, …) is COPY-ON-APPEND:
 *     the helpers below replace the draft's reference with a new array rather
 *     than pushing into the one the caller owns.
 *   - `rover` is a fresh object every tick, with fresh `pos` and `cell`.
 *   - `Route` objects are immutable once built; replacing a route assigns a
 *     new object, so sharing the reference is safe.
 *
 * Internally a `step()` builds a DRAFT — a new SimState whose arrays start out
 * aliased to the previous one — and the private helpers in this file are
 * permitted to mutate THAT, because by construction nothing reachable from it
 * is also reachable from the caller's state unless it is immutable.
 */

import type {
  Cell,
  DecisionRecord,
  InterventionAction,
  InterventionOption,
  InterventionReason,
  InterventionRequest,
  MissionConfig,
  MissionMetrics,
  MissionOutcome,
  MissionRecord,
  Route,
  RouteCandidate,
  SimEvent,
  SimState,
  Constraints,
  CostWeights,
} from './types'
import { METRES_PER_CELL, TICK_SECONDS } from './types'
import { constraintsFor, routeStats, stepEnergyWh, weightsFor } from './cost'
import { plan } from './planner'
import { summariseRisk } from './explain'
import { getScenario } from './scenarios'
import {
  applyObservation,
  cloneBelief,
  createBelief,
  deltaIsEmpty,
  generateTerrain,
  idx,
  observationDelta,
  observedFraction,
} from './terrain'

const SQRT2 = Math.SQRT2
const DEG = 180 / Math.PI

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * A believed-hazard rise smaller than this on a route cell is not treated as a
 * discovery. Without it the rover would replan on essentially every tick while
 * crossing a concealment patch, because each sweep nudges dozens of cells by a
 * few thousandths and every one of them is technically "a hazard discovered on
 * the route".
 */
const MATERIAL_HAZARD_RISE = 0.05

/** Replans for one waypoint before a supervised mission asks for help. */
const REPEATED_REPLAN_LIMIT = 4

/**
 * How much the hazard term is charged for exceeding the STATED risk tolerance,
 * per cell-length of route, when choosing between candidates.
 *
 * WHY A SEPARATE SELECTION SCORE EXISTS. Every candidate route is re-costed in
 * one common currency (the mission's own weights) so the numbers are
 * comparable — but then the "current preferences" candidate is by construction
 * the argmin, because A* already returned the optimum under exactly those
 * weights, and the comparison would be theatre.
 *
 * The tie is broken by something A* CANNOT optimise: `peakHazard` is a maximum
 * over the path, not a sum over steps, so no shortest-path search can minimise
 * it as part of its objective. Charging for peak exceedance therefore makes
 * the contest real — a risk-averse candidate can and does win when the cheap
 * route's worst cell is above what the operator said they would accept.
 *
 * `riskTolerance` (a preference) sits below `maxHazard` (a hard limit) for any
 * tolerance under 0.75, and this penalty is what gives that gap teeth.
 */
const PEAK_EXCEEDANCE_PENALTY = 0.6

/** Slowest the rover goes on ground at the slope limit, as a fraction of top speed. */
const MIN_SPEED_FRACTION = 0.4
const SLOPE_SLOWDOWN = 1 - MIN_SPEED_FRACTION

/** Guard for `runToCompletion` and `replay`; generous enough that no healthy
 *  mission reaches it, finite so a pathological one still terminates. */
const DEFAULT_MAX_TICKS = 20000

// ---------------------------------------------------------------------------
// Planner timing side-table
// ---------------------------------------------------------------------------

interface PlanAccum {
  ms: number
  count: number
}

/**
 * Cumulative planner wall-clock, kept OUT of `SimState`.
 *
 * `SimState` has no field for it and `types.ts` is frozen, but more
 * importantly `elapsedMs` is the one non-deterministic quantity in the system
 * and putting it in the serializable state would make two identical runs
 * produce different records. A WeakMap keyed on the state object keeps it
 * available to `computeMetrics` without polluting what gets exported — and
 * because the key is the state object itself, nothing is mutated and `step()`
 * stays pure.
 */
const planAccum = new WeakMap<SimState, PlanAccum>()

function accumOf(state: SimState): PlanAccum {
  return planAccum.get(state) ?? { ms: 0, count: 0 }
}

// ---------------------------------------------------------------------------
// Draft helpers — these mutate a draft the caller created, never a shared state
// ---------------------------------------------------------------------------

function appendEvent(d: SimState, e: SimEvent): void {
  d.events = [...d.events, e]
}

function appendDecision(d: SimState, rec: DecisionRecord): void {
  d.decisions = [...d.decisions, rec]
}

function draftFrom(state: SimState, advanceTick: boolean): SimState {
  const tick = advanceTick ? state.tick + 1 : state.tick
  return {
    ...state,
    tick,
    elapsedS: tick * TICK_SECONDS,
    rover: {
      ...state.rover,
      pos: { ...state.rover.pos },
      cell: { ...state.rover.cell },
    },
  }
}

/** True when nothing further should happen this tick. */
function halted(d: SimState): boolean {
  return d.outcome !== null || d.pendingIntervention !== null
}

function nextId(prefix: string, d: SimState, n: number): string {
  // Ids are derived from tick and a counter rather than a random source, so
  // two runs of the same mission produce the same ids and records diff cleanly.
  return `${prefix}-${d.tick}-${n}`
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createSimulation(config: MissionConfig): SimState {
  const scenario = getScenario(config.scenarioId)
  const terrain = generateTerrain(scenario.terrain, scenario.width, scenario.height, config.seed)
  const belief = createBelief(terrain)
  // The rover can see its own surroundings before it has moved, so the initial
  // plan is made with one sweep already folded in rather than from pure orbit.
  applyObservation(belief, observationDelta(belief, terrain, config.start, config.rover.sensorRangeCells))

  const constraints = constraintsFor(config)

  const state: SimState = {
    tick: 0,
    elapsedS: 0,
    config,
    terrain,
    belief,
    rover: {
      mode: 'planning',
      pos: { x: config.start.x, y: config.start.y },
      cell: { x: config.start.x, y: config.start.y },
      heading: 0,
      battery: 1,
      odometerM: 0,
      energyUsedWh: 0,
      waypointIndex: 0,
      route: null,
      routeProgress: 0,
    },
    events: [{ type: 'mission-started', tick: 0 }],
    decisions: [],
    pendingIntervention: null,
    resolutions: [],
    abandonedRoutes: [],
    trail: [{ x: config.start.x, y: config.start.y }],
    replanCount: 0,
    effectiveMaxHazard: constraints.maxHazard,
    outcome: null,
  }

  // The first plan happens at tick 0 so the UI has a route to draw before the
  // clock starts, and so a mission that is unroutable from the outset says so
  // immediately rather than after a wasted tick.
  const acc: PlanAccum = { ms: 0, count: 0 }
  planLeg(state, acc, 'initial-plan', 'mission start')
  planAccum.set(state, acc)
  return state
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by one tick. Pure: the argument is never mutated.
 *
 * Returning the IDENTICAL object (rather than a copy) when nothing can happen
 * is deliberate — it gives `runToCompletion` and `replay` a cheap, unambiguous
 * "this is wedged, stop looping" signal, and it is what guarantees they
 * terminate when a supervised mission is waiting for a human who will never
 * arrive.
 */
export function step(state: SimState): SimState {
  if (state.outcome !== null) return state
  // NEVER BLOCK: a pending intervention makes the tick a no-op and the
  // simulation resumes through resolveIntervention(). Awaiting a human inside
  // the loop would make the engine impossible to replay or run headless.
  if (state.pendingIntervention !== null) return state

  const d = draftFrom(state, true)
  const acc: PlanAccum = { ms: 0, count: 0 }

  senseAndMaybeReplan(d, acc)

  // A rover with no route and no reason to stop should be trying to get one;
  // this covers resuming after a failed plan in autonomous mode.
  if (!halted(d) && d.rover.route === null) {
    planLeg(d, acc, 'replan', 'no active route')
  }

  if (!halted(d)) driveTick(d, acc)
  if (!halted(d)) checkBattery(d, acc)

  planAccum.set(d, { ms: accumOf(state).ms + acc.ms, count: accumOf(state).count + acc.count })
  return d
}

/**
 * Step 2 and 3 of the tick: sweep the sensors, report discoveries, and decide
 * whether what was found invalidates the route being driven.
 */
function senseAndMaybeReplan(d: SimState, acc: PlanAccum): void {
  const range = d.config.rover.sensorRangeCells
  const delta = observationDelta(d.belief, d.terrain, d.rover.cell, range)
  if (deltaIsEmpty(delta)) return

  // Copy-on-write: only now is cloning the belief worth paying for.
  const nextBelief = cloneBelief(d.belief)
  applyObservation(nextBelief, delta)
  d.belief = nextBelief

  const remaining = remainingRouteCells(d)
  const remainingSet = new Set(remaining.map((c) => idx(d.belief.width, c.x, c.y)))

  let materialOnRoute: { cell: Cell; severity: number } | null = null
  for (const r of delta.raised) {
    const onRoute = remainingSet.has(r.index)
    appendEvent(d, {
      type: 'hazard-discovered',
      tick: d.tick,
      cell: r.cell,
      severity: r.severity,
      onRoute,
    })
    if (!onRoute) continue
    const rise = r.severity - r.previous
    const blocks = r.severity > d.effectiveMaxHazard
    if (!blocks && rise < MATERIAL_HAZARD_RISE) continue
    // Keep the worst one; it is the one worth naming in the trigger text.
    if (materialOnRoute === null || r.severity > materialOnRoute.severity) {
      materialOnRoute = { cell: r.cell, severity: r.severity }
    }
  }

  if (materialOnRoute === null) {
    // Even with no new discovery on the route, a cell ahead may have become
    // impassable earlier in this same sweep's clone; check the whole remainder.
    const blocked = firstBlockedCell(d, remaining)
    if (blocked === null) return
    triggerReplan(
      d,
      acc,
      `route blocked at (${blocked.x}, ${blocked.y}) — believed hazard ${d.belief.hazard[idx(d.belief.width, blocked.x, blocked.y)].toFixed(2)} exceeds the ${d.effectiveMaxHazard.toFixed(2)} limit`,
    )
    return
  }

  const { cell, severity } = materialOnRoute
  const verb = severity > d.effectiveMaxHazard ? 'blocks' : 'lies on'
  triggerReplan(
    d,
    acc,
    `newly observed hazard of severity ${severity.toFixed(2)} at (${cell.x}, ${cell.y}) ${verb} the planned route`,
  )
}

/** Route cells from the rover's current position onward. */
function remainingRouteCells(d: SimState): Cell[] {
  const route = d.rover.route
  if (!route) return []
  const from = Math.max(0, Math.floor(d.rover.routeProgress))
  return route.cells.slice(from)
}

function firstBlockedCell(d: SimState, cells: Cell[]): Cell | null {
  const w = d.belief.width
  for (const c of cells) {
    const i = idx(w, c.x, c.y)
    if (d.belief.hazard[i] > d.effectiveMaxHazard) return c
    if (d.belief.slopeDeg[i] > d.config.maxSlopeDeg) return c
  }
  return null
}

function triggerReplan(d: SimState, acc: PlanAccum, trigger: string): void {
  if (d.rover.route) d.abandonedRoutes = [...d.abandonedRoutes, d.rover.route]
  d.replanCount += 1
  d.rover.mode = 'replanning'
  planLeg(d, acc, 'replan', trigger)
}

// ---------------------------------------------------------------------------
// Planning a leg
// ---------------------------------------------------------------------------

interface Posture {
  id: string
  label: string
  weights: CostWeights
  constraints: Constraints
}

/**
 * The three risk postures evaluated at every planning decision.
 *
 * They are genuinely different searches, not relabelled copies of one result:
 * "risk-averse" plans with the hazard weight raised AND a tighter hazard
 * ceiling, so it explores a smaller feasible set and often returns a
 * physically different corridor; "direct" plans as if risk hardly mattered.
 * Every one of them is an actual `plan()` call whose route is kept or whose
 * failure is recorded.
 */
function postures(d: SimState): Posture[] {
  const config = d.config
  const base: Constraints = {
    maxSlopeDeg: config.maxSlopeDeg,
    maxHazard: d.effectiveMaxHazard,
    batteryReserveFrac: config.batteryReserveFrac,
  }
  return [
    {
      id: 'current',
      label: 'Current preferences',
      weights: weightsFor(config),
      constraints: base,
    },
    {
      id: 'risk-averse',
      label: 'Risk-averse',
      // A tighter ceiling as well as a heavier weight: the weight changes
      // which route is preferred, the ceiling changes which routes exist.
      weights: weightsFor({ ...config, riskTolerance: Math.max(0, config.riskTolerance - 0.4) }),
      constraints: { ...base, maxHazard: base.maxHazard * 0.65 },
    },
    {
      id: 'direct',
      label: 'Most direct',
      weights: weightsFor({ ...config, riskTolerance: 0.95, energyPriority: 0.05 }),
      constraints: base,
    },
  ]
}

/** Where the rover is currently trying to get to, or null when it is done. */
function currentGoal(d: SimState): Cell | null {
  const wps = d.config.waypoints
  return d.rover.waypointIndex < wps.length ? wps[d.rover.waypointIndex] : null
}

/**
 * Plan the current leg, record the decision, and either start driving or raise
 * an intervention.
 *
 * `goalOverride` exists for `return-to-start`, which drives to a destination
 * that is not a waypoint.
 */
function planLeg(
  d: SimState,
  acc: PlanAccum,
  kind: DecisionRecord['kind'],
  trigger: string,
  goalOverride?: Cell,
): void {
  const goal = goalOverride ?? currentGoal(d)
  if (goal === null) {
    finishMission(d)
    return
  }

  d.rover.mode = kind === 'replan' ? 'replanning' : 'planning'

  // The common currency every candidate is re-costed in. See
  // PEAK_EXCEEDANCE_PENALTY for why selection does not simply use it.
  const scoringWeights = weightsFor(d.config)
  const scoringConstraints: Constraints = {
    maxSlopeDeg: d.config.maxSlopeDeg,
    maxHazard: d.effectiveMaxHazard,
    batteryReserveFrac: d.config.batteryReserveFrac,
  }

  const candidates: RouteCandidate[] = []
  for (const p of postures(d)) {
    const result = plan(
      {
        belief: d.belief,
        start: d.rover.cell,
        goal,
        weights: p.weights,
        constraints: p.constraints,
      },
      d.config.rover,
    )
    acc.ms += result.stats.elapsedMs
    acc.count += 1

    if (result.ok) {
      // Re-cost the planned CELLS in the common currency. The path is exactly
      // what A* returned; only the pricing is unified, so the totals in the
      // record are comparable across candidates.
      candidates.push({
        id: p.id,
        label: p.label,
        route: recost(d, result.route.cells, scoringWeights, scoringConstraints),
        weights: p.weights,
        constraints: p.constraints,
      })
    } else {
      candidates.push({
        id: p.id,
        label: p.label,
        route: null,
        rejected: planFailureText(result.reason),
        weights: p.weights,
        constraints: p.constraints,
      })
    }
  }

  const chosen = selectCandidate(d, candidates)
  const decision: DecisionRecord = {
    id: nextId('decision', d, d.decisions.length),
    tick: d.tick,
    kind,
    roverState: d.rover.mode,
    position: { ...d.rover.cell },
    trigger,
    observedFraction: observedFraction(d.belief),
    batteryFrac: d.rover.battery,
    candidates,
    selectedId: chosen?.id ?? null,
    reasonCode: chosen ? chosen.reasonCode : 'no-feasible-route',
    caveats: buildCaveats(d, candidates, chosen),
  }
  appendDecision(d, decision)

  if (!chosen) {
    appendEvent(d, { type: 'plan-failed', tick: d.tick, reason: 'goal-unreachable' })
    raiseOrFail(d, acc, 'no-safe-route', decision)
    return
  }

  const selectedRoute = chosen.candidate.route as Route
  appendEvent(d, {
    type: 'plan-computed',
    tick: d.tick,
    decisionId: decision.id,
    routeCost: selectedRoute.cost.total,
  })
  if (kind === 'replan') {
    appendEvent(d, { type: 'replan-triggered', tick: d.tick, trigger, decisionId: decision.id })
  }

  // Legal but above the stated preference, or projected to eat the reserve:
  // both are decisions a supervised operator should get to make.
  if (selectedRoute.peakHazard > d.config.riskTolerance) {
    if (raiseOrContinue(d, acc, 'risk-exceeds-tolerance', decision, selectedRoute)) return
  } else if (projectedBatteryBreach(d, selectedRoute)) {
    if (raiseOrContinue(d, acc, 'battery-reserve-breach', decision, selectedRoute)) return
  } else if (replansForCurrentWaypoint(d) >= REPEATED_REPLAN_LIMIT) {
    if (raiseOrContinue(d, acc, 'repeated-replanning', decision, selectedRoute)) return
  }

  startDriving(d, selectedRoute)
}

/**
 * Re-price a planned path in the common currency.
 *
 * The CELLS are exactly what A* returned under the posture's own weights;
 * only the pricing is swapped, so every candidate in a decision reports a
 * total that can be compared with every other one.
 */
function recost(d: SimState, cells: Cell[], w: CostWeights, c: Constraints): Route {
  return routeStats(d.belief, cells, w, c, d.config.rover)
}

function startDriving(d: SimState, route: Route): void {
  d.rover.route = route
  d.rover.routeProgress = 0
  d.rover.mode = 'driving'
}

function planFailureText(reason: string): string {
  switch (reason) {
    case 'goal-impassable':
      return 'the goal cell is itself above the hazard or slope limit'
    case 'start-impassable':
      return 'the rover is standing on a cell above the hazard or slope limit'
    case 'goal-unreachable':
      return 'no connected route exists under these constraints'
    default:
      return 'the search was exhausted without reaching the goal'
  }
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

interface Chosen {
  id: string
  candidate: RouteCandidate
  reasonCode: string
  score: number
}

/** Common-currency cost plus the peak-exceedance charge. See the constant. */
function selectionScore(d: SimState, route: Route): number {
  const exceed = Math.max(0, route.peakHazard - d.config.riskTolerance)
  const lengthCells = route.distanceM / METRES_PER_CELL
  return route.cost.total + PEAK_EXCEEDANCE_PENALTY * exceed * lengthCells
}

function selectCandidate(d: SimState, candidates: RouteCandidate[]): Chosen | null {
  let best: Chosen | null = null
  for (const c of candidates) {
    if (!c.route) continue
    const score = selectionScore(d, c.route)
    if (best === null || score < best.score) {
      best = { id: c.id, candidate: c, reasonCode: 'lower-total-cost', score }
    }
  }
  if (!best) return null

  const feasible = candidates.filter((c) => c.route !== null)
  if (feasible.length === 1) {
    best.reasonCode = 'only-feasible-route'
    return best
  }

  // The reason code names the dimension on which the winner actually beat the
  // best alternative, so it is derived from the numbers rather than asserted.
  let rival: RouteCandidate | null = null
  for (const c of feasible) {
    if (c.id === best.id) continue
    if (rival === null || selectionScore(d, c.route!) < selectionScore(d, rival.route!)) rival = c
  }
  if (rival?.route && best.candidate.route) {
    const a = best.candidate.route
    const b = rival.route
    if (a.peakHazard < b.peakHazard - 0.02 || a.meanHazard < b.meanHazard - 0.02) {
      best.reasonCode = 'lower-hazard-cost'
    } else if (a.energyWh < b.energyWh - 1) {
      best.reasonCode = 'lower-energy-cost'
    } else if (a.distanceM < b.distanceM - METRES_PER_CELL) {
      best.reasonCode = 'shorter-route'
    }
  }

  // Mark the rejected ones with why they lost, in real numbers.
  for (const c of candidates) {
    if (c.id === best.id || !c.route) continue
    c.rejected = `scored ${selectionScore(d, c.route).toFixed(2)} against ${best.score.toFixed(2)}`
  }
  return best
}

function buildCaveats(
  d: SimState,
  candidates: RouteCandidate[],
  chosen: Chosen | null,
): string[] {
  const caveats: string[] = []
  caveats.push(
    'Candidate routes are re-costed under the mission’s active weights so their totals are comparable; ' +
      'selection additionally charges peak hazard above the stated tolerance, which no shortest-path search can minimise',
  )
  const unobserved = 1 - observedFraction(d.belief)
  if (unobserved > 0.05) {
    caveats.push(
      `The plan crosses ground that is ${Math.round(unobserved * 100)}% unobserved, so believed hazard there is the orbital estimate only`,
    )
  }
  const failed = candidates.filter((c) => c.route === null).length
  if (failed > 0 && chosen) {
    caveats.push(`${failed} of ${candidates.length} postures found no route at all under their own constraints`)
  }
  if (d.effectiveMaxHazard > constraintsFor(d.config).maxHazard + 1e-9) {
    caveats.push(
      `Hazard ceiling is ${d.effectiveMaxHazard.toFixed(2)}, raised above the configured ${constraintsFor(d.config).maxHazard.toFixed(2)} by an operator decision`,
    )
  }
  return caveats
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

/**
 * Replans since the last waypoint was reached OR the last time an operator
 * answered an intervention.
 *
 * Derived from the event log rather than a dedicated field, so it survives
 * serialisation and replay. Resetting on `intervention-resolved` as well as on
 * `waypoint-reached` is what stops a long leg over broken ground from asking
 * the same question on every subsequent replan: once a human has said "carry
 * on", the budget starts again rather than being permanently exhausted.
 */
function replansForCurrentWaypoint(d: SimState): number {
  let count = 0
  for (let i = d.events.length - 1; i >= 0; i--) {
    const e = d.events[i]
    if (e.type === 'waypoint-reached' || e.type === 'intervention-resolved') break
    if (e.type === 'replan-triggered') count++
  }
  return count
}

function projectedBatteryBreach(d: SimState, route: Route): boolean {
  const rover = d.config.rover
  const driveSeconds = route.distanceM / Math.max(1e-6, rover.maxSpeedMs)
  const projectedWh = d.rover.energyUsedWh + route.energyWh + rover.idleWhPerS * driveSeconds
  const projectedBattery = 1 - projectedWh / rover.capacityWh
  return projectedBattery < d.config.batteryReserveFrac
}

/**
 * Raise an intervention if supervised; otherwise carry on.
 * Returns true when the tick should stop here.
 */
function raiseOrContinue(
  d: SimState,
  acc: PlanAccum,
  reason: InterventionReason,
  decision: DecisionRecord,
  route: Route,
): boolean {
  if (d.config.autonomyLevel !== 'supervised') return false
  raiseIntervention(d, acc, reason, decision, route)
  return true
}

/** No route at all: supervised asks, autonomous fails. */
function raiseOrFail(
  d: SimState,
  acc: PlanAccum,
  reason: InterventionReason,
  decision: DecisionRecord,
): void {
  if (d.config.autonomyLevel === 'supervised') {
    raiseIntervention(d, acc, reason, decision, null)
    return
  }
  d.outcome = 'failed'
  d.rover.mode = 'failed'
  appendEvent(d, {
    type: 'mission-failed',
    tick: d.tick,
    reason: 'no feasible route under the mission constraints',
  })
}

function raiseIntervention(
  d: SimState,
  acc: PlanAccum,
  reason: InterventionReason,
  decision: DecisionRecord,
  route: Route | null,
): void {
  const options = buildOptions(d, acc, reason, decision, route)
  const request: InterventionRequest = {
    id: nextId('intervention', d, d.resolutions.length),
    tick: d.tick,
    reason,
    summary: summariseRisk(reason, decision),
    decisionId: decision.id,
    options,
  }
  d.pendingIntervention = request
  d.rover.mode = 'awaiting-approval'
  appendEvent(d, {
    type: 'intervention-required',
    tick: d.tick,
    requestId: request.id,
    reason,
  })
}

/**
 * Build the options a human may choose between.
 *
 * Every option whose action involves driving carries a REAL route from a real
 * `plan()` call — the relaxed-tolerance option is planned at the relaxed
 * ceiling, the return-home option is planned back to the start. An option
 * whose route could not be planned is simply NOT OFFERED, rather than offered
 * with a route the engine cannot actually execute.
 *
 * Each option is built by its own small function below, because whether an
 * option belongs on the list is a different question per option and
 * interleaving those conditions in one body made the policy unreadable.
 */
function buildOptions(
  d: SimState,
  acc: PlanAccum,
  reason: InterventionReason,
  decision: DecisionRecord,
  route: Route | null,
): InterventionOption[] {
  const ctx: OptionContext = {
    d,
    acc,
    reason,
    decision,
    route,
    base: {
      maxSlopeDeg: d.config.maxSlopeDeg,
      maxHazard: d.effectiveMaxHazard,
      batteryReserveFrac: d.config.batteryReserveFrac,
    },
    weights: weightsFor(d.config),
  }

  // Order matters only for presentation: carry on, hedge, relax, retreat, give
  // up — roughly least to most drastic.
  const builders: ((c: OptionContext) => InterventionOption | null)[] = [
    acceptPlannedRoute,
    saferAlternative,
    relaxTheCeiling,
    returnToLandingSite,
    skipThisWaypoint,
    abortTheMission,
  ]

  const options: InterventionOption[] = []
  for (const build of builders) {
    const o = build(ctx)
    if (o) options.push(o)
  }
  return options
}

/** Everything an option builder needs, assembled once. */
interface OptionContext {
  d: SimState
  acc: PlanAccum
  reason: InterventionReason
  decision: DecisionRecord
  /** The route the engine was about to drive, when there is one. */
  route: Route | null
  base: Constraints
  weights: CostWeights
}

/** Drive the route the engine selected, despite whatever raised the question. */
function acceptPlannedRoute({ route, decision }: OptionContext): InterventionOption | null {
  if (!route || !decision.selectedId) return null
  return {
    id: 'accept',
    label: 'Proceed on the planned route',
    detail:
      `Drive the selected route anyway: ${Math.round(route.distanceM)} m, ` +
      `peak hazard ${route.peakHazard.toFixed(2)}, ${route.energyWh.toFixed(1)} Wh.`,
    action: { type: 'accept-route', candidateId: decision.selectedId },
    route,
  }
}

/**
 * Take a candidate the planner already produced that is genuinely safer.
 *
 * Offered only when one exists and is safer by a margin worth a human's
 * attention — a 0.01 improvement in peak hazard is not a choice, it is noise
 * dressed up as one.
 */
function saferAlternative({ route, decision }: OptionContext): InterventionOption | null {
  if (!route || !decision.selectedId) return null
  const safer = decision.candidates.find(
    (c) => c.id !== decision.selectedId && c.route && c.route.peakHazard < route.peakHazard - 0.02,
  )
  if (!safer?.route) return null
  return {
    id: 'safer',
    label: `Take the ${safer.label.toLowerCase()} route`,
    detail:
      `${Math.round(safer.route.distanceM)} m, peak hazard ${safer.route.peakHazard.toFixed(2)} ` +
      `(${Math.round(safer.route.distanceM - route.distanceM)} m further).`,
    action: { type: 'accept-route', candidateId: safer.id },
    route: safer.route,
  }
}

/**
 * Raise the hazard ceiling for the rest of the mission.
 *
 * Only meaningful when the ceiling is what blocked us, and only offered when a
 * route actually appears at the relaxed value — which costs a real `plan()`
 * call to find out, and that is the point: the operator sees the route they
 * would be authorising, not a promise that one might exist.
 */
function relaxTheCeiling(ctx: OptionContext): InterventionOption | null {
  const { d, acc, reason, base, weights } = ctx
  if (reason !== 'no-safe-route' && reason !== 'repeated-replanning') return null
  const relaxed = Math.min(0.95, d.effectiveMaxHazard + 0.25)
  if (relaxed <= d.effectiveMaxHazard + 1e-9) return null
  const goal = currentGoal(d)
  if (!goal) return null

  const r = plan(
    {
      belief: d.belief,
      start: d.rover.cell,
      goal,
      weights,
      constraints: { ...base, maxHazard: relaxed },
    },
    d.config.rover,
  )
  acc.ms += r.stats.elapsedMs
  acc.count += 1
  if (!r.ok) return null

  return {
    id: 'relax',
    label: `Raise the hazard ceiling to ${relaxed.toFixed(2)}`,
    detail:
      `Opens a ${Math.round(r.route.distanceM)} m route peaking at hazard ` +
      `${r.route.peakHazard.toFixed(2)}, above the configured limit.`,
    action: { type: 'raise-risk-tolerance', to: relaxed },
    route: r.route,
  }
}

/**
 * Abandon the remaining waypoints and drive home.
 *
 * Suppressed when the rover has not left the landing site, which is exactly
 * the case when the very FIRST plan fails: offering "return home, 0 m" as a
 * choice is noise, and it was on the list until a real run surfaced it.
 */
function returnToLandingSite(ctx: OptionContext): InterventionOption | null {
  const { d, acc, reason, base, weights } = ctx
  if (reason !== 'battery-reserve-breach' && reason !== 'no-safe-route') return null
  if (d.rover.cell.x === d.config.start.x && d.rover.cell.y === d.config.start.y) return null

  const home = plan(
    { belief: d.belief, start: d.rover.cell, goal: d.config.start, weights, constraints: base },
    d.config.rover,
  )
  acc.ms += home.stats.elapsedMs
  acc.count += 1
  if (!home.ok) return null

  return {
    id: 'home',
    label: 'Return to the landing site',
    detail: `Abandon the remaining waypoints and drive ${Math.round(home.route.distanceM)} m home.`,
    action: { type: 'return-to-start' },
    route: home.route,
  }
}

/** Give up on this waypoint. Only meaningful when another one follows it. */
function skipThisWaypoint({ d }: OptionContext): InterventionOption | null {
  if (d.rover.waypointIndex >= d.config.waypoints.length - 1) return null
  return {
    id: 'skip',
    label: 'Skip this waypoint',
    detail: 'Give up on the current waypoint and plan directly to the next one.',
    action: { type: 'skip-waypoint' },
    route: null,
  }
}

/** Always available: there is no state in which stopping is not an option. */
function abortTheMission(): InterventionOption {
  return {
    id: 'abort',
    label: 'Abort the mission',
    detail: 'Stop here. The mission is recorded as aborted.',
    action: { type: 'abort-mission' },
    route: null,
  }
}

/**
 * Apply a human's choice and resume.
 *
 * Happens AT THE CURRENT TICK, not the next one — the recorded resolution
 * carries `state.tick`, and `replay` applies it at exactly that tick before
 * stepping, which is what makes a replayed mission land on the same trajectory.
 */
export function resolveIntervention(state: SimState, optionId: string): SimState {
  const req = state.pendingIntervention
  if (!req) return state
  const option = req.options.find((o) => o.id === optionId)
  // Throwing rather than ignoring: an unknown option id means a UI or a
  // mission record disagrees with the engine about what was on offer, and
  // silently doing nothing would make a replay diverge with no indication.
  if (!option) throw new Error(`Unknown intervention option: ${optionId}`)

  const d = draftFrom(state, false)
  d.pendingIntervention = null
  d.resolutions = [...d.resolutions, { requestId: req.id, optionId, tick: state.tick }]
  appendEvent(d, {
    type: 'intervention-resolved',
    tick: d.tick,
    requestId: req.id,
    optionId,
  })

  const acc: PlanAccum = { ms: 0, count: 0 }
  applyAction(d, acc, option.action, req)

  appendDecision(d, {
    id: nextId('decision', d, d.decisions.length),
    tick: d.tick,
    kind: 'intervention-resolved',
    roverState: d.rover.mode,
    position: { ...d.rover.cell },
    trigger: `operator chose "${option.label}"`,
    observedFraction: observedFraction(d.belief),
    batteryFrac: d.rover.battery,
    candidates: [],
    selectedId: null,
    reasonCode: 'operator-choice',
    caveats: [option.detail],
  })

  planAccum.set(d, { ms: accumOf(state).ms + acc.ms, count: accumOf(state).count + acc.count })
  return d
}

function applyAction(
  d: SimState,
  acc: PlanAccum,
  action: InterventionAction,
  req: InterventionRequest,
): void {
  switch (action.type) {
    case 'accept-route': {
      const decision = d.decisions.find((x) => x.id === req.decisionId)
      const candidate = decision?.candidates.find((c) => c.id === action.candidateId)
      if (candidate?.route) {
        startDriving(d, candidate.route)
      } else {
        // The option referenced a candidate that no longer has a route. Rather
        // than drive nothing, replan from here.
        planLeg(d, acc, 'replan', 'accepted route was no longer available')
      }
      return
    }
    case 'raise-risk-tolerance': {
      d.effectiveMaxHazard = action.to
      planLeg(d, acc, 'replan', `operator raised the hazard ceiling to ${action.to.toFixed(2)}`)
      return
    }
    case 'skip-waypoint': {
      const skipped = d.rover.waypointIndex
      d.rover.waypointIndex += 1
      if (currentGoal(d) === null) {
        finishMission(d)
        return
      }
      planLeg(d, acc, 'replan', `operator skipped waypoint ${skipped}`)
      return
    }
    case 'return-to-start': {
      // Consuming the remaining waypoints is what makes arrival at the landing
      // site end the mission: `onRouteComplete` finishes when no waypoint is
      // left, and `finishMission` then records 'aborted' because not every
      // waypoint was reached.
      d.rover.waypointIndex = d.config.waypoints.length
      planLeg(d, acc, 'replan', 'operator ordered a return to the landing site', d.config.start)
      return
    }
    case 'abort-mission': {
      markAborted(d)
      return
    }
  }
}

export function abortMission(state: SimState): SimState {
  if (state.outcome !== null) return state
  const d = draftFrom(state, false)
  d.pendingIntervention = null
  markAborted(d)
  planAccum.set(d, accumOf(state))
  return d
}

function markAborted(d: SimState): void {
  d.outcome = 'aborted'
  d.rover.mode = 'aborted'
  d.rover.route = null
  appendEvent(d, { type: 'mission-aborted', tick: d.tick })
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

/**
 * Advance the rover along its route for one tick, and draw the energy that
 * motion and avionics cost.
 *
 * Progress is consumed in ARC LENGTH, not in route-array index: a diagonal
 * step is √2 cell-lengths of ground, and advancing the index uniformly would
 * make the rover travel 41% faster whenever its route happened to zig-zag.
 */
function driveTick(d: SimState, acc: PlanAccum): void {
  const rover = d.rover
  const spec = d.config.rover
  // Avionics draw regardless of whether the rover moves at all.
  let wh = spec.idleWhPerS * TICK_SECONDS

  if (rover.route && rover.mode === 'driving') {
    const cells = rover.route.cells
    const here = idx(d.belief.width, rover.cell.x, rover.cell.y)
    // Steep ground slows the rover toward MIN_SPEED_FRACTION of top speed.
    const steepness = Math.min(1, d.belief.slopeDeg[here] / Math.max(1e-6, d.config.maxSlopeDeg))
    const speedCells = ((spec.maxSpeedMs * TICK_SECONDS) / METRES_PER_CELL) * (1 - SLOPE_SLOWDOWN * steepness)

    let budget = speedCells
    let progress = rover.routeProgress

    while (budget > 1e-12 && progress < cells.length - 1) {
      const i = Math.floor(progress)
      const frac = progress - i
      const a = cells[i]
      const b = cells[i + 1]
      const segLen = a.x !== b.x && a.y !== b.y ? SQRT2 : 1
      const remain = (1 - frac) * segLen
      const take = Math.min(budget, remain)

      const metres = take * METRES_PER_CELL
      const segMetres = segLen * METRES_PER_CELL
      const dz =
        d.belief.elevation[idx(d.belief.width, b.x, b.y)] -
        d.belief.elevation[idx(d.belief.width, a.x, a.y)]
      const uphillDeg = dz > 0 ? Math.atan2(dz, segMetres) * DEG : 0
      wh += stepEnergyWh(metres, uphillDeg, spec)
      rover.odometerM += metres

      // Snap to the vertex when the segment is consumed, so repeated float
      // addition cannot leave progress a hair short of an integer forever.
      progress = take >= remain - 1e-12 ? i + 1 : progress + take / segLen
      budget -= take
    }

    rover.routeProgress = progress
    updatePose(d, cells, progress)
  }

  rover.energyUsedWh += wh
  rover.battery = Math.max(0, Math.min(1, 1 - rover.energyUsedWh / spec.capacityWh))

  if (rover.route && rover.mode === 'driving' && rover.routeProgress >= rover.route.cells.length - 1) {
    onRouteComplete(d, acc)
  }
}

function updatePose(d: SimState, cells: Cell[], progress: number): void {
  const rover = d.rover
  const last = cells.length - 1
  const i = Math.min(Math.floor(progress), last)
  if (i >= last) {
    rover.pos = { x: cells[last].x, y: cells[last].y }
  } else {
    const t = progress - i
    const a = cells[i]
    const b = cells[i + 1]
    rover.pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    rover.heading = Math.atan2(b.y - a.y, b.x - a.x)
  }

  // The occupied cell is taken from the ROUTE rather than from rounding the
  // continuous position, which guarantees the rover is always standing on a
  // cell the planner certified as passable.
  const nearest = cells[Math.min(last, Math.max(0, Math.round(progress)))]
  if (nearest.x !== rover.cell.x || nearest.y !== rover.cell.y) {
    rover.cell = { x: nearest.x, y: nearest.y }
    d.trail = [...d.trail, { x: nearest.x, y: nearest.y }]
  }
}

function onRouteComplete(d: SimState, acc: PlanAccum): void {
  const index = d.rover.waypointIndex
  if (index < d.config.waypoints.length) {
    appendEvent(d, {
      type: 'waypoint-reached',
      tick: d.tick,
      index,
      cell: { ...d.rover.cell },
    })
    d.rover.waypointIndex = index + 1
    d.rover.route = null
    d.rover.routeProgress = 0
    if (currentGoal(d) === null) {
      finishMission(d)
      return
    }
    planLeg(d, acc, 'waypoint-reached', `waypoint ${index} reached`)
    return
  }
  finishMission(d)
}

function finishMission(d: SimState): void {
  const reached = d.events.filter((e) => e.type === 'waypoint-reached').length
  const all = reached >= d.config.waypoints.length
  const outcome: MissionOutcome = all ? 'complete' : 'aborted'
  d.outcome = outcome
  d.rover.mode = all ? 'complete' : 'aborted'
  d.rover.route = null
  appendDecision(d, {
    id: nextId('decision', d, d.decisions.length),
    tick: d.tick,
    kind: all ? 'mission-complete' : 'abort',
    roverState: d.rover.mode,
    position: { ...d.rover.cell },
    trigger: all
      ? `all ${d.config.waypoints.length} waypoints reached`
      : `mission ended with ${reached} of ${d.config.waypoints.length} waypoints reached`,
    observedFraction: observedFraction(d.belief),
    batteryFrac: d.rover.battery,
    candidates: [],
    selectedId: null,
    reasonCode: all ? 'mission-complete' : 'mission-aborted',
    caveats: [],
  })
  appendEvent(
    d,
    all ? { type: 'mission-complete', tick: d.tick } : { type: 'mission-aborted', tick: d.tick },
  )
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

function checkBattery(d: SimState, acc: PlanAccum): void {
  if (d.rover.battery >= d.config.batteryReserveFrac) return
  // Emit the warning once. Without the guard a supervised operator who chose
  // to press on would be asked again on every subsequent tick.
  const alreadyWarned = d.events.some((e) => e.type === 'battery-low')
  if (alreadyWarned) return

  appendEvent(d, { type: 'battery-low', tick: d.tick, battery: d.rover.battery })

  const decision: DecisionRecord = {
    id: nextId('decision', d, d.decisions.length),
    tick: d.tick,
    kind: 'intervention-required',
    roverState: d.rover.mode,
    position: { ...d.rover.cell },
    trigger: `battery at ${(d.rover.battery * 100).toFixed(0)}% is below the ${(d.config.batteryReserveFrac * 100).toFixed(0)}% reserve`,
    observedFraction: observedFraction(d.belief),
    batteryFrac: d.rover.battery,
    candidates: [],
    selectedId: null,
    reasonCode: 'battery-reserve-breach',
    caveats: [],
  }
  appendDecision(d, decision)

  if (d.config.autonomyLevel === 'supervised') {
    raiseIntervention(d, acc, 'battery-reserve-breach', decision, d.rover.route)
    return
  }
  d.outcome = 'failed'
  d.rover.mode = 'failed'
  d.rover.route = null
  appendEvent(d, {
    type: 'mission-failed',
    tick: d.tick,
    reason: `battery fell below the ${(d.config.batteryReserveFrac * 100).toFixed(0)}% reserve`,
  })
}

// ---------------------------------------------------------------------------
// Metrics, records, replay
// ---------------------------------------------------------------------------

export function computeMetrics(state: SimState): MissionMetrics {
  const waypointsReached = state.events.filter((e) => e.type === 'waypoint-reached').length
  let hazardsDiscovered = 0
  let hazardsOnRoute = 0
  for (const e of state.events) {
    if (e.type !== 'hazard-discovered') continue
    hazardsDiscovered++
    if (e.onRoute) hazardsOnRoute++
  }

  let peakHazardTraversed = 0
  for (const c of state.trail) {
    const h = state.belief.hazard[idx(state.belief.width, c.x, c.y)]
    if (h > peakHazardTraversed) peakHazardTraversed = h
  }

  const acc = planAccum.get(state)
  // Fallback when metrics are computed on a state this module never produced
  // (a deserialised one, say): every candidate corresponds to exactly one
  // plan() call, so the count is recoverable even when the timing is not.
  const derivedCount = state.decisions.reduce((n, d) => n + d.candidates.length, 0)

  return {
    completed: state.outcome === 'complete',
    waypointsReached,
    waypointsTotal: state.config.waypoints.length,
    ticks: state.tick,
    elapsedS: state.elapsedS,
    distanceM: state.rover.odometerM,
    energyWh: state.rover.energyUsedWh,
    batteryRemaining: state.rover.battery,
    replans: state.replanCount,
    hazardsDiscovered,
    hazardsOnRoute,
    interventions: state.events.filter((e) => e.type === 'intervention-required').length,
    planMsTotal: acc?.ms ?? 0,
    planCount: acc?.count ?? derivedCount,
    peakHazardTraversed,
  }
}

export function toRecord(state: SimState, missionId: string, createdAt: string): MissionRecord {
  return {
    version: 1,
    missionId,
    createdAt,
    config: state.config,
    resolutions: state.resolutions,
    outcome: state.outcome ?? 'aborted',
    metrics: computeMetrics(state),
    events: state.events,
    decisions: state.decisions,
  }
}

/**
 * Re-run a recorded mission from its seed.
 *
 * The record stores no terrain and no trajectory — only
 * (config, resolutions) — so this is the real test of whether the engine is
 * deterministic: anything that leaked a clock or an unseeded random number
 * into a decision shows up here as a replay that diverges.
 *
 * Resolutions are applied at the tick they were recorded at, BEFORE that
 * tick's step, which mirrors the live ordering exactly: the intervention was
 * raised by the step that produced tick T, and the human answered while the
 * state still read tick T.
 */
export function replay(record: MissionRecord, maxTicks = DEFAULT_MAX_TICKS): SimState {
  let s = createSimulation(record.config)

  const byTick = new Map<number, string[]>()
  for (const r of record.resolutions) {
    const list = byTick.get(r.tick)
    if (list) list.push(r.optionId)
    else byTick.set(r.tick, [r.optionId])
  }

  for (let guard = 0; guard < maxTicks && s.outcome === null; guard++) {
    const due = byTick.get(s.tick)
    if (due) {
      for (const optionId of due) {
        if (s.pendingIntervention === null) break
        s = resolveIntervention(s, optionId)
      }
    }
    const next = step(s)
    // Identical object means the tick was a no-op — a pending intervention
    // with no recorded answer. Looping further would never terminate.
    if (next === s) break
    s = next
  }
  return s
}

/** Drive a mission to its end. Always terminates: either the outcome is set,
 *  the tick budget runs out, or `step` returns its own argument. */
export function runToCompletion(state: SimState, maxTicks = DEFAULT_MAX_TICKS): SimState {
  let s = state
  for (let i = 0; i < maxTicks && s.outcome === null; i++) {
    const next = step(s)
    if (next === s) break
    s = next
  }
  return s
}
