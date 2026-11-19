# Decision log

Each entry is a choice that closed off alternatives, with the reason and the
cost of being wrong.

## D1 — TypeScript everywhere; no Python service
The prompt allows a Python/FastAPI service. Rejected. The planner is a few
hundred lines of graph search over a 128x128 grid; shipping it as a service
would add a process, a wire format, a CORS story and an async boundary for no
algorithmic gain, and would stop the benchmark from reusing the exact code the
browser runs. One toolchain means `bench/run.ts` and the UI execute the same
`plan()`. **Cost if wrong:** a genuinely heavy solver (sampling-based planning
over a large continuous space) would need a worker or a service. The engine is
already isolated behind `core/`, so that move stays available.

## D2 — Canvas 2D, not PixiJS or Three.js
A 128x128 grid redrawn at 60fps is ~16k cells; an offscreen terrain bitmap
painted once per belief change plus a cheap overlay pass is comfortably enough.
WebGL would add a dependency and a shader surface to debug for no visible gain
at this resolution. **Cost if wrong:** a much larger map or true 3D relief
would need it; `createRenderer()` is the seam.

## D3 — Hand-built component set in the shadcn idiom, not shadcn/ui itself
Kept the idiom (Tailwind + `class-variance-authority` + `clsx`/`tailwind-merge`)
and skipped the generator. `shadcn init` writes a large surface of Radix-backed
components, of which this app uses a handful, and each one then becomes project
source to maintain. **Cost if wrong:** if the app grows a combobox, a dialog
stack or a date picker, pulling Radix primitives in is still available and the
idiom already matches.

## D4 — The planner plans on belief, never on ground truth
`Terrain` holds `hazard` (orbit-visible) and `hiddenHazard` (sensor-only).
`Belief` merges the second in only for observed cells. A planner given ground
truth never needs to replan, which would make the entire autonomy story a
scripted animation. **Cost if wrong:** none identified; this is the load-bearing
decision of the project.

## D5 — Human approval is a state value, not an awaited promise
`step()` becomes a no-op while `pendingIntervention` is set, and the simulation
advances again through `resolveIntervention()`. The obvious alternative — await
a promise inside the loop — makes the mission impossible to replay headlessly,
impossible to unit-test without a fake clock, and blocks whatever is driving the
loop. **Cost if wrong:** the state machine has more explicit transitions to keep
correct; that is what the engine tests cover.

## D6 — Explanations are generated from the decision record
`explainDecision()` takes a `DecisionRecord` and returns prose. No prose is ever
written at the site where the decision is made. The failure mode being designed
out is narration drift: an explanation string that was true when it was written
and silently stops matching the arithmetic after the cost model changes.
**Cost if wrong:** explanations read slightly more templated than hand-written
ones would. Accepted.

## D7 — A mission record stores inputs, not frames
`MissionRecord` holds `(config, seed, resolutions)` plus the event and decision
log, and not the terrain or the per-tick rover trace. Replay re-runs the engine.
A record that stored both could disagree with the engine; `replay()` is asserted
against the live run in the test suite. **Cost if wrong:** replay costs a
re-simulation. At these grid sizes that is milliseconds.
