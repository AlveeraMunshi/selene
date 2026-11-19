/**
 * The terrain cache and its invalidation.
 *
 * The cache exists to make one claim: the per-cell bake runs when the belief
 * changes, and not when a frame is drawn. Every test here is about that claim,
 * because it is the one property of the renderer that produces no visible
 * difference when it is wrong — a cache that repaints every frame looks
 * perfect and runs at a fraction of the frame rate, and a cache that never
 * repaints looks perfect until the rover drives somewhere.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Belief, SimState } from '@/core/types'
import { TerrainCache, countObserved } from '../terrainLayer'
import { makeMockState } from '../mock'
import { installCanvasStub, uninstallCanvasStub } from './stubCanvas'

const OPTS = {
  showElevation: true,
  showSlope: true,
  showHazard: true,
  showObserved: true,
}

beforeAll(installCanvasStub)
afterAll(uninstallCanvasStub)

describe('countObserved', () => {
  it('counts the ones in a flag array', () => {
    expect(countObserved(new Uint8Array([0, 1, 1, 0, 1]))).toBe(3)
    expect(countObserved(new Uint8Array(0))).toBe(0)
    expect(countObserved(new Uint8Array(64))).toBe(0)
  })
})

/** Shallow-clone a belief so the arrays are new objects with identical content. */
function cloneBelief(b: Belief): Belief {
  return {
    width: b.width,
    height: b.height,
    observed: Uint8Array.from(b.observed),
    hazard: Float32Array.from(b.hazard),
    slopeDeg: Float32Array.from(b.slopeDeg),
    elevation: Float32Array.from(b.elevation),
  }
}

/** The shape `step()` produces: a new state object over the same terrain. */
function nextTick(state: SimState, patch: Partial<SimState> = {}): SimState {
  return { ...state, tick: state.tick + 1, ...patch }
}

describe('TerrainCache invalidation', () => {
  let cache: TerrainCache
  let state: SimState

  beforeEach(() => {
    cache = new TerrainCache()
    state = makeMockState({ width: 24, height: 24, seed: 11, progress: 0.3 })
  })

  it('bakes once for the first frame', () => {
    expect(cache.ensure(state, OPTS)).toBe(true)
    expect(cache.bakes).toBe(1)
  })

  it('does not re-bake across many frames of an unchanged state', () => {
    for (let i = 0; i < 60; i++) cache.ensure(state, OPTS)
    expect(cache.bakes).toBe(1)
  })

  it('does not re-bake merely because the tick advanced', () => {
    cache.ensure(state, OPTS)
    // The engine stepped but revealed nothing new: the bitmap is unchanged, so
    // repainting it would be pure waste. This is why the key is the revealed
    // count and not the tick.
    cache.ensure(nextTick(state), OPTS)
    cache.ensure(nextTick(state, { tick: state.tick + 2 }), OPTS)
    expect(cache.bakes).toBe(1)
  })

  it('does not re-bake for a fresh belief object with identical contents', () => {
    cache.ensure(state, OPTS)
    // `step()` is pure, so it hands back new objects every tick. Keying on
    // object identity would repaint 16k cells twice a second for nothing.
    const copied = nextTick(state, { belief: cloneBelief(state.belief) })
    cache.ensure(copied, OPTS)
    expect(cache.bakes).toBe(1)
  })

  it('re-bakes when a cell becomes observed, even mutated in place', () => {
    cache.ensure(state, OPTS)
    // `observe()` is specified to mutate the belief in place, so the object
    // the cache already saw is the object that changed. The revealed count is
    // what notices.
    const unseen = state.belief.observed.indexOf(0)
    expect(unseen).toBeGreaterThanOrEqual(0)
    state.belief.observed[unseen] = 1
    cache.ensure(nextTick(state), OPTS)
    expect(cache.bakes).toBe(2)
  })

  it('re-bakes when the belief shrinks back, as a replay scrub does', () => {
    cache.ensure(state, OPTS)
    const seen = state.belief.observed.indexOf(1)
    state.belief.observed[seen] = 0
    cache.ensure(nextTick(state), OPTS)
    expect(cache.bakes).toBe(2)
  })

  it('re-bakes when a layer is toggled', () => {
    cache.ensure(state, OPTS)
    cache.ensure(state, { ...OPTS, showHazard: false })
    expect(cache.bakes).toBe(2)
    cache.ensure(state, { ...OPTS, showHazard: false })
    expect(cache.bakes).toBe(2)
    cache.ensure(state, { ...OPTS, showObserved: false })
    expect(cache.bakes).toBe(3)
  })

  it('re-bakes when the risk tolerance moves, because the tint is scaled by it', () => {
    cache.ensure(state, OPTS)
    cache.ensure({ ...state, effectiveMaxHazard: 0.9 }, OPTS)
    expect(cache.bakes).toBe(2)
  })

  it('re-bakes when the climb limit moves, because the wall threshold is', () => {
    cache.ensure(state, OPTS)
    cache.ensure({ ...state, config: { ...state.config, maxSlopeDeg: 40 } }, OPTS)
    expect(cache.bakes).toBe(2)
  })

  it('re-bakes for a different terrain even at the same revealed count', () => {
    cache.ensure(state, OPTS)
    const other = makeMockState({ width: 24, height: 24, seed: 99, progress: 0.3 })
    // Force the counts to agree so only the terrain identity can catch this.
    other.belief.observed = Uint8Array.from(state.belief.observed)
    cache.ensure({ ...other, tick: state.tick }, OPTS)
    expect(cache.bakes).toBe(2)
  })

  it('re-bakes when the grid is resized', () => {
    cache.ensure(state, OPTS)
    const bigger = makeMockState({ width: 32, height: 32, seed: 11, progress: 0.3 })
    cache.ensure(bigger, OPTS)
    expect(cache.bakes).toBe(2)
  })
})

describe('TerrainCache discovered-hazard list', () => {
  it('lists only observed cells whose hazard exceeds the orbital baseline', () => {
    const cache = new TerrainCache()
    const state = makeMockState({ width: 32, height: 32, seed: 5, progress: 0.6 })
    cache.ensure(state, OPTS)

    expect(cache.discovered.length).toBeGreaterThan(0)
    expect(cache.discoveredSeverities.length).toBe(cache.discovered.length)

    for (let n = 0; n < cache.discovered.length; n++) {
      const i = cache.discovered[n]
      expect(state.belief.observed[i]).toBe(1)
      expect(state.belief.hazard[i]).toBeGreaterThan(state.terrain.hazard[i])
      expect(cache.discoveredSeverities[n]).toBeGreaterThan(0)
    }
  })

  it('never includes a cell the rover has not seen', () => {
    const cache = new TerrainCache()
    const state = makeMockState({ width: 32, height: 32, seed: 5, progress: 0.15 })
    cache.ensure(state, OPTS)
    const leaked = cache.discovered.filter((i) => state.belief.observed[i] === 0)
    expect(leaked).toEqual([])
  })

  it('grows as the rover explores', () => {
    const early = new TerrainCache()
    const late = new TerrainCache()
    early.ensure(makeMockState({ width: 48, height: 48, seed: 3, progress: 0.15 }), OPTS)
    late.ensure(makeMockState({ width: 48, height: 48, seed: 3, progress: 0.9 }), OPTS)
    expect(late.discovered.length).toBeGreaterThan(early.discovered.length)
  })
})

describe('TerrainCache lifecycle', () => {
  it('reports the observed count it keyed on', () => {
    const cache = new TerrainCache()
    const state = makeMockState({ width: 24, height: 24, seed: 7, progress: 0.4 })
    cache.ensure(state, OPTS)
    expect(cache.observedCells).toBe(countObserved(state.belief.observed))
  })

  it('drops its bitmap on destroy', () => {
    const cache = new TerrainCache()
    cache.ensure(makeMockState({ width: 16, height: 16 }), OPTS)
    expect(cache.bitmap).not.toBeNull()
    cache.destroy()
    expect(cache.bitmap).toBeNull()
    expect(cache.discovered).toEqual([])
  })

  it('does not mutate the state it reads', () => {
    const cache = new TerrainCache()
    const state = makeMockState({ width: 24, height: 24, seed: 13, progress: 0.5 })
    const observedBefore = Uint8Array.from(state.belief.observed)
    const hazardBefore = Float32Array.from(state.belief.hazard)
    const elevBefore = Float32Array.from(state.belief.elevation)
    cache.ensure(state, OPTS)
    expect(state.belief.observed).toEqual(observedBefore)
    expect(state.belief.hazard).toEqual(hazardBefore)
    expect(state.belief.elevation).toEqual(elevBefore)
  })
})
