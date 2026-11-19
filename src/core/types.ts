/**
 * SELENE shared contracts.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS HAND-WRITTEN RATHER THAN GROWN:
 * every other module in the project — the planner, the simulation loop, the
 * canvas renderer, the React store, the benchmark harness — depends on these
 * shapes and on nothing else of each other's. Keeping the contracts in one
 * file that imports nothing is what allows those modules to be built and
 * tested independently.
 *
 * Two invariants hold across everything here:
 *
 *  1. SERIALIZABLE. No classes, no Map, no Set, no functions on any type that
 *     can reach a MissionRecord. A mission must survive JSON.stringify so it
 *     can be exported, diffed and replayed.
 *  2. DETERMINISTIC. Nothing in core/ may call Date.now(), Math.random(), or
 *     read the DOM. Time is `tick`, randomness is a seeded Rng passed in.
 *     This is what makes a mission reproducible from (scenarioId, seed,
 *     config, interventions) alone.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Integer cell coordinate in grid space. Origin is top-left, +y is down. */
export interface Cell {
  x: number
  y: number
}

/** Continuous position in grid space; the rover interpolates between cells. */
export interface Vec2 {
  x: number
  y: number
}

/** Flat index into the terrain's typed arrays: y * width + x. */
export type CellIndex = number

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * A lunar terrain patch. All per-cell data is stored in parallel typed arrays
 * indexed by `y * width + x` — one allocation per layer rather than one object
 * per cell, because a 128x128 map is 16384 cells and the renderer walks all of
 * them every frame.
 *
 * `hazard` is what a mission planner can see before launch (from orbit).
 * `hiddenHazard` is what only the rover's local sensors can discover. The gap
 * between the two is the entire reason this project needs replanning.
 */
export interface Terrain {
  width: number
  height: number
  /** Seed the terrain was generated from; regenerating with it is exact. */
  seed: number
  /** Metres above the patch's local datum. Drives slope and climb energy. */
  elevation: Float32Array
  /** Degrees, 0..90, derived from the elevation gradient. */
  slopeDeg: Float32Array
  /** Orbit-visible hazard severity, 0 (clear) .. 1 (impassable rubble). */
  hazard: Float32Array
  /**
   * Hazard severity NOT visible from orbit: soft regolith, small craters,
   * shadowed dropoffs. Zero almost everywhere. The rover only learns a cell's
   * value once that cell is within sensor range.
   */
  hiddenHazard: Float32Array
}

/** Metres per cell edge. Fixed per terrain; used for distance and energy. */
export const METRES_PER_CELL = 4

// ---------------------------------------------------------------------------
// Belief — what the rover currently thinks is true
// ---------------------------------------------------------------------------

/**
 * The rover's belief state, which is what the planner actually plans on.
 *
 * Planning against ground truth would make the whole exercise circular: a
 * planner that can already see every hazard never needs to replan. The planner
 * sees `Belief`, the simulator sees `Terrain`, and the difference between them
 * is discovered one sensor sweep at a time.
 */
export interface Belief {
  width: number
  height: number
  /** 1 once the cell has been inside sensor range at least once. */
  observed: Uint8Array
  /**
   * Believed total hazard per cell: the orbital `hazard` layer everywhere,
   * plus `hiddenHazard` for cells that have been observed.
   */
  hazard: Float32Array
  /** Copied from terrain; slope is considered orbit-visible (altimetry). */
  slopeDeg: Float32Array
  elevation: Float32Array
}

// ---------------------------------------------------------------------------
// Cost model
// ---------------------------------------------------------------------------

/**
 * Weights for the four terms of the route cost function. These come from the
 * user's mission configuration, so changing a slider has to be capable of
 * changing the chosen route — that property is asserted in the planner tests.
 */
export interface CostWeights {
  distance: number
  slope: number
  hazard: number
  energy: number
}

/**
 * Per-term contribution of a single step or a whole route. Carried on every
 * route candidate so the explanation layer can quote real numbers instead of
 * asserting that one route "looked safer".
 */
export interface CostBreakdown {
  distance: number
  slope: number
  hazard: number
  energy: number
  total: number
}

/** Hard constraints. A cell violating any of these is not traversable at all. */
export interface Constraints {
  /** Degrees. Above this the rover cannot climb, regardless of weights. */
  maxSlopeDeg: number
  /**
   * 0..1. Believed hazard above this is treated as impassable. This is the
   * "risk tolerance" slider: raising it opens up shorter, nastier routes.
   */
  maxHazard: number
  /** Fraction 0..1 of battery that must remain. Below it the rover stops. */
  batteryReserveFrac: number
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanRequest {
  belief: Belief
  start: Cell
  goal: Cell
  weights: CostWeights
  constraints: Constraints
  /**
   * Heuristic multiplier for weighted A*. 1 = admissible (optimal), >1 trades
   * optimality for speed. Defaults to 1; the benchmark sweeps it.
   */
  heuristicWeight?: number
}

/** Why a planning attempt produced no usable route. */
export type PlanFailure =
  | 'goal-unreachable'
  | 'goal-impassable'
  | 'start-impassable'
  | 'search-exhausted'

export interface PlannerStats {
  /** Nodes popped from the open set. The real measure of search effort. */
  nodesExpanded: number
  /** Peak size of the open set. */
  frontierPeak: number
  /** Wall-clock milliseconds. Measured by the caller, never inside core. */
  elapsedMs: number
}

export interface Route {
  /** Cell-by-cell path, inclusive of start and goal. */
  cells: Cell[]
  cost: CostBreakdown
  /** Metres along the ground, accounting for diagonal steps. */
  distanceM: number
  /** Watt-hours the energy model predicts this route will consume. */
  energyWh: number
  /** Worst believed hazard on any cell of the route, 0..1. */
  peakHazard: number
  /** Mean believed hazard, weighted by step length. */
  meanHazard: number
  /** Steepest believed slope on the route, degrees. */
  peakSlopeDeg: number
}

export type PlanResult =
  | { ok: true; route: Route; stats: PlannerStats }
  | { ok: false; reason: PlanFailure; stats: PlannerStats }

// ---------------------------------------------------------------------------
// Explainable decisions
// ---------------------------------------------------------------------------

/**
 * One alternative the planner actually evaluated, kept so the UI can show what
 * was rejected and why. A candidate is only ever created from a real planner
 * run — never fabricated to pad the list.
 */
export interface RouteCandidate {
  id: string
  label: string
  /** Null when this candidate's search failed; `rejected` then says why. */
  route: Route | null
  /** Set when the candidate was evaluated but not chosen. */
  rejected?: string
  /** The weights/constraints this candidate was planned under. */
  weights: CostWeights
  constraints: Constraints
}

export type DecisionKind =
  | 'initial-plan'
  | 'replan'
  | 'waypoint-reached'
  | 'intervention-required'
  | 'intervention-resolved'
  | 'abort'
  | 'mission-complete'

/**
 * The structured record behind every autonomy decision. The human-readable
 * explanation is GENERATED FROM THIS RECORD (see core/explain.ts) rather than
 * written alongside it, so the sentence a user reads cannot drift away from
 * the arithmetic the engine actually did.
 */
export interface DecisionRecord {
  id: string
  tick: number
  kind: DecisionKind
  /** Rover mode at the moment the decision was taken. */
  roverState: RoverMode
  position: Cell
  /** What prompted the decision, in engine terms. */
  trigger: string
  /** Everything the planner was allowed to see. */
  observedFraction: number
  batteryFrac: number
  /** Every route evaluated, in evaluation order. */
  candidates: RouteCandidate[]
  /** `id` of the chosen candidate, or null when nothing was chosen. */
  selectedId: string | null
  /** Short machine-tagged reason, e.g. 'lower-hazard-cost'. */
  reasonCode: string
  /** Known limits of this decision: stale belief, unobserved cells ahead. */
  caveats: string[]
}

// ---------------------------------------------------------------------------
// Rover
// ---------------------------------------------------------------------------

export type RoverMode =
  | 'idle'
  | 'planning'
  | 'driving'
  | 'replanning'
  | 'awaiting-approval'
  | 'charging'
  | 'complete'
  | 'failed'
  | 'aborted'

export interface RoverState {
  mode: RoverMode
  /** Continuous position; `cell` is the rounded authority for terrain lookups. */
  pos: Vec2
  cell: Cell
  /** Radians, 0 = +x, increasing clockwise in screen space. */
  heading: number
  /** 0..1. */
  battery: number
  /** Metres driven since mission start. */
  odometerM: number
  /** Watt-hours drawn since mission start. */
  energyUsedWh: number
  /** Index into mission.waypoints the rover is currently driving toward. */
  waypointIndex: number
  /** The route currently being executed, if any. */
  route: Route | null
  /** How far along `route.cells` the rover is, as a float index. */
  routeProgress: number
}

/** Physical parameters of the rover. Fixed per mission, shown in the UI. */
export interface RoverSpec {
  /** Metres per second over flat ground. */
  maxSpeedMs: number
  /** Battery capacity in watt-hours. */
  capacityWh: number
  /** Watt-hours per metre on flat ground. */
  flatWhPerM: number
  /**
   * Extra watt-hours per metre per degree of uphill slope. Downhill is modelled
   * as free rather than regenerative, which is the conservative choice.
   */
  climbWhPerMPerDeg: number
  /** Cells. Hidden hazards within this radius become observed. */
  sensorRangeCells: number
  /**
   * Energy drawn by avionics regardless of motion, in **watt-hours per
   * second**.
   *
   * Named for its unit after the original `idleW` cost a 3600x display bug:
   * the field read as watts, the engine used it as Wh/s, and the planner panel
   * duly rendered "0.02 W" for a 72 W draw. A unit that lives only in a doc
   * comment is a unit that will be read wrong by whoever does not open the
   * type.
   */
  idleWhPerS: number
}

// ---------------------------------------------------------------------------
// Human-in-the-loop
// ---------------------------------------------------------------------------

export type InterventionReason =
  | 'no-safe-route'
  | 'risk-exceeds-tolerance'
  | 'battery-reserve-breach'
  | 'repeated-replanning'

export interface InterventionOption {
  id: string
  label: string
  /** What taking this option does, in plain language, for the UI. */
  detail: string
  /** The consequence the engine will apply. */
  action: InterventionAction
  /** Null when the option does not correspond to driving a route. */
  route: Route | null
}

export type InterventionAction =
  | { type: 'accept-route'; candidateId: string }
  /** Temporarily raise maxHazard for this leg only. */
  | { type: 'raise-risk-tolerance'; to: number }
  | { type: 'skip-waypoint' }
  | { type: 'abort-mission' }
  | { type: 'return-to-start' }

/**
 * A pending request for a human decision.
 *
 * NOTE ON ARCHITECTURE: this is a value in the simulation state, not an awaited
 * promise. `step()` becomes a no-op while one is outstanding and the simulation
 * resumes through `resolveIntervention()`. Blocking a worker on human input is
 * what makes a simulator impossible to replay, test or run headless.
 */
export interface InterventionRequest {
  id: string
  tick: number
  reason: InterventionReason
  /** Human-readable framing of the risk, generated from the decision record. */
  summary: string
  decisionId: string
  options: InterventionOption[]
}

export interface InterventionResolution {
  requestId: string
  optionId: string
  /** Tick at which the human's choice was applied. Replay uses this. */
  tick: number
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'mission-started'; tick: number }
  | { type: 'plan-computed'; tick: number; decisionId: string; routeCost: number }
  | { type: 'plan-failed'; tick: number; reason: PlanFailure }
  | { type: 'hazard-discovered'; tick: number; cell: Cell; severity: number; onRoute: boolean }
  | { type: 'replan-triggered'; tick: number; trigger: string; decisionId: string }
  | { type: 'waypoint-reached'; tick: number; index: number; cell: Cell }
  | { type: 'intervention-required'; tick: number; requestId: string; reason: InterventionReason }
  | { type: 'intervention-resolved'; tick: number; requestId: string; optionId: string }
  | { type: 'battery-low'; tick: number; battery: number }
  | { type: 'mission-complete'; tick: number }
  | { type: 'mission-failed'; tick: number; reason: string }
  | { type: 'mission-aborted'; tick: number }

export type SimEventType = SimEvent['type']

// ---------------------------------------------------------------------------
// Mission configuration
// ---------------------------------------------------------------------------

export interface MissionConfig {
  scenarioId: string
  seed: number
  start: Cell
  waypoints: Cell[]
  /** 0..1. Higher means willing to drive through worse believed hazard. */
  riskTolerance: number
  /** 0..1. Higher means the cost function weights energy more heavily. */
  energyPriority: number
  /** 0..1. Mission stops rather than dropping below this. */
  batteryReserveFrac: number
  /** Degrees. Hard climb limit. */
  maxSlopeDeg: number
  /** Whether the engine pauses for human approval at all. */
  autonomyLevel: 'supervised' | 'autonomous'
  rover: RoverSpec
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

/** Seconds of simulated time advanced by one call to `step()`. */
export const TICK_SECONDS = 0.5

export interface SimState {
  tick: number
  /** Simulated seconds elapsed; always tick * TICK_SECONDS. */
  elapsedS: number
  config: MissionConfig
  terrain: Terrain
  belief: Belief
  rover: RoverState
  events: SimEvent[]
  decisions: DecisionRecord[]
  pendingIntervention: InterventionRequest | null
  resolutions: InterventionResolution[]
  /** Routes superseded by a replan, kept so the UI can draw what changed. */
  abandonedRoutes: Route[]
  /** Cells the rover has physically occupied, for the traversed-path overlay. */
  trail: Cell[]
  /** Count of replans so far; feeds the repeated-replanning intervention. */
  replanCount: number
  /** Effective risk tolerance, which an intervention may raise above config. */
  effectiveMaxHazard: number
  /** Set once the mission ends. */
  outcome: MissionOutcome | null
}

export type MissionOutcome = 'complete' | 'failed' | 'aborted'

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string
  name: string
  /** One sentence shown on the scenario card. */
  summary: string
  /** What this scenario is designed to demonstrate, for the research writeup. */
  hypothesis: string
  width: number
  height: number
  seed: number
  start: Cell
  suggestedWaypoints: Cell[]
  /** Terrain generator knobs. */
  terrain: TerrainParams
}

export interface TerrainParams {
  /** Number of octaves of value noise in the elevation field. */
  octaves: number
  /** Metres of elevation range. */
  relief: number
  /** Number of craters stamped into the heightfield. */
  craters: number
  /** 0..1 — how much of the hazard field is visible from orbit. */
  orbitalVisibility: number
  /** Mean fraction of cells carrying a hidden hazard. */
  hiddenHazardDensity: number
  /** Extra rubble fields placed as orbit-visible obstacles. */
  rubbleFields: number
}

// ---------------------------------------------------------------------------
// Mission record — export and replay
// ---------------------------------------------------------------------------

/**
 * Everything needed to reconstruct a finished mission exactly.
 *
 * Deliberately does NOT contain the terrain or the per-tick rover trace: both
 * are derivable from (config.scenarioId, config.seed, config, resolutions) by
 * re-running the engine. Storing the derived data as well would let the record
 * disagree with the engine, and the replay test asserts it cannot.
 */
export interface MissionRecord {
  version: 1
  missionId: string
  /** ISO timestamp. The ONLY wall-clock value in the system, set at the edge. */
  createdAt: string
  config: MissionConfig
  resolutions: InterventionResolution[]
  outcome: MissionOutcome
  metrics: MissionMetrics
  events: SimEvent[]
  decisions: DecisionRecord[]
}

export interface MissionMetrics {
  completed: boolean
  waypointsReached: number
  waypointsTotal: number
  ticks: number
  elapsedS: number
  distanceM: number
  energyWh: number
  /** Battery remaining, 0..1. */
  batteryRemaining: number
  replans: number
  hazardsDiscovered: number
  /** Hazards found that were actually on the route being driven. */
  hazardsOnRoute: number
  interventions: number
  /**
   * Sum of planner wall-clock time across every plan in the mission.
   *
   * THE ONE NON-DETERMINISTIC FIELD IN THIS STRUCT. Every other field is a
   * pure function of (scenarioId, seed, config, resolutions) and is therefore
   * identical across a run and its replay; this one is a measurement of the
   * machine, and will differ by a factor of three between a cold and a warm
   * run of the same mission.
   *
   * Consequence: `deepEqual(computeMetrics(live), computeMetrics(replay(rec)))`
   * is NOT a valid determinism assertion. Exclude this field, or compare the
   * event log instead, which is fully deterministic. A replay check written
   * the obvious way fails here for a reason that has nothing to do with
   * replay being broken.
   */
  planMsTotal: number
  planCount: number
  /**
   * Worst hazard on any cell the rover actually drove across, read from the
   * belief **as it stands at the end of the mission**.
   *
   * That hindsight is deliberate but it answers only one of two questions.
   * A cell crossed while it was believed clear, whose hidden hazard the rover
   * discovered later, is counted here at its discovered severity. So this is
   * the right number for "how dangerous was the ground that got driven" and
   * the WRONG number for "how much risk did the planner knowingly accept" —
   * the latter needs the belief as it stood at the moment of traversal, which
   * is not recorded per cell.
   *
   * Benchmarks comparing planners on risk exposure are measuring the first
   * question. Do not quote this as evidence about planner judgement.
   */
  peakHazardTraversed: number
}
