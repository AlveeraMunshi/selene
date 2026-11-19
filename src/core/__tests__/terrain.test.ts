/**
 * Terrain generation, the belief/ground-truth split, and sensing.
 *
 * The load-bearing assertions here are (a) byte-identical regeneration from a
 * seed, which is what `replay` depends on, and (b) that `observe` reports only
 * cells whose believed hazard actually ROSE — the engine uses that list as its
 * replan trigger, so a looser contract would make the rover replan forever.
 */

import { describe, expect, it } from 'vitest'
import {
  cloneBelief,
  createBelief,
  generateTerrain,
  idx,
  inBounds,
  observe,
  observedFraction,
} from '../terrain'
import { SCENARIOS } from '../scenarios'
import type { TerrainParams } from '../types'

const PARAMS: TerrainParams = {
  octaves: 4,
  relief: 40,
  craters: 8,
  orbitalVisibility: 0.5,
  hiddenHazardDensity: 0.2,
  rubbleFields: 5,
}

describe('idx / inBounds', () => {
  it('indexes row-major', () => {
    expect(idx(10, 3, 2)).toBe(23)
  })
  it('rejects out-of-range coordinates', () => {
    expect(inBounds(10, 10, -1, 0)).toBe(false)
    expect(inBounds(10, 10, 0, -1)).toBe(false)
    expect(inBounds(10, 10, 10, 0)).toBe(false)
    expect(inBounds(10, 10, 0, 10)).toBe(false)
    expect(inBounds(10, 10, 9, 9)).toBe(true)
  })
})

describe('generateTerrain', () => {
  it('is byte-identical for the same seed', () => {
    const a = generateTerrain(PARAMS, 64, 64, 4242)
    const b = generateTerrain(PARAMS, 64, 64, 4242)
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation))
    expect(Array.from(a.slopeDeg)).toEqual(Array.from(b.slopeDeg))
    expect(Array.from(a.hazard)).toEqual(Array.from(b.hazard))
    expect(Array.from(a.hiddenHazard)).toEqual(Array.from(b.hiddenHazard))
  })

  it('differs for a different seed', () => {
    const a = generateTerrain(PARAMS, 64, 64, 1)
    const b = generateTerrain(PARAMS, 64, 64, 2)
    expect(Array.from(a.elevation)).not.toEqual(Array.from(b.elevation))
  })

  it('keeps every layer inside its documented range', () => {
    const t = generateTerrain(PARAMS, 64, 64, 99)
    for (let i = 0; i < t.hazard.length; i++) {
      expect(t.slopeDeg[i]).toBeGreaterThanOrEqual(0)
      expect(t.slopeDeg[i]).toBeLessThanOrEqual(90)
      expect(t.hazard[i]).toBeGreaterThanOrEqual(0)
      expect(t.hazard[i]).toBeLessThanOrEqual(1)
      expect(t.hiddenHazard[i]).toBeGreaterThanOrEqual(0)
      // The believed total after observation must also stay inside [0,1], or
      // the Belief contract is violated the first time a cell is swept.
      expect(t.hazard[i] + t.hiddenHazard[i]).toBeLessThanOrEqual(1 + 1e-6)
    }
  })

  it('uses relief: a taller relief produces a taller elevation range', () => {
    const lo = generateTerrain({ ...PARAMS, relief: 10, craters: 0 }, 64, 64, 5)
    const hi = generateTerrain({ ...PARAMS, relief: 100, craters: 0 }, 64, 64, 5)
    const range = (a: Float32Array) => Math.max(...a) - Math.min(...a)
    expect(range(hi.elevation)).toBeGreaterThan(range(lo.elevation) * 5)
  })

  it('stamps craters, which is what creates steep ground', () => {
    const none = generateTerrain({ ...PARAMS, craters: 0, rubbleFields: 0 }, 64, 64, 8)
    const many = generateTerrain({ ...PARAMS, craters: 20, rubbleFields: 0 }, 64, 64, 8)
    expect(Math.max(...many.slopeDeg)).toBeGreaterThan(Math.max(...none.slopeDeg))
  })

  it('hides nothing when orbital visibility is total', () => {
    const t = generateTerrain({ ...PARAMS, orbitalVisibility: 1 }, 64, 64, 3)
    expect(Math.max(...t.hiddenHazard)).toBe(0)
  })

  it('hides nothing when the hidden density is zero', () => {
    const t = generateTerrain({ ...PARAMS, hiddenHazardDensity: 0 }, 64, 64, 3)
    expect(Math.max(...t.hiddenHazard)).toBe(0)
  })

  it('honours hiddenHazardDensity as the fraction of concealed cells', () => {
    for (const density of [0.1, 0.3]) {
      const t = generateTerrain({ ...PARAMS, hiddenHazardDensity: density }, 96, 96, 17)
      let concealed = 0
      // A concealed cell is one where orbit under-reports. Counting cells with
      // a non-zero hidden layer is the direct measurement of that.
      for (let i = 0; i < t.hiddenHazard.length; i++) if (t.hiddenHazard[i] > 1e-6) concealed++
      const frac = concealed / t.hiddenHazard.length
      expect(Math.abs(frac - density)).toBeLessThan(0.05)
    }
  })

  it('clusters hidden hazard into patches rather than scattering it', () => {
    // A clustered field has most concealed cells adjacent to another concealed
    // cell. Salt-and-pepper noise at 20% density would average ~1.6 concealed
    // neighbours out of 8; a patch field averages far more.
    const t = generateTerrain({ ...PARAMS, hiddenHazardDensity: 0.2 }, 96, 96, 21)
    const concealed = (x: number, y: number) => t.hiddenHazard[idx(96, x, y)] > 1e-6
    let count = 0
    let neighbourSum = 0
    for (let y = 1; y < 95; y++) {
      for (let x = 1; x < 95; x++) {
        if (!concealed(x, y)) continue
        count++
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (concealed(x + dx, y + dy)) neighbourSum++
          }
        }
      }
    }
    expect(count).toBeGreaterThan(100)
    expect(neighbourSum / count).toBeGreaterThan(6)
  })
})

describe('createBelief', () => {
  it('starts with the orbital hazard layer only and nothing observed', () => {
    const t = generateTerrain(PARAMS, 48, 48, 77)
    const b = createBelief(t)
    expect(Array.from(b.hazard)).toEqual(Array.from(t.hazard))
    expect(Array.from(b.observed)).toEqual(Array.from(new Uint8Array(48 * 48)))
    expect(observedFraction(b)).toBe(0)
  })

  it('copies rather than aliases, so the belief cannot corrupt ground truth', () => {
    const t = generateTerrain(PARAMS, 32, 32, 5)
    const b = createBelief(t)
    b.hazard[0] = 0.99
    b.elevation[0] = -1234
    expect(t.hazard[0]).not.toBe(0.99)
    expect(t.elevation[0]).not.toBe(-1234)
  })
})

describe('observe', () => {
  it('reveals cells inside a Euclidean radius and no further', () => {
    const t = generateTerrain(PARAMS, 48, 48, 31)
    const b = createBelief(t)
    observe(b, t, { x: 24, y: 24 }, 5)
    expect(b.observed[idx(48, 24, 24)]).toBe(1)
    expect(b.observed[idx(48, 29, 24)]).toBe(1) // distance 5, inside
    expect(b.observed[idx(48, 30, 24)]).toBe(0) // distance 6, outside
    expect(b.observed[idx(48, 28, 28)]).toBe(0) // distance 5.66, outside
  })

  it('folds hidden hazard into belief once observed', () => {
    const t = generateTerrain(PARAMS, 48, 48, 31)
    const b = createBelief(t)
    observe(b, t, { x: 24, y: 24 }, 8)
    for (let y = 20; y <= 28; y++) {
      for (let x = 20; x <= 28; x++) {
        const i = idx(48, x, y)
        if (b.observed[i] !== 1) continue
        expect(b.hazard[i]).toBeCloseTo(Math.min(1, t.hazard[i] + t.hiddenHazard[i]), 6)
      }
    }
  })

  it('returns ONLY cells whose believed hazard rose, not every observed cell', () => {
    const t = generateTerrain(PARAMS, 48, 48, 31)
    const b = createBelief(t)
    const raised = observe(b, t, { x: 24, y: 24 }, 8)
    // Many cells become observed; only those with a hidden layer should be
    // reported, because the engine treats the return value as a discovery.
    let observedCount = 0
    for (let i = 0; i < b.observed.length; i++) if (b.observed[i]) observedCount++
    expect(observedCount).toBeGreaterThan(raised.length)
    for (const c of raised) expect(t.hiddenHazard[idx(48, c.x, c.y)]).toBeGreaterThan(0)
  })

  it('reports nothing on a repeated sweep of the same place', () => {
    const t = generateTerrain(PARAMS, 48, 48, 31)
    const b = createBelief(t)
    observe(b, t, { x: 24, y: 24 }, 6)
    const second = observe(b, t, { x: 24, y: 24 }, 6)
    // This is the property that stops the engine replanning on every tick.
    expect(second).toEqual([])
  })

  it('clips to the map edge without throwing', () => {
    const t = generateTerrain(PARAMS, 32, 32, 2)
    const b = createBelief(t)
    expect(() => observe(b, t, { x: 0, y: 0 }, 10)).not.toThrow()
    expect(() => observe(b, t, { x: 31, y: 31 }, 10)).not.toThrow()
  })
})

describe('cloneBelief', () => {
  it('isolates the mutable layers and shares the read-only ones', () => {
    const t = generateTerrain(PARAMS, 32, 32, 9)
    const a = createBelief(t)
    const b = cloneBelief(a)
    b.hazard[0] = 0.5
    b.observed[0] = 1
    expect(a.hazard[0]).not.toBe(0.5)
    expect(a.observed[0]).toBe(0)
    // Aliased on purpose: nothing writes to these, and copying them every
    // tick would double the engine's allocation for no benefit.
    expect(b.slopeDeg).toBe(a.slopeDeg)
    expect(b.elevation).toBe(a.elevation)
  })
})

describe('shipped scenarios', () => {
  it('every scenario generates terrain within range', () => {
    for (const s of SCENARIOS) {
      const t = generateTerrain(s.terrain, s.width, s.height, s.seed)
      expect(t.width).toBe(s.width)
      expect(t.height).toBe(s.height)
      expect(Math.max(...t.hazard)).toBeLessThanOrEqual(1)
      expect(Math.min(...t.hazard)).toBeGreaterThanOrEqual(0)
    }
  })

  it('every scenario start and waypoint sits on ground the rover can stand on', () => {
    for (const s of SCENARIOS) {
      const t = generateTerrain(s.terrain, s.width, s.height, s.seed)
      for (const c of [s.start, ...s.suggestedWaypoints]) {
        const i = idx(s.width, c.x, c.y)
        // Clean in BOTH layers: a start that becomes impassable the instant
        // the rover's own sensors sweep it would strand the mission at tick 1.
        expect(Math.min(1, t.hazard[i] + t.hiddenHazard[i])).toBeLessThan(0.15)
        expect(t.slopeDeg[i]).toBeLessThan(20)
      }
    }
  })
})
