/**
 * The mock state fixture.
 *
 * It is test data, so what it has to be is *deterministic* and *shaped like
 * the real thing*. A fixture that drifts between runs turns every downstream
 * renderer test into a flake, and a fixture that violates the Belief contract
 * (hazard known where nothing has been observed) would let a ground-truth leak
 * in the renderer pass unnoticed.
 */

import { describe, expect, it } from 'vitest'
import { makeMockState, MOCK_ROVER } from '../mock'
import { TICK_SECONDS } from '@/core/types'

describe('makeMockState', () => {
  it('is deterministic for a seed', () => {
    const a = makeMockState({ width: 24, height: 24, seed: 1234 })
    const b = makeMockState({ width: 24, height: 24, seed: 1234 })
    expect(Array.from(a.terrain.elevation)).toEqual(Array.from(b.terrain.elevation))
    expect(Array.from(a.belief.observed)).toEqual(Array.from(b.belief.observed))
    expect(a.rover).toEqual(b.rover)
    expect(a.trail).toEqual(b.trail)
  })

  it('differs between seeds', () => {
    const a = makeMockState({ width: 24, height: 24, seed: 1 })
    const b = makeMockState({ width: 24, height: 24, seed: 2 })
    expect(Array.from(a.terrain.elevation)).not.toEqual(Array.from(b.terrain.elevation))
  })

  it('produces arrays of the declared size', () => {
    const s = makeMockState({ width: 20, height: 12 })
    const n = 20 * 12
    expect(s.terrain.elevation.length).toBe(n)
    expect(s.terrain.slopeDeg.length).toBe(n)
    expect(s.terrain.hazard.length).toBe(n)
    expect(s.terrain.hiddenHazard.length).toBe(n)
    expect(s.belief.observed.length).toBe(n)
    expect(s.belief.hazard.length).toBe(n)
  })

  it('honours the Belief contract: unobserved cells know only the orbital hazard', () => {
    const s = makeMockState({ width: 40, height: 40, seed: 77, progress: 0.5 })
    for (let i = 0; i < s.belief.observed.length; i++) {
      if (s.belief.observed[i] === 0) {
        expect(s.belief.hazard[i]).toBe(s.terrain.hazard[i])
      } else {
        expect(s.belief.hazard[i]).toBeGreaterThanOrEqual(s.terrain.hazard[i])
      }
    }
  })

  it('leaves part of the map unexplored, so there is fog to draw', () => {
    const s = makeMockState({ width: 64, height: 64, seed: 9, progress: 0.4 })
    let seen = 0
    for (let i = 0; i < s.belief.observed.length; i++) seen += s.belief.observed[i]
    expect(seen).toBeGreaterThan(0)
    expect(seen).toBeLessThan(s.belief.observed.length)
  })

  it('reveals more of the map as progress rises', () => {
    const count = (p: number) => {
      const s = makeMockState({ width: 64, height: 64, seed: 9, progress: p })
      let n = 0
      for (let i = 0; i < s.belief.observed.length; i++) n += s.belief.observed[i]
      return n
    }
    expect(count(0.8)).toBeGreaterThan(count(0.2))
  })

  it('keeps every trail and route cell inside the grid', () => {
    const s = makeMockState({ width: 30, height: 18, seed: 5, progress: 0.7 })
    const cells = [...s.trail, ...(s.rover.route?.cells ?? [])]
    for (const r of s.abandonedRoutes) cells.push(...r.cells)
    expect(cells.length).toBeGreaterThan(0)
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThan(30)
      expect(c.y).toBeLessThan(18)
    }
  })

  it('keeps elapsedS consistent with the tick, as the engine contract requires', () => {
    const s = makeMockState({ width: 24, height: 24 })
    expect(s.elapsedS).toBeCloseTo(s.tick * TICK_SECONDS, 9)
  })

  it('can be built without an abandoned route', () => {
    expect(makeMockState({ width: 16, height: 16, withAbandoned: false }).abandonedRoutes).toEqual(
      [],
    )
    expect(
      makeMockState({ width: 16, height: 16, withAbandoned: true }).abandonedRoutes.length,
    ).toBeGreaterThan(0)
  })

  it('clamps progress to the usable range', () => {
    expect(() => makeMockState({ width: 16, height: 16, progress: -4 })).not.toThrow()
    expect(() => makeMockState({ width: 16, height: 16, progress: 7 })).not.toThrow()
  })

  it('places the rover on the end of its own trail', () => {
    const s = makeMockState({ width: 32, height: 32, seed: 3, progress: 0.6 })
    const head = s.trail[s.trail.length - 1]
    expect(s.rover.cell).toEqual(head)
    expect(s.rover.pos).toEqual({ x: head.x, y: head.y })
  })

  it('emits hazard-discovery events only for cells it actually revealed', () => {
    const s = makeMockState({ width: 48, height: 48, seed: 21, progress: 0.7 })
    const discoveries = s.events.filter((e) => e.type === 'hazard-discovered')
    expect(discoveries.length).toBeGreaterThan(0)
    for (const e of discoveries) {
      if (e.type !== 'hazard-discovered') continue
      expect(s.belief.observed[e.cell.y * 48 + e.cell.x]).toBe(1)
    }
  })

  it('exposes a rover spec with a usable sensor range', () => {
    expect(MOCK_ROVER.sensorRangeCells).toBeGreaterThan(0)
    expect(makeMockState().config.rover).toBe(MOCK_ROVER)
  })
})
