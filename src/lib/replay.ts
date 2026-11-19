/**
 * Replay driving: turning a MissionRecord back into scrubbable states.
 *
 * WHY THIS EXISTS WHEN `replay()` ALREADY DOES: the engine's `replay()` returns
 * the FINAL state, which is the right contract for a test asserting that a
 * record reproduces its mission. A scrubber needs the states in between, and a
 * chart needs battery sampled over time — neither is stored in the record,
 * by D7, because a record holds inputs rather than frames.
 *
 * WHY KEYFRAMES RATHER THAN EVERY FRAME: a SimState carries the belief, which
 * is four arrays of width*height. At 128x128 that is roughly 210 KB per frame,
 * so keeping two thousand of them is half a gigabyte. Keyframes plus a short
 * forward step on seek costs a few megabytes and a handful of milliseconds.
 *
 * WHY THE DRIVING LOOP IS DUPLICATED HERE: it is the same shape as the live
 * ticker, and both are playback concerns rather than domain logic — the
 * decisions all still happen inside `step()` and `resolveIntervention()`.
 */

import { abortMission, createSimulation, resolveIntervention, step } from '@/core/engine'
import type { MissionRecord, SimState } from '@/core/types'

/** Hard stop. A record that will not terminate is a bug, not a long mission. */
const MAX_TICKS = 20_000
/** Memory ceiling for the scrubber. Stride doubles rather than this growing. */
const MAX_KEYFRAMES = 48
/** Chart resolution ceiling. Points are plain numbers, so this can be larger. */
const MAX_SERIES_POINTS = 600

export interface ReplaySeriesPoint {
  tick: number
  elapsedS: number
  /** 0..1, straight off RoverState. */
  batteryFrac: number
  /** Cumulative watt-hours drawn, straight off RoverState. */
  energyWh: number
  /** Cumulative metres, straight off RoverState. */
  distanceM: number
  replanCount: number
}

export interface ReplaySession {
  record: MissionRecord
  /** Tick of the final state; the scrubber's maximum. */
  totalTicks: number
  keyframes: { tick: number; state: SimState }[]
  series: ReplaySeriesPoint[]
  finalState: SimState
  /**
   * True when the drive loop stopped on the safety limit or on a missing
   * resolution rather than on an outcome. The UI says so instead of
   * presenting a partial reconstruction as the mission.
   */
  truncated: boolean
}

/**
 * One step of replay.
 *
 * The set of already-applied resolutions is read off `state.resolutions`
 * rather than tracked alongside, which is what lets a seek resume from any
 * keyframe without carrying bookkeeping with it.
 */
function advance(state: SimState, record: MissionRecord): SimState | null {
  if (state.outcome !== null) return null
  const pending = state.pendingIntervention
  if (pending) {
    const applied = new Set(state.resolutions.map((r) => r.requestId))
    const match =
      record.resolutions.find((r) => r.requestId === pending.id && !applied.has(r.requestId)) ??
      record.resolutions.find((r) => !applied.has(r.requestId))
    // A record whose resolutions do not cover its interventions cannot be
    // replayed past this point. Guessing an option would fabricate a decision
    // the operator never made.
    if (!match) return null
    return resolveIntervention(state, match.optionId)
  }
  // An operator abort is an input to the run, recorded as the tick it happened
  // at. Without honouring it the session steps past the abort to the mission's
  // natural end — a 40-tick aborted run reconstructing as a 1,440-tick
  // completed one, with the scrubber describing a mission that never happened
  // beside metrics from the one that did.
  //
  // Checked AFTER the pending-resolution branch, because an operator can
  // answer and then abort within the same tick, and aborting first would drop
  // the answer that was actually given.
  if (record.abortedAtTick !== undefined && state.tick >= record.abortedAtTick) {
    return abortMission(state)
  }
  return step(state)
}

function samplePoint(s: SimState): ReplaySeriesPoint {
  return {
    tick: s.tick,
    elapsedS: s.elapsedS,
    batteryFrac: s.rover.battery,
    energyWh: s.rover.energyUsedWh,
    distanceM: s.rover.odometerM,
    replanCount: s.replanCount,
  }
}

/** Halve a sampled list in place when it outgrows its budget, doubling stride. */
function decimate<T>(list: T[]): void {
  for (let i = 1, w = 1; i < list.length; i += 2, w++) list[w] = list[i]
  list.length = Math.ceil(list.length / 2)
}

export function buildReplaySession(record: MissionRecord): ReplaySession {
  let state = createSimulation(record.config)
  let keyStride = 10
  let seriesStride = 2

  const keyframes: { tick: number; state: SimState }[] = [{ tick: state.tick, state }]
  const series: ReplaySeriesPoint[] = [samplePoint(state)]

  let guard = 0
  let truncated = false
  for (;;) {
    const next = advance(state, record)
    if (next === null) {
      // Natural end when the mission reached an outcome; truncated otherwise.
      truncated = state.outcome === null
      break
    }
    state = next
    guard++
    if (guard >= MAX_TICKS) {
      truncated = true
      break
    }

    if (state.tick % keyStride === 0) {
      keyframes.push({ tick: state.tick, state })
      if (keyframes.length > MAX_KEYFRAMES) {
        decimate(keyframes)
        keyStride *= 2
      }
    }
    if (state.tick % seriesStride === 0) {
      series.push(samplePoint(state))
      if (series.length > MAX_SERIES_POINTS) {
        decimate(series)
        seriesStride *= 2
      }
    }
  }

  // The final state is always both a keyframe and a sample, whatever the
  // stride landed on, so the scrubber can reach the end and the chart ends
  // at the real last reading rather than a few ticks short.
  const lastKey = keyframes[keyframes.length - 1]
  if (!lastKey || lastKey.tick !== state.tick) keyframes.push({ tick: state.tick, state })
  const lastPoint = series[series.length - 1]
  if (!lastPoint || lastPoint.tick !== state.tick) series.push(samplePoint(state))

  return { record, totalTicks: state.tick, keyframes, series, finalState: state, truncated }
}

/**
 * The state at (or immediately after) `tick`.
 *
 * Steps forward from the nearest earlier keyframe. Bounded by the keyframe
 * stride, so this is cheap enough to call on every scrubber input event.
 */
export function seekReplay(session: ReplaySession, tick: number): SimState {
  const target = Math.max(0, Math.min(tick, session.totalTicks))

  let base = session.keyframes[0]
  for (const kf of session.keyframes) {
    if (kf.tick <= target) base = kf
    else break
  }
  if (!base) return session.finalState

  let state = base.state
  // The stride bounds this, but an intervention resolution can advance the
  // state without advancing the tick, so the loop needs its own ceiling.
  let guard = 0
  while (state.tick < target && guard < MAX_TICKS) {
    const next = advance(state, session.record)
    if (next === null) break
    state = next
    guard++
  }
  return state
}
