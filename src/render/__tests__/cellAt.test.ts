/**
 * `cellAt` through the real renderer.
 *
 * This is the test the whole viewport module exists for. Hit-testing a canvas
 * crosses three coordinate systems and a device-pixel ratio, and when it is
 * wrong the symptom is "clicking the map sometimes picks the wrong square",
 * which is nearly impossible to localise by hand. The assertion is exhaustive
 * on purpose: every cell centre, at several device-pixel ratios and several
 * canvas aspect ratios, must come back as its own cell.
 *
 * The device-pixel ratio is swept specifically because the obvious wrong
 * implementation — dividing the pointer position by dpr — is correct at 1x and
 * silently wrong everywhere else, which is exactly the machine most people
 * develop on.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRenderer } from '../scene'
import { DEFAULT_RENDER_OPTIONS } from '../scene'
import { makeMockState } from '../mock'
import { installCanvasStub, makeCanvas, setDpr, uninstallCanvasStub } from './stubCanvas'
import { makeViewport, viewportOrigin, viewportScale } from '../viewport'

beforeAll(installCanvasStub)
afterAll(() => {
  uninstallCanvasStub()
  setDpr(1)
})
afterEach(() => setDpr(1))

const GRID = 16
const state = makeMockState({ width: GRID, height: GRID, seed: 42, progress: 0.4 })

interface Layout {
  label: string
  rect: { left: number; top: number; width: number; height: number }
}

const LAYOUTS: Layout[] = [
  { label: 'square', rect: { left: 0, top: 0, width: 480, height: 480 } },
  { label: 'wide, letterboxed left and right', rect: { left: 0, top: 0, width: 900, height: 400 } },
  { label: 'tall, letterboxed top and bottom', rect: { left: 0, top: 0, width: 400, height: 900 } },
  { label: 'offset in the page', rect: { left: 137, top: 64, width: 613, height: 451 } },
  { label: 'fractional size', rect: { left: 10.5, top: 7.25, width: 777.5, height: 519.75 } },
]

const DPRS = [1, 1.25, 2, 3]

describe('cellAt', () => {
  for (const { label, rect } of LAYOUTS) {
    for (const dpr of DPRS) {
      it(`round-trips every cell centre: ${label} at dpr ${dpr}`, () => {
        setDpr(dpr)
        const canvas = makeCanvas(rect)
        const renderer = createRenderer(canvas)
        renderer.resize(rect.width, rect.height)
        renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)

        const v = makeViewport(rect.width, rect.height, GRID, GRID)
        const s = viewportScale(v)
        const o = viewportOrigin(v)

        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const clientX = rect.left + o.x + (x + 0.5) * s
            const clientY = rect.top + o.y + (y + 0.5) * s
            expect(renderer.cellAt(clientX, clientY)).toEqual({ x, y })
          }
        }
        renderer.destroy()
      })
    }
  }

  it('is unaffected by the device-pixel ratio, which is the classic bug here', () => {
    const rect = { left: 23, top: 41, width: 640, height: 480 }
    const probe = { x: 300, y: 260 }
    const results = DPRS.map((dpr) => {
      setDpr(dpr)
      const canvas = makeCanvas(rect)
      const renderer = createRenderer(canvas)
      renderer.resize(rect.width, rect.height)
      renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)
      const cell = renderer.cellAt(rect.left + probe.x, rect.top + probe.y)
      renderer.destroy()
      return cell
    })
    for (const r of results) expect(r).toEqual(results[0])
    expect(results[0]).not.toBeNull()
  })

  it('sizes the backing store to css pixels times dpr', () => {
    setDpr(2)
    const rect = { left: 0, top: 0, width: 300, height: 200 }
    const canvas = makeCanvas(rect)
    const renderer = createRenderer(canvas)
    renderer.resize(300, 200)
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(400)
    renderer.destroy()
  })

  it('caps the backing store so a very high dpr cannot explode the fill cost', () => {
    setDpr(8)
    const rect = { left: 0, top: 0, width: 400, height: 400 }
    const canvas = makeCanvas(rect)
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    expect(canvas.width).toBe(1200) // capped at 3x, not 8x
    renderer.destroy()
  })

  it('corrects for CSS stretching the element past its drawn size', () => {
    // Told to draw at 400x400; CSS lays it out at 800x800.
    const rect = { left: 0, top: 0, width: 800, height: 800 }
    const canvas = makeCanvas(rect)
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)
    // Dead centre of the laid-out element is dead centre of the grid.
    expect(renderer.cellAt(400, 400)).toEqual({ x: GRID / 2, y: GRID / 2 })
    renderer.destroy()
  })

  it('returns null in the letterbox rather than clamping to the nearest cell', () => {
    const rect = { left: 0, top: 0, width: 900, height: 300 }
    const canvas = makeCanvas(rect)
    const renderer = createRenderer(canvas)
    renderer.resize(rect.width, rect.height)
    renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)
    expect(renderer.cellAt(10, 150)).toBeNull()
    expect(renderer.cellAt(890, 150)).toBeNull()
    expect(renderer.cellAt(450, 150)).not.toBeNull()
    renderer.destroy()
  })

  it('returns null before any state has been drawn', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    expect(renderer.cellAt(200, 200)).toBeNull()
    renderer.destroy()
  })

  it('returns null after destroy, so a late pointer event cannot resurrect it', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)
    expect(renderer.cellAt(200, 200)).not.toBeNull()
    renderer.destroy()
    expect(renderer.cellAt(200, 200)).toBeNull()
  })
})

describe('createRenderer', () => {
  it('throws a clear error when the canvas has no 2D context', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 10, height: 10 })
    canvas.getContext = (() => null) as never
    expect(() => createRenderer(canvas)).toThrow(/no 2D context/)
  })

  it('draws without touching the state it was given', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    const snapshot = JSON.stringify({
      tick: state.tick,
      rover: state.rover,
      trail: state.trail.length,
      abandoned: state.abandonedRoutes.length,
      events: state.events.length,
    })
    for (let i = 0; i <= 10; i++) renderer.draw(state, DEFAULT_RENDER_OPTIONS, i / 10)
    expect(
      JSON.stringify({
        tick: state.tick,
        rover: state.rover,
        trail: state.trail.length,
        abandoned: state.abandonedRoutes.length,
        events: state.events.length,
      }),
    ).toBe(snapshot)
    renderer.destroy()
  })

  it('survives every layer being switched off', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    expect(() =>
      renderer.draw(
        state,
        {
          showElevation: false,
          showSlope: false,
          showHazard: false,
          showObserved: false,
          showPlannedRoute: false,
          showTrail: false,
          showAbandoned: false,
          hoverCell: null,
          selectedCell: null,
        },
        0.5,
      ),
    ).not.toThrow()
    renderer.destroy()
  })

  it('accepts a hover and a selection without throwing', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.resize(400, 400)
    expect(() =>
      renderer.draw(
        state,
        { ...DEFAULT_RENDER_OPTIONS, hoverCell: { x: 2, y: 3 }, selectedCell: { x: 9, y: 1 } },
        1,
      ),
    ).not.toThrow()
    renderer.destroy()
  })

  it('tolerates a zero-sized canvas', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 0, height: 0 })
    const renderer = createRenderer(canvas)
    renderer.resize(0, 0)
    expect(() => renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)).not.toThrow()
    renderer.destroy()
  })

  it('is inert after destroy', () => {
    const canvas = makeCanvas({ left: 0, top: 0, width: 400, height: 400 })
    const renderer = createRenderer(canvas)
    renderer.destroy()
    expect(() => renderer.draw(state, DEFAULT_RENDER_OPTIONS, 0)).not.toThrow()
    expect(() => renderer.resize(100, 100)).not.toThrow()
  })
})
