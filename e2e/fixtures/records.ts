/**
 * Mission records built by the REAL engine, in Node, at test time.
 *
 * WHY THIS EXISTS. The three shipped scenarios run 1,028-1,816 ticks. At the
 * fastest playback the UI offers (4x = 8 Hz) the shortest of them is a little
 * over two minutes, so "complete a mission, then analyse it" is not a journey
 * a browser test can drive end to end. Rather than sleep for two minutes, or
 * weaken the Analysis journey into asserting an empty state, the record is
 * produced here by `createSimulation` + `step` -- the same functions the app
 * calls -- and seeded into `localStorage` before the page loads.
 *
 * This is a fixture, not a mock. Every field is engine output; the browser
 * re-simulates it through `buildReplaySession` exactly as it would a mission
 * that had just run. What the Analysis tests cannot claim is that the LIVE
 * tick loop produced it, so `05-replay-export.spec.ts` also drives a real
 * mission to a real recorded outcome through the UI (see the abort journey).
 *
 * Imports are relative, not `@/`: tsconfig.json excludes `e2e/`, so the path
 * alias is not guaranteed to resolve in Playwright's loader. `src/core/*`
 * imports its own siblings relatively, so a relative entry point is enough.
 */

import {
  createSimulation,
  resolveIntervention,
  step,
  toRecord,
} from '../../src/core/engine'
import { DEFAULT_ROVER } from '../../src/core/scenarios'
import type { Cell, MissionConfig, MissionRecord, SimState } from '../../src/core/types'

/** `localStorage` key and envelope version, mirroring `src/lib/persist.ts`. */
export const MISSIONS_KEY = 'selene.missions'
const SCHEMA_VERSION = 1

export interface RecordOptions {
  scenarioId?: string
  seed?: number
  start?: Cell
  waypoints?: Cell[]
  autonomyLevel?: MissionConfig['autonomyLevel']
  missionId?: string
  createdAt?: string
  /**
   * Override the rover. The planner UI does not expose these -- the rover
   * spec panel is read-only -- but `MissionConfig` carries them and the
   * engine honours them, which is the only practical way to produce a
   * battery-exhaustion failure without simulating an hour of mission.
   */
  rover?: Partial<MissionConfig['rover']>
}

/**
 * A config matching the app's own defaults (`src/state/defaults.ts`), so a
 * seeded record is indistinguishable from one the planner would have made.
 */
function configFor(o: RecordOptions): MissionConfig {
  return {
    scenarioId: o.scenarioId ?? 'baseline-traverse',
    seed: o.seed ?? 20260419,
    start: o.start ?? { x: 4, y: 88 },
    waypoints: o.waypoints ?? [{ x: 12, y: 80 }],
    riskTolerance: 0.45,
    energyPriority: 0.5,
    batteryReserveFrac: 0.15,
    maxSlopeDeg: 25,
    autonomyLevel: o.autonomyLevel ?? 'autonomous',
    rover: { ...DEFAULT_ROVER, ...o.rover },
  }
}

/** Hard ceiling so a wedged engine fails the test rather than hanging it. */
const MAX_TICKS = 4000

/**
 * Run a mission to its outcome and record it.
 *
 * Throws rather than returning a partial record: a fixture that silently
 * stopped short would make every assertion built on it meaningless.
 */
export function buildRecord(options: RecordOptions = {}): MissionRecord {
  let state: SimState = createSimulation(configFor(options))
  for (let i = 0; i < MAX_TICKS && state.outcome === null; i++) {
    const next = step(state)
    // `step` returns its own argument when the tick is a no-op, which here
    // means an unanswered intervention. Looping on it would never terminate.
    if (next === state) break
    state = next
  }
  if (state.outcome === null) {
    throw new Error(
      `Fixture mission did not reach an outcome in ${MAX_TICKS} ticks ` +
        `(stopped at tick ${state.tick}, pending=${state.pendingIntervention?.reason ?? 'none'}).`,
    )
  }
  return toRecord(
    state,
    options.missionId ?? 'fixture-complete-1',
    options.createdAt ?? '2026-03-01T12:00:00.000Z',
  )
}

/**
 * The standard fixture: a short, genuinely completed traverse.
 *
 * 143 ticks on `baseline-traverse` with the waypoint pulled in to (12, 80).
 * Short enough that the browser's `buildReplaySession` is instant, long
 * enough that the scrubber, the power chart and the event log all have real
 * content to show. Memoized because every spec file that needs it would
 * otherwise re-run the engine.
 */
let cachedComplete: MissionRecord | null = null

export function completedRecord(): MissionRecord {
  if (!cachedComplete) cachedComplete = buildRecord()
  return cachedComplete
}

/**
 * A mission the engine ENDED rather than finished: the battery falls through
 * the reserve floor at tick 124 and the engine records
 * `outcome: 'failed'` with its own stated reason.
 *
 * A 20 Wh battery is the only cheap way to reach that state -- the reference
 * rover carries 1,200 Wh and the longest shipped traverse spends under 200,
 * so a real failure would need a mission far longer than any test should run.
 */
let cachedFailed: MissionRecord | null = null

export function failedRecord(): MissionRecord {
  if (!cachedFailed) {
    cachedFailed = buildRecord({
      waypoints: [{ x: 52, y: 44 }],
      rover: { capacityWh: 20 },
      missionId: 'fixture-failed-1',
      createdAt: '2026-03-01T13:00:00.000Z',
    })
  }
  return cachedFailed
}

/**
 * A record the app can list but CANNOT reconstruct.
 *
 * Built honestly rather than hand-written: a supervised mission really does
 * stop at tick 0 on `risk-exceeds-tolerance`, the request is really answered
 * with "abort", and then the answer is removed. `advance()` in
 * `src/lib/replay.ts` refuses to guess an option the operator never made, so
 * the session comes back truncated and the scrubber says so. That is the
 * shape a hand-edited or partially-written record takes.
 */
let cachedTruncated: MissionRecord | null = null

export function unresolvableRecord(): MissionRecord {
  if (cachedTruncated) return cachedTruncated

  const state = createSimulation(
    configFor({ autonomyLevel: 'supervised', waypoints: [{ x: 52, y: 44 }, { x: 88, y: 10 }] }),
  )
  const pending = state.pendingIntervention
  if (!pending) {
    throw new Error('A supervised mission on the default route should open awaiting approval.')
  }
  const abort = pending.options.find((o) => o.action.type === 'abort-mission')
  if (!abort) throw new Error('The opening approval request should offer an abort.')

  const ended = resolveIntervention(state, abort.id)
  const record = toRecord(ended, 'fixture-truncated-1', '2026-03-01T14:00:00.000Z')
  // Drop the answer, keeping the mission that asked the question.
  cachedTruncated = { ...record, resolutions: [] }
  return cachedTruncated
}

/** The envelope `src/lib/persist.ts` reads, ready for `localStorage.setItem`. */
export function missionsEnvelope(records: MissionRecord[]): string {
  return JSON.stringify({ v: SCHEMA_VERSION, data: records })
}
