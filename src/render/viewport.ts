/**
 * Pure grid <-> screen geometry.
 *
 * WHY THIS IS A SEPARATE MODULE WITH NO CANVAS IN IT: `cellAt()` is the single
 * piece of the renderer whose bugs are invisible. Everything else is wrong in a
 * way you can see — a colour is off, a line is in the wrong place. A mapping
 * that is one cell out only shows up as "clicking the map sometimes selects the
 * wrong square", which is maddening to chase through a canvas, a device-pixel
 * ratio and a letterbox at the same time. Keeping the arithmetic in plain
 * functions over plain numbers means the round-trip can be asserted directly.
 *
 * Coordinate systems, in order:
 *   client px  — what a MouseEvent reports, relative to the viewport
 *   css px     — relative to the canvas element's top-left (what we draw in)
 *   grid units — cells; (0,0) is the top-left corner of cell (0,0)
 *   cell       — integer cell coordinates
 *
 * Device pixels appear in exactly one place, the canvas backing store, and are
 * handled by a single `setTransform` in the renderer. No layout code below ever
 * sees a dpr, which is deliberate: dpr bugs come from scaling twice.
 */

import type { Cell } from '@/core/types'

/**
 * Everything needed to place a square grid inside a possibly non-square canvas.
 *
 * `zoom` and `pan` are carried even though the shipped UI leaves them at
 * identity, because the inverse mapping is only *provably* right if the test
 * can exercise it away from identity — a round-trip that only ever runs at
 * zoom 1, pan 0 passes for several wrong implementations.
 */
export interface Viewport {
  /** Canvas size in CSS pixels. */
  cssW: number
  cssH: number
  /** Grid size in cells. */
  gridW: number
  gridH: number
  /** Multiplier on the fit scale. 1 = fit the whole grid. */
  zoom: number
  /** Offset in CSS pixels applied after fitting. */
  panX: number
  panY: number
}

export function makeViewport(
  cssW: number,
  cssH: number,
  gridW: number,
  gridH: number,
  zoom = 1,
  panX = 0,
  panY = 0,
): Viewport {
  return { cssW, cssH, gridW, gridH, zoom, panX, panY }
}

/**
 * CSS pixels per cell edge.
 *
 * `min` of the two axes rather than `max`, so the grid is letterboxed inside
 * the canvas rather than cropped by it. Cells stay square: a non-uniform scale
 * would make a circular sensor range render as an ellipse and silently
 * misrepresent the rover's reach.
 */
export function viewportScale(v: Viewport): number {
  if (v.gridW <= 0 || v.gridH <= 0) return 0
  const fit = Math.min(v.cssW / v.gridW, v.cssH / v.gridH)
  return fit * v.zoom
}

/** Top-left of cell (0,0) in CSS pixels, including the letterbox and the pan. */
export function viewportOrigin(v: Viewport): { x: number; y: number } {
  const s = viewportScale(v)
  return {
    x: (v.cssW - v.gridW * s) / 2 + v.panX,
    y: (v.cssH - v.gridH * s) / 2 + v.panY,
  }
}

/** The grid's drawn rectangle in CSS pixels. */
export function viewportRect(v: Viewport): { x: number; y: number; w: number; h: number } {
  const s = viewportScale(v)
  const o = viewportOrigin(v)
  return { x: o.x, y: o.y, w: v.gridW * s, h: v.gridH * s }
}

/**
 * Grid units -> CSS pixels. Accepts fractional grid coordinates, which is what
 * the interpolated rover position and the route polylines are made of.
 */
export function gridToCss(v: Viewport, gx: number, gy: number): { x: number; y: number } {
  const s = viewportScale(v)
  const o = viewportOrigin(v)
  return { x: o.x + gx * s, y: o.y + gy * s }
}

/** The *centre* of a cell in CSS pixels. Routes and markers are centre-anchored. */
export function cellCentreToCss(v: Viewport, cx: number, cy: number): { x: number; y: number } {
  return gridToCss(v, cx + 0.5, cy + 0.5)
}

/** CSS pixels -> fractional grid units. Unbounded; may be outside the grid. */
export function cssToGrid(v: Viewport, x: number, y: number): { x: number; y: number } {
  const s = viewportScale(v)
  if (s === 0) return { x: 0, y: 0 }
  const o = viewportOrigin(v)
  return { x: (x - o.x) / s, y: (y - o.y) / s }
}

/**
 * CSS pixels -> integer cell, or null when the point is in the letterbox.
 *
 * `Math.floor` and not `Math.round`: a cell owns the half-open square
 * [cx, cx+1), so the cell *centre* at cx + 0.5 floors back to cx, and the
 * boundary at exactly cx belongs to cx rather than to cx - 1. Rounding here is
 * the classic off-by-one — it would make every cell's clickable area straddle
 * two cells and shift the whole grid by half a cell.
 */
export function cssToCell(v: Viewport, x: number, y: number): Cell | null {
  const g = cssToGrid(v, x, y)
  const cx = Math.floor(g.x)
  const cy = Math.floor(g.y)
  if (cx < 0 || cy < 0 || cx >= v.gridW || cy >= v.gridH) return null
  return { x: cx, y: cy }
}

/**
 * Client (event) pixels -> CSS pixels inside the canvas.
 *
 * `rectW`/`rectH` are the element's *laid-out* size from `getBoundingClientRect`
 * and `cssW`/`cssH` are the size the renderer was told to draw at. They are
 * normally equal, and are not when CSS stretches the element (`width: 100%` on
 * a canvas whose attributes say otherwise) or when a transform scales an
 * ancestor. Dividing through by the ratio is what keeps hit-testing correct in
 * those cases instead of drifting proportionally to the error.
 */
export function clientToCss(
  v: Viewport,
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const kx = rect.width > 0 ? v.cssW / rect.width : 1
  const ky = rect.height > 0 ? v.cssH / rect.height : 1
  return { x: (clientX - rect.left) * kx, y: (clientY - rect.top) * ky }
}

/** The full client -> cell mapping, as one function so it can be tested as one. */
export function clientToCell(
  v: Viewport,
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Cell | null {
  const p = clientToCss(v, clientX, clientY, rect)
  return cssToCell(v, p.x, p.y)
}
