# Contract issues

Problems found in the frozen `src/core/types.ts` / `docs/ENGINE_API.md` while
implementing the engine. **Nothing here was fixed by editing the contract.**
Each entry records the problem, the workaround actually shipped, and what a
future un-freezing should do instead.

Raised by Agent C, wave 1.

---

## 1. `PlanRequest` cannot express the energy term of its own cost function

**The problem.** `stepCost` is specified as

```ts
stepCost(belief, from, to, w: CostWeights, c: Constraints, rover: RoverSpec): CostBreakdown | null
```

and its energy term needs `flatWhPerM` and `climbWhPerMPerDeg` off the
`RoverSpec`. But `PlanRequest` carries only `belief`, `start`, `goal`,
`weights`, `constraints` and `heuristicWeight` — **no rover**. So
`plan(req: PlanRequest)` has no way to supply the argument its own cost model
requires.

This is not cosmetic: the heuristic scale `minCostPerCellStep(w, rover)` also
needs it, and getting the rover wrong there changes whether A* is admissible.

**Workaround shipped.** The rover is an *optional second argument*:

```ts
export function plan(req: PlanRequest, rover: RoverSpec = DEFAULT_ROVER): PlanResult
export function planUniformCost(req: PlanRequest, rover: RoverSpec = DEFAULT_ROVER): PlanResult
```

`plan(req)` still type-checks and still works, so the frozen signature in
`ENGINE_API.md` remains valid for every caller; the engine passes
`state.config.rover` so the energy term reflects the real vehicle.

**Proper fix.** Add `rover: RoverSpec` to `PlanRequest`. It is the only field
of a planning problem that is currently unrepresentable.

**Risk if left as is.** A UI that builds its own `PlanRequest` for a preview
and calls `plan(req)` silently prices energy against `DEFAULT_ROVER`. With the
shipped rover spec that is correct; with a user-edited rover it is not, and
nothing warns.

---

## 2. `RoverSpec.idleW` is named for watts and documented as watt-hours per second

```ts
/** Watt-hours per second drawn by avionics regardless of motion. */
idleW: number
```

The name says W, the comment says Wh/s. They differ by a factor of 3600, which
is the difference between a rover that finishes its traverse at 83% battery and
one that is flat in 83 ticks.

**Workaround shipped.** The **doc comment** is treated as authoritative:
`idleWh = rover.idleW * TICK_SECONDS`. `DEFAULT_ROVER.idleW` is set to `0.02`,
which is 0.02 Wh/s = 72 W — a plausible avionics bus load under the documented
reading, and an implausible one under the name's reading.

**Proper fix.** Rename to `idleWhPerS`, or change the semantics to watts and
divide by 3600 at the point of use.

---

## 3. `PlannerStats.elapsedMs` asks core to record something core may not measure

```ts
/** Wall-clock milliseconds. Measured by the caller, never inside core. */
elapsedMs: number
```

But `elapsedMs` is a field of `PlannerStats`, which is a field of `PlanResult`,
which is what `plan()` — a core function — returns. The caller cannot fill in a
field of a value it is handed already constructed, short of mutating it.

**Workaround shipped.** `plan()` stamps it from `performance.now()` taken
immediately on entry and immediately before each of the six returns. Three
things make this safe and they are commented at the call site:

- it is a **measurement, not a decision** — no branch, budget or timeout reads
  it, so it cannot influence which route comes back;
- it is confined to the boundary of `plan()`, nowhere else in core;
- every test that compares two runs excludes it, and the one field it makes
  non-deterministic is called out in `MissionMetrics`.

**Proper fix.** Either drop the comment (and accept that the planner times
itself), or move `elapsedMs` out of `PlannerStats` into a wrapper the caller
constructs.

---

## 4. `MissionMetrics.planMsTotal` and `planCount` have nowhere to accumulate

`computeMetrics(state: SimState)` must report the planner time summed across a
whole mission, but `SimState` has no field to carry a running total and
`DecisionRecord` / `RouteCandidate` do not carry `PlannerStats` either. The
information is destroyed the moment `plan()` returns.

**Workaround shipped.** A module-private `WeakMap<SimState, {ms, count}>` in
`engine.ts`. Keyed on the state object, so nothing is mutated and `step()`
stays pure; and kept out of `SimState` deliberately, because a non-deterministic
value inside a serializable state would make two identical runs produce
different records.

When no entry exists — metrics computed on a deserialised state — `planCount`
falls back to summing `decisions[].candidates.length`, which is exact (every
candidate is exactly one `plan()` call), and `planMsTotal` reports 0.

**Proper fix.** Add `planMsTotal` / `planCount` to `SimState`, and accept that
`SimState` then has one non-deterministic field; or attach `PlannerStats` to
`RouteCandidate`, which also makes per-decision timing visible in the UI.

> Note: a comment-only amendment to `types.ts` by another agent now documents
> the non-determinism of `planMsTotal` at the field itself. That matches the
> finding above and changes no type.

---

## 5. Minor: `Route.cells` and the type of a zero-length route

`Route` requires `cells: Cell[]` "inclusive of start and goal". When start and
goal are the same cell the route is a single cell with no steps, and
`meanHazard` is then a mean over an empty set.

**Workaround shipped.** `routeStats` returns `meanHazard = hazard(start)` for a
one-cell route rather than `NaN` or `0`, on the grounds that the rover's
exposure is the one cell it is standing on. Tested explicitly. Worth stating in
the type's doc comment, since `0` would be an equally defensible reading and
callers cannot currently tell which they will get.
