# SELENE — research notes

What this system claims, how the claims are tested, what the measurements say,
and where the model stops being worth believing.

Everything numeric below came out of `npx tsx bench/run.ts` on the commit it
was written against. The harness is deterministic: two consecutive runs
produce byte-identical output in every section except the timing section,
which is a measurement of the machine and is segregated for that reason. The
raw record is `bench/out/results.json`.

**This is a simulation.** No lunar data, no flight heritage, no validation
against a real rover. Where a number here looks like a mission result, it is a
result about this simulator.

---

## 1. The three scenarios as hypotheses

Each scenario exists to make one claim falsifiable. The `hypothesis` field in
`src/core/scenarios.ts` is the claim; the terrain parameters were swept until
it held. What follows is the claim, what would break it, and what the
benchmark found.

### H1 — `baseline-traverse` (Mare Traverse)

> With high orbital visibility and sparse hidden hazard, the initial plan
> survives contact with the terrain: the mission completes with at most one
> replan and no intervention.

**Falsified by** a replan, on the canonical seed, at the reference
configuration. The scenario's whole job is to be the control: if the rover
replans here, "it replanned" stops being evidence of anything on the other
two.

**Found.** 0 replans, 6 planner calls, 2/2 waypoints, 482 m, 203.6 Wh, 83%
battery remaining. Across 12 seeds at the reference configuration the median
replan count is 0 with p25–p75 of 0–0, and the maximum over the whole grid
cell is 0. **Holds.**

The scenario is not trivially clean: 33 hazards are discovered, 3 of them on
the active route. None is large enough to clear the engine's 0.05 materiality
threshold, which is what the 0.97 orbital-visibility parameter was tuned to
produce. The control works by making discoveries *immaterial*, not by making
them absent — which is the stronger version of the claim.

### H2 — `dynamic-hazard` (Regolith Trap)

> Low orbital visibility over clustered concealment patches guarantees that
> the initial route crosses ground that looks clear and is not, forcing at
> least one replan driven by a hazard the planner could not have known about.

**Falsified by** zero replans, or by replans that are not attributable to
newly observed hazard.

**Found.** 9 replans on the canonical seed, 246 hazards discovered, 12 of them
on the active route, 30 planner calls against the baseline's 6. Across 12
seeds at the reference configuration the median is 27 replans (p25–p75
11–40). **Holds, emphatically** — arguably too emphatically; see §7.

### H3 — `competing-objectives` (Rille Crossing)

> Dense rubble between start and goal creates two genuinely different homotopy
> classes. Moving `riskTolerance` from low to high flips the selected route
> between the safe detour and the direct corridor, with a measurable
> difference in distance and peak hazard.

**Falsified by** the two tolerance settings producing the same route, or
routes differing by less than the terrain noise between seeds.

**Found, and this is the one that needs qualifying.** On the canonical seed
the effect is large. Measured here, planned route then driven traverse:

| riskTolerance | planned | peak hazard | driven | peak hazard driven |
|---|---|---|---|---|
| 0.15 | 752 m | 0.267 | 752 m | 0.267 |
| 0.85 | 502 m | 0.750 | 483 m | 0.750 |
| 0.90 | 490 m | 0.750 | 471 m | 0.750 |

A **36% shorter traverse for 2.8× the peak hazard**, with the route plainly in
a different homotopy class rather than a perturbation of the same one. Across
the 12-seed ensemble, paired
per seed, moving `riskTolerance` from 0.15 to 0.85 shortens the driven
traverse by a median **−24.0%** (p25–p75 −27.5% to −20.1%, n=4) and raises the
peak hazard driven by **+0.358**.

The qualification is `n=4`. At `riskTolerance` 0.15 only 4 of 12 seeds produce
a mission that completes at all — 8 are unroutable, because a 0.15 tolerance
sets the hard hazard ceiling to 0.27 and the rubble fields close every
corridor. So the hypothesis holds on the seeds where both settings have a
mission, and on the other eight the low-tolerance setting does not have a
route to compare. **Holds, with the completion cost stated in §5.**

Note also that seed 16 was chosen by sweeping 400 seeds for the widest gap
between the low- and high-tolerance routes. The canonical numbers are
therefore a *selected maximum*, not a typical draw, and the ensemble medians
above are the honest figure.

---

## 2. The cost model

Read from `src/core/cost.ts`; the constants are that file's, not estimates.

### 2.1 Preference mapping

The user sets two sliders, `riskTolerance` $r \in [0,1]$ and `energyPriority`
$e \in [0,1]$. Raw weights:

$$
\tilde w_{\text{haz}} = 0.15 + 3.0\,(1-r)^2 \qquad
\tilde w_{\text{ene}} = 0.10 + 1.6\,e^{1.5}
$$
$$
\tilde w_{\text{slp}} = 0.30 + 0.5\,e \qquad
\tilde w_{\text{dist}} = 1.0
$$

then normalised, $w_i = \tilde w_i / \sum_j \tilde w_j$, so $\sum_i w_i = 1$.

Three consequences worth stating because they are not obvious from the
formulae:

- **Distance is held constant and gives way by normalisation.** Raising
  hazard aversion does not lower the distance weight directly; it raises the
  denominator.
- **The quadratic in $(1-r)$ makes the risk slider decisive.** The *raw*
  hazard weight spans 0.15 to 3.15, a factor of 21. After normalisation the
  span is 0.0696 to 0.6111, a factor of **8.8**. The file's own comment quotes
  the raw factor; the normalised one is what the search actually sees.
- **`energyPriority` buys slope aversion as well as energy aversion**, on the
  argument that climbing is where the energy goes. §6 shows this term does
  very little.

At the reference configuration ($r=0.45$, $e=0.4$) the weights are
distance 0.3266, slope 0.1633, hazard 0.3453, energy 0.1648.

### 2.2 Hard constraints

$$
\text{maxHazard} = 0.15 + 0.80\,r
$$

A cell is impassable if its believed hazard exceeds this or its slope exceeds
`maxSlopeDeg`. At the reference $r=0.45$ the ceiling is **0.51**.

The floor of 0.15 stops a zero-tolerance mission being trivially unroutable;
the ceiling of 0.95 preserves the type's promise that hazard 1.0 means
impassable rubble whatever the operator asked for.

Note the deliberate gap: for any $r < 0.75$ there is a band of hazard that is
*legal* (below `maxHazard`) but above the *stated preference* $r$. A route in
that band is what raises a `risk-exceeds-tolerance` intervention.

### 2.3 Energy

$$
E_{\text{step}}(m, \theta) = f\,m + c\,m\max(0,\theta)
$$

with $f = 0.35$ Wh/m, $c = 0.02$ Wh/m/deg, $m$ metres, $\theta$ the uphill
angle in degrees. Downhill is modelled as flat, not regenerative: a rover
brakes downhill, and over-crediting descent would let the planner buy free
range by going over a ridge.

Idle draw is $0.02$ Wh/s of avionics (72 W) regardless of motion.

### 2.4 Step cost and its normalisation

Cells are 4 m square, 8-connected, so a step is $L \in \{1, \sqrt2\}$
cell-lengths and $m = 4L$ metres. Each term is divided by the largest value it
can legally take, so the four weights are comparable:

$$
\begin{aligned}
C_{\text{dist}} &= w_{\text{dist}} \cdot L/\sqrt2 \\
C_{\text{slp}}  &= w_{\text{slp}} \cdot \text{slope}(v)/\text{maxSlopeDeg} \\
C_{\text{haz}}  &= w_{\text{haz}} \cdot \text{hazard}(v) \\
C_{\text{ene}}  &= w_{\text{ene}} \cdot E_{\text{step}}/E_{\max}
\end{aligned}
$$

where $v$ is the destination cell and

$$
E_{\max} = E_{\text{step}}(\sqrt2 \cdot 4,\ \text{maxSlopeDeg})
$$

is the most expensive legal single step — a diagonal taken at the slope limit.
At `maxSlopeDeg` 25 that is **4.8083 Wh**. Each term is therefore in $[0,1]$,
a step costs at most ~1, and route totals are comparable across preference
settings. That comparability is what lets the engine pick an argmin across
candidate routes planned under *different* weights.

Only the destination cell is gated. The rover is already standing on the
source cell, and refusing to let it leave a cell it has just discovered to be
awful would strand it there.

### 2.5 Selection is not the same as search

The engine plans three candidate "postures" per decision — current
preferences, risk-averse (a 0.4 lower tolerance *and* a ceiling at 0.65 of
the configured one), and most-direct — then re-costs all three in one common
currency and picks the argmin of

$$
\text{score} = C_{\text{total}} + 0.6 \cdot \max(0,\ \text{peakHazard} - r) \cdot L_{\text{route}}
$$

The second term is load-bearing. Without it the "current preferences"
candidate is the argmin by construction — A\* already returned the optimum
under exactly those weights — and the comparison is theatre. `peakHazard` is a
**maximum over the path**, not a sum over steps, so no shortest-path search
can minimise it as part of its objective. Charging for peak exceedance is
therefore the one dimension on which a different candidate can genuinely win.

§4 contains a measured instance of this mattering: on one seed the risk-aware
*planner* produced a route with a **higher** peak hazard than the
shortest-distance planner, because it was minimising a sum and peak is a max.

---

## 3. Admissibility of the heuristic

### 3.1 The argument

For a step of length $L$ cell-lengths:

$$
\begin{aligned}
C_{\text{dist}} &= w_{\text{dist}} L/\sqrt2 &&\text{exactly linear in } L\\
C_{\text{slp}} &\ge 0,\quad C_{\text{haz}} \ge 0 \\
C_{\text{ene}} &= w_{\text{ene}}\frac{fL\cdot 4 + cL\cdot 4\theta}{E_{\max}}
  \;\ge\; w_{\text{ene}}\frac{f\cdot 4 L}{E_{\max}} &&\text{since }\theta \ge 0
\end{aligned}
$$

so

$$
C_{\text{step}} \;\ge\; L \underbrace{\left(\frac{w_{\text{dist}}}{\sqrt2}
+ \frac{w_{\text{ene}} \cdot 4f}{E_{\max}}\right)}_{\textstyle \kappa}
$$

$\kappa$ is `minCostPerCellStep`. At the reference configuration
$\kappa = 0.27890$, of which $0.23091$ is the distance part.

Octile distance

$$
h_{\text{oct}}(a,b) = |\Delta x| + |\Delta y| + (\sqrt2 - 2)\min(|\Delta x|,|\Delta y|)
$$

is the minimum achievable path **length**, in cell-lengths, on an 8-connected
grid ignoring every obstacle. Since every step costs at least $\kappa$ per
cell-length, $\kappa \cdot h_{\text{oct}}$ is a lower bound on the cost of any
path to the goal. **Admissible.** The bound is per-unit-length and octile
satisfies the triangle inequality, so it is also **consistent** — no node is
ever re-expanded with a better $g$, which is what licenses the closed-set
guard in the search.

Note what the bound throws away: the slope and hazard terms, entirely. That is
required for admissibility — they can be zero — and it is also the reason the
heuristic gets *weaker* as the hazard weight grows. §3.3 measures that.

### 3.2 The empirical check

`planUniformCost` is the same search with $h = 0$ — Dijkstra. Dijkstra cannot
be wrong about optimality, so if the heuristic is secretly inadmissible the
two disagree. Nothing else in the test suite would catch it: a
slightly-too-strong heuristic still returns a plausible-looking route.

`src/core/__tests__/planner.test.ts` asserts the equality over **N = 24**
independently generated 48×48 terrains, at `riskTolerance` 0.55. (The test
requests 24 problems and asserts at least 20; seeds 1–24 all yield a routable
problem, so the realised N is 24.)

The benchmark widens it in the direction the proof is weakest — low risk
tolerance, where the hazard weight is largest relative to the two terms the
bound actually uses. **160 terrains, four tolerances, 40 each:**

| riskTolerance | terrains | max abs cost gap | max rel gap | violations |
|---|---|---|---|---|
| 0.05 | 40 | 0.0 | 0.0% | 0 |
| 0.25 | 40 | 0.0 | 0.0% | 0 |
| 0.55 | 40 | 0.0 | 0.0% | 0 |
| 0.85 | 40 | 0.0 | 0.0% | 0 |

Exactly zero, not "within tolerance" — the two searches return the identical
float. This is the most defensible claim in the repository, and it is the one
to attack first if you want to find a bug.

### 3.3 What the heuristic buys, and where it stops buying

A\* nodes expanded as a percentage of the uniform-cost search's, same 160
terrains, median [p25–p75]:

| riskTolerance | A\* nodes as % of oracle | A\* expands fewer |
|---|---|---|
| 0.05 | 48.7 [38.8–63.5] | 40/40 |
| 0.25 | 48.7 [35.5–62.5] | 40/40 |
| 0.55 | 36.3 [30.1–44.9] | 40/40 |
| 0.85 | 31.8 [27.8–40.3] | 40/40 |

**The heuristic is monotonically less effective as risk aversion rises**, from
32% of oracle expansions at tolerance 0.85 to 49% at 0.05. That is the
prediction of §3.1 confirmed: the bound uses only the distance and energy
weights, so the larger the share of true cost carried by hazard, the looser it
is, and A\* degenerates toward Dijkstra. A risk-averse mission is
*intrinsically* more expensive to plan, and it is expensive for a structural
reason rather than an implementation one.

---

## 4. Risk-aware A\* against a shortest-distance baseline

### 4.1 Design

The question — does risk-aware planning trade distance for a measurable
reduction in hazard exposure, and by how much — has two halves, so there are
two experiments.

**Open loop** isolates the cost model. One belief (the real one the engine
plans its first leg on: orbital hazard everywhere plus one sensor sweep at the
start), one start, one goal, three weight settings:

| arm | weights | hard constraints |
|---|---|---|
| `risk-aware` | `weightsFor(config)` at $r=0.45,e=0.4$ | `constraintsFor(config)`, ceiling 0.51 |
| `shortest-distance` | `{distance:1, slope:0, hazard:0, energy:0}` | **the same**, ceiling 0.51 |
| `shortest-uncapped` | distance-only | ceiling opened to 0.95 |

The third arm exists because the second one is not a clean baseline: the hard
hazard ceiling is doing some of the work, and without the third arm "the cost
model made the route safer" could really be "the constraint made the route
safer, and the weights did nothing".

**Closed loop** asks whether any of it survives execution. There the engine
cannot be given distance-only weights — `weightsFor` has non-zero floors on
the other three terms and selection adds the peak-exceedance charge — so the
contrast is risk-aware ($r=0.45$) against the most distance-dominant setting
the shipped engine admits ($r=1.0$, $e=0$; weights distance 0.645, slope
0.194, hazard 0.097, energy 0.065). That is a weaker contrast and is labelled
as such wherever it appears.

Everything is **paired by seed**: between-seed variation in route length is
far larger than the effect, so per-seed differences are taken first and
summarised second. 12 seeds per scenario, index 0 being the scenario's own
hand-picked seed and the rest offset by a prime stride.

### 4.2 Open loop: the cost model in isolation

Median [p25–p75] over 12 seeds.

**`baseline-traverse`**

| arm | routed | distance m | energy Wh | peak hazard | mean hazard | nodes |
|---|---|---|---|---|---|---|
| risk-aware | 12/12 | 476 [469–477] | 190.6 [186.4–194.0] | 0.240 [0.188–0.467] | 0.0172 [0.0102–0.0330] | 2741 [2444–3159] |
| shortest-distance | 12/12 | 465 [465–471] | 190.7 [188.2–193.7] | 0.499 [0.484–0.504] | 0.0684 [0.0341–0.0879] | 256 [175–527] |
| shortest-uncapped | 12/12 | 465 [465–465] | 188.8 [188.1–193.8] | 0.541 [0.497–0.626] | 0.0729 [0.0477–0.0908] | 171 [170–237] |

**`dynamic-hazard`**

| arm | routed | distance m | energy Wh | peak hazard | mean hazard | nodes |
|---|---|---|---|---|---|---|
| risk-aware | 9/12 | 363 [349–371] | 143.8 [141.1–154.0] | 0.386 [0.220–0.423] | 0.0334 [0.0108–0.0475] | 2087 [2012–2476] |
| shortest-distance | 9/12 | 346 [336–364] | 144.9 [140.1–149.5] | 0.453 [0.292–0.488] | 0.0866 [0.0204–0.1059] | 204 [85–357] |
| shortest-uncapped | 11/12 | 336 [336–339] | 139.3 [137.5–144.0] | 0.617 [0.407–0.712] | 0.0876 [0.0221–0.1625] | 85 [85–159] |

**`competing-objectives`**

| arm | routed | distance m | energy Wh | peak hazard | mean hazard | nodes |
|---|---|---|---|---|---|---|
| risk-aware | 12/12 | 490 [477–515] | 205.0 [202.4–215.9] | 0.431 [0.383–0.490] | 0.0607 [0.0506–0.0683] | 3727 [3239–4253] |
| shortest-distance | 12/12 | 481 [470–507] | 208.4 [202.5–216.9] | 0.496 [0.480–0.505] | 0.1248 [0.0933–0.1508] | 1126 [580–1458] |
| shortest-uncapped | 12/12 | 466 [462–474] | 200.2 [198.9–207.1] | 0.818 [0.687–0.854] | 0.1623 [0.1292–0.2280] | 566 [383–759] |

Paired per-seed change, risk-aware relative to each baseline (median):

| scenario | vs | pairs | distance | energy | peak hazard | mean hazard | nodes | mean-haz wins |
|---|---|---|---|---|---|---|---|---|
| baseline-traverse | shortest-distance | 12 | **+0.75%** | −0.4% | **−19.6%** | **−59.5%** | +954% | 12/12 |
| baseline-traverse | shortest-uncapped | 12 | +2.27% | −0.3% | −40.9% | −70.6% | +1323% | 12/12 |
| dynamic-hazard | shortest-distance | 9 | **+3.80%** | +0.9% | **−13.5%** | **−51.1%** | +1206% | 9/9 |
| dynamic-hazard | shortest-uncapped | 9 | +5.92% | +0.9% | −30.2% | −58.0% | +2233% | 9/9 |
| competing-objectives | shortest-distance | 12 | **+1.54%** | −0.6% | **−9.1%** | **−51.8%** | +230% | 12/12 |
| competing-objectives | shortest-uncapped | 12 | +4.40% | +1.6% | −44.1% | −58.5% | +628% | 12/12 |

### 4.3 Honest reading

**The effect is real, it is large on mean hazard, and it is cheap in
distance.** Against the like-for-like shortest-distance baseline, risk-aware
planning costs 0.8–3.8% more distance and roughly **halves mean hazard
exposure** — 51–60% lower, on 33 of 33 paired seeds with no losses and no
ties. For a traverse of 350–500 m that is 4–14 extra metres per percentage
point of mean hazard removed. On this terrain, that is a good trade.

**Peak hazard is a weaker and noisier win than mean hazard.** The median
reduction is 9–20%, the per-seed wins are 9/12, 7/9 and 9/12, and there are
three ties and — on `dynamic-hazard` — **one outright loss**, a seed where the
risk-aware route's worst cell was worse than the shortest route's. That is not
a bug: the planner minimises a *sum* of per-step hazard and peak is a *max*,
which no shortest-path search can optimise. It is the exact gap the engine's
`PEAK_EXCEEDANCE_PENALTY` exists to cover at selection time, and the measured
loss is the argument for that penalty existing.

**Energy is a null result.** −0.6% to +1.6%, spanning zero, with no consistent
sign. Risk-aware planning does not save energy and does not meaningfully cost
it. §6 explains why: only 12–19% of a route's energy is the climb term, and
net elevation change is fixed by the endpoints, so there is very little energy
for a planner to find.

**The cost is search effort, and it is an order of magnitude.** +230% to
+2233% more nodes expanded, for the structural reason in §3.3. In absolute
terms this is still 1–3 ms per plan (§8), so it does not matter here — but it
would matter on a 1000×1000 grid, and the scaling is the thing to quote, not
the milliseconds.

**Roughly half the safety comes from the hard constraint, not the weights.**
Compare the two baselines: against `shortest-uncapped` the peak-hazard
reduction is 30–44%, against `shortest-distance` it is 9–20%. The difference
is what the 0.51 ceiling alone contributes. A reader who concluded "the cost
function is what makes this safe" would be about half right, and the third arm
is what shows it.

### 4.4 Closed loop: and here it stops being free

| scenario | arm | complete | failed | unroutable | distance m | replans | peak haz driven |
|---|---|---|---|---|---|---|---|
| baseline-traverse | risk-aware | 12/12 | 0 | 0 | 477 [468–486] | 0.0 | 0.327 [0.212–0.481] |
| baseline-traverse | distance-dominant | 12/12 | 0 | 0 | 465 [465–468] | 0.0 | 0.496 [0.444–0.553] |
| dynamic-hazard | risk-aware | **8/12** | 1 | 3 | 386 [373–423] | 27.0 [11–40] | 0.453 [0.349–0.494] |
| dynamic-hazard | distance-dominant | **11/12** | 0 | 1 | 319 [316–326] | 13.0 [8–23] | 0.739 [0.712–0.854] |
| competing-objectives | risk-aware | 12/12 | 0 | 0 | 485 [477–507] | 0.0 [0–0.8] | 0.456 [0.403–0.490] |
| competing-objectives | distance-dominant | 12/12 | 0 | 0 | 463 [454–469] | 1.5 [0–6] | 0.688 [0.500–0.770] |

Paired over seeds where both arms completed:

| scenario | pairs | distance | peak hazard driven | replans | peak lower on |
|---|---|---|---|---|---|
| baseline-traverse | 12 | +2.5% | −0.138 (−22.3%) | 0.0 | 9/12, 2 tied |
| dynamic-hazard | 8 | **+24.4%** | **−0.397 (−51.6%)** | +8.0 | 8/8 |
| competing-objectives | 12 | +6.2% | −0.232 (−33.9%) | 0.0 | 11/12, 1 tied |

**The headline negative result: on `dynamic-hazard`, risk aversion costs
completion rate.** 8/12 against 11/12. Three of the twelve seeds have no route
at all for the risk-aware arm — the 0.51 ceiling closes the corridor that the
0.95 ceiling leaves open — and one more drives 1019 m, replans 76 times and
then fails with no feasible route, having replanned itself into a pocket.

The distance cost also grows by an order of magnitude once the loop is closed:
+3.8% open-loop becomes **+24.4%** closed-loop on the same scenario. Replanning
compounds the detour. Each replan starts from where the rover actually is, not
from where the original plan assumed it would be, so a cautious planner that
backs away from a discovered patch pays for the backing away *and* for the new
route, repeatedly — 27 replans against 13.

So the full statement is: **risk-aware planning halves hazard exposure, costs
1–4% distance in a single plan and up to 24% over a replanning mission, and on
hazardous terrain reduces the fraction of missions that finish at all.**
Whether that is the right trade is a mission-design question this benchmark
cannot answer; it can only price it.

---

## 5. Closed-loop parameter sweep

3 scenarios × 12 seeds × 5 risk tolerances × 3 energy priorities = **540
missions**, autonomous, ~15 s. Full tables in `bench/out/results.json`;
abridged here to the risk axis at `energyPriority` 0.4.

| scenario | risk | complete | unroutable | distance m | replans | peak haz driven |
|---|---|---|---|---|---|---|
| baseline-traverse | 0.15 | 9/12 | 3 | 491 [486–496] | 0.0 | 0.094 [0.072–0.118] |
| baseline-traverse | 0.30 | 9/12 | 3 | 489 [484–490] | 0.0 | 0.119 [0.077–0.218] |
| baseline-traverse | 0.45 | 12/12 | 0 | 477 [468–486] | 0.0 | 0.327 [0.212–0.481] |
| baseline-traverse | 0.60 | 12/12 | 0 | 466 [465–475] | 0.0 | 0.491 [0.314–0.499] |
| baseline-traverse | 0.85 | 12/12 | 0 | 465 [465–470] | 0.0 | 0.493 [0.337–0.504] |
| dynamic-hazard | 0.15 | 6/12 | 5 | 401 [380–868] | 16.0 [8.5–44] | 0.211 [0.167–0.234] |
| dynamic-hazard | 0.30 | 6/12 | 3 | 405 [398–717] | 19.0 [10–45] | 0.241 [0.211–0.339] |
| dynamic-hazard | 0.45 | 8/12 | 3 | 386 [373–423] | 27.0 [11–40] | 0.453 [0.349–0.494] |
| dynamic-hazard | 0.60 | 9/12 | 3 | 380 [363–391] | 23.0 [17–35] | 0.586 [0.494–0.614] |
| dynamic-hazard | 0.85 | 11/12 | 1 | 322 [319–332] | 20.0 [11–23] | 0.739 [0.701–0.765] |
| competing-objectives | 0.15 | 4/12 | 8 | 623 [592–660] | 0.0 | 0.230 [0.218–0.245] |
| competing-objectives | 0.30 | 8/12 | 4 | 555 [533–579] | 0.0 | 0.337 [0.293–0.360] |
| competing-objectives | 0.45 | 12/12 | 0 | 485 [477–507] | 0.0 [0–0.8] | 0.456 [0.403–0.490] |
| competing-objectives | 0.60 | 12/12 | 0 | 481 [473–493] | 0.0 [0–0.8] | 0.518 [0.431–0.572] |
| competing-objectives | 0.85 | 12/12 | 0 | 472 [466–475] | 0.0 [0–5.3] | 0.602 [0.513–0.750] |

The sweep behaves monotonically in the way the cost model predicts — risk
tolerance up, distance down, peak hazard driven up, completion rate up — and
the dominant term is **unroutability**, not planner failure. At
`riskTolerance` 0.15 on `competing-objectives`, 8 of 12 seeds have no mission:
the ceiling is 0.27 and the rubble barrier is continuous above it. This is the
hard constraint, not the search.

Continuous columns pool missions that actually drove; completion rate is over
all seeds. Pooling a 0 m unroutable mission into a distance median would pull
it toward zero in proportion to how hostile the scenario is, which would read
as "the hard scenario has shorter routes".

### Supervised autonomy

Where the engine declines to proceed alone, 12 seeds:

| scenario | risk | held | completed | held at tick | reasons across seeds |
|---|---|---|---|---|---|
| baseline-traverse | 0.15 | 4/12 | 8 | 0 [0–193] | no-safe-route ×3, risk-exceeds-tolerance ×1 |
| baseline-traverse | 0.25 | 3/12 | 9 | 0 [0–0] | no-safe-route ×3 |
| baseline-traverse | 0.45 | 4/12 | 8 | 0 [0–0] | risk-exceeds-tolerance ×4 |
| dynamic-hazard | 0.15 | 12/12 | 0 | 0 [0–120] | risk-exceeds-tolerance ×6, no-safe-route ×5, repeated-replanning ×1 |
| dynamic-hazard | 0.25 | 11/12 | 1 | 60 [0–401] | repeated-replanning ×5, no-safe-route ×5, risk-exceeds-tolerance ×1 |
| dynamic-hazard | 0.45 | 12/12 | 0 | 100 [0–380] | repeated-replanning ×5, risk-exceeds-tolerance ×4, no-safe-route ×3 |
| competing-objectives | 0.15 | 12/12 | 0 | 0 [0–0] | no-safe-route ×8, risk-exceeds-tolerance ×4 |
| competing-objectives | 0.25 | 11/12 | 1 | 0 [0–0] | risk-exceeds-tolerance ×6, no-safe-route ×5 |
| competing-objectives | 0.45 | 6/12 | 6 | 0 [0–0] | risk-exceeds-tolerance ×6 |

All three intervention reasons that the engine can raise before a battery
breach are observed, and the hold tick distinguishes them usefully: a
`no-safe-route` or `risk-exceeds-tolerance` hold fires at tick 0 (the initial
plan is already unacceptable), while `repeated-replanning` fires at tick
60–400, after the rover has driven into trouble. **A supervised mission on
`dynamic-hazard` essentially always stops and asks**, at every tolerance
tested. That is a design statement about the scenario, not a defect — but a
product whose default is supervised and whose default scenario holds 12/12 is
worth knowing about.

---

## 6. The energy slider does almost nothing, and here is why

Each row holds the seed and the other slider fixed and differences the same
mission against itself.

| scenario | slider | from → to | pairs | route changed | distance | energy | peak haz driven |
|---|---|---|---|---|---|---|---|
| baseline-traverse | riskTolerance | 0.15 → 0.85 | 9 | 8/9 | **−4.3%** | −3.4% | +0.385 |
| baseline-traverse | energyPriority | 0.10 → 0.80 | 12 | 11/12 | +0.00% | **−0.45%** | 0.000 |
| dynamic-hazard | riskTolerance | 0.15 → 0.85 | 6 | 6/6 | **−22.5%** | −23.5% | +0.542 |
| dynamic-hazard | energyPriority | 0.10 → 0.80 | 8 | 8/8 | −0.23% | **−0.46%** | 0.000 |
| competing-objectives | riskTolerance | 0.15 → 0.85 | 4 | 4/4 | **−24.0%** | −20.9% | +0.358 |
| competing-objectives | energyPriority | 0.10 → 0.80 | 12 | 11/12 | −0.00% | **−0.19%** | 0.000 |

`energyPriority` **is** wired up — moving it from 0.1 to 0.8 changes the
driven trail on 30 of 32 paired missions — and it buys a median energy saving
of **0.2–0.5%**, which rounds to nothing against a 200 Wh traverse. Peak
hazard driven does not move at all.

This is not a wiring bug, it is the physics of the model, and one measured
number explains it: **the climb term is only 12–19% of a route's energy.** The
open-loop experiment reports it per arm; the per-scenario medians are 12.8,
12.3 and 17.0% for the risk-aware arm and 13.8, 16.0 and 19.3% for the
shortest-distance arm, with no single route in the whole ensemble above 24.4%.
The rest is $f \cdot m$, proportional to distance, which is
already nearly fixed for a traverse between two given cells. And net elevation
change is determined by the endpoints, so the only climb energy a planner can
remove is gratuitous up-and-down — which fractal terrain at 36–52 m relief
over 384 m does not offer much of.

An energy slider will only earn its place on terrain where the climb term
dominates: much higher relief, a much larger `climbWhPerMPerDeg`, or routes
long enough that a ridge can be gone around rather than over. As shipped, it
is a slider that changes the route and does not change the outcome, and that
is worth saying in the UI rather than leaving a user to infer an effect that
is not there.

---

## 7. Weighted A\*

`heuristicWeight` $w$ multiplies the admissible heuristic; the search is then
$w$-suboptimal in the worst case. Suboptimality is measured against the
uniform-cost oracle, not against A\* at $w=1$ — the two are the same number,
but measuring against the oracle makes this independent of the admissibility
claim rather than assuming it.

Median [p25–p75] over 12 seeds. Oracle expansions: 8700, 7667, 7883 for the
three scenarios.

**`baseline-traverse`**

| w | nodes | % of oracle | cost above optimum | distance m |
|---|---|---|---|---|
| 1.00 | 2741 [2444–3159] | 32.1 | **0.00%** | 476 |
| 1.25 | **285 [157–459]** | 3.4 | **1.59%** | 475 |
| 1.50 | 100 [88–141] | 1.2 | 3.43% | 468 |
| 2.00 | 85 [85–108] | 1.0 | 4.57% | 465 |
| 3.00 | 86 [85–91] | 1.0 | 4.11% | 465 |

**`dynamic-hazard`**

| w | nodes | % of oracle | cost above optimum | distance m |
|---|---|---|---|---|
| 1.00 | 2087 [2012–2476] | 27.2 | 0.00% | 363 |
| 1.25 | 740 [287–865] | 9.4 | 1.06% | 363 |
| 1.50 | 142 [85–331] | 1.9 | 3.21% | 356 |
| 2.00 | 94 [85–111] | 1.2 | 5.63% | 346 |
| 3.00 | 92 [85–99] | 1.2 | 7.20% | 346 |

**`competing-objectives`**

| w | nodes | % of oracle | cost above optimum | distance m |
|---|---|---|---|---|
| 1.00 | 3727 [3239–4253] | 47.6 | 0.00% | 490 |
| 1.25 | 1282 [985–1861] | 16.4 | 0.83% | 495 |
| 1.50 | 414 [237–698] | 5.3 | 3.18% | 483 |
| 2.00 | 195 [115–376] | 2.4 | 5.10% | 483 |
| 3.00 | 132 [100–254] | 1.7 | 5.94% | 485 |

**$w = 1.25$ is the interesting point: a 3–10× reduction in expansions for
under 2% above optimum.** $w = 1.5$ gives 9–27× for about 3%.

Two honest observations. **Suboptimality is not monotone in $w$** — on
`baseline-traverse`, $w=3$ (4.11%) beats $w=2$ (4.57%). Weighted A\* only
bounds the worst case; a larger $w$ changes the expansion order and can
stumble onto a better path. And **$w$ makes routes less safe as a side
effect**: on `baseline-traverse` the median peak hazard rises from 0.240 at
$w=1$ to 0.492 at $w=2$. The inflated heuristic is a distance bound, so
weighting it up weights distance up relative to everything else. An operator
who speeds up the planner is quietly also making it less cautious, which is
not what the control appears to do.

The engine itself always plans at $w=1$. Nothing in the product exposes this
knob; it exists on `PlanRequest` and is swept here.

---

## 8. Timing

Wall clock, darwin-arm64, node v22.13.1, after warm-up. Median [p25–p75] ms.
These are the only numbers in this document that do not reproduce exactly.

| scenario | `plan()` one leg | nodes | `createSimulation()` | full mission | ticks |
|---|---|---|---|---|---|
| baseline-traverse | 1.715 [1.702–1.768] | 2882 | 3.18 [3.12–3.29] | 6.5 [6.2–6.6] | 1440 |
| dynamic-hazard | 1.061 [1.058–1.069] | 2087 | 4.61 [4.42–4.62] | 26.3 [26.1–26.3] | 1026 |
| competing-objectives | 3.250 [3.143–3.254] | 5671 | 10.34 [10.30–10.42] | 13.1 [12.9–13.1] | 1814 |

15 timed repeats for `plan()`, 5 for the mission figures, after 10 and 2
warm-up iterations respectively.

A single plan is 1–3 ms on a 96×96 grid, so the planner view can re-plan on
every slider drag without a worker. A whole headless mission is 6–26 ms, which
is what makes a 540-mission sweep a 15-second command rather than an overnight
job — and that, in turn, is why the seed ensembles in this document are 12
wide instead of 1.

Note `dynamic-hazard` has the *cheapest* single plan and by far the *most
expensive* mission: 1.06 ms × 30+ plans and 1026 ticks of sensing. Per-plan
latency and mission cost are not the same quantity.

**Cold versus warm matters more than the spread does.** The same mission's
`planMsTotal` measured 17.6 ms on a cold first run and 3.1 ms on a warm
replay, a 5.6× gap. Every timing here is warm. A number taken without a
warm-up would overstate the planner's cost by about 5×.

---

## 9. Reproducibility

`npx tsx bench/run.ts --ci` is the gate CI runs. Seven fixed missions, each
run twice live, then replayed from its exported `MissionRecord` — which stores
only `(config, seed, resolutions)` and no terrain or trajectory — and all
three compared against SHA-256 digests committed in `bench/golden.json`.

| case | outcome | ticks | what it covers |
|---|---|---|---|
| baseline-autonomous | complete | 1440 | clean two-leg traverse, no replan |
| dynamic-autonomous | complete | 1026 | repeated replanning on discovered hazard |
| competing-autonomous | complete | 1814 | rubble field, route chosen by risk weight |
| dynamic-supervised-held | held | 60 | supervised, holds on repeated-replanning |
| competing-supervised-answered | held | 974 | operator accepts; replay replays the answer |
| dynamic-late-failure | failed | 3279 | drives 1 km, replans 76×, then has no route |
| dynamic-unroutable | unroutable | 0 | start cell above the ceiling; no mission exists |

All seven reproduce exactly: event log, decision log, driven trail and the
deterministic subset of `MissionMetrics`.

The gate is validated in both directions — it was confirmed to **fail**, with
a non-zero exit, on a deliberately corrupted digest and on a missing golden
file. A gate that has only ever been seen to pass has not been tested.

`MissionMetrics.planMsTotal` is excluded from the metrics digest by name. It
is a wall-clock measurement sitting in a struct of otherwise deterministic
results, and asserting on it makes the gate fail on every machine for a reason
that has nothing to do with reproducibility.

The gate earned its keep during this work: `src/core/types.ts`,
`scenarios.ts` and `engine.ts` were edited by another agent mid-session
(`RoverSpec.idleW` was renamed to `idleWhPerS`), and the digests still
matched — which is exactly the evidence a refactor needs and exactly what a
test suite of behavioural assertions is slower at providing.

---

## 10. Limitations

Specific, and in rough order of how much they would matter to someone
deciding whether any of the above transfers to a real vehicle.

**The rover always knows exactly where it is.** There is no localisation
error, no odometry drift, no slip, no IMU, no visual odometry, nothing. The
rover's `cell` is ground truth by construction. On a real rover, position
uncertainty is the thing that makes a 4 m-resolution hazard map hard to use —
the hazard you planned around and the hazard you are actually next to are
offset by your position error, and the entire plan-then-execute loop has to be
robust to that. **This is the single largest departure from a real mission**,
and nothing in this benchmark touches it.

**No comms, no latency, no bandwidth.** A supervised intervention here is
instantaneous and free. A real one costs a round trip, a bandwidth budget for
whatever imagery justifies the decision, and a window in which the rover is
sitting still. The product's "the mission waits — visibly" is dramatically
cheaper in simulation than in Mission Control.

**The sensor is a perfect disc.** `observationDelta` reveals every cell within
6 cells (24 m) Euclidean, with no occlusion by terrain, no false positives, no
false negatives, no range-dependent noise, and no dependence on heading, sun
angle or shadow. A real hazard camera sees a cone, cannot see over a rise, and
is least reliable at exactly the range where you most want it. Hazard
discovery here is therefore a clean step function, which is why the
materiality threshold (0.05) is the only de-bouncing the engine needs.

**Hazard severity has no failure-probability semantics.** `hazard ∈ [0,1]` is
a scalar with no calibration against anything physical. "Risk tolerance 0.45"
therefore means "a believed-hazard ceiling of 0.51 in an arbitrary unit", not
"a 45% chance of something" or "accept up to X% probability of immobilisation
per metre". Every risk statement in this document is internal to the model.
Making it mean something would require a severity-to-probability mapping and
a definition of the failure event, and would change the cost function from a
weighted sum into an expected-loss calculation.

**The terrain is procedural value noise, not DEM data.** Fractal noise plus
stamped craters plus rubble fields, parameters tuned until the scenarios
behaved. It is not LRO/LOLA, not a real site, and its slope and hazard
statistics are not claimed to match lunar regolith. The `hiddenHazard` layer —
the thing the whole autonomy story rests on — is placed by a density
parameter, so "what orbital imagery misses" is a modelling assumption with no
empirical content.

**The energy model is linear in slope and has nothing else in it.** No
regolith sinkage or slip-dependent drawbar pull, no motor efficiency curve, no
thermal load, no battery temperature or depth-of-discharge effects, no
regenerative braking (downhill is modelled as flat, which is conservative but
arbitrary), and no solar recharge at all — the `'charging'` rover mode is
declared in `RoverMode` and never assigned anywhere in `core/`. Battery
decreases monotonically for the whole mission. On a real traverse, sinkage in
soft regolith can dominate the energy budget, and it is exactly correlated
with the hidden-hazard field this model treats as a pure obstacle.

**A 4 m grid quantises both the path and the hazards.** A hazard smaller than
a cell either disappears or inflates to 16 m². And the planner is 8-connected,
so it can only produce headings on 45° increments: routes zig-zag where an
any-angle planner (Theta\*, Field D\*) would cut a straight line, and the
distance figures carry that grid penalty. The comparison in §4 is unaffected —
both arms pay it — but the absolute distances are not what a continuous
planner would produce.

**Single rover. No coordination, no shared map, no relay.**

**The rover's speed is not physical.** `maxSpeedMs` is 0.8 m/s, chosen (per
the comment in `scenarios.ts`) so a traverse is ~1300 ticks rather than
~10000, which is a test-suite constraint rather than a vehicle property. That
file puts it between a crewed Apollo LRV and a modern teleoperated design;
either way it is a choice about simulation runtime. Every duration in this
document is therefore a simulation duration, and because idle draw is charged
per second, the idle share of the energy budget is understated by whatever
factor the speed is wrong by.

**`peakHazardTraversed` is computed with hindsight.** `computeMetrics` reads
`state.belief.hazard` at the *end* of the mission along the whole trail, so a
cell the rover crossed while believing it was clear, and only later observed
to be bad, is counted at its discovered severity. That is the right number for
"how dangerous was the ground it actually drove over" and the wrong number for
"how much risk did the planner knowingly accept". The two are not distinguished
anywhere, and the second is arguably the more interesting one.

**The engine discards planner search effort.** `plan()` returns
`PlannerStats.nodesExpanded`, and the engine accumulates only wall-clock time
and a call count into `MissionMetrics`. Closed-loop search effort is therefore
unmeasurable from the public API; every node count in this document is
open-loop, and the closed-loop tables report `planCount` as the available
proxy. Adding `nodesExpandedTotal` to `MissionMetrics` is a two-line change
and would make §4.4 strictly better.

**The seed ensemble varies terrain, not missions.** A seed changes the world
but not the start cell or the waypoints, so some seeds have no mission at all
(up to 8 of 12 at low tolerance). The ensemble is a sample of *terrains under
fixed endpoints*, not a sample of plausible missions, and the unroutable
fraction is partly an artefact of that choice rather than a property of the
scenario.

**Twelve seeds is small, and no confidence intervals are quoted.** The paired
design makes the effects visible at this n — 33 of 33 wins on mean hazard is
not ambiguous — but the quartiles are quartiles of twelve numbers, and nothing
here is a significance test.

**The canonical seeds are selected.** `competing-objectives` seed 16 was
chosen by sweeping 400 seeds for the largest low-vs-high-tolerance gap. Any
single-seed number from that scenario is a best case by construction. This is
why the ensemble medians are given alongside.

---

## 11. What to measure next

In the order I would actually do them.

1. **Add position uncertainty and see what breaks.** A Gaussian error on the
   rover's believed cell, growing with distance driven and reset by some
   notional localisation fix. The prediction is that the risk-aware advantage
   *grows* — a route with 0.017 mean hazard has more margin to be wrong about
   where it is than one with 0.068 — and that the materiality threshold and
   the replan trigger both need rethinking because every sweep now disagrees
   with the last one. It is the cheapest change that would make the autonomy
   story meaningfully harder, and it attacks the limitation at the top of §10.

2. **Give hazard a probability semantics and make the cost an expected loss.**
   Define a failure event (immobilisation), map severity to per-metre failure
   probability, and replace the weighted hazard sum with
   $-\log\prod(1-p_i)$, which is additive and therefore still A\*-able. Then
   "risk tolerance" becomes an acceptable mission failure probability, which
   is a number a mission planner could actually argue about, and the
   peak-vs-mean tension in §4.3 mostly dissolves because the product is
   sensitive to both.

3. **Instrument closed-loop search effort**, and measure total nodes expanded
   per mission rather than per plan. The open-loop finding that risk aversion
   costs 2–12× expansions, combined with the finding that it causes 2× the
   replans, suggests the compounded closed-loop cost is much worse than either
   number alone. That is a two-line engine change and a real result.

4. **Any-angle planning as a fourth arm.** Theta\* on the same cost field
   would separate "the cost model's detour" from "the 8-connected grid's
   zig-zag", which §10 says the current distance figures conflate. It would
   also test whether the admissibility story survives a planner whose parent
   pointers skip cells.

5. **Sweep the replan trigger, not just the preferences.** `MATERIAL_HAZARD_RISE`
   (0.05) and `REPEATED_REPLAN_LIMIT` (4) are the two most behaviourally
   consequential constants in `engine.ts` and neither is swept anywhere. The
   `dynamic-hazard` 27-replan median and the 1 km late failure both look like
   threshold artefacts, and the honest way to find out is to vary them.

6. **Characterise the late failure mode properly.** One seed in twelve drives
   1019 m, replans 76 times and then finds no route. Is the rover trapping
   itself in a pocket it drove into, or is it oscillating between two
   corridors? A replan-location histogram over a few hundred seeds would say,
   and "greedy replanning can strand the vehicle" is a finding worth having
   either way.

7. **Scale the grid.** Everything here is 96×96. The planner's node counts and
   the heuristic's weakening under risk aversion both predict trouble at
   1000×1000, and the useful question is where the 1–3 ms plan becomes 100 ms
   and the browser needs a worker.
