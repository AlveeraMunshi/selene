/**
 * Seeded pseudo-randomness.
 *
 * WHY THIS EXISTS: every stochastic choice in SELENE — terrain noise, crater
 * placement, rubble fields, concealment patches — has to be reproducible from
 * a seed alone, because `MissionRecord` deliberately stores no terrain. If any
 * of it reached for `Math.random()`, replaying a mission would regenerate a
 * different world and the replay test could never pass.
 *
 * mulberry32 is used rather than something fancier because it is 32-bit,
 * branch-free, has a period of 2^32 and passes gjrand's smallcrush — which is
 * far more statistical quality than terrain noise needs, at four arithmetic
 * ops per call.
 */

/** A stream of uniform values in [0, 1). Calling it advances the stream. */
export type Rng = () => number

/**
 * Build a fresh stream from `seed`. Two streams made from the same seed emit
 * byte-identical sequences; that is the property the whole replay story rests
 * on, and it is asserted directly in the tests.
 */
export function makeRng(seed: number): Rng {
  // Coerce to uint32 up front so that negative or fractional seeds still give
  // a well-defined (and stable) stream rather than NaN-poisoning the state.
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    // >>> 0 before dividing: the xor-shift can leave the sign bit set, and a
    // negative numerator here would silently produce values outside [0, 1).
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * An integer in the half-open range [lo, hi).
 *
 * Half-open rather than inclusive so that `rngInt(rng, 0, width)` is a valid
 * cell coordinate without an off-by-one at every call site, which is how it is
 * used throughout terrain generation.
 */
export function rngInt(rng: Rng, lo: number, hi: number): number {
  if (hi <= lo) return lo
  return lo + Math.floor(rng() * (hi - lo))
}

/** A float in [lo, hi). Convenience wrapper; keeps the scaling arithmetic in one place. */
export function rngRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo)
}
