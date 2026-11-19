/**
 * Summary statistics for benchmark samples.
 *
 * WHY THIS FILE EXISTS: the project's headline numbers are medians over seeds
 * and repeats, and a median quoted without a spread is not a measurement — it
 * hides whether the effect is larger than the variation between seeds. Every
 * continuous quantity the harness reports goes through `summarise`, so a table
 * cell physically cannot be a bare mean of three runs.
 *
 * Quantiles use the linear-interpolation definition (R/numpy "type 7"), which
 * is the one most readers assume. For n < 4 the interpolation degenerates to
 * something close to min/max, which is honest: with three samples there is no
 * meaningful quartile and the min/max columns say so.
 */

export interface Summary {
  /** Number of samples the summary was computed from. */
  n: number
  min: number
  p25: number
  median: number
  p75: number
  max: number
  /** Arithmetic mean. Reported alongside the median, never instead of it. */
  mean: number
  /** p75 - p25. The single number to quote when space is tight. */
  iqr: number
}

/** The empty summary, used when a cell has no samples at all. */
export const EMPTY_SUMMARY: Summary = {
  n: 0,
  min: NaN,
  p25: NaN,
  median: NaN,
  p75: NaN,
  max: NaN,
  mean: NaN,
  iqr: NaN,
}

/**
 * Quantile by linear interpolation between order statistics.
 *
 * `sorted` must already be ascending; the caller sorts once and asks for
 * several quantiles, so sorting in here would be three sorts per summary.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function summarise(values: readonly number[]): Summary {
  if (values.length === 0) return { ...EMPTY_SUMMARY }
  const sorted = [...values].sort((a, b) => a - b)
  const p25 = quantile(sorted, 0.25)
  const p75 = quantile(sorted, 0.75)
  let sum = 0
  for (const v of sorted) sum += v
  return {
    n: sorted.length,
    min: sorted[0],
    p25,
    median: quantile(sorted, 0.5),
    p75,
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    iqr: p75 - p25,
  }
}

/**
 * Paired per-sample relative change, as a percentage, summarised.
 *
 * PAIRED, not a ratio of medians. Each seed is its own terrain, and the
 * between-seed variation in route length is far larger than the effect being
 * measured — so comparing a median against a median would drown a real effect
 * in terrain noise. Pairing cancels the terrain out: the question asked of
 * each seed is "on THIS map, what did the treatment change?".
 *
 * Samples where the baseline is zero are dropped rather than reported as
 * infinite, and the returned `n` says how many survived.
 */
export function pairedPercentDelta(
  treatment: readonly number[],
  baseline: readonly number[],
): Summary {
  if (treatment.length !== baseline.length) {
    throw new Error(`pairedPercentDelta: length mismatch ${treatment.length} vs ${baseline.length}`)
  }
  const out: number[] = []
  for (let i = 0; i < treatment.length; i++) {
    const b = baseline[i]
    if (!Number.isFinite(b) || b === 0) continue
    if (!Number.isFinite(treatment[i])) continue
    out.push(((treatment[i] - b) / b) * 100)
  }
  return summarise(out)
}

/** Paired absolute difference, summarised. Safe when the baseline can be 0. */
export function pairedDelta(
  treatment: readonly number[],
  baseline: readonly number[],
): Summary {
  if (treatment.length !== baseline.length) {
    throw new Error(`pairedDelta: length mismatch ${treatment.length} vs ${baseline.length}`)
  }
  const out: number[] = []
  for (let i = 0; i < treatment.length; i++) {
    if (!Number.isFinite(treatment[i]) || !Number.isFinite(baseline[i])) continue
    out.push(treatment[i] - baseline[i])
  }
  return summarise(out)
}

/**
 * Fraction of paired samples where the treatment is strictly lower.
 *
 * Reported next to a paired median because a median improvement that holds on
 * 6 of 12 seeds and a median improvement that holds on 12 of 12 are different
 * findings, and the median alone cannot tell them apart.
 */
export function winRate(
  treatment: readonly number[],
  baseline: readonly number[],
  tolerance = 0,
): { wins: number; ties: number; losses: number; n: number } {
  let wins = 0
  let ties = 0
  let losses = 0
  let n = 0
  for (let i = 0; i < treatment.length; i++) {
    if (!Number.isFinite(treatment[i]) || !Number.isFinite(baseline[i])) continue
    n++
    const d = treatment[i] - baseline[i]
    if (d < -tolerance) wins++
    else if (d > tolerance) losses++
    else ties++
  }
  return { wins, ties, losses, n }
}
