/**
 * The claim TEST_PLAN closes on: "the recorded mission is a faithful account
 * of the one that ran."
 *
 * The unit suites prove the halves. `src/core/__tests__` proves
 * `replay(toRecord(run))` reproduces a run; `src/state/__tests__` proves the
 * ticker advances and stops. Neither crosses the seam between them, and the
 * seam is where the claim actually lives: the record that reaches
 * `localStorage` is written by the STORE, from a state the STORE's ticker
 * produced, and it is read back by `src/lib/replay.ts` rather than by the
 * engine's own `replay()`. Three modules, none of which tests the pair.
 *
 * So these drive the real store with fake timers, let it finish a real
 * mission, and compare the saved record's reconstruction against the live
 * run tick by tick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ROVER } from '@/core/scenarios'
import type { MissionConfig, MissionMetrics, SimState } from '@/core/types'
import { computeMetrics } from '@/core/engine'
import { buildReplaySession, seekReplay } from '@/lib/replay'
import { disposeMissionStore, useMissionStore } from '@/state/missionStore'

/** 2 Hz base rate: one tick every 500 ms at 1x. */
const TICK_MS = 500

/**
 * A mission that really completes, in 143 ticks.
 *
 * The scenario's own suggested route is 1,440 ticks, which is 720 seconds of
 * fake time and a quarter of a million timer callbacks; pulling the waypoint
 * in to (12, 80) keeps every property under test identical and the run
 * affordable.
 */
function shortMission(
  autonomyLevel: MissionConfig['autonomyLevel'] = 'autonomous',
): MissionConfig {
  return {
    scenarioId: 'baseline-traverse',
    seed: 20260419,
    start: { x: 4, y: 88 },
    waypoints: [{ x: 12, y: 80 }],
    riskTolerance: 0.45,
    energyPriority: 0.5,
    batteryReserveFrac: 0.15,
    maxSlopeDeg: 25,
    autonomyLevel,
    rover: DEFAULT_ROVER,
  }
}

function resetStore(config: MissionConfig): void {
  disposeMissionStore()
  useMissionStore.setState({
    config,
    state: null,
    status: 'idle',
    speed: 1,
    metrics: null,
    missions: [],
    selectedMissionId: null,
    replay: null,
    selectedDecisionId: null,
  })
}

/**
 * Run the store's own ticker until the mission ends, answering any
 * intervention with its first option, and keep every state it published.
 */
function runToEnd(maxTicks = 3000): SimState[] {
  const seen: SimState[] = []
  const unsubscribe = useMissionStore.subscribe((s) => {
    const last = seen[seen.length - 1]
    if (s.state && s.state !== last) seen.push(s.state)
  })
  try {
    for (let i = 0; i < maxTicks; i++) {
      const s = useMissionStore.getState()
      if (s.state?.outcome != null) break
      if (s.state?.pendingIntervention) {
        useMissionStore.getState().resolveIntervention(s.state.pendingIntervention.options[0]!.id)
        continue
      }
      vi.advanceTimersByTime(TICK_MS)
    }
  } finally {
    unsubscribe()
  }
  return seen
}

/**
 * `planMsTotal` is a measurement of the machine, not of the mission, and
 * `types.ts` says so at length: it differs by a factor of three between a
 * cold and a warm run. `planCount` is derived alongside it and is stable, so
 * only the timing is dropped.
 */
function withoutTiming(m: MissionMetrics): Omit<MissionMetrics, 'planMsTotal'> {
  const { planMsTotal: _ignored, ...rest } = m
  return rest
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  resetStore(shortMission())
})

afterEach(() => {
  disposeMissionStore()
  vi.useRealTimers()
})

describe('the record the store saves', () => {
  it('reconstructs to the same mission, tick for tick', () => {
    useMissionStore.getState().launch()
    const live = runToEnd()

    const store = useMissionStore.getState()
    expect(store.state!.outcome).toBe('complete')
    expect(store.missions).toHaveLength(1)

    const record = store.missions[0]!
    const session = buildReplaySession(record)

    // Same length, same ending.
    expect(session.truncated).toBe(false)
    expect(session.totalTicks).toBe(store.state!.tick)
    expect(session.finalState.outcome).toBe(store.state!.outcome)

    // Same account of what happened. The event log is fully deterministic --
    // unlike the metrics, which carry one wall-clock field.
    expect(session.finalState.events).toEqual(record.events)
    expect(session.finalState.decisions).toEqual(record.decisions)
    expect(withoutTiming(computeMetrics(session.finalState))).toEqual(
      withoutTiming(record.metrics),
    )

    // And the same trajectory, not merely the same destination: a record
    // that reproduced the totals while driving a different route would pass
    // every assertion above.
    const liveByTick = new Map(live.map((s) => [s.tick, s]))
    for (const tick of [0, 1, 20, 60, 100, store.state!.tick]) {
      const expected = liveByTick.get(tick)
      if (!expected) continue
      const got = seekReplay(session, tick)
      expect(got.tick, `tick ${tick}`).toBe(expected.tick)
      expect(got.rover.cell, `cell at tick ${tick}`).toEqual(expected.rover.cell)
      expect(got.rover.odometerM, `odometer at tick ${tick}`).toBeCloseTo(
        expected.rover.odometerM,
        6,
      )
      expect(got.rover.battery, `battery at tick ${tick}`).toBeCloseTo(expected.rover.battery, 6)
    }
  })

  it('leaves no timer behind once the mission has ended', () => {
    useMissionStore.getState().launch()
    runToEnd()

    expect(useMissionStore.getState().status).toBe('finished')

    const at = useMissionStore.getState().state!.tick
    vi.advanceTimersByTime(TICK_MS * 200)
    expect(useMissionStore.getState().state!.tick).toBe(at)
    expect(useMissionStore.getState().missions).toHaveLength(1)

    // The ticker handle is module scope and invisible from here, so the
    // timer count is the only direct way to see it -- but it has to be read
    // AFTER advancing. `clearInterval` called from inside the interval's own
    // callback (which is what `finalize` does) leaves the fake clock still
    // counting it until the clock next moves; an interval that had really
    // leaked would have re-armed and still be counted here.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('carries an operator answer into the record, and the replay applies it', () => {
    // A supervised mission on the default route stops at tick 0 on
    // `risk-exceeds-tolerance`; the answer is the only thing that
    // distinguishes two otherwise identical replays.
    resetStore({
      ...shortMission('supervised'),
      waypoints: [
        { x: 52, y: 44 },
        { x: 88, y: 10 },
      ],
    })

    useMissionStore.getState().launch()
    const pending = useMissionStore.getState().state!.pendingIntervention
    expect(pending, 'a supervised mission should open awaiting approval').not.toBeNull()

    const safer = pending!.options.find((o) => o.id === 'safer') ?? pending!.options[0]!
    useMissionStore.getState().resolveIntervention(safer.id)
    useMissionStore.getState().abort()

    const record = useMissionStore.getState().missions[0]!
    expect(record.resolutions).toHaveLength(1)
    expect(record.resolutions[0]!.optionId).toBe(safer.id)

    // The reconstruction re-applies it at the tick it was given, rather than
    // guessing or stalling.
    const session = buildReplaySession(record)
    expect(session.finalState.resolutions).toEqual(record.resolutions)
    // NOT `toBeGreaterThan(0)`. That assertion passed only because replay used
    // to ignore the abort and run on to the mission's natural end. The operator
    // answered and aborted at tick 0, so a faithful reconstruction ends at tick
    // 0 too. The invariant worth asserting is that it ends where the live run
    // ended, whatever that tick happens to be.
    expect(session.totalTicks).toBe(record.metrics.ticks)
  })

  /**
   * KNOWN DEFECT, documented as an expected failure.
   *
   * An operator ABORT is not part of the record. `toRecord` stores
   * (config, resolutions) and stamps `outcome: 'aborted'`, but the abort
   * itself is neither a resolution nor anything else the record carries --
   * so `replay()` re-runs the mission from the seed and simply keeps going.
   *
   * Measured: a baseline-traverse mission aborted at tick 40 produces a
   * record whose `metrics.ticks` is 40 and whose `outcome` is 'aborted', and
   * whose reconstruction runs to tick 1,440 and ends 'complete', with
   * `truncated: false` so nothing in the UI says the two disagree. The
   * Analysis view then shows a 40-tick aborted mission's metrics beside a
   * 1,440-tick completed mission's map, chart and scrubber.
   *
   * `it.fails` so the suite stays green while the gap stands and goes red
   * the moment a fix lands.
   */
  it(
    'an aborted mission reconstructs as the mission that was aborted', () => {
    useMissionStore.getState().launch()
    for (let i = 0; i < 40; i++) vi.advanceTimersByTime(TICK_MS)
    useMissionStore.getState().abort()

    const record = useMissionStore.getState().missions[0]!
    expect(record.outcome).toBe('aborted')

    const session = buildReplaySession(record)
    expect(session.finalState.outcome).toBe('aborted')
    expect(session.totalTicks).toBe(record.metrics.ticks)
  })
})
