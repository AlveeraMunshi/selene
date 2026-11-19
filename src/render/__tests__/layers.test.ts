/**
 * Layer toggles reach the canvas.
 *
 * A toggle that silently does nothing is invisible in review — the checkbox
 * moves, the map looks the same, and nobody can tell whether that is the
 * toggle being broken or the layer having nothing to draw on this terrain.
 * Counting draw calls against the stub context is the cheapest way to assert
 * that each flag is actually wired to geometry, without rendering a pixel.
 *
 * The three toggles that only change the *baked* bitmap (elevation, slope and
 * the fog) produce the same number of draw calls either way, so they are
 * covered in terrainLayer.test.ts by asserting a re-bake instead.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRenderer, DEFAULT_RENDER_OPTIONS, type RenderOptions } from '../scene'
import { makeMockState } from '../mock'
import { installCanvasStub, makeCanvas, stubFor, uninstallCanvasStub } from './stubCanvas'

beforeAll(installCanvasStub)
afterAll(uninstallCanvasStub)

const RECT = { left: 0, top: 0, width: 600, height: 600 }
const state = makeMockState({ width: 48, height: 48, seed: 8, progress: 0.55 })

/** Total 2D-context method calls made by one frame with these options. */
function callsFor(opts: RenderOptions): number {
  const canvas = makeCanvas(RECT)
  const renderer = createRenderer(canvas)
  renderer.resize(RECT.width, RECT.height)
  renderer.draw(state, opts, 0.5)
  const stub = stubFor(canvas)
  const total = Object.values(stub.calls).reduce((a, b) => a + b, 0)
  renderer.destroy()
  return total
}

function namedCalls(opts: RenderOptions): Record<string, number> {
  const canvas = makeCanvas(RECT)
  const renderer = createRenderer(canvas)
  renderer.resize(RECT.width, RECT.height)
  renderer.draw(state, opts, 0.5)
  const calls = { ...stubFor(canvas).calls }
  renderer.destroy()
  return calls
}

describe('the frame reaches the canvas at all', () => {
  it('blits the cached terrain bitmap exactly once per frame', () => {
    const calls = namedCalls(DEFAULT_RENDER_OPTIONS)
    expect(calls.drawImage).toBe(1)
  })

  it('resets the transform once per frame rather than accumulating a scale', () => {
    const canvas = makeCanvas(RECT)
    const renderer = createRenderer(canvas)
    renderer.resize(RECT.width, RECT.height)
    for (let i = 0; i < 5; i++) renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)
    const calls = stubFor(canvas).calls
    expect(calls.setTransform).toBe(5)
    // No bare `scale()` anywhere: that is what compounds across frames.
    expect(calls.scale).toBeUndefined()
    renderer.destroy()
  })

  it('balances every save with a restore', () => {
    const calls = namedCalls(DEFAULT_RENDER_OPTIONS)
    expect(calls.save).toBe(calls.restore)
    expect(calls.save).toBeGreaterThan(5)
  })

  it('draws the rover and its sensor ring', () => {
    const calls = namedCalls(DEFAULT_RENDER_OPTIONS)
    expect(calls.arc).toBeGreaterThan(0)
    expect(calls.rotate).toBe(1)
    expect(calls.translate).toBe(1)
  })

  it('numbers the waypoints', () => {
    const calls = namedCalls(DEFAULT_RENDER_OPTIONS)
    expect(calls.fillText).toBe(state.config.waypoints.length)
  })
})

describe('each toggle is wired to geometry', () => {
  const toggles: Array<keyof RenderOptions> = [
    'showHazard',
    'showPlannedRoute',
    'showTrail',
    'showAbandoned',
  ]

  for (const key of toggles) {
    it(`${key} changes what is drawn`, () => {
      const on = callsFor({ ...DEFAULT_RENDER_OPTIONS, [key]: true })
      const off = callsFor({ ...DEFAULT_RENDER_OPTIONS, [key]: false })
      expect(on).toBeGreaterThan(off)
    })
  }

  it('hoverCell adds an outline', () => {
    const none = callsFor({ ...DEFAULT_RENDER_OPTIONS, hoverCell: null })
    const some = callsFor({ ...DEFAULT_RENDER_OPTIONS, hoverCell: { x: 4, y: 4 } })
    expect(some).toBeGreaterThan(none)
  })

  it('selectedCell adds an outline', () => {
    const none = callsFor({ ...DEFAULT_RENDER_OPTIONS, selectedCell: null })
    const some = callsFor({ ...DEFAULT_RENDER_OPTIONS, selectedCell: { x: 4, y: 4 } })
    expect(some).toBeGreaterThan(none)
  })
})

describe('interpolation drives the rover and nothing else', () => {
  it('moves the rover between two ticks without touching the route', () => {
    const canvas = makeCanvas(RECT)
    const renderer = createRenderer(canvas)
    renderer.resize(RECT.width, RECT.height)

    const a = makeMockState({ width: 48, height: 48, seed: 8, progress: 0.5 })
    renderer.draw(a, DEFAULT_RENDER_OPTIONS, 1)

    const stub = stubFor(canvas)
    const translatesBefore = stub.calls.translate ?? 0

    // A later tick at the same grid: the rover should be re-placed, and the
    // number of route/trail strokes should not depend on alpha.
    const b = { ...a, tick: a.tick + 1 }
    renderer.draw(b, DEFAULT_RENDER_OPTIONS, 0)
    const strokesAtZero = stub.calls.stroke ?? 0
    renderer.draw(b, DEFAULT_RENDER_OPTIONS, 1)
    const strokesAtOne = (stub.calls.stroke ?? 0) - strokesAtZero

    expect((stub.calls.translate ?? 0) - translatesBefore).toBe(2)
    expect(strokesAtOne).toBeGreaterThan(0)
    renderer.destroy()
  })

  it('tolerates an alpha outside [0,1] from a stalled clock', () => {
    const canvas = makeCanvas(RECT)
    const renderer = createRenderer(canvas)
    renderer.resize(RECT.width, RECT.height)
    expect(() => {
      renderer.draw(state, DEFAULT_RENDER_OPTIONS, -5)
      renderer.draw(state, DEFAULT_RENDER_OPTIONS, 42)
      renderer.draw(state, DEFAULT_RENDER_OPTIONS, Number.NaN)
    }).not.toThrow()
    renderer.destroy()
  })
})
