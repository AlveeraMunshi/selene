# Workstreams and file ownership

Contracts (`src/core/types.ts`, `docs/ENGINE_API.md`) were frozen by the
orchestrator before any agent started. No agent edits `package.json`,
`tsconfig.json`, `vite.config.ts` or `src/core/types.ts`.

| Agent | Workstream | Owns | Depends on |
|---|---|---|---|
| C | Autonomy & algorithms | `src/core/**` (except `types.ts`), `src/core/__tests__/**` | contracts |
| B | Design system | `src/ui/**`, `src/styles/**` | contracts |
| D | Simulation rendering | `src/render/**` | contracts |
| E | App & systems | `src/state/**`, `src/views/**`, `src/App.tsx`, `src/main.tsx` | contracts, C+B+D signatures |
| F | Verification | `tests/**`, `e2e/**` | all |
| G | Research & portfolio | `bench/**`, `README.md`, `docs/RESEARCH.md`, `docs/CASE_STUDY.md` | C |

Wave 1 (parallel): C, B, D, E — all four code against the frozen contract.
Wave 2: orchestrator integrates, typechecks, fixes seams.
Wave 3 (parallel): F, G.
