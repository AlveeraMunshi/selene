# SELENE — product specification

## What this is

A browser-based research platform for watching an autonomous rover plan, drive,
discover that it was wrong, and replan — on simulated lunar terrain, with every
decision inspectable.

## What it is not

It is not a path animator. The rover's route is computed by graph search over a
cost model at the moment it is needed, against a belief state that is strictly
poorer than the simulator's ground truth. If the planner were given the true
hazard field it would never replan and the product would have no subject.

## Who it is for

Three readers, in priority order:

1. **An autonomy or robotics engineer** evaluating whether the author can build
   a planning system, not just draw one. They will look for the cost function,
   the admissibility of the heuristic, and whether replanning is real.
2. **An operator persona** — someone who should understand a mission's state
   within a few seconds of looking at the screen, and who is occasionally asked
   to make a decision the rover declines to make alone.
3. **A reader of the repository** who never runs it, and must still be able to
   tell what was built from the README and the case study.

## The three experiences

### 1. Mission Planner
Pick a scenario, place a start and an ordered set of waypoints on the map, and
set four preferences: risk tolerance, energy priority, battery reserve, and a
hard slope limit. A previewed route updates live from the real planner, showing
its cost breakdown. Launch is disabled, with a stated reason, when the mission
is not plannable.

**Acceptance:** moving the risk-tolerance slider visibly changes the previewed
route on `competing-objectives`. If it does not, the cost model is not wired to
the UI and the feature is a lie.

### 2. Live Autonomous Mission
The terrain at full bleed, with toggleable layers for elevation, slope, hazard,
belief fog, the planned route, abandoned routes and the driven trail. A
telemetry rail carries battery, distance, energy, clock, current objective,
rover mode and replan count. Transport controls: play, pause, single-step,
reset, and speed.

A decision stream lists every autonomy decision in reverse order. Opening one
shows generated prose **and the structured record it was generated from** —
each candidate route with its per-term costs, which was chosen, and the stated
caveats.

When the rover declines to proceed alone, an intervention panel takes over:
the risk in plain language, the real alternatives with their real costs, and a
choice. The mission waits — visibly — until the operator decides.

**Acceptance:** on `dynamic-hazard`, a hazard is discovered on the active route,
the ghost of the abandoned plan remains visible, and the decision stream gains
an entry whose numbers match the route actually taken.

### 3. Mission Analysis and Replay
Saved missions, their metrics, battery and energy over time, the full event log,
planned versus executed route, hazards discovered and how many were on-route,
and the interventions taken. A scrubber replays the mission through the same
renderer. The record exports as JSON.

**Acceptance:** every number on this screen traces to a field of
`MissionMetrics` or a counted event. There is no score that the engine did not
compute.

## States every screen must handle

| State | Treatment |
|---|---|
| No scenario chosen | Planner shows scenario cards only; map is an empty state |
| No waypoints | Launch disabled, reason stated inline |
| Route infeasible | Preview replaced by the planner's actual failure reason |
| Mission not started | Mission view shows an empty state pointing at the Planner |
| Awaiting approval | Intervention panel dominates; transport shows the mission is held |
| Mission failed | Outcome banner with the engine's stated reason, not a generic error |
| No saved missions | Analysis shows an empty state, not a blank grid |
| Render context lost | Error boundary with a readable message and a reset |

## Responsive behaviour

Three columns above ~1100px (config rail, map, telemetry/decisions). Below that,
the map stays full width and the rails stack beneath it in priority order:
intervention, telemetry, decisions. The map must remain interactive at the
narrowest supported width.

## Accessibility floor

Every control reachable and operable by keyboard with a visible focus ring.
Sliders are real range inputs. Tabs implement the tablist pattern. Colour is
never the only carrier of meaning — hazard severity also varies by pattern, and
rover mode is a word as well as a colour. `prefers-reduced-motion` disables
transform and opacity transitions.

## Explicit non-goals

- Real lunar data, real ephemeris, or physically accurate regolith mechanics.
- 3D terrain. The seam exists; the value does not justify it yet.
- Multi-rover coordination.
- An LLM in the decision path. The reasoning must stay inspectable arithmetic;
  a language model may one day narrate it, but may never make it.
