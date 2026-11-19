/**
 * The reproducibility gate.
 *
 * THE CLAIM BEING DEFENDED: a mission is a pure function of
 * (scenarioId, seed, config, resolutions). Everything else — the terrain, the
 * route, the event log, the decision records, the driven trail — is derived.
 * If that stops being true, every benchmark number in this repository becomes
 * unreproducible and the replay feature becomes a lie.
 *
 * HOW IT IS CHECKED, in three layers of increasing strength:
 *
 *  1. Two independent live runs of the same config agree.
 *  2. A replay from the exported `MissionRecord` — which stores no terrain and
 *     no trajectory — agrees with the live run.
 *  3. All three agree with a digest committed to `bench/golden.json`, so a
 *     change in engine behaviour is visible in a pull request diff rather than
 *     being absorbed silently.
 *
 * WHAT IS DELIBERATELY NOT CHECKED: `MissionMetrics.planMsTotal`. It is a
 * wall-clock measurement sitting in a struct of deterministic results, and
 * asserting on it would make this gate fail on every machine. See
 * `lib/hash.ts`.
 *
 * THE CASE SET IS CHOSEN FOR PATH COVERAGE, not for coverage of the parameter
 * space: a clean traverse, a mission that replans repeatedly, two supervised
 * missions that stop and wait, a mission that fails after driving 1 km, a
 * mission with no route at all, and — the hardest one — a supervised mission
 * whose outstanding intervention is answered and which therefore exercises
 * replay's resolution-ordering code.
 */

import {
  computeMetrics,
  createSimulation,
  replay,
  resolveIntervention,
  runToCompletion,
  toRecord,
} from '../../src/core/engine'
import { SCENARIOS } from '../../src/core/scenarios'
import type { MissionConfig, SimState } from '../../src/core/types'
import { configFor } from '../lib/config'
import { decisionsDigest, eventsDigest, metricsDigest, trailDigest } from '../lib/hash'
import { classify, type RunOutcome } from '../lib/mission'

/** A fixed timestamp: `createdAt` is the one wall-clock value in the system
 *  and it must not leak into a digest. */
const FIXED_CREATED_AT = '2026-01-01T00:00:00.000Z'

export interface GoldenCase {
  id: string
  description: string
  config: MissionConfig
  /** Intervention option ids to answer, in order, as they come up. */
  answers?: string[]
}

export interface CaseDigest {
  events: string
  decisions: string
  trail: string
  metrics: string
}

export interface CaseResult {
  id: string
  description: string
  outcome: RunOutcome
  ticks: number
  digest: CaseDigest
  /** True when two live runs produced the same digests. */
  liveStable: boolean
  /** True when the replay reproduced the live run. */
  replayMatches: boolean
  /** null when there is no golden entry yet; otherwise whether it matched. */
  goldenMatches: boolean | null
}

const byId = (id: string) => {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`reproducibility: unknown scenario ${id}`)
  return s
}

/**
 * The golden case set.
 *
 * The two seeds that are not a scenario's own are not arbitrary: 77122349 is
 * the seed on which `dynamic-hazard` drives over a kilometre, replans 76
 * times and then fails, and 77130421 is one where the rover's own start cell
 * is above the hazard ceiling. Both were found by the seed sweep, and both
 * are paths no happy-path case touches.
 */
export function goldenCases(): GoldenCase[] {
  const [baseline, dynamic, competing] = [
    byId('baseline-traverse'),
    byId('dynamic-hazard'),
    byId('competing-objectives'),
  ]
  return [
    {
      id: 'baseline-autonomous',
      description: 'clean two-leg traverse, no replan',
      config: configFor(baseline),
    },
    {
      id: 'dynamic-autonomous',
      description: 'repeated replanning on discovered hazard',
      config: configFor(dynamic),
    },
    {
      id: 'competing-autonomous',
      description: 'rubble field, route chosen by risk weight',
      config: configFor(competing),
    },
    {
      id: 'dynamic-supervised-held',
      description: 'supervised, holds on repeated-replanning',
      config: configFor(dynamic, { riskTolerance: 0.25, autonomyLevel: 'supervised' }),
    },
    {
      id: 'competing-supervised-answered',
      description: 'supervised, operator accepts, replay replays the answer',
      config: configFor(competing, { riskTolerance: 0.25, autonomyLevel: 'supervised' }),
      answers: ['accept'],
    },
    {
      id: 'dynamic-late-failure',
      description: 'drives 1 km, replans 76 times, then has no route',
      config: configFor(dynamic, { seed: 77122349 }),
    },
    {
      id: 'dynamic-unroutable',
      description: 'start cell above the hazard ceiling; no mission exists',
      config: configFor(dynamic, { seed: 77130421 }),
    },
  ]
}

/**
 * Drive a case to its end, answering up to `answers.length` interventions.
 *
 * Each answer is applied to whatever intervention is outstanding when the
 * mission next stops, which is the same thing an operator does and the same
 * thing `replay` reconstructs from the recorded resolutions.
 */
function driveCase(c: GoldenCase): SimState {
  let s = runToCompletion(createSimulation(c.config))
  for (const optionId of c.answers ?? []) {
    if (s.pendingIntervention === null) break
    const available = s.pendingIntervention.options.map((o) => o.id)
    if (!available.includes(optionId)) {
      throw new Error(
        `case ${c.id}: option "${optionId}" not offered; available: ${available.join(', ')}`,
      )
    }
    s = runToCompletion(resolveIntervention(s, optionId))
  }
  return s
}

function digestOf(s: SimState): CaseDigest {
  return {
    events: eventsDigest(s.events),
    decisions: decisionsDigest(s.decisions),
    trail: trailDigest(s.trail),
    metrics: metricsDigest(computeMetrics(s)),
  }
}

function sameDigest(a: CaseDigest, b: CaseDigest): boolean {
  return (
    a.events === b.events &&
    a.decisions === b.decisions &&
    a.trail === b.trail &&
    a.metrics === b.metrics
  )
}

export interface ReproducibilityResult {
  cases: CaseResult[]
  /** Every case was self-consistent, replay-consistent and golden-consistent. */
  pass: boolean
  /** Cases with no golden entry. Not a failure in `--update-golden` mode. */
  missingGolden: string[]
  failures: string[]
}

export function runReproducibility(
  golden: Record<string, CaseDigest> | null,
): ReproducibilityResult {
  const cases: CaseResult[] = []
  const failures: string[] = []
  const missingGolden: string[] = []

  for (const c of goldenCases()) {
    const first = driveCase(c)
    const second = driveCase(c)
    const d1 = digestOf(first)
    const d2 = digestOf(second)
    const liveStable = sameDigest(d1, d2)

    const record = toRecord(first, c.id, FIXED_CREATED_AT)
    const replayed = replay(record)
    const dr = digestOf(replayed)
    // The replay of a supervised mission that was never answered stops in the
    // same held state; the digests still have to agree.
    const replayMatches = sameDigest(d1, dr)

    const expected = golden?.[c.id]
    let goldenMatches: boolean | null = null
    if (!expected) {
      missingGolden.push(c.id)
    } else {
      goldenMatches = sameDigest(d1, expected)
      if (!goldenMatches) {
        for (const k of ['events', 'decisions', 'trail', 'metrics'] as const) {
          if (d1[k] !== expected[k]) {
            failures.push(`${c.id}: ${k} digest ${d1[k]} != golden ${expected[k]}`)
          }
        }
      }
    }
    if (!liveStable) failures.push(`${c.id}: two live runs disagreed`)
    if (!replayMatches) failures.push(`${c.id}: replay diverged from the live run`)

    cases.push({
      id: c.id,
      description: c.description,
      outcome: classify(first),
      ticks: first.tick,
      digest: d1,
      liveStable,
      replayMatches,
      goldenMatches,
    })
  }

  return {
    cases,
    pass: failures.length === 0 && missingGolden.length === 0,
    missingGolden,
    failures,
  }
}

/** Digests for every case, for writing a fresh `bench/golden.json`. */
export function computeGolden(): Record<string, CaseDigest> {
  const out: Record<string, CaseDigest> = {}
  for (const c of goldenCases()) out[c.id] = digestOf(driveCase(c))
  return out
}
