# SELENE

**[Live demo](https://alveeramunshi.github.io/selene/app/)** ·
**[Landing page](https://alveeramunshi.github.io/selene/)** ·
[Research and limitations](docs/RESEARCH.md) ·
[Case study](docs/CASE_STUDY.md) ·
[Final report](docs/FINAL_REPORT.md)

A browser-based simulation of an autonomous lunar rover that plans a route,
drives it, discovers the ground is worse than it looked, and replans — with
every decision inspectable as arithmetic rather than as narration.

The idea that makes it more than a path animator: **the planner plans on
belief, the simulator advances against ground truth, and the gap between them
is what forces replanning.** The terrain carries two hazard layers — one
visible from orbit, one discoverable only by the rover's own sensors at 24 m —
and the planner is never shown the second. A planner given ground truth would
never need to replan, and the whole autonomy story would be a scripted
animation.

**This is a simulation.** Procedural terrain, not lunar DEM data. A linear
energy model, no regolith mechanics. A perfect sensor and a rover that always
knows exactly where it is. Nothing here has been validated against a real
vehicle, and [the limitations are written out at length](docs/RESEARCH.md#10-limitations)
rather than left implied.

## Quickstart

```bash
npm install
npm run dev        # the app, on http://localhost:5173
npm test           # unit suite (vitest)
npm run bench      # the full benchmark, ~15s, tables to stdout
npm run e2e        # Playwright
npx tsc --noEmit   # typecheck
```

The reproducibility gate CI runs is `npx tsx bench/run.ts --ci`: seven fixed
missions, each run twice and replayed from its exported record, all compared
against digests committed in `bench/golden.json`. It exits non-zero on any
divergence.

## Architecture

```
src/core/     the engine: terrain, cost model, A* planner, simulation loop
src/render/   canvas 2D renderer, offscreen terrain bake + overlay pass
src/state/    zustand store
src/views/    the three screens: planner, live mission, analysis
bench/        the benchmark harness and its golden digests
```

Everything under `src/core/` is pure. No `Date.now()`, no `Math.random()`, no
DOM — time is an integer `tick`, randomness is a seeded `mulberry32` passed in,
and `step()` never mutates its argument. One wall clock reading is permitted,
at the boundary of the planner, and it is a measurement nothing branches on.

That rule is what buys three things at once. A mission is a pure function of
`(scenarioId, seed, config, resolutions)`, so a `MissionRecord` can store those
four things and **nothing derived** — no terrain, no trajectory — and `replay()`
reconstructs the mission by re-running the engine. The record therefore cannot
disagree with the engine. And the same engine runs headlessly in Node, which is
why a 540-mission parameter sweep is a 15-second shell command rather than
something that needs a browser.

Human approval is a value in the state, not an awaited promise: `step()` becomes
a no-op while an intervention is outstanding and the simulation resumes through
`resolveIntervention()`. Blocking a loop on human input is what makes a
simulator impossible to replay or test.

## What is real and what is simulated

Real, in the sense of being computed rather than staged:

- Routes come from A\* over a four-term cost function at the moment they are
  needed. The heuristic is admissible and consistent, and A\* returns the
  **exact** uniform-cost optimum on 160 independently generated terrains across
  four risk settings — zero disagreement, not "within tolerance".
- Replans are caused by sensor observations that raise believed hazard on the
  route being driven. Nothing is scripted at a tick number.
- Every explanation shown in the UI is generated from the structured
  `DecisionRecord` the engine produced, so the prose cannot drift away from the
  arithmetic.
- Every number on the analysis screen is a field of `MissionMetrics` or a
  counted event.

Simulated, and not claimed otherwise: the terrain (fractal value noise plus
stamped craters and rubble fields), the energy model (linear in uphill slope;
no sinkage, no thermal, no solar recharge, no regenerative braking), hazard
severity (a scalar in [0,1] with no failure-probability meaning, so "risk
tolerance 0.45" is not calibrated against anything physical), the sensor (a
perfect 24 m disc with no occlusion and no noise), and the rover's position,
which carries no error at all.

## Headline results

From `npm run bench` on this commit; the full tables and the honest reading are
in [docs/RESEARCH.md](docs/RESEARCH.md).

**Risk-aware planning roughly halves hazard exposure for 1–4% more distance.**
Against a shortest-distance baseline under identical hard constraints, on the
same beliefs, paired per seed across 33 planning problems: mean hazard along the
route falls by **51–60%** and peak hazard by 9–20%, for **+0.8% to +3.8%**
distance. Mean hazard was lower on 33 of 33 paired seeds.

**Roughly half of that safety is the hard constraint, not the cost function.**
Opening the hazard ceiling from 0.51 to 0.95 while keeping distance-only weights
widens the peak-hazard gap from 9–20% to 30–44%. A third arm exists in the
benchmark specifically so this cannot be mistaken for the weights doing all the
work.

**And it is not free once the loop closes.** On the hazard-dense scenario,
risk-aware missions complete **8 of 12** seeds against the distance-dominant
arm's 11 of 12 — a tighter hazard ceiling makes three terrains unroutable — and
drive **+24.4%** further with 2× the replans in exchange for a 51.6% lower peak
hazard driven. Risk aversion costs completion rate.

**The energy-priority slider changes the route and not the outcome.** Moving it
from 0.1 to 0.8 alters the driven trail on 30 of 32 paired missions and saves a
median **0.2–0.5%** energy. The reason is measured rather than guessed: the
climb term is only 12–19% of a route's energy, and net elevation change is fixed
by the endpoints.

**Weighted A\* buys a lot for very little.** At `heuristicWeight` 1.25 the
search expands 3–10× fewer nodes for under 2% above the optimum — though it also
raises the peak hazard of the route it returns, because the inflated heuristic is
a distance bound.

**One plan is 1–3 ms; one headless mission is 6–26 ms** on a 96×96 grid (warm,
median of 15 and 5 repeats, darwin-arm64). Cold-versus-warm is a 5.6× gap, which
is why every timing here is taken after a warm-up.

## Further reading

- [docs/RESEARCH.md](docs/RESEARCH.md) — the scenarios as falsifiable
  hypotheses, the cost model as mathematics, the admissibility proof and its
  empirical check, every benchmark table with spread, and the limitations.
- [docs/CASE_STUDY.md](docs/CASE_STUDY.md) — the engineering: what was decided,
  what each decision cost, and what is unfinished.
- [docs/DECISION_LOG.md](docs/DECISION_LOG.md) — seven architectural choices,
  each with the alternative it closed off and the cost of being wrong.
- [docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md) — things that cost real
  time during the build, written down so they cost it once.
- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — what the product claims to be,
  including its acceptance criteria and its explicit non-goals.
