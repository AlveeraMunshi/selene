/**
 * Timing with a warm-up and a repeat count.
 *
 * Every timing in this harness goes through here, because a single timed call
 * on a cold JIT measures the compiler rather than the code: the same planner
 * call measured 17.6 ms on its first invocation and 3.19 ms as a warm median.
 * Quoting the first number would overstate the planner's cost by 5x.
 *
 * The returned record carries the warm-up and repeat counts so a published
 * figure can say how it was produced, which is the difference between a
 * timing and a number.
 */

import { summarise, type Summary } from './stats'

export interface Timing {
  /** Milliseconds, summarised over `repeats` warm iterations. */
  ms: Summary
  warmups: number
  repeats: number
}

export interface MeasureOptions {
  warmups?: number
  repeats?: number
}

/**
 * Run `fn` `warmups` times untimed, then `repeats` times timed.
 *
 * The result of `fn` is deliberately read into a sink and returned from the
 * closure so a sufficiently clever engine cannot eliminate the call; at this
 * scale that is defensive rather than observed.
 */
export function measure(fn: () => unknown, opts: MeasureOptions = {}): Timing {
  const warmups = opts.warmups ?? 5
  const repeats = opts.repeats ?? 15
  let sink: unknown
  for (let i = 0; i < warmups; i++) sink = fn()
  const samples: number[] = []
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now()
    sink = fn()
    samples.push(performance.now() - t0)
  }
  if (sink === undefined && samples.length === 0) throw new Error('measure: no samples')
  return { ms: summarise(samples), warmups, repeats }
}
