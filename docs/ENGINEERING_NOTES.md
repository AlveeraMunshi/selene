
## Root config is a shared dependency no agent owns (orchestrator, wave 1)

`tsconfig.json` carried `"baseUrl": "."`, copied from the habitual Vite React
template. TypeScript **7.0.2** removed the option outright:

```
tsconfig.json:19:5 - error TS5102: Option 'baseUrl' has been removed.
```

This is a *config-level* error, so `tsc` fails **before reading a single source
file**. Every one of the four parallel agents inherited a typecheck that could
not pass no matter what they wrote, and none of them could fix it, because the
file partitioning that makes parallel work safe had explicitly put root config
outside all of their lanes. One agent diagnosed it and worked around it with a
scoped tsconfig in a temp directory; the cost was paid by all four.

**The mechanism:** file-ownership partitioning protects agents from each other
and leaves a shared root that belongs to nobody. A fault there is invisible in
each agent's local reasoning ("my files are fine") and fatal globally.

**The fix is ordering, not vigilance.** Before launching parallel agents, the
orchestrator runs the full verification command — typecheck, test, build — on a
trivial placeholder and sees it pass. A toolchain proven green on one file stays
green for twenty. Validating `vitest` this way caught nothing because it was
already correct; validating `tsc` would have cost one call and saved four agents
a false signal.

Removing `baseUrl` was sufficient: TS 5+ resolves `paths` relative to the
tsconfig's own directory, so `"@/*": ["./src/*"]` needs no base. Tree went from
"fails before parsing" to **0 errors** across 21 agent-written files.

## Object identity is the wrong cache key in both directions (agent D, wave 1)

The terrain bitmap is baked once per belief change and blitted every frame. The
obvious key is `state.belief`, and it is wrong twice over:

- `observe()` is specified to **mutate the belief in place**, so the object the
  cache already holds is the object that changed — identity says "fresh" while
  the contents moved. Stale frames.
- `step()` is specified to be **pure**, so an unchanged belief arrives as a new
  object every tick — identity says "changed" while the contents are the same.
  A 16k-cell repaint twice a second for nothing.

One contract produces both failures, which is what makes it worth writing down:
a key derived from identity cannot be right when some code paths mutate and
others copy.

**What is sufficient instead:** everything mutable in `Belief` is a function of
which cells are observed (`hazard` is the orbital layer plus the hidden layer on
observed cells; `slopeDeg` and `elevation` are copied at creation and frozen),
and `observed` only ever goes 0 → 1. So the **count of observed cells** changes
whenever the belief's contents change. That is a proof, not a heuristic, and it
costs one pass over a `Uint8Array`.

**Making it cheap:** the count is O(n), and n is 16,384 at 60 fps. The belief
cannot change unless the engine stepped, and a step always advances `tick`, so
an unchanged `tick` **plus** an unchanged `observed` array reference is a proof
that the count is unchanged. That skips the scan on ~29 of every 30 frames while
still catching a loaded or replayed state that happens to share a tick number.

Measured on the mock 128×128 fixture: 1 bake per belief change instead of 1 per
frame. The test asserts `cache.bakes` directly, because this is otherwise
invisible — a cache that repaints every frame looks perfect and runs slow, and
one that never repaints looks perfect until the rover moves.

## A rAF loop that reads props draws one state forever (agent D, wave 1)

A `requestAnimationFrame` loop started inside an effect closes over the props of
the render that created it. Reading `state` directly means the loop draws that
one state for the lifetime of the component — and because the loop keeps
running and the canvas keeps being repainted with identical pixels, **the
symptom is a map frozen at tick 0 while the sidebar numbers advance**. It reads
as a broken engine, which is where the hours go.

The fix is three lines: keep the latest `state`/`opts` in refs, start the loop
once, have the loop read only refs. The non-obvious part is *where* the refs are
written — in a **layout effect**, not during render. Assigning a ref while
rendering stores values from renders React may discard; a layout effect runs
after commit and before paint, so the next frame is guaranteed to see committed
data and is never a frame behind.

**Verified by breaking it.** Swapping `stateRef.current` back to `state` makes
the test fail with `expected 2 to be 3` — the frame drew the old state's two
waypoints instead of the new state's three. A test for a stale closure that
still passes against the stale implementation is not a test.

## dpr belongs in exactly one place, and hit-testing is not it (agent D, wave 1)

Canvas device-pixel-ratio handling has two halves that look like one:

- the **backing store** is `cssPx × dpr`, with `ctx.setTransform(dpr,0,0,dpr,0,0)`
  once per frame so all drawing is in CSS pixels;
- **`getBoundingClientRect` already reports CSS pixels**, so `cellAt` must not
  divide by dpr at all.

Dividing the pointer position by dpr is the natural-looking mistake and it is
**correct at 1×**, which is the machine most people develop on. It then selects
the wrong cell on every retina display. The test sweeps dpr ∈ {1, 1.25, 2, 3}
across five canvas aspect ratios and asserts every cell centre round-trips —
exhaustive because the failure is a quiet off-by-one, not a crash.

`setTransform` rather than `scale` for the same reason: `scale` compounds, so a
frame that throws halfway leaves a doubled matrix behind and the next frame
draws at 2×. The test asserts `scale` is never called.

Two more that cost time:

- **Assigning `canvas.width`/`height` resets the entire context state.** Doing
  it unconditionally every frame clears the canvas a second time and discards
  the transform set immediately before. Guard it with an equality check.
- **One formula, one place.** `drawStatic` originally re-derived the letterbox
  origin instead of calling `viewportOrigin`. They agreed at the time. Two
  copies of a layout formula is exactly how the drawn grid and the hit-test
  drift apart, and the symptom — a map that looks right and selects one cell
  off — is the hardest kind to localise.

## A linear alpha makes a continuous hazard field glow everywhere (agent D, wave 1)

Hazard is drawn as a tint whose alpha carries severity. At `alpha = severity`
the map reads as uniformly dangerous: a measured histogram of the fixture
terrain puts **67% of cells under 0.1** and **19% above 0.3**, and at linear
alpha every one of that long mild tail is plainly visible, so a genuinely
impassable cell is only slightly louder than ground the rover would happily
cross.

Two changes fixed it: a floor below which nothing is tinted (0.08), and
`alpha = maxAlpha · severity^1.6`, which pushes the low end down and leaves the
top of the range alone. Severity is normalised against the *effective* risk
tolerance rather than against 1, so moving the tolerance slider visibly relaxes
the map — which is what the slider is for.

This was only visible by **looking at the output**. The bake writes into a plain
RGBA buffer, so it runs headlessly: a ~30-line PNG encoder over `zlib.deflateSync`
dumped the composite to a file in one `tsx` call, with no canvas dependency and
no browser. Worth doing for any per-pixel code — three variants side by side
settled a tuning question that no assertion would have caught.

## A wall-clock field inside a results struct breaks every equality assertion

`MissionMetrics` carried `planMsTotal` — the summed wall-clock time of every
planner call — next to seventeen deterministic outcome fields. The obvious
determinism check is then the one everybody writes first:

```ts
expect(computeMetrics(live)).toEqual(computeMetrics(replay(record)))
```

It fails, on every scenario, every time. Measured here: `22.69ms` live against
`7.35ms` on replay for the same mission — a **3.1x** gap, because the replay ran
with the JIT already warm. The other sixteen fields matched exactly and the full
event log was byte-identical, so replay was never broken at all.

**The mechanism:** mixing a *measurement of the machine* with *results of the
computation* in one struct means the struct inherits the weaker property. The
failure then points at the wrong subsystem — the assertion says "replay
diverged", and replay is correct.

The tell that distinguishes the two cases is cheap and worth reaching for
immediately: **diff field-by-field rather than asserting on the whole struct.**
One differing field named `...Ms` is a measurement problem; several differing
fields spread across the struct is a real divergence.

Either separate the timing into its own type, or — as here, where the benchmark
genuinely wants the number alongside the outcome — document the boundary on the
field itself and compare the event log for determinism instead. The comment has
to live on the field, because that is where the next person will be standing
when the assertion fails.

## A candidate set scored in one candidate's own currency is theatre (agent C, wave 1)

Every replan records three route candidates planned under different risk
postures, and picks the argmin. The obvious implementation is to re-cost all
three under the mission's active weights so the totals are comparable, then
take the smallest.

That comparison **cannot ever be won by anything but "current preferences"**.
A\* already returned the optimum under exactly those weights, so re-costing the
others in the same currency can only put them above it. Three plan calls per
replan, a decision record with three entries, and a predetermined winner.

Varying the *constraints* instead does not help, and the reason is worth
keeping: feasible sets are ordered by inclusion. A tighter ceiling is a subset,
so it can only cost more; a looser ceiling is a superset, so it can only cost
less. Either way the ordering is fixed before any terrain is looked at.

**What breaks the symmetry is a term A\* cannot optimise.** `peakHazard` is a
*maximum over the path*, not a sum over steps, so no shortest-path search can
minimise it as part of its objective — which is exactly why it is available as
a tiebreak that no candidate has already won. Selection is

```
score = cost.total (common currency) + 0.6 x max(0, peakHazard - riskTolerance) x lengthCells
```

and the risk-averse posture now genuinely wins when the cheap route's worst
cell is above what the operator said they would accept.

This also gives `riskTolerance` (a preference) and `maxHazard` (a hard limit)
distinct jobs. `constraintsFor` maps tolerance to a *higher* ceiling —
`0.15 + 0.80 x riskTolerance`, which exceeds the tolerance itself for any value
under 0.75 — so there is a band where a route is legal and above preference.
The penalty is what gives that band teeth, and `risk-exceeds-tolerance` is the
intervention that fires inside it.

**The transferable form:** if you generate alternatives by optimising k
objectives and then rank them by one of those k objectives, you have not built
a decision procedure, you have built an expensive way to re-derive one
optimiser's answer. The ranking criterion must be something none of the
generators optimised.

## Comparing against the cheapest rejected candidate hides the interesting one (agent C, wave 1)

`explainDecision` compares the winner to the runner-up. Taking the runner-up to
be the cheapest non-selected candidate produced, on real missions:

> "Current preferences" was selected on lowest total cost; it was within
> rounding of "Most direct" on every measure.

True, and useless. On open ground "current preferences" and "most direct"
return the *identical path*, so the cheapest rejected candidate is an identical
twin — while "risk-averse", 45 m longer with 0.42 less peak hazard, sat one row
further down and went unmentioned.

Fix: the runner-up is the cheapest rejected candidate that differs
**materially** from the winner, falling back to the cheapest when every posture
agreed (in which case "within rounding" is the right thing to say). Same
decision record, same numbers, and the sentence became:

> against "Risk-averse" it is 45 m shorter, 0.42 more peak hazard, 0.09 more
> mean hazard, 15.4 Wh less energy and 2.31 below it on total cost.

**The mechanism:** "closest in score" and "most informative to contrast
against" are different relations, and in any candidate set with near-duplicates
they pick different elements.

## Without a materiality threshold the rover replans on noise (agent C, wave 1)

The spec is "a discovered hazard on the remaining route triggers a replan". Read
literally, that fires on a cell whose believed hazard rose from 0.300 to 0.301,
and a sensor sweep crossing a concealment patch nudges dozens of cells at once.

Measured, with the threshold at 0 vs the shipped 0.05:

| scenario | replans @0 | replans @0.05 | plan() calls @0 | @0.05 |
|---|---|---|---|---|
| baseline-traverse | 3 | **0** | 15 | **6** |
| dynamic-hazard | 12 | **9** | 39 | **30** |
| competing-objectives | 0 | 0 | 3 | 3 |

Baseline is the interesting row. Its hidden hazards peak at **0.045 severity** —
genuinely nothing — and without the threshold they provoked three full replans,
which would have falsified the scenario's own hypothesis that a well-surveyed
traverse survives contact with the terrain. The scenario was not mistuned; the
trigger was.

A cell that becomes *impassable* bypasses the threshold entirely, so nothing
that actually blocks the route is ever filtered out.

**Needed for this:** `observationDelta` reports `previous` alongside the new
severity. A trigger that can only see the new value cannot tell a discovery
from a confirmation.

## Resetting a counter on the wrong event asks the same question forever (agent C, wave 1)

`repeated-replanning` fires at 4 replans for the same waypoint, counted from the
event log as "replan-triggered events since the last waypoint-reached". On a
**single-waypoint** mission that denominator never resets, so replans 4, 5, 6, 7
and 8 each raised a fresh intervention: dynamic-hazard supervised asked the
operator **6 times**, five of them after they had already said "carry on".

Counting since the last `waypoint-reached` **or** `intervention-resolved` took
it to **2**. The operator's acknowledgement is what the budget should restart
from, because the budget exists to catch *unattended* thrash.

**Generalisable:** a rate limiter whose window resets on task progress starves
on any task with one step. Reset on the acknowledgement, not only on the
progress.

## Scenario parameters cannot be reasoned to; the seed has to be swept (agent C, wave 1)

`competing-objectives` has to offer a genuine short-risky / long-safe choice.
Hand-picked parameters (9 rubble fields, seed 31415927) gave routes of 490 m
and 474 m at peak hazard 0.79 and 0.55 — a route change, technically, and not a
dilemma anybody would notice.

Sweeping 400 seeds at 14 rubble fields, scoring each by
`Δdistance + 300 x Δpeak-hazard` between the riskTolerance-0.15 and -0.90
routes, produced **213 viable candidates**. The best (seed 16) gives:

| riskTolerance | distance | peak hazard |
|---|---|---|
| 0.15 | 752 m | 0.27 |
| 0.50 | 531 m | 0.43 |
| 0.90 | 490 m | 0.75 |

Three visibly different corridors, 53% distance spread, 0.48 hazard spread.
The sweep took 2.7 seconds. The rubble-field count was the parameter that
mattered — at 9 the map is porous enough that every tolerance finds the same
gap; at 14 there is a near-complete barrier with one risky opening in it.

**The lesson is about cost asymmetry.** Reasoning about what a noise field will
produce is unreliable and unfalsifiable; running the generator 400 times costs
three seconds and yields a measured answer plus a ranked list of alternatives.
Any scenario claim in `scenarios.ts` that was not produced this way is a guess.

## A start cell must be clean in both hazard layers, not just the visible one (agent C, wave 1)

Scenario start cells were placed by eye at the map corners. At
`riskTolerance 0.15` (ceiling 0.27) two of the three scenarios returned
**`start-impassable`** before the mission began — the rover was parked on
orbital rubble.

The subtler half: a start clean in `hazard` but sitting inside a *concealment
patch* passes every static check and then becomes impassable on tick 1, when
the rover's own sensors fold `hiddenHazard` in. The placement search therefore
screens on `min(1, hazard + hiddenHazard)`, which is what the belief will hold
the instant the first sweep lands, and there is a test asserting it for every
shipped scenario.

## Copy-on-write only pays if you probe before you clone (agent C, wave 1)

`step()` is pure and `observe()` is specified to mutate the belief in place, so
every tick must clone before sensing: a `Uint8Array` and a `Float32Array` over
9,216 cells, ~46 KB, 2 ticks of simulated second.

But at 0.8 m/s over 4 m cells the rover's **cell** changes only about every
fourth tick, and a sweep from an unchanged cell changes nothing at all. So
`observationDelta()` computes what a sweep *would* change without writing, and
the clone happens only when the delta is non-empty — roughly one tick in four.

`cloneBelief` additionally copies only `observed` and `hazard`; `slopeDeg` and
`elevation` have no writer anywhere in the engine and are aliased. There is a
test asserting the aliasing, because it is the kind of optimisation that is
silently correct until someone adds a writer.

## The A\* heuristic bound must be per unit length, not per step (agent C, wave 1)

Octile distance mixes steps of length 1 and √2, so a heuristic of
`octile x (minimum cost of a step)` is **not** admissible: the minimum step cost
is an orthogonal step's, and multiplying it by an octile distance that counts
diagonals as 1.414 over-estimates whenever the optimal path is diagonal.

The bound has to be per **cell-length**:

```
stepCost >= L x ( w.distance/√2 + w.energy x flatWhPerM x METRES_PER_CELL / MAXE )
```

— both surviving terms are exactly linear in L, the other two are non-negative,
and octile is the minimum achievable path length in cell-lengths. It is also
consistent, so no node is re-expanded.

This is asserted two ways: numerically in `cost.test.ts` over every legal step
of a generated map (>10,000 steps), and end-to-end in `planner.test.ts`, where
A\* and a Dijkstra oracle must agree on total cost to 1e-9 across 24
independent terrains. The second test is the one that would catch a subtly
over-strong heuristic; the first is the one that says *why*.

## A supervised mission is already waiting before its first tick (agent E, wave 1)

`createSimulation(config)` does not return an inert state. Under the default
supervised autonomy it plans the opening route and raises an approval request
for it, so the state comes back at `tick: 0` with `pendingIntervention` set and
the rover in `awaiting-approval`.

Two things in the app layer were written on the opposite assumption and both
were wrong in ways that do not throw.

`launch()` set `status: 'running'` and started the ticker. The first interval
callback then discovered the request and paused — so the UI claimed the mission
was running for half a second before admitting it was stopped. That is precisely
the confusion the intervention panel exists to prevent, arriving from the one
place guaranteed to show it to every user on every launch. `launch()` now reads
`pendingIntervention` off the freshly created state and opens paused.

The shell then moved the operator to the Mission tab by watching for `status`
to become `'running'` — which, for the common case, now never happens. Replaced
with a callback passed down to the planner, which is better anyway: a component
that wants to know a thing happened should be told, not left to infer it from a
state machine it does not own.

The general shape: **a constructor that performs work can return a state that is
already in the middle of the state machine**, and an app layer that assumes
"fresh means idle" will be wrong silently rather than loudly.

## A debounce that only setters trigger never runs for the initial state (agent E, wave 1)

The planner's route preview is debounced in the store rather than in the view,
so that "the preview always reflects the config" is true by construction rather
than by every view remembering to wire it. Every config setter calls
`schedulePreview()`.

The store starts with a scenario and its suggested waypoints already configured,
so there is something to preview before the user touches anything — and because
no setter had run, nothing ever scheduled it. The planner sat on "Planning" with
Launch disabled and no reason given, forever, until a slider was moved. The
`previewPending: true` initial flag made it look like work in progress rather
than work that would never start.

Fixed with an explicit `initMissionStore()` called from the shell's mount
effect, rather than a module-level side effect: importing the store should not
generate terrain in a test or on a server.

Caught by a render test asserting `preview?.ok` after the debounce window, which
is the kind of thing a typecheck cannot see and a human clicking around would
blame on the planner being slow.

## Keyframes, not frames, because a SimState carries the belief (agent E, wave 1)

`MissionRecord` stores inputs rather than frames (D7), and `replay()` returns
only the final state — correct for asserting that a record reproduces its
mission, useless for a scrubber. The obvious fix, keeping every intermediate
state, costs more than it looks: a `SimState` holds the belief, which is four
arrays of `width x height`. At 128x128 that is ~210 KB per frame, so a
1,800-tick mission is nearly 400 MB.

Keyframes every N ticks plus a short forward step on seek costs a few megabytes
and bounded time. The stride doubles (and the list halves) whenever the keyframe
count exceeds its budget, so memory is capped rather than merely small for the
missions that exist today.

Measured on the three shipped scenarios: 38–48 keyframes, build 12 ms, and 40
random seeks in 4 ms.

This only works because `step()` really is pure about the belief. That was
verified rather than assumed — if `observe()` had mutated a shared belief in
place, every keyframe would alias the final one and the scrubber would show the
end-state fog at tick 0, which looks like a rendering bug rather than a memory
model bug.

## A conditional child breaks an explicit grid-rows template (agent E, wave 1)

The mission column was `grid-rows-[auto_minmax(360px,1fr)_auto]` over three
children: intervention panel, map, transport bar. The intervention panel is
rendered conditionally and most ticks have no request outstanding — at which
point there are two children, the map silently takes the `auto` row and the
transport bar takes the `minmax(360px,1fr)`. The layout is wrong exactly when
nothing is wrong with the mission.

A conditional child and a positional row template cannot both be right. Flex
with `grow` on the map handles both cases, because it assigns space by what is
present rather than by position.

## Recharts' tooltip generics do not survive a render function (agent E, wave 1)

`<Tooltip content={<Custom />} />` fails to typecheck because the element form
is typed as needing every prop Recharts injects at runtime. The render-function
form `content={(props) => <Custom {...props} />}` fails differently: the
`ValueType`/`NameType` parameters are inferred from the chart and do not unify
with a component annotated `TooltipContentProps<number, string>`.

Typing the tooltip against the three fields it actually reads — `active`,
`label`, `payload`, each narrowed before use — is both shorter than fighting
the inference and more honest about the component's real contract. Worth
reaching for sooner than I did: a library's generic prop type is not
automatically the right type for your own component.

## Two grid blowouts that hid a whole panel, and neither threw anything

Found by opening the app in a browser after wave 1. Typecheck was clean, 296
tests passed, the production build succeeded, and three agents had each
verified their own files. Nobody had looked at a pixel, and the planner was
losing an entire panel off the right edge of the screen.

### 1. A grid item will not shrink below its content

The rail was 340px wide and correct. The `<Panel>` inside it measured **467px**
and ran to x=1567 in a 1456px viewport — and because the ancestor clipped rather
than scrolled, `document.scrollWidth === clientWidth`, so **the usual overflow
check reported no overflow**. 105 elements were off-screen and the page looked
calm.

A grid item's `min-width` computes to `auto`, which means *min-content*: the
item refuses to shrink below the widest thing in it, and happily overflows its
track instead. The outer three-column grid already guarded against this with
`grid-cols-[320px_minmax(0,1fr)_340px]` — the `minmax(0,...)` idiom exists for
exactly this — but the single-column rails inside it did not, and a nested grid
needs the same guard as the outer one.

The detection that works, since `scrollWidth` does not: walk every element and
compare `getBoundingClientRect().right` against `clientWidth`.

### 2. `min-h-0` on the item lets the rows collapse and then equalise

With the width fixed, the four panels still overlapped. The rail reported
`grid-template-rows: 167.75px 167.75px 167.75px 167.75px` while the panels
needed 442, 555, 242 and 169 — every row forced to an identical
`(719 - 3*16) / 4`, with `overflow: visible` spilling the excess over the panel
below.

`align-content: start` does **not** fix it; setting it changed nothing. The
cause is one step away: each `Panel` carries `min-h-0` (correct, and necessary
for its own internal scrolling), which drops each row's min-content contribution
to zero. Four rows that may each be zero, inside a container with a definite
height, get the height split equally between them. The fix is to size the rows
by their content — `grid-auto-rows: min-content` — after which the rail's
content legitimately exceeds its height and the `overflow-y-auto` that was
already there starts doing its job.

**What this pair is really about.** Both bugs are a parent correctly sized and a
child that declines to fit, and in both the symptom is silent: no error, no
console warning, no failing test, and in the first case not even a scrollbar.
The panel that vanished was the cost breakdown — the one piece of UI that
demonstrates the planner is real. A build can be green in every automated sense
and still be shipping a blank space where its best feature was.

The cheap check, worth running once per layout: count elements whose right edge
exceeds the viewport, and compare each flex/grid child's `scrollHeight` against
its laid-out `height`. Both are a few lines in the console and both find this
class of fault instantly.

## A two-arm baseline cannot tell a cost function from a constraint (agent G, bench)

The benchmark's headline question is whether risk-aware planning buys anything
over shortest-distance planning. The obvious experiment is two arms: the
mission's real weights, and `{distance:1, slope:0, hazard:0, energy:0}`, on the
same belief between the same cells.

That experiment is confounded and the confound is invisible in its output. Both
arms are gated by the same `maxHazard`, which at the reference tolerance is
0.51, so the "shortest-distance" arm is really *shortest path that is already
forbidden from entering the worst ground*. Its routes come back looking
respectably safe, and the measured advantage of the risk-aware arm is whatever
is left over — which reads as "the cost function helps a bit".

A third arm settles it in one extra call per seed: distance-only weights with
the ceiling opened to 0.95, the most permissive the system admits. The
peak-hazard gap goes from 9–20% against the constrained baseline to **30–44%**
against the unconstrained one. Roughly half the safety was the hard constraint
the whole time, and with two arms there is no way to know that.

**The mechanism:** when a treatment and a baseline share a *gate* as well as an
*objective*, the gate's contribution is attributed to the objective by default.
Any A/B over a planner with hard constraints has this shape. The fix is cheap
and the failure is silent, which is the worst combination.

## Pooling an unroutable mission into a distance median inverts the result (agent G, bench)

Varying `config.seed` gives a genuinely different world under the same scenario
parameters, which is what makes a seed ensemble worth having. It also means the
fixed start and waypoints land on terrain that sometimes has no route at all:
at `riskTolerance` 0.15 on `competing-objectives`, **8 of 12 seeds** are
unroutable, and the engine reports those as `outcome: 'failed'` with
`distanceM: 0` at tick 0.

Averaging those in does not add noise, it adds bias in a specific direction:
the more hostile the configuration, the more zeros, so the distance median
*falls* as conditions get worse. The table then says low risk tolerance
produces shorter routes, which is the opposite of the truth.

Three buckets are needed and the engine's `outcome` field only distinguishes
one of them:

- **unroutable** — no route at tick 0, nothing driven, excluded from continuous
  medians and reported as its own column;
- **failed** — drove and then could not continue (battery, or replanned into a
  pocket), which is the interesting autonomy failure;
- **held** — supervised, waiting for a human, neither success nor failure.

`classify()` in `bench/lib/mission.ts` separates them on `tick === 0 &&
odometerM === 0`. Completion rate is computed over all seeds; everything
continuous is pooled over missions that actually drove, and both denominators
are printed.

## The admissible bound ignores two of its four weights, and the benchmark can see it (agent G, bench)

`minCostPerCellStep` is `w.distance/√2 + w.energy·flat·M/MAXE`. The slope and
hazard terms are dropped, correctly — they can be zero, so keeping them would
break admissibility. The consequence is not in the proof, it is in the
performance: **the heuristic is weakest exactly when the hazard weight is
largest**.

Measured over 160 terrains, A\* expansions as a percentage of the uniform-cost
oracle's: 31.8% at `riskTolerance` 0.85, 36.3% at 0.55, 48.7% at 0.25 and 0.05.
Monotone, and a 1.5× swing. A risk-averse mission is intrinsically more
expensive to plan.

Worth knowing for two reasons. It predicts where a larger grid will hurt first
— a cautious mission on a 1000×1000 map, not an average one. And it means
`heuristicWeight` is not the neutral speed knob it looks like: the inflated
heuristic is a *distance* bound, so weighting it up weights distance up against
hazard, and the median peak hazard of the returned route rises from 0.240 at
w=1 to 0.492 at w=2 on `baseline-traverse`. A control that appears to trade
accuracy for speed also trades away caution.

## A gate that has only ever passed has not been tested (agent G, bench)

`bench/run.ts --ci` hashes seven missions' event logs, decision logs, trails
and deterministic metrics against `bench/golden.json`. Writing it and watching
it print PASS proves nothing: a gate that compares a digest against itself, or
that silently treats a missing golden file as "no cases to check", passes just
as cheerfully.

Both directions were checked explicitly — a deliberately corrupted digest
produces a named failure and exit 1, and a missing `golden.json` produces an
instruction and exit 1 rather than a vacuous pass. Two minutes, and it is the
difference between a gate and a decoration.

It then earned its keep within the hour. `RoverSpec.idleW` was renamed to
`idleWhPerS` across `types.ts`, `scenarios.ts` and `engine.ts` by a
concurrently-running agent; the seven digests still matched, which is exactly
the evidence a behaviour-preserving refactor needs and which a suite of
assertions is slower at producing.

**One metrics gap found while building it, worth a two-line fix in `engine.ts`:**
`plan()` returns `PlannerStats.nodesExpanded` and the engine discards it,
accumulating only wall clock and a call count into `MissionMetrics`. Closed-loop
search effort is therefore unmeasurable from the public API, so every node
count in the benchmark is open-loop and the closed-loop tables fall back to
`planCount`. Given that risk aversion costs 2–12× expansions *and* roughly 2×
the replans, the compounded figure is probably the interesting one and nobody
can currently see it.

## The e2e harness cannot reach its own server (agent F, wave 2)

`npx playwright test` from a clean checkout fails with
`Timed out waiting 180000ms from config.webServer` — three minutes of nothing,
then a message that says nothing about the cause. The app is fine and the
tests are fine.

`playwright.config.ts` runs `npm run preview -- --port 4173 --strictPort` and
waits on `http://127.0.0.1:4173`. Vite's preview server defaults to
`host: 'localhost'`, and on macOS with Node 17+ `localhost` resolves verbatim
to `::1` first, so the server binds **IPv6 loopback only**:

```
$ lsof -nP -iTCP -sTCP:LISTEN | grep 4173
node  47025  ...  TCP [::1]:4173 (LISTEN)
$ curl -o /dev/null -w '%{http_code}' http://localhost:4173/   # 200
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/   # fails to connect
```

`127.0.0.1` and `::1` are different addresses. The readiness probe never
succeeds, so Playwright waits out the full timeout and never starts a test.

**Either one-token change fixes it**, and both were verified against the
measurements above:

- add `--host 127.0.0.1` to the `webServer.command`, which makes the server
  bind the address the config already names; or
- change `webServer.url` *and* `use.baseURL` to `http://localhost:4173`.

Until then the suite runs only if a correctly-bound server is already up —
`npx vite preview --port 4173 --strictPort --host 127.0.0.1` — because
`reuseExistingServer` is true outside CI. **In CI it is false, so this is a
hard failure there**, which is the worst place for it: the symptom is a
three-minute hang attributed to a slow build.

The generalisation is the one already written at the top of this file about
`baseUrl`: a shared config file belongs to nobody, and a fault in it is
invisible to every agent's local reasoning. The cheap guard is the same —
run the real command once against a trivial spec before building on it.

## Three ways a browser test lies about CSS, all found in one afternoon (agent F, wave 2)

**A transitioned property reads as its start value.** `.focus-ring` paints
`outline: 2px solid transparent` always and colours it under
`:focus-visible`. `Button`, `Tabs`, `Toggle` and the scenario cards also carry
`transition-colors`, and Tailwind's `transition-colors` includes
`outline-color` — so the ring *fades in*. A `getComputedStyle` read taken
immediately after `keyboard.press('Tab')` catches frame one and returns
`rgba(0, 0, 0, 0)`. The first draft of the accessibility test reported **ten
controls with no focus indicator**; every one of them was fine. The tell was
that the four range inputs and the seed `<input>` passed — those are the
controls with no `transition-colors` on them. Poll for the painted state with
a bound; do not read it once.

**An element can be visible, enabled, correctly named — and unclickable.**
See the transport defect below. `toBeVisible()` and `toBeEnabled()` both pass
on an element another element is painted over; only a hit test finds it.
`document.elementFromPoint` at the control's own centre is the check, and
Playwright's own actionability timeout is the assertion.

**A debounced panel shows the previous answer.** The store debounces planning
by 120 ms, so the route figures immediately after a slider moves belong to the
*last* configuration. A test that read them too early took Mare Traverse's
482 m as Rille Crossing's cautious distance and failed a directional
comparison against 490 m. The fix is never to read a derived figure on
arrival: capture the previous text, act, and wait for it to change.

## The mission view's panels overlap below 1100px (agent F, wave 2)

The narrow layout does not stack; it overlaps. Measured by comparing every
pair of `<section>` boxes inside `<main>`, viewport height held at 820:

| width | overlapping pairs | panels past the bottom of `<main>` |
|---|---|---|
| 1280 | 0 | none |
| 900 | **6** | **2** |

At 900px the **Traverse** telemetry panel is covered by the map across its
full 181px height, the **Objective** panel by 154px; the transport panel is
covered by the decision stream and the decision inspector; and the transport
panel and the inspector both extend below `<main>`, with no page scroll to
reach them.

The consequence an operator meets first is that the transport cannot be
clicked. `document.elementFromPoint` at each control's own centre:

| width | Play/Pause | Step | Reset | layer switch |
|---|---|---|---|---|
| 1280 | OK | OK | OK | OK |
| 1100 | OK | OK | OK | OK |
| 1099 | **blocked** | **blocked** | **blocked** | OK |
| 900 | **blocked** | **blocked** | **blocked** | OK |
| 768 | **blocked** | **blocked** | **blocked** | OK |
| 420 | **blocked** | **blocked** | **blocked** | **blocked** |

**Mechanism.** The narrow layout keeps `h-full` on a grid whose three auto
rows cannot hold their content: the telemetry column alone stacks to roughly
600px inside a row of roughly 254px, so it overflows and the next row — later
in the DOM, therefore painted on top — covers it. `overflow-y-auto` on the
outer grid does not help, because the rows are sized against the container
rather than against their contents.

**Why no ordinary assertion catches it.** Every control is `visible`, every
control is `enabled`, every control has the right accessible name, and the
panels all report sensible sizes. `toBeVisible()` passes on an element
something else is painted over. The only checks that find it are a hit test
and a pairwise box comparison, and the only reason to run either is having
looked at a screenshot first.

The one thing that still works at these widths is the Space shortcut, because
a keyboard event does not go through hit-testing — which is the only way to
stop a mission on a narrow viewport today. Both are asserted in
`e2e/06-keyboard-responsive.spec.ts`, the defect as `test.fail()`.

## An aborted mission does not replay as the mission that was aborted (agent F, wave 2)

`toRecord` stores `(config, resolutions)` and stamps `outcome`. An operator
abort is neither — `abortMission()` sets the outcome on the live state and
nothing records that it happened — so `replay()` re-runs from the seed and
simply keeps going.

Measured: a `baseline-traverse` mission aborted at tick 40 produces a record
with `metrics.ticks: 40` and `outcome: 'aborted'`, whose `buildReplaySession`
runs to **tick 1,440** and ends `'complete'`, with `truncated: false`. The
Analysis view then shows a 40-tick aborted mission's metrics beside a
1,440-tick completed mission's map, chart and scrubber, and says nothing.

This is the one case where TEST_PLAN's closing claim — "the recorded mission
is a faithful account of the one that ran" — does not hold. The fix is a line
in the record: either an `abortedAtTick`, or a `mission-aborted` entry the
replay loop honours. Encoded as `it.fails` in
`tests/store-replay.integration.test.ts`.

## No mission can be driven to completion in a browser test (agent F, wave 2)

The three scenarios run 1,816 / 1,440 / 1,026 ticks. The fastest playback the
UI offers is 4x on a 2 Hz base, so the *shortest* of them is 2 minutes 8
seconds of wall clock, and the longest is 3 minutes 47. A journey that watched
one finish would spend its whole budget testing `setInterval`.

Three things made journeys 1–5 affordable anyway, and they are worth knowing
before anyone writes the next one:

- **A supervised mission is already waiting before the first tick.**
  `createSimulation` plans the opening route and raises
  `risk-exceeds-tolerance` on the default configuration, so the intervention
  journey needs zero ticks.
- **`dynamic-hazard` replans at tick 7**, then 13, 19 and 25. Driving it with
  the Step control — one engine tick per click — reaches the first replan in
  seven clicks with no timing dependency at all.
- **A waypoint at (12, 80) instead of the scenario's own (52, 44)** turns
  `baseline-traverse` into a genuinely completed 143-tick mission. That is the
  record `e2e/fixtures/records.ts` builds in Node and seeds into
  `localStorage` for the analysis journey; the browser still re-simulates it
  through `buildReplaySession`, so every figure on screen is computed in the
  page.

## `npm run typecheck` does not cover `e2e/` (agent F, wave 2)

`tsconfig.json` has `"exclude": ["e2e", ...]`, which is right for the build —
Playwright specs must not reach the bundle — and means the e2e suite is
invisible to the project typecheck. They are type-clean under the project's
own strict settings, but only when checked explicitly:

```
npx tsc --ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters \
  --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx \
  --skipLibCheck --lib ES2022,DOM,DOM.Iterable --types node \
  e2e/*.ts e2e/fixtures/*.ts
```

Worth either adding to the `typecheck` script or giving `e2e/` its own
`tsconfig.json` with a project reference.

## One long value hides eight labels (agent F, wave 2)

The decision inspector's "Record" block renders a column of unlabelled
values: `0`, `Intervention resolved`, `Driving`, `4, 88`, a sentence, a
reason code and two percentages, with nothing saying which is which. The
labels are in the DOM, in the accessibility tree, and **zero pixels wide**.

`KeyValue` lays out `grid-cols-[minmax(0,1fr)_auto]` — key elastic, value
content-sized with no cap — and each row is `grid-cols-subgrid`, so every row
shares those two tracks. That sharing is what turns one long value into eight
missing labels rather than one. The decision column is a fixed 380px; the
`Trigger` row on an intervention-resolved decision reads
`operator chose "Proceed on the planned route"` and measures 334px, so the
`auto` track takes it all and the key track resolves to 0. `truncate` on the
`<dt>` then hides it with no ellipsis, because the box has no width to put one
in.

Measured `grid-template-columns` on that `<dl>`: `0px 334px`, identically at
1440, 1700, 2000 and 2400px. The column is fixed, so widening the browser does
not help.

**Why it survived review.** The same component is correct everywhere else —
Analysis's "Planned against executed" keeps a 276px key column, because every
value there is a short figure — and it is correct on the *first* decision a
mission produces, whose trigger is the twelve-character "mission start". It
only breaks on decisions carrying prose, which is to say on the interesting
ones.

A `max-w` or `wrap-anywhere` on the value cell closes it. Encoded as
`test.fail()` in `e2e/08-decision-inspector.spec.ts`, which measures the `dt`
widths directly — no screenshot comparison, because the failure is invisible
in a screenshot taken of the working case.

## The energy slider's stated curve is inverted in practice (agent F, wave 2)

`MissionParameters` tells the operator "every control here changes the cost
function, so the previewed route moves with it", and `cost.ts` explains the
`energyPriority ** 1.5` exponent as chosen "so the first half of the energy
slider does comparatively little and the top end is decisive".

Measured through `computePreview` on each shipped scenario, moving
`energyPriority` across its whole range:

| scenario | 0.0 | 0.5 | 1.0 |
|---|---|---|---|
| baseline-traverse | 482 m | 482 m | 482 m |
| dynamic-hazard | 336 m | 349 m | 349 m |
| competing-objectives | 531 m | 534 m | 534 m |

The weight does reach the planner, so this is not a wiring fault — but the
**top half of the slider is inert on all three maps**, and on
`baseline-traverse` the whole control is. Whatever movement exists happens
between 0 and 0.5, which is the opposite of the comment.

Found by writing an e2e assertion that the control moves the plan and having
it fail honestly. Risk tolerance, by contrast, swings
`competing-objectives` from 752 m at 27% peak hazard to 490 m at 75% — it is
the control the acceptance criterion names, and it works exactly as
documented. There is no test for `energyPriority` in the suite, because an
assertion that it changes the route would be asserting something false.
