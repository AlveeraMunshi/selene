/**
 * Grid <-> screen geometry.
 *
 * The round-trip is the assertion that matters: every cell's centre must map
 * back to that cell. It is checked away from identity zoom and pan on purpose,
 * because a round-trip that only ever runs at zoom 1 / pan 0 also passes for
 * an implementation that forgets the scale entirely.
 */

import { describe, expect, it } from 'vitest'
import {
  cellCentreToCss,
  clientToCell,
  clientToCss,
  cssToCell,
  cssToGrid,
  gridToCss,
  makeViewport,
  viewportOrigin,
  viewportRect,
  viewportScale,
} from '../viewport'

const RECT = { left: 0, top: 0, width: 0, height: 0 }

describe('viewportScale', () => {
  it('fits the grid inside the canvas on the tighter axis', () => {
    // 800x400 canvas, 16x16 grid: height is the binding constraint.
    expect(viewportScale(makeViewport(800, 400, 16, 16))).toBe(25)
    expect(viewportScale(makeViewport(400, 800, 16, 16))).toBe(25)
  })

  it('keeps cells square for a non-square grid', () => {
    const v = makeViewport(600, 600, 30, 10)
    const s = viewportScale(v)
    expect(s).toBe(20)
    const r = viewportRect(v)
    expect(r.w).toBe(600)
    expect(r.h).toBe(200)
  })

  it('multiplies through by zoom', () => {
    expect(viewportScale(makeViewport(800, 400, 16, 16, 2))).toBe(50)
  })

  it('is zero rather than Infinity for a degenerate grid', () => {
    expect(viewportScale(makeViewport(800, 400, 0, 0))).toBe(0)
    expect(cssToGrid(makeViewport(800, 400, 0, 0), 10, 10)).toEqual({ x: 0, y: 0 })
  })
})

describe('viewportOrigin', () => {
  it('centres the grid, so the letterbox is split evenly', () => {
    const o = viewportOrigin(makeViewport(800, 400, 16, 16))
    expect(o).toEqual({ x: 200, y: 0 })
  })

  it('adds the pan after centring', () => {
    const o = viewportOrigin(makeViewport(800, 400, 16, 16, 1, 30, -12))
    expect(o).toEqual({ x: 230, y: -12 })
  })
})

describe('cell centre round-trip', () => {
  const cases = [
    { label: 'identity, square canvas', v: makeViewport(512, 512, 16, 16) },
    { label: 'letterboxed horizontally', v: makeViewport(900, 400, 32, 32) },
    { label: 'letterboxed vertically', v: makeViewport(400, 900, 32, 32) },
    { label: 'fractional scale', v: makeViewport(777, 613, 128, 128) },
    { label: 'zoomed in', v: makeViewport(512, 512, 16, 16, 2.5) },
    { label: 'zoomed out', v: makeViewport(512, 512, 16, 16, 0.4) },
    { label: 'panned', v: makeViewport(512, 512, 16, 16, 1, 37, -21) },
    { label: 'zoomed and panned', v: makeViewport(640, 480, 64, 64, 1.75, -88, 46) },
    { label: 'non-square grid', v: makeViewport(800, 300, 40, 12, 1.2, 15, 7) },
  ]

  for (const { label, v } of cases) {
    it(`maps every cell centre back to itself: ${label}`, () => {
      for (let y = 0; y < v.gridH; y++) {
        for (let x = 0; x < v.gridW; x++) {
          const p = cellCentreToCss(v, x, y)
          expect(cssToCell(v, p.x, p.y)).toEqual({ x, y })
        }
      }
    })
  }
})

describe('cssToCell boundaries', () => {
  const v = makeViewport(400, 400, 8, 8) // scale 50, origin 0,0

  it('assigns a boundary to the cell it opens, not the one it closes', () => {
    // A cell owns [cx, cx+1). x = 50 is the start of cell 1, not the end of 0.
    expect(cssToCell(v, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(cssToCell(v, 49.999, 0)).toEqual({ x: 0, y: 0 })
    expect(cssToCell(v, 50, 0)).toEqual({ x: 1, y: 0 })
  })

  it('returns null outside the grid', () => {
    expect(cssToCell(v, -1, 10)).toBeNull()
    expect(cssToCell(v, 10, -0.001)).toBeNull()
    expect(cssToCell(v, 400, 10)).toBeNull()
    expect(cssToCell(v, 10, 400)).toBeNull()
  })

  it('returns null in the letterbox rather than clamping to an edge cell', () => {
    // 800x400 canvas with a 16x16 grid leaves 200px of letterbox each side.
    const wide = makeViewport(800, 400, 16, 16)
    expect(cssToCell(wide, 100, 200)).toBeNull()
    expect(cssToCell(wide, 700, 200)).toBeNull()
    expect(cssToCell(wide, 201, 200)).toEqual({ x: 0, y: 8 })
  })
})

describe('gridToCss', () => {
  it('accepts fractional grid coordinates, as the interpolated rover needs', () => {
    const v = makeViewport(400, 400, 8, 8)
    expect(gridToCss(v, 2.5, 3.25)).toEqual({ x: 125, y: 162.5 })
  })
})

describe('clientToCss', () => {
  it('subtracts the element origin', () => {
    const v = makeViewport(400, 400, 8, 8)
    const rect = { left: 40, top: 25, width: 400, height: 400 }
    expect(clientToCss(v, 140, 125, rect)).toEqual({ x: 100, y: 100 })
  })

  it('corrects for CSS stretching the element away from its drawn size', () => {
    // Drawn at 400x400, laid out at 800x800: a click halfway across the
    // element is still halfway across the grid.
    const v = makeViewport(400, 400, 8, 8)
    const rect = { left: 0, top: 0, width: 800, height: 800 }
    expect(clientToCss(v, 400, 400, rect)).toEqual({ x: 200, y: 200 })
    expect(clientToCell(v, 400, 400, rect)).toEqual({ x: 4, y: 4 })
  })

  it('falls back to 1:1 for a detached element with a zero rect', () => {
    const v = makeViewport(400, 400, 8, 8)
    expect(clientToCss(v, 100, 100, RECT)).toEqual({ x: 100, y: 100 })
  })
})
