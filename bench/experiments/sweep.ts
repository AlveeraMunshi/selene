/**
 * The closed-loop parameter sweep: scenario x seed x (risk, energy).
 *
 * This is the only experiment that measures the WHOLE system — sensing,
 * replanning, driving, battery — rather than one planner call. Everything it
 * reports comes out of `MissionMetrics`, computed by the engine, so there is
 * no score here the engine did not itself compute.
 *
 * ONE METRIC IS MISSING AND IT IS WORTH SAYING SO: planner node expansions.
 * `plan()` returns `PlannerStats.nodesExpanded`, but the engine accumulates
 * only wall-clock time and a call count into `MissionMetrics` — search effort
 * is discarded at the call site. Closed-loop search effort is therefore
 * reported here as `planCount`, and node expansions are measured open-loop in
 * the baseline experiment, where the planner is called directly.
 *
 * MEDIANS ARE POOLED OVER MISSIONS THAT ACTUALLY DROVE. A seed on which the
 * start cell is above the hazard ceiling contributes 0 m and 0 Wh, and
 * including those zeros would pull every distance median toward zero in
 * proportion to how hostile the scenario is — which would read as "the hard
 * scenario has shorter routes". Completion rate is computed over ALL seeds,
 * because that is the question completion rate answers.
 */

import type { MissionConfig } from '../../src/core/types'
import {
  configFor,
  ENERGY_GRID,
  REFERENCE,
  RISK_GRID,
  SCENARIO_LIST,
  seedsFor,
} from '../lib/config'
import { drove, runMission, type MissionRun, type RunOutcome } from '../lib/mission'
import { pairedDelta, pairedPercentDelta, summarise, type Summary } from '../lib/stats'

export interface SweepCell {
  scenarioId: string
  riskTolerance: number
  energyPriority: number
  /** Seeds attempted. Every cell of the grid runs the same seed ensemble. */
  seeds: number
  outcomes: Record<RunOutcome, number>
  /** complete / seeds. */
  completionRate: number
  /** complete / (seeds - unroutable): the rate over missions that existed. */
  completionRateRoutable: number
  /** Pooled over missions that drove. */
  distanceM: Summary
  energyWh: Summary
  batteryRemaining: Summary
  replans: Summary
  hazardsDiscovered: Summary
  hazardsOnRoute: Summary
  peakHazardTraversed: Summary
  planCount: Summary
  ticks: Summary
  interventions: Summary
}

export interface SweepResult {
  cells: SweepCell[]
  riskGrid: readonly number[]
  energyGrid: readonly number[]
  seedsPerCell: number
  missionsRun: number
}

const EMPTY_OUTCOMES = (): Record<RunOutcome, number> => ({
  complete: 0,
  failed: 0,
  unroutable: 0,
  aborted: 0,
  held: 0,
  stalled: 0,
})

export function summariseRuns(
  scenarioId: string,
  riskTolerance: number,
  energyPriority: number,
  runs: readonly MissionRun[],
): SweepCell {
  const outcomes = EMPTY_OUTCOMES()
  for (const r of runs) outcomes[r.outcome]++

  const driven = runs.filter(drove)
  const pick = (f: (r: MissionRun) => number) => summarise(driven.map(f))
  const routable = runs.length - outcomes.unroutable

  return {
    scenarioId,
    riskTolerance,
    energyPriority,
    seeds: runs.length,
    outcomes,
    completionRate: runs.length > 0 ? outcomes.complete / runs.length : NaN,
    completionRateRoutable: routable > 0 ? outcomes.complete / routable : NaN,
    distanceM: pick((r) => r.metrics.distanceM),
    energyWh: pick((r) => r.metrics.energyWh),
    batteryRemaining: pick((r) => r.metrics.batteryRemaining),
    replans: pick((r) => r.metrics.replans),
    hazardsDiscovered: pick((r) => r.metrics.hazardsDiscovered),
    hazardsOnRoute: pick((r) => r.metrics.hazardsOnRoute),
    peakHazardTraversed: pick((r) => r.metrics.peakHazardTraversed),
    planCount: pick((r) => r.metrics.planCount),
    ticks: pick((r) => r.metrics.ticks),
    interventions: pick((r) => r.metrics.interventions),
  }
}

export function runSweep(seedCount: number): SweepResult {
  const cells: SweepCell[] = []
  let missionsRun = 0

  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)
    for (const riskTolerance of RISK_GRID) {
      for (const energyPriority of ENERGY_GRID) {
        const runs = seeds.map((seed) => {
          const config: MissionConfig = configFor(scenario, {
            seed,
            riskTolerance,
            energyPriority,
          })
          missionsRun++
          return runMission(config)
        })
        cells.push(summariseRuns(scenario.id, riskTolerance, energyPriority, runs))
      }
    }
  }

  return {
    cells,
    riskGrid: RISK_GRID,
    energyGrid: ENERGY_GRID,
    seedsPerCell: seedCount,
    missionsRun,
  }
}

/**
 * Supervised behaviour, measured separately.
 *
 * A supervised mission stops at the first decision it declines to make alone,
 * so its distance and energy are not comparable with an autonomous run's.
 * What IS worth measuring is which risk tolerances cause a hold at all, and on
 * what grounds — that is the product claim the intervention panel rests on.
 */
export interface SupervisedCell {
  scenarioId: string
  riskTolerance: number
  seeds: number
  held: number
  completed: number
  unroutable: number
  failed: number
  /** Counts of each reason the mission was held on, across seeds. */
  reasons: Record<string, number>
  /** Tick at which the hold happened, over the seeds that held. */
  heldAtTick: Summary
}

export function runSupervised(seedCount: number, risks: readonly number[]): SupervisedCell[] {
  const out: SupervisedCell[] = []
  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)
    for (const riskTolerance of risks) {
      const reasons: Record<string, number> = {}
      const heldTicks: number[] = []
      let held = 0
      let completed = 0
      let unroutable = 0
      let failed = 0
      for (const seed of seeds) {
        const run = runMission(
          configFor(scenario, { seed, riskTolerance, autonomyLevel: 'supervised' }),
        )
        if (run.outcome === 'held') {
          held++
          heldTicks.push(run.metrics.ticks)
          const reason = run.heldOn ?? 'unknown'
          reasons[reason] = (reasons[reason] ?? 0) + 1
        } else if (run.outcome === 'complete') completed++
        else if (run.outcome === 'unroutable') unroutable++
        else failed++
      }
      out.push({
        scenarioId: scenario.id,
        riskTolerance,
        seeds: seeds.length,
        held,
        completed,
        unroutable,
        failed,
        reasons,
        heldAtTick: summarise(heldTicks),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Slider sensitivity
// ---------------------------------------------------------------------------

/**
 * Does each preference slider actually change the mission?
 *
 * WHY THIS IS A SEPARATE, PAIRED MEASUREMENT. Reading the grid above by eye
 * suggests risk tolerance moves everything and energy priority moves almost
 * nothing — but the grid reports medians over seeds, and a median that barely
 * shifts is consistent with a per-seed effect that is real and simply
 * cancels. The only way to tell is to hold the seed fixed, move one slider,
 * and difference the same mission against itself.
 *
 * This is the product's own acceptance criterion from PRODUCT_SPEC.md turned
 * into a number: "moving the risk-tolerance slider visibly changes the
 * previewed route. If it does not, the cost model is not wired to the UI and
 * the feature is a lie." A slider with no measurable effect is worth
 * reporting as such.
 */
export interface SliderSensitivity {
  scenarioId: string
  slider: 'riskTolerance' | 'energyPriority'
  /** The two settings compared, low then high. */
  from: number
  to: number
  /** Value of the OTHER slider, held fixed. */
  held: number
  /** Seeds where both settings produced a completed mission. */
  pairs: number
  distancePct: Summary
  energyPct: Summary
  peakHazardAbs: Summary
  replansAbs: Summary
  /** Seeds where the driven trail changed at all. The bluntest test. */
  routeChanged: number
}

function trailKey(run: MissionRun): string {
  return run.state.trail.map((c) => `${c.x},${c.y}`).join(';')
}

function comparePair(
  scenarioId: string,
  slider: SliderSensitivity['slider'],
  from: number,
  to: number,
  held: number,
  lo: readonly MissionRun[],
  hi: readonly MissionRun[],
): SliderSensitivity {
  const a: MissionRun[] = []
  const b: MissionRun[] = []
  let routeChanged = 0
  for (let i = 0; i < lo.length; i++) {
    if (lo[i].outcome !== 'complete' || hi[i].outcome !== 'complete') continue
    a.push(hi[i])
    b.push(lo[i])
    if (trailKey(hi[i]) !== trailKey(lo[i])) routeChanged++
  }
  const col = (xs: MissionRun[], f: (r: MissionRun) => number) => xs.map(f)
  return {
    scenarioId,
    slider,
    from,
    to,
    held,
    pairs: a.length,
    distancePct: pairedPercentDelta(
      col(a, (r) => r.metrics.distanceM),
      col(b, (r) => r.metrics.distanceM),
    ),
    energyPct: pairedPercentDelta(
      col(a, (r) => r.metrics.energyWh),
      col(b, (r) => r.metrics.energyWh),
    ),
    peakHazardAbs: pairedDelta(
      col(a, (r) => r.metrics.peakHazardTraversed),
      col(b, (r) => r.metrics.peakHazardTraversed),
    ),
    replansAbs: pairedDelta(
      col(a, (r) => r.metrics.replans),
      col(b, (r) => r.metrics.replans),
    ),
    routeChanged,
  }
}

/** Endpoints of each slider, with the other held at the reference value. */
const RISK_LOW = 0.15
const RISK_HIGH = 0.85
const ENERGY_LOW = 0.1
const ENERGY_HIGH = 0.8

export function runSliderSensitivity(seedCount: number): SliderSensitivity[] {
  const out: SliderSensitivity[] = []
  for (const scenario of SCENARIO_LIST) {
    const seeds = seedsFor(scenario, seedCount)
    const run = (over: Partial<MissionConfig>) =>
      seeds.map((seed) => runMission(configFor(scenario, { seed, ...over })))

    const heldEnergy = REFERENCE.energyPriority
    out.push(
      comparePair(
        scenario.id,
        'riskTolerance',
        RISK_LOW,
        RISK_HIGH,
        heldEnergy,
        run({ riskTolerance: RISK_LOW, energyPriority: heldEnergy }),
        run({ riskTolerance: RISK_HIGH, energyPriority: heldEnergy }),
      ),
    )

    const heldRisk = REFERENCE.riskTolerance
    out.push(
      comparePair(
        scenario.id,
        'energyPriority',
        ENERGY_LOW,
        ENERGY_HIGH,
        heldRisk,
        run({ riskTolerance: heldRisk, energyPriority: ENERGY_LOW }),
        run({ riskTolerance: heldRisk, energyPriority: ENERGY_HIGH }),
      ),
    )
  }
  return out
}
