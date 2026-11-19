# Test plan

The question each layer answers, and what a passing suite actually proves.

## Unit — `src/core/__tests__/` (Vitest, node)

| Area | Assertion | Why it is the right test |
|---|---|---|
| RNG | same seed ⇒ identical stream | everything downstream inherits determinism from here |
| Terrain | same seed ⇒ byte-identical arrays | replay reconstructs terrain from the seed alone |
| **A\* optimality** | `plan()` total cost === `planUniformCost()` total cost over ≥20 random terrains | this is the admissibility proof; an inflated heuristic shows up as a strictly worse path |
| A\* efficiency | A\* expands fewer nodes than uniform cost | confirms the heuristic is doing work, not just being safe |
| Corner cutting | no diagonal step between two blocked orthogonals | a planner that cuts corners produces routes a real chassis cannot drive |
| Failure modes | unreachable / impassable goal return the right `PlanFailure` | the UI renders these; they must be distinguishable |
| **Preference sensitivity** | low vs high risk tolerance yield different routes on the same map | proves the sliders reach the cost function |
| Purity | `step()` leaves its input deep-equal | the store relies on this to swap state safely |
| Determinism | two runs from one config ⇒ identical metrics and event sequence | prerequisite for every benchmark number |
| **Replay fidelity** | `replay(toRecord(run))` reproduces metrics and events | proves the record stores enough, and that nothing derived can drift |
| Intervention | supervised mission reaches `awaiting-approval`; `step()` is a no-op there; `resolveIntervention` resumes | the non-blocking design is only correct if the no-op is real |

## Unit — `src/render/__tests__/`

Pure helpers only: `cellAt` round-trips a cell centre at several device pixel
ratios, the elevation ramp is monotonic, interpolation clamps. Canvas pixel
output is not asserted — it is reviewed by screenshot.

## Component — `tests/`

The store's tick loop: ticking advances state; a pending intervention stops the
ticker rather than spinning on a no-op; reset clears the interval; a finished
mission stops. Views render their empty, loading, awaiting-approval and failed
states.

## End-to-end — `e2e/` (Playwright, Chromium)

1. **Vertical slice** — choose scenario, set start and a waypoint, see a preview,
   launch, observe the rover's position change, pause, reset.
2. **Replan** — run `dynamic-hazard` to completion at speed; assert the decision
   stream gains a replan entry and an abandoned route is drawn.
3. **Intervention** — run supervised until the approval panel appears, choose an
   option, assert the mission resumes.
4. **Preference sensitivity in the UI** — move risk tolerance on
   `competing-objectives` and assert the previewed route's reported cost changes.
5. **Replay and export** — complete a mission, open Analysis, scrub, export JSON.
6. **Keyboard and responsive** — tab to every control in the planner; the mission
   view at 900px keeps the map interactive.

## What a green suite does not prove

That the physics are right, that the scenarios are interesting, or that the
interface is legible. Those are reviewed by eye and by the benchmark, not
asserted. The suite proves the system is deterministic, the search is optimal
under its own cost model, and the recorded mission is a faithful account of the
one that ran.
