/**
 * The determinism floor. If these fail, nothing else in the project can be
 * trusted: terrain, replay and the determinism tests all rest on `makeRng`
 * producing the same stream for the same seed.
 */

import { describe, expect, it } from 'vitest'
import { makeRng, rngInt, rngRange } from '../rng'

describe('makeRng', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const xs = Array.from({ length: 500 }, () => a())
    const ys = Array.from({ length: 500 }, () => b())
    expect(xs).toEqual(ys)
  })

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    const xs = Array.from({ length: 200 }, () => a())
    const ys = Array.from({ length: 200 }, () => b())
    expect(xs).not.toEqual(ys)
    // Not merely "not deep-equal": the streams should disagree essentially
    // everywhere, which rules out an off-by-one in the state update.
    const agreements = xs.filter((v, i) => v === ys[i]).length
    expect(agreements).toBe(0)
  })

  it('stays inside [0, 1)', () => {
    for (const seed of [0, 1, -7, 2 ** 31, 999983]) {
      const rng = makeRng(seed)
      for (let i = 0; i < 2000; i++) {
        const v = rng()
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    }
  })

  it('is roughly uniform, so terrain features are not biased to one corner', () => {
    const rng = makeRng(42)
    const buckets = new Array(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i++) buckets[Math.floor(rng() * 10)]++
    for (const b of buckets) expect(Math.abs(b - n / 10) / (n / 10)).toBeLessThan(0.05)
  })
})

describe('rngInt', () => {
  it('returns integers in the half-open range [lo, hi)', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 5000; i++) {
      const v = rngInt(rng, 3, 9)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThan(9)
    }
  })

  it('collapses to lo when the range is empty, rather than returning NaN', () => {
    const rng = makeRng(7)
    expect(rngInt(rng, 5, 5)).toBe(5)
    expect(rngInt(rng, 5, 2)).toBe(5)
  })
})

describe('rngRange', () => {
  it('stays within bounds', () => {
    const rng = makeRng(11)
    for (let i = 0; i < 2000; i++) {
      const v = rngRange(rng, -2.5, 4.5)
      expect(v).toBeGreaterThanOrEqual(-2.5)
      expect(v).toBeLessThan(4.5)
    }
  })
})
