# SELENE — final report

What was built, what is genuinely working, what is not, and what to do next.
Every claim here was verified by running something; where a thing was not
measured, this report says so.

## 1. What works

An autonomous lunar rover simulation that a user can configure, launch, watch,
intervene in, and replay — with the autonomy doing real work.

**The engine.** Seeded procedural terrain with two hazard layers: one visible
from orbit, one discoverable only by the rover's sensors. The planner is shown
only a belief state built from the first layer plus whatever has been observed;
the simulator advances against ground truth. That gap is what forces replanning,
and it is why the autonomy is not a scripted animation.

- 8-connected A\* with a four-term cost function (distance, slope, hazard,
  energy), corner-cutting forbidden, binary-heap frontier.
- Replanning triggered by a *material* rise in believed hazard on the route
  being driven, not by any change (without that threshold the baseline scenario
  replanned three times on 0.045-severity noise and falsified its own premise).
- Human-in-the-loop as a value in the state, never an awaited promise: `step()`
  is a no-op while a request is outstanding, and `resolveIntervention()` resumes.
- Decision records with every candidate actually evaluated, its per-term costs,
  the selection reason and the caveats — and prose generated *from* that record.

**The application.** Three views: a planner with a live route preview that
re-plans on every config change; a live mission with ten toggleable map layers,
transport controls, telemetry, a decision stream and an inspector; and an
analysis view with metrics, charts, the event log, a replay scrubber and JSON
export. Missions persist to `localStorage` behind a failure-tolerant wrapper.

**Verification.** 317 unit and integration tests, 29 Playwright end-to-end tests
across six journeys, a 540-mission benchmark harness, and a CI reproducibility
gate over seven fixed missions covering six distinct outcome classes.

## 2. The results worth defending

**Heuristic admissibility, proven empirically.** A\* at weight 1 returns the
*exact* uniform-cost optimum on 160 generated terrains across four risk
tolerances: max absolute cost gap **0.0**, zero violations, while expanding
31.8–48.7% of the oracle's nodes and winning on 40/40 problems at every level.
This is the strongest claim in the repository and it is a differential test
against a slow oracle, not an assertion about the code.

**Risk-aware planning trades distance for hazard, measurably.** Paired over 33
problems: mean hazard **−51% to −60%** for **+0.8% to +3.8%** distance, lower on
33/33 seeds.

**And it costs completion rate.** Closed loop on `dynamic-hazard`, risk-aware
completes **8/12** against distance-dominant's **11/12**, with the distance
penalty growing to **+24.4%** and twice the replans.

**Roughly half the apparent "safety" is the hard constraint, not the cost
function** — found only by adding a third benchmark arm with the hazard ceiling
opened under the same weights. A two-arm comparison attributes it all to the
weights and is silently confounded.

**Replay is exact.** A mission's record stores `(config, seed, resolutions,
abortedAtTick)` and nothing derived; replay re-runs the engine and reproduces
the event log byte-for-byte.

## 3. Bugs found and fixed after the build was "green"

Every one of these was present while the typecheck was clean, 296 tests passed
and the production build succeeded.

| Defect | How it presented | Found by |
|---|---|---|
| Grid item refusing to shrink below content | the whole cost-breakdown panel rendered off-screen; `scrollWidth === clientWidth`, so the standard overflow test said nothing | opening it in a browser |
| `min-h-0` collapsing grid rows | four panels forced to 168px each when they needed 442/555/242/169, overlapping | same |
| Same fault in the mission view below 1100px | transport controls covered and un-clickable while passing every visibility check | end-to-end test measuring `elementFromPoint` |
| `flex-1`'s zero basis | primary nav rendering "Analy…" with 86px of free space | browser |
| A long value starving the key track to 0px | every label in the decision record block invisible, no ellipsis | end-to-end test measuring `dt` widths |
| `idleW` unit ambiguity | planner displayed "0.02 W" for a 72 W draw — 3600x | reading the rendered value against the contract |
| Abort absent from the mission record | a 40-tick aborted mission replayed to a 1,440-tick completion, with no indication | integration test |
| Playwright `webServer` bind address | `vite preview` binds `[::1]`, config probed `127.0.0.1`; **nothing ran in CI** | running it from a clean checkout |
| Generated-prose punctuation | `…104.1 Wh., "Take the risk-averse route"…` | reading the rendered intervention |

## 4. Unresolved limitations

**Stated honestly rather than implied.** `docs/RESEARCH.md` §10 carries fifteen
more about the simulation's physical fidelity; these are the engineering ones.

- **Closed-loop search effort is unmeasurable.** `plan()` returns
  `nodesExpanded` and the engine discards it, so every node count published is
  open-loop. Two lines in `engine.ts` would close it.
- **`peakHazardTraversed` is computed with hindsight** — it reads the end-state
  belief along the whole trail, so a cell crossed while believed clear counts at
  its later-discovered severity. Right for "how bad was the ground", wrong for
  "how much risk did the planner knowingly accept". Documented on the field.
- **The energy-priority control is a weak preference and its top half is inert.**
  Measured 482/482/482 m on `baseline-traverse`. The cause is physical — net
  elevation is fixed by the endpoints and the climb term is 12–19% of route
  energy — so a larger weight distorts the route for a 0.2–0.5% median saving.
  The claim in the code and the UI was corrected rather than the model tuned.
- **`RoverMode` declares `'charging'` and nothing ever assigns it.** Battery is
  monotonically decreasing; there is no solar model.
- **Pan and zoom exist in `viewport.ts`, tested, but are not exposed** through
  the `Renderer` contract. A one-method change.
- **Accessibility gaps**: the map canvas is pointer-only, so placing a start or
  waypoint cannot be done by keyboard; `role="alertdialog"` on the intervention
  panel has no focus management (arguably correct for a non-blocking design, but
  it should be a decision rather than an omission); a second `banner` landmark
  appears while an intervention is pending; `Stat` has no programmatic
  label/value association.
- **Chromium only.** The Playwright config ships one browser.
- **Two behaviourally decisive engine constants are swept nowhere** —
  `MATERIAL_HAZARD_RISE` and `REPEATED_REPLAN_LIMIT`.
- **The 1 km late-failure mode is uncharacterised** — one seed drives 1,019 m,
  replans 76 times and then has no route. Trap or oscillation is unknown; it
  needs a replan-location histogram over a few hundred seeds.

## 5. Recommended next steps, in order

1. **Thread `nodesExpanded` into `MissionMetrics`.** It is the cheapest change
   here and it makes an entire section of the research honest rather than
   caveated.
2. **Characterise the late-failure mode.** It is the only observed behaviour
   nobody can explain, and an unexplained failure in an autonomy system is worth
   more attention than a new feature.
3. **Sweep the two engine constants.** They decide replanning behaviour and were
   set by hand.
4. **Record believed-hazard-at-traversal per cell**, which retires the hindsight
   caveat and makes planner-judgement comparisons meaningful.
5. **Make the map keyboard-operable.** It is the one place the accessibility
   floor is genuinely not met.
6. **Give the energy model something route-dependent** — slip, thermal, solar
   incidence — if the energy preference is to mean anything.

## 6. How to run everything

```bash
npm install
npm run dev          # the app
npm test             # 317 unit and integration tests
npm run typecheck    # both projects, including e2e
npm run bench        # 540 missions, ~15s
npx tsx bench/run.ts --ci   # the reproducibility gate CI runs
npm run e2e          # 29 Playwright tests
```
