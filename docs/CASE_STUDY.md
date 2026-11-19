# SELENE — case study

Written for someone who will push back. Every claim below points at a file or
at a benchmark run, and the places where the system is weak are in §7 rather
than buried.

---

## 1. The problem

Build something that demonstrates autonomy rather than depicting it.

The depiction version is easy and worthless: precompute a path, animate a
sprite along it, print "REPLANNING…" at tick 300, show a confidence number
that came from nowhere. It looks identical to the real thing in a screenshot
and falls apart under one question — *what would have happened if the terrain
were different?*

The constraint that makes the problem real is this: **the thing that plans
must not be able to see the thing that moves.** Give the planner the true
hazard field and it never needs to replan; every replan is then a lie. So the
system needs two worlds that disagree, a mechanism by which the disagreement
is discovered incrementally, and a planner that is genuinely re-run against
the updated picture — and then the interesting engineering is all in keeping
those two worlds honestly separated while still being able to reproduce any
mission exactly.

Three audiences, in priority order: an autonomy engineer who will look for the
cost function and the heuristic's admissibility; an operator who should read
the mission state in a few seconds and is occasionally asked to make a
decision the rover declines to make alone; and a reader who never runs it.

---

## 2. The central design decision, and what it cost

`Terrain` carries two hazard layers:

```ts
hazard:       Float32Array   // visible from orbit
hiddenHazard: Float32Array   // soft regolith, shadowed dropoffs — sensor only
```

`Belief` carries `observed: Uint8Array` and a merged `hazard` field: the
orbital layer everywhere, plus `hiddenHazard` only for cells that have been
inside the 24 m sensor disc. The planner takes a `Belief`. The driving and
sensing code takes a `Terrain`. Nothing in `core/` ever hands ground truth to
the planner, and the engine's replan trigger is `observe()` reporting that a
cell on the route being driven is worse than the orbital survey claimed.

**What it bought.** Replanning is a consequence rather than a feature. On
`dynamic-hazard` the median mission replans 27 times across 12 seeds, every one
attributable to a specific `hazard-discovered` event with `onRoute: true`, and
on the control scenario the median is 0 with a maximum of 0 over all 180
missions in that scenario's grid. The difference between the two is entirely
the `orbitalVisibility` and `hiddenHazardDensity` terrain parameters. That is
the claim being demonstrable instead of asserted.

**What it cost.** Two things, both real.

The engine has to be copy-on-write over four typed arrays, because `step()` is
pure and the belief changes. The solution is to share `belief` by reference
until a sweep would actually change it, then clone only `observed` and
`hazard` (`slopeDeg` and `elevation` have no writer). At 0.8 m/s over 4 m cells
the rover's cell changes about every fourth tick, so most ticks skip the copy.

And the renderer cannot cache on object identity, because the contract
produces both failure directions at once: `observe()` mutates in place (so
identity says "fresh" while contents moved) and `step()` is pure (so identity
says "changed" while contents are the same). The fix is a proof rather than a
heuristic — everything mutable in `Belief` is a function of which cells are
observed, and `observed` only ever goes 0 → 1, so the *count* of observed cells
changes exactly when the contents do. That is in
[ENGINEERING_NOTES.md](ENGINEERING_NOTES.md) with the measurement that backs
it.

---

## 3. The algorithms

### A\* over a four-term cost field

8-connected grid, 96×96, no corner cutting (a diagonal is legal only when both
orthogonal neighbours it squeezes between are passable — a vehicle with width
cannot slip through a corner contact point). Binary min-heap over two parallel
arrays with lazy deletion, so the hot loop allocates nothing and
decrease-key is handled by skipping stale pops against the closed set.

The cost of a step is a weighted sum of four terms, each divided by the largest
value it can legally take so the weights are comparable:

```
distance : L/√2                        L ∈ {1, √2}            → [0.707, 1]
slope    : slopeDeg(to)/maxSlopeDeg    constraint-bounded     → [0, 1]
hazard   : hazard(to)                  already 0..1           → [0, 1]
energy   : E_step/E_max                E_max = diagonal at the slope limit
```

Weights are themselves normalised to sum to 1, so a step costs at most ~1 and
route totals are comparable across *different* preference settings. That is
what lets the engine plan three candidate routes under three different weight
sets and then pick an argmin across them.

If the normalisation were skipped, the four weights would silently be encoding
unit conversions — metres against degrees against a dimensionless severity
against watt-hours — and moving a slider would do something unpredictable.
This is the kind of thing that works by accident until someone changes
`METRES_PER_CELL`.

### The admissibility argument, and the oracle that checks it

This is the most defensible thing in the repository and the thing to attack
first.

For a step of length $L$ cell-lengths, the slope and hazard terms are
non-negative, the distance term is exactly $w_d L/\sqrt2$, and the energy term
is at least $w_e \cdot 4fL/E_{\max}$ because the uphill angle is non-negative.
So every step costs at least $\kappa L$ where

$$\kappa = \frac{w_d}{\sqrt2} + \frac{4 f w_e}{E_{\max}}$$

Octile distance is the minimum achievable path *length* on an 8-connected grid
ignoring obstacles, so $\kappa \cdot h_\text{oct}$ lower-bounds the cost of any
path to the goal. Admissible. The bound is per-unit-length and octile obeys the
triangle inequality, so it is also consistent — which is what licenses the
closed-set guard, because no node will ever be re-expanded with a better $g$.

An argument on a whiteboard is not evidence. `planUniformCost()` is the
identical search with $h = 0$ — Dijkstra — and exists for no reason except to
be an oracle. Dijkstra cannot be wrong about optimality, so an inadmissible
heuristic shows up as a cost disagreement. Nothing else in a test suite would
catch it: a slightly-too-strong heuristic still returns a plausible route, and
every other assertion you would write about a planner still passes.

The unit test asserts the equality over 24 independently generated terrains.
The benchmark widens it in the direction the proof is weakest — the bound uses
only two of the four weights and throws slope and hazard away, so it is
loosest at *low* risk tolerance where the hazard weight is largest — and runs
**160 terrains across four tolerances**. Result: **max absolute cost gap 0.0 at
every level.** Not "within 1e-9"; the two searches return the identical float.

The same measurement produces the result I find most satisfying in the project,
because it was predicted by the proof before it was measured:

| riskTolerance | A\* nodes as % of the oracle's |
|---|---|
| 0.05 | 48.7 |
| 0.25 | 48.7 |
| 0.55 | 36.3 |
| 0.85 | 31.8 |

**The heuristic gets monotonically worse as the mission gets more cautious**,
because the share of true cost carried by the term the bound ignores grows. A
risk-averse mission is intrinsically more expensive to plan, for a structural
reason rather than an implementation one.

### Candidate selection, and a thing A\* structurally cannot do

Each decision plans three postures — current preferences, risk-averse (a 0.4
lower tolerance *and* a ceiling at 0.65 of the configured one, so both the
preference and the set of legal routes change), and most-direct. All three are
re-costed in one common currency so the numbers in the decision record are
comparable.

But then the "current preferences" candidate is the argmin *by construction* —
A\* already returned the optimum under exactly those weights — and the contest
is theatre. The tie is broken by charging for peak hazard above the stated
tolerance:

```
score = totalCost + 0.6 · max(0, peakHazard − riskTolerance) · routeLengthCells
```

`peakHazard` is a **maximum over the path**, not a sum over steps, so no
shortest-path search can minimise it as part of its objective. That is the one
dimension on which a different candidate can genuinely win, and it is why the
penalty exists rather than being a tuning knob someone added.

The benchmark contains a measured instance of the underlying gap: on one seed
of `dynamic-hazard`, the risk-aware *planner* returned a route whose peak
hazard was **higher** than the shortest-distance planner's, while its mean
hazard was 51% lower. Minimising a sum does not minimise a max. That single
seed is the empirical argument for the selection penalty.

### Human approval as a state value

`InterventionRequest` is a field on `SimState`. `step()` becomes a no-op while
one is outstanding, and the simulation resumes through `resolveIntervention()`.
The obvious alternative — await a promise inside the loop — makes the mission
impossible to replay headlessly, impossible to unit-test without a fake clock,
and blocks whatever is driving the loop.

The cost is more explicit state transitions to keep correct. The benefit shows
up in the reproducibility gate, where a supervised mission that is held, then
answered, then driven to a second hold, replays byte-identically from a record
that stores only the resolution ticks and option ids.

---

## 4. Determinism, and the one place it is violated on purpose

A mission is a pure function of `(scenarioId, seed, config, resolutions)`.
`MissionRecord` stores exactly those plus the event and decision logs, and
**no terrain and no trajectory**. `replay()` re-runs the engine. A record that
stored derived data as well could disagree with the engine; this one cannot,
because there is nothing to disagree.

Nothing in `core/` calls `Date.now()` or `Math.random()`. Randomness is a
seeded mulberry32 consumed in a fixed order. Time is an integer tick. The one
wall-clock reading is `performance.now()` at the boundary of the planner
search, and it is a measurement nothing branches on — no budget, no timeout, no
early exit depends on it.

**That one exception caused the most instructive bug in the project**, and it
is not a bug in the engine. `MissionMetrics` carries `planMsTotal` — summed
planner wall clock — alongside sixteen deterministic outcome fields. So the
obvious determinism assertion,

```ts
expect(computeMetrics(live)).toEqual(computeMetrics(replay(record)))
```

fails on every scenario, every time. Measured here: 17.6 ms live against
3.1 ms on a warm replay, a 5.6× gap, with the other sixteen fields matching
exactly and the event log byte-identical. Replay was never broken. Mixing a
*measurement of the machine* into a struct of *results of the computation*
means the struct inherits the weaker property, and the failure then points at
the wrong subsystem.

The benchmark's response is structural rather than a comment: `metricsDigest`
drops that field by name, and the timing experiment is the only part of the
harness that does not reproduce exactly, segregated into its own section of
both the stdout and the JSON.

---

## 5. What was measured, and what it says

`npx tsx bench/run.ts` — 15 seconds, 540 sweep missions plus the comparisons.
Full tables and the honest reading in [RESEARCH.md](RESEARCH.md).

**The headline is a trade, and it is a good one in isolation.** Against a
shortest-distance baseline under identical hard constraints, on identical
beliefs, paired per seed across 33 planning problems: **mean hazard along the
route falls 51–60%, peak hazard 9–20%, for 0.8–3.8% more distance.** Mean
hazard was lower on 33 of 33 paired seeds. Energy is unchanged — −0.6% to
+1.6%, spanning zero.

**About half of the safety is the hard constraint, not the cost function.** A
third arm — distance-only weights with the hazard ceiling opened from 0.51 to
0.95 — widens the peak-hazard gap from 9–20% to 30–44%. Without that arm,
"the cost model made it safer" and "the constraint made it safer" are
indistinguishable, and a reader would credit the wrong mechanism.

**And it is not free once the loop closes.** On `dynamic-hazard`, risk-aware
missions complete **8 of 12** seeds against a distance-dominant arm's 11 of 12
— the tighter ceiling makes three terrains unroutable and one mission drives
1019 m, replans 76 times and then finds no route at all — and the distance
penalty grows from +3.8% in a single plan to **+24.4%** over a replanning
mission, because each replan starts from where the rover actually is. The
exchange is a 51.6% lower peak hazard driven, on 8 of 8 paired seeds.

Risk aversion costs completion rate. That is the sort of result a benchmark is
for, and it is not visible from a single scenario at a single seed.

**A negative result about the product.** `energyPriority` changes the driven
trail on 30 of 32 paired missions and saves a median **0.2–0.5%** energy. It is
wired up and it does nothing useful. The reason is measured rather than
guessed: the climb term is only 12–19% of a route's energy, and net elevation
change is fixed by the endpoints, so the only climb energy a planner can remove
is gratuitous up-and-down — which fractal terrain at 36–52 m relief over 384 m
does not offer much of. The slider will only earn its place on much higher
relief or much longer routes.

**Weighted A\* is cheap and has a side effect worth knowing.** At
`heuristicWeight` 1.25 the search expands 3–10× fewer nodes for under 2% above
the optimum. But the inflated heuristic is a *distance* bound, so weighting it
up weights distance up against everything else: on `baseline-traverse` the
median peak hazard of the returned route rises from 0.240 at w=1 to 0.492 at
w=2. A control that appears to trade accuracy for speed is quietly also
trading away caution. (The engine always plans at w=1; the knob exists on
`PlanRequest` and is swept only by the benchmark.)

**Performance.** One plan is 1–3 ms on 96×96; a whole headless mission is
6–26 ms. That is what makes the planner view re-plan on every slider drag
without a worker, and what makes a 540-mission sweep a shell command.

---

## 6. The benchmark harness itself

`bench/run.ts` plus six experiment modules. Four properties it was built to
have, because a benchmark that lacks them is decoration:

**It cannot quote a bare mean of three runs.** Every continuous quantity goes
through `summarise()` and is rendered as `median [p25–p75]`. Comparisons are
**paired by seed** — between-seed variation in route length is far larger than
the effect being measured, so differencing the same mission against itself is
the only way to see it — and every paired median is reported next to a win
count, because a median improvement that holds on 6 of 12 seeds and one that
holds on 12 of 12 are different findings.

**It distinguishes three things that all arrive as `outcome: 'failed'`.** A
mission with no route at tick 0 (`unroutable`) contributes 0 m and 0 Wh, and
pooling those zeros into a distance median would pull it toward zero in
proportion to how hostile the scenario is — which would read as "the hard
scenario has shorter routes". So continuous columns pool missions that drove,
completion rate is over all seeds, and unroutable is its own column.

**Every timing has a warm-up and a repeat count attached to the number.**
Cold-versus-warm on the same planner call is a 5.6× gap; a timing taken without
one overstates the cost by 5×.

**The reproducibility gate is validated in both directions.** It was confirmed
to fail, with a non-zero exit and a named digest, against a deliberately
corrupted `golden.json` and against a missing one. A gate that has only ever
been seen to pass has not been tested. Its seven cases are chosen for path
coverage rather than parameter coverage: a clean traverse, a replanning
mission, a supervised hold, a supervised hold that is *answered* and then
replayed from the recorded resolution, a mission that fails after a kilometre,
and one that has no route at all.

The gate paid for itself during this work. Another agent renamed
`RoverSpec.idleW` to `idleWhPerS` across `types.ts`, `scenarios.ts` and
`engine.ts` mid-session; the seven digests still matched, which is precisely
the evidence a refactor needs and which a suite of behavioural assertions is
slower at producing.

---

## 7. What is unfinished, and what I would not defend

**The rover always knows exactly where it is.** No localisation error, no
odometry drift, no slip. This is the largest gap between the simulation and a
real mission, and it is load-bearing: position uncertainty is what makes a 4 m
hazard map hard to use, because the hazard you planned around and the hazard
you are next to are offset by your error. Everything in §5 is measured in a
world where that problem does not exist. I would expect the risk-aware
advantage to *grow* under position noise — a route at 0.017 mean hazard has
more margin to be wrong than one at 0.068 — but that is a hypothesis, not a
result.

**"Risk tolerance 0.45" is not calibrated against anything.** Hazard severity
is a scalar in [0,1] with no failure-probability semantics, so every risk
statement in this project is internal to the model. The fix is specific and I
did not do it: define a failure event, map severity to a per-metre failure
probability, and replace the weighted hazard sum with $-\log\prod(1-p_i)$,
which is additive and therefore still A\*-able. Risk tolerance would then be an
acceptable mission failure probability — something a mission planner could
argue about — and the peak-versus-mean tension in §3 would largely dissolve.

**The engine throws away search effort.** `plan()` returns
`nodesExpanded`; the engine accumulates only wall clock and a call count into
`MissionMetrics`. So every node count in the benchmark is open-loop, and the
closed-loop tables report `planCount` as a proxy. Given that risk aversion
costs 2–12× expansions *and* roughly 2× the replans, the compounded closed-loop
cost is probably much worse than either figure suggests — and I cannot
currently measure it. It is a two-line engine change in someone else's file.

**`peakHazardTraversed` is computed with hindsight.** It reads the *end-state*
belief along the whole trail, so a cell crossed while believed clear and only
later observed to be bad is counted at its discovered severity. That is the
right number for "how dangerous was the ground it drove over" and the wrong
number for "how much risk did the planner knowingly accept". The second is
arguably more interesting and is not computed anywhere.

**The seed ensemble is a sample of terrains, not of missions.** A seed changes
the world but not the start cell or the waypoints, so up to 8 of 12 seeds are
unroutable at low tolerance. The unroutable fraction is therefore partly an
artefact of holding the endpoints fixed. Twelve seeds is also small, and
nothing here is a significance test — the paired design is what makes the
effects legible at that n.

**The canonical seeds are selected.** `competing-objectives` seed 16 was chosen
by sweeping 400 seeds for the widest low-vs-high-tolerance gap. Any
single-seed number from it is a best case by construction, which is why the
ensemble medians are given alongside everywhere.

**The grid is 8-connected, so the planner cannot produce a heading off a 45°
increment.** Routes zig-zag where an any-angle planner (Theta\*, Field D\*)
would cut straight, and the absolute distances carry that penalty. The
comparisons are unaffected — both arms pay it — but the numbers are not what a
continuous planner would produce.

**Everything is 96×96 and single-rover.** No coordination, no comms latency, no
bandwidth budget. A supervised intervention here is instantaneous and free; a
real one costs a round trip and a window in which the rover sits still.

**Two engine constants are behaviourally decisive and are swept nowhere.**
`MATERIAL_HAZARD_RISE` (0.05) and `REPEATED_REPLAN_LIMIT` (4). The 27-replan
median and the 1 km late failure both look like threshold artefacts, and the
honest way to find out is to vary them, which the harness does not yet do.

---

## 8. If you want to find a mistake

In descending order of where I would look.

1. **The heuristic.** The admissibility argument in §3 is the load-bearing
   claim, and the empirical check is only as good as the terrain family it
   samples. `planUniformCost` makes the check cheap to extend — point it at a
   terrain with a pathological slope/hazard correlation and see whether the
   bound still holds.
2. **`PEAK_EXCEEDANCE_PENALTY = 0.6`.** It is the one number in the selection
   path that is a tuning constant rather than a derivation, and it scales with
   route length, so its effect on a 2 km traverse is not the effect it has on
   the 400 m ones measured here.
3. **The replan trigger.** `MATERIAL_HAZARD_RISE` de-bounces sensor sweeps, and
   a mission that replans 76 times before failing is either the trigger being
   too sensitive or the rover genuinely trapping itself. Nobody has looked.
4. **The closed-loop distance penalty.** +24.4% is much larger than the +3.8%
   open-loop figure, and the explanation offered — that each replan starts from
   where the rover actually is — is plausible and unverified. A histogram of
   replan locations would settle it.
