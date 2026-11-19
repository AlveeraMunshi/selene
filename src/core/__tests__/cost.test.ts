/**
 * The cost model.
 *
 * The most important property proved here is the one the A* heuristic rests
 * on: `minCostPerCellStep` is a genuine lower bound on the cost per unit of
 * path length. If it ever exceeds the real cost of a step, A* stops being
 * admissible and the oracle test in planner.test.ts starts failing — this
 * suite is where that would be caught first, and more legibly.
 */

import { describe, expect, it } from 'vitest'
import {
  constraintsFor,
  maxStepEnergyWh,
  minCostPerCellStep,
  passable,
  routeStats,
  stepCost,
  stepEnergyWh,
  weightsFor,
} from '../cost'
import { METRES_PER_CELL } from '../types'
import { createBelief, generateTerrain, idx } from '../terrain'
import { DEFAULT_ROVER, SCENARIOS } from '../scenarios'
import { flatBelief, setHazard, setSlope, TEST_CONSTRAINTS, TEST_WEIGHTS, configFor } from './helpers'

const ROVER = DEFAULT_ROVER

describe('weightsFor', () => {
  it('always normalises to sum 1, so totals are comparable across settings', () => {
    for (let r = 0; r <= 1.0001; r += 0.1) {
      for (let e = 0; e <= 1.0001; e += 0.1) {
        const w = weightsFor(configFor(SCENARIOS[0], { riskTolerance: r, energyPriority: e }))
        expect(w.distance + w.slope + w.hazard + w.energy).toBeCloseTo(1, 10)
        for (const v of Object.values(w)) expect(v).toBeGreaterThan(0)
      }
    }
  })

  it('raises the hazard weight sharply as risk tolerance falls', () => {
    const timid = weightsFor(configFor(SCENARIOS[0], { riskTolerance: 0 }))
    const bold = weightsFor(configFor(SCENARIOS[0], { riskTolerance: 1 }))
    expect(timid.hazard).toBeGreaterThan(bold.hazard * 5)
    // ...and distance gives way, which is what makes a detour affordable.
    expect(timid.distance).toBeLessThan(bold.distance)
  })

  it('raises the energy weight with energy priority', () => {
    const lazy = weightsFor(configFor(SCENARIOS[0], { energyPriority: 0 }))
    const thrifty = weightsFor(configFor(SCENARIOS[0], { energyPriority: 1 }))
    expect(thrifty.energy).toBeGreaterThan(lazy.energy * 5)
    expect(thrifty.distance).toBeLessThan(lazy.distance)
  })
})

describe('constraintsFor', () => {
  it('maps risk tolerance onto a hazard ceiling and passes the rest through', () => {
    const c = constraintsFor(configFor(SCENARIOS[0], { riskTolerance: 0.5, maxSlopeDeg: 19, batteryReserveFrac: 0.3 }))
    expect(c.maxHazard).toBeCloseTo(0.55, 10)
    expect(c.maxSlopeDeg).toBe(19)
    expect(c.batteryReserveFrac).toBe(0.3)
  })

  it('never reaches 1.0, so true rubble stays impassable at any tolerance', () => {
    expect(constraintsFor(configFor(SCENARIOS[0], { riskTolerance: 1 })).maxHazard).toBeLessThan(1)
  })

  it('leaves a band where a route is legal but above the stated preference', () => {
    // This gap is what the engine's `risk-exceeds-tolerance` intervention is for.
    for (const rt of [0, 0.25, 0.5, 0.7]) {
      expect(constraintsFor(configFor(SCENARIOS[0], { riskTolerance: rt })).maxHazard).toBeGreaterThan(rt)
    }
  })
})

describe('stepEnergyWh', () => {
  it('charges for distance and for climbing, but not for descending', () => {
    const flat = stepEnergyWh(10, 0, ROVER)
    const up = stepEnergyWh(10, 15, ROVER)
    const down = stepEnergyWh(10, -15, ROVER)
    expect(flat).toBeCloseTo(3.5, 10)
    expect(up).toBeGreaterThan(flat)
    // Downhill is flat, never regenerative: crediting descent would let the
    // planner buy range by going over a ridge.
    expect(down).toBe(flat)
  })
})

describe('stepCost', () => {
  it('returns null outside the grid', () => {
    const b = flatBelief(5, 5)
    expect(stepCost(b, { x: 0, y: 0 }, { x: -1, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).toBeNull()
    expect(stepCost(b, { x: -1, y: 0 }, { x: 0, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).toBeNull()
  })

  it('returns null when the destination exceeds the hazard ceiling', () => {
    const b = flatBelief(5, 5)
    setHazard(b, 1, 0, 0.6)
    expect(stepCost(b, { x: 0, y: 0 }, { x: 1, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).toBeNull()
    setHazard(b, 1, 0, 0.4)
    expect(stepCost(b, { x: 0, y: 0 }, { x: 1, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).not.toBeNull()
  })

  it('returns null when the destination exceeds the slope limit', () => {
    const b = flatBelief(5, 5)
    setSlope(b, 1, 0, 30)
    expect(stepCost(b, { x: 0, y: 0 }, { x: 1, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).toBeNull()
  })

  it('lets the rover leave a cell it is already standing on, however bad', () => {
    // Gating `from` as well would strand a rover that discovered it was
    // parked on something awful.
    const b = flatBelief(5, 5)
    setHazard(b, 0, 0, 0.99)
    setSlope(b, 0, 0, 80)
    expect(stepCost(b, { x: 0, y: 0 }, { x: 1, y: 0 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)).not.toBeNull()
  })

  it('normalises each term into roughly [0, 1] so the weights are comparable', () => {
    const b = flatBelief(5, 5)
    setHazard(b, 1, 1, 0.5)
    setSlope(b, 1, 1, 25)
    const c = stepCost(b, { x: 0, y: 0 }, { x: 1, y: 1 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)!
    // Each field is weight x normalised quantity, so each is at most its weight.
    expect(c.distance).toBeLessThanOrEqual(TEST_WEIGHTS.distance + 1e-9)
    expect(c.slope).toBeLessThanOrEqual(TEST_WEIGHTS.slope + 1e-9)
    expect(c.hazard).toBeLessThanOrEqual(TEST_WEIGHTS.hazard + 1e-9)
    expect(c.energy).toBeLessThanOrEqual(TEST_WEIGHTS.energy + 1e-9)
    expect(c.total).toBeCloseTo(c.distance + c.slope + c.hazard + c.energy, 10)
  })

  it('charges a diagonal √2 times the distance of an orthogonal step', () => {
    const b = flatBelief(5, 5)
    const o = stepCost(b, { x: 1, y: 1 }, { x: 2, y: 1 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)!
    const d = stepCost(b, { x: 1, y: 1 }, { x: 2, y: 2 }, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)!
    expect(d.distance / o.distance).toBeCloseTo(Math.SQRT2, 10)
  })
})

describe('minCostPerCellStep', () => {
  it('is a true lower bound on the cost of a step, per unit of length', () => {
    // The admissibility proof, checked numerically on real terrain: for every
    // legal step on a generated map, cost >= length x bound.
    const t = generateTerrain(SCENARIOS[2].terrain, 64, 64, 1234)
    const belief = createBelief(t)
    const config = configFor(SCENARIOS[2])
    const w = weightsFor(config)
    const c = constraintsFor(config)
    const bound = minCostPerCellStep(w, ROVER, c)
    expect(bound).toBeGreaterThan(0)

    let checked = 0
    for (let y = 1; y < 63; y++) {
      for (let x = 1; x < 63; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
          const cost = stepCost(belief, { x, y }, { x: x + dx, y: y + dy }, w, c, ROVER)
          if (!cost) continue
          const length = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1
          expect(cost.total).toBeGreaterThanOrEqual(length * bound - 1e-9)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000)
  })

  it('is looser but still valid when no constraints are supplied', () => {
    const w = weightsFor(configFor(SCENARIOS[0]))
    const c = constraintsFor(configFor(SCENARIOS[0]))
    expect(minCostPerCellStep(w, ROVER)).toBeLessThanOrEqual(minCostPerCellStep(w, ROVER, c) + 1e-12)
  })
})

describe('maxStepEnergyWh', () => {
  it('is the energy of a diagonal step at the slope limit', () => {
    const c = { ...TEST_CONSTRAINTS, maxSlopeDeg: 25 }
    const expected = stepEnergyWh(Math.SQRT2 * METRES_PER_CELL, 25, ROVER)
    expect(maxStepEnergyWh(c, ROVER)).toBeCloseTo(expected, 10)
  })
})

describe('passable', () => {
  it('agrees with stepCost about what is traversable', () => {
    const b = flatBelief(5, 5)
    setHazard(b, 2, 2, 0.9)
    expect(passable(b, TEST_CONSTRAINTS, 2, 2)).toBe(false)
    expect(passable(b, TEST_CONSTRAINTS, 1, 1)).toBe(true)
    expect(passable(b, TEST_CONSTRAINTS, 9, 9)).toBe(false)
  })
})

describe('routeStats', () => {
  it('sums step costs in path order, which is what makes it match the A* g-score', () => {
    const b = flatBelief(8, 8)
    setHazard(b, 2, 0, 0.3)
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
    ]
    let manual = 0
    for (let i = 1; i < cells.length; i++) {
      manual += stepCost(b, cells[i - 1], cells[i], TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)!.total
    }
    const r = routeStats(b, cells, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)
    expect(r.cost.total).toBe(manual)
  })

  it('measures distance in metres including diagonals', () => {
    const b = flatBelief(8, 8)
    const r = routeStats(
      b,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 1 },
      ],
      TEST_WEIGHTS,
      TEST_CONSTRAINTS,
      ROVER,
    )
    expect(r.distanceM).toBeCloseTo(METRES_PER_CELL * (1 + Math.SQRT2), 6)
  })

  it('weights mean hazard by step length', () => {
    const b = flatBelief(8, 8)
    setHazard(b, 1, 0, 0.4) // reached by an orthogonal step, length 1
    setHazard(b, 2, 1, 0.8) // reached by a diagonal step, length √2
    const r = routeStats(
      b,
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 1 },
      ],
      TEST_WEIGHTS,
      TEST_CONSTRAINTS,
      ROVER,
    )
    const expected = (0.4 * 1 + 0.8 * Math.SQRT2) / (1 + Math.SQRT2)
    expect(r.meanHazard).toBeCloseTo(expected, 6)
    expect(r.peakHazard).toBeCloseTo(0.8, 6)
  })

  it('handles a zero-length route without dividing by zero', () => {
    const b = flatBelief(8, 8)
    setHazard(b, 3, 3, 0.25)
    const r = routeStats(b, [{ x: 3, y: 3 }], TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)
    expect(r.distanceM).toBe(0)
    expect(r.cost.total).toBe(0)
    expect(r.meanHazard).toBeCloseTo(0.25, 6)
    expect(Number.isNaN(r.meanHazard)).toBe(false)
  })

  it('reports the peak slope actually crossed', () => {
    const t = generateTerrain(SCENARIOS[0].terrain, 48, 48, 3)
    const b = createBelief(t)
    const cells = Array.from({ length: 20 }, (_, i) => ({ x: 5 + i, y: 10 }))
    const r = routeStats(b, cells, TEST_WEIGHTS, TEST_CONSTRAINTS, ROVER)
    const expected = Math.max(...cells.map((c) => b.slopeDeg[idx(48, c.x, c.y)]))
    expect(r.peakSlopeDeg).toBeCloseTo(expected, 6)
  })
})
