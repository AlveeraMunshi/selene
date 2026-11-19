# Engine API contract

Frozen before parallel implementation began. Every module below is owned by
exactly one agent; everything else imports only these signatures and
`src/core/types.ts`.

```ts
// src/core/rng.ts                                     [Agent C]
export type Rng = () => number                  // uniform [0,1)
export function makeRng(seed: number): Rng      // mulberry32; same seed, same stream
export function rngInt(rng: Rng, lo: number, hi: number): number

// src/core/terrain.ts                                 [Agent C]
export function generateTerrain(
  params: TerrainParams, width: number, height: number, seed: number): Terrain
export function createBelief(terrain: Terrain): Belief
export function observe(                        // mutates belief in place
  belief: Belief, terrain: Terrain, at: Cell, rangeCells: number): Cell[]  // newly revealed hazard cells
export function idx(w: number, x: number, y: number): CellIndex
export function inBounds(w: number, h: number, x: number, y: number): boolean

// src/core/cost.ts                                    [Agent C]
export function weightsFor(config: MissionConfig): CostWeights
export function constraintsFor(config: MissionConfig): Constraints
export function stepCost(
  belief: Belief, from: Cell, to: Cell,
  w: CostWeights, c: Constraints, rover: RoverSpec): CostBreakdown | null  // null = impassable
export function routeStats(
  belief: Belief, cells: Cell[],
  w: CostWeights, c: Constraints, rover: RoverSpec): Route
export function minCostPerCellStep(w: CostWeights, rover: RoverSpec): number  // heuristic scale

// src/core/planner.ts                                 [Agent C]
export function plan(req: PlanRequest): PlanResult
export function planUniformCost(req: PlanRequest): PlanResult   // h=0 oracle, for tests

// src/core/explain.ts                                 [Agent C]
export function explainDecision(d: DecisionRecord): string
export function explainIntervention(r: InterventionRequest): string
export function reasonCodeLabel(code: string): string

// src/core/scenarios.ts                               [Agent C]
export const SCENARIOS: Scenario[]                      // exactly 3, ids below
export function getScenario(id: string): Scenario       // throws on unknown id
export const DEFAULT_ROVER: RoverSpec

// src/core/engine.ts                                  [Agent C]
export function createSimulation(config: MissionConfig): SimState
export function step(state: SimState): SimState          // pure; never mutates input
export function resolveIntervention(state: SimState, optionId: string): SimState
export function abortMission(state: SimState): SimState
export function computeMetrics(state: SimState): MissionMetrics
export function toRecord(state: SimState, missionId: string, createdAt: string): MissionRecord
export function replay(record: MissionRecord): SimState  // re-runs from seed to completion
export function runToCompletion(state: SimState, maxTicks?: number): SimState

// src/render/scene.ts                                 [Agent D]
export interface RenderOptions {
  showElevation: boolean; showSlope: boolean; showHazard: boolean
  showObserved: boolean; showPlannedRoute: boolean; showTrail: boolean
  showAbandoned: boolean; hoverCell: Cell | null; selectedCell: Cell | null
}
export function createRenderer(canvas: HTMLCanvasElement): Renderer
// AMENDED after wave 1: the React hook shipped positional, without pointer
// callbacks. Pointer wiring lives in the view, which resolves through cellAt.
//   useRenderer(state, opts, config?) => { canvasRef, cellAt }
export interface Renderer {
  draw(state: SimState, opts: RenderOptions, alpha: number): void
  resize(cssW: number, cssH: number): void
  cellAt(clientX: number, clientY: number): Cell | null
  destroy(): void
}
```

Scenario ids: `baseline-traverse`, `dynamic-hazard`, `competing-objectives`.
