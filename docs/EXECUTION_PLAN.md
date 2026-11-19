# Execution plan

## Model

One orchestrator, seven workstreams, contracts frozen before any parallel work
began. The orchestrator owns `src/core/types.ts`, `docs/**`, and all root
config; no agent may edit those, which is what makes concurrent work in a
single checkout safe without worktrees.

## Phases

| Phase | Content | Gate |
|---|---|---|
| 0 | Discovery, contracts, scaffold | `src/core/types.ts` + `docs/ENGINE_API.md` frozen and committed |
| 1 | Wave 1 in parallel: core engine (C), design system (B), renderer (D), app shell (E) | each agent's own files typecheck |
| 2 | Integration: the orchestrator reconciles seams, typechecks the whole tree, builds | `npm run build` passes, app runs |
| 3 | Wave 2 in parallel: verification (F), research and benchmarks (G) | suites green, benchmark reproduces |
| 4 | Browser verification, polish, documentation, skill distillation | screenshots reviewed, README and case study written |

## Checklist

Status is updated as work lands. `verified` means the orchestrator ran
something, not that an agent reported success.

| # | Task | Agent | Deliverable | Status |
|---|---|---|---|---|
| 0.1 | Environment and tooling survey | orch | — | done |
| 0.2 | Frozen type contracts | orch | `src/core/types.ts` | done |
| 0.3 | Engine API contract | orch | `docs/ENGINE_API.md` | done |
| 0.4 | Product spec, test plan, decision log | orch | `docs/*.md` | done |
| 0.5 | Scaffold, deps, Playwright | orch | root config | done |
| 1.1 | Seeded RNG and terrain generation | C | `core/rng.ts`, `core/terrain.ts` | pending |
| 1.2 | Cost model | C | `core/cost.ts` | pending |
| 1.3 | A\* + uniform-cost oracle | C | `core/planner.ts` | pending |
| 1.4 | Simulation loop, replanning, interventions | C | `core/engine.ts` | pending |
| 1.5 | Explanation generator | C | `core/explain.ts` | pending |
| 1.6 | Three tuned scenarios | C | `core/scenarios.ts` | pending |
| 1.7 | Design tokens and component set | B | `src/ui/**`, `src/styles/**` | pending |
| 1.8 | Canvas renderer and rAF hook | D | `src/render/**` | pending |
| 1.9 | Store, three views, app shell | E | `src/state/**`, `src/views/**` | pending |
| 2.1 | Seam reconciliation and full typecheck | orch | — | pending |
| 2.2 | Production build | orch | `dist/` | pending |
| 3.1 | Unit, component and e2e suites | F | `tests/**`, `e2e/**` | pending |
| 3.2 | Benchmark harness and research writeup | G | `bench/**`, `docs/RESEARCH.md` | pending |
| 4.1 | Browser verification | orch | screenshots | pending |
| 4.2 | README and case study | G | `README.md`, `docs/CASE_STUDY.md` | pending |
| 4.3 | Reusable skills distilled to project-builder | orch | external repo | pending |

## Integration policy

Agents in Wave 1 code against documented signatures, not against each other's
files, so three of the four will not fully typecheck until integration. That is
expected and is the cost of the parallelism; the contract is what keeps the
reconciliation mechanical rather than a rewrite.
