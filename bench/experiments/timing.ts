/**
 * Wall-clock timings, each with a warm-up, a repeat count and a spread.
 *
 * THESE ARE THE ONLY NON-DETERMINISTIC NUMBERS THE HARNESS PRODUCES, and they
 * are kept in their own experiment and their own section of the JSON for that
 * reason. Everything else in this benchmark reproduces bit-for-bit; these do
 * not, and mixing them into a results struct is the exact mistake
 * `MissionMetrics.planMsTotal` already made once in this repository.
 *
 * WHAT IS TIMED:
 *   - one `plan()` call on the first leg of each scenario, which is the
 *     latency a user feels when they move a slider in the planner view;
 *   - one `createSimulation()`, which includes terrain generation and the
 *     initial plan;
 *   - a whole mission driven to completion headlessly, which is what sets
 *     how big a sweep is affordable.
 *
 * Timings are reported as median with p25-p75, never as a mean, and the
 * warm-up and repeat counts travel with the number.
 */

import { createSimulation, runToCompletion } from '../../src/core/engine'
import { plan } from '../../src/core/planner'
import { constraintsFor, weightsFor } from '../../src/core/cost'
import type { Cell, MissionConfig } from '../../src/core/types'
import { configFor, SCENARIO_LIST } from '../lib/config'
import { measure, type Timing } from '../lib/measure'

export interface TimingRow {
  scenarioId: string
  /** One A* call on the first leg, admissible heuristic. */
  planCall: Timing
  /** Terrain generation + belief + initial plan. */
  createSimulation: Timing
  /** Full headless mission, start to outcome. */
  fullMission: Timing
  /** Context for the mission timing: how many ticks it actually ran. */
  ticks: number
  /** Context for the plan timing: how hard that search was. */
  nodesExpanded: number
}

export interface TimingResult {
  rows: TimingRow[]
  /** Reported so a reader can discount the numbers appropriately. */
  platform: string
  nodeVersion: string
}

function legFor(config: MissionConfig): { start: Cell; goal: Cell } {
  const goal = config.waypoints[config.waypoints.length - 1]
  if (!goal) throw new Error('timing: scenario has no waypoints')
  return { start: config.start, goal }
}

export function runTiming(repeats: number): TimingResult {
  const rows: TimingRow[] = []

  for (const scenario of SCENARIO_LIST) {
    const config = configFor(scenario)
    const sim = createSimulation(config)
    const { start, goal } = legFor(config)
    const req = {
      belief: sim.belief,
      start,
      goal,
      weights: weightsFor(config),
      constraints: constraintsFor(config),
    }
    const probe = plan(req, config.rover)

    // A full mission is ~20-40 ms, so it gets fewer repeats than a plan call;
    // the repeat count travels with each number rather than being assumed.
    const missionRepeats = Math.max(3, Math.round(repeats / 3))
    const finished = runToCompletion(createSimulation(config))

    rows.push({
      scenarioId: scenario.id,
      planCall: measure(() => plan(req, config.rover), { warmups: 10, repeats }),
      createSimulation: measure(() => createSimulation(config), {
        warmups: 3,
        repeats: missionRepeats,
      }),
      fullMission: measure(() => runToCompletion(createSimulation(config)), {
        warmups: 2,
        repeats: missionRepeats,
      }),
      ticks: finished.tick,
      nodesExpanded: probe.stats.nodesExpanded,
    })
  }

  return {
    rows,
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.version,
  }
}
