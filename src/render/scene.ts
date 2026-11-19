/**
 * The renderer: a pure function of SimState onto a canvas.
 *
 * It reads state and draws it. It decides nothing. If the rover appears to
 * move, the engine moved it; if a route changes, the planner changed it. The
 * only state the renderer owns is presentational — the cached terrain bitmap,
 * the canvas size, and the previous tick's rover pose, which exists solely so
 * that 2 Hz simulation can be shown at 60 Hz without stuttering.
 *
 * SimState is never mutated. Nothing in this file assigns through a reference
 * reachable from the state argument.
 *
 * FRAME SHAPE
 *   1  reset the transform for the current device-pixel ratio
 *   2  clear, and plate the grid's square inside the letterbox
 *   3  blit the cached terrain bitmap   (repainted only on belief change)
 *   4  sensor-discovered hazard markers (hundreds of cells, from the bake)
 *   5  discovery pulses, abandoned routes, trail, planned route
 *   6  waypoints, rover, hover and selection
 *
 * Order matters: terrain under data, data under intent, intent under the
 * rover, and the cursor on top of everything.
 */

import type { Cell, SimState } from '@/core/types'
import {
  drawAbandonedRoutes,
  drawBackdrop,
  drawCellOutline,
  drawDiscoveredHazards,
  drawGridFrame,
  drawHazardPulses,
  drawPlannedRoute,
  drawRover,
  drawTrail,
  drawWaypoints,
} from './overlays'
import { PALETTE } from './colors'
import { interpolatePose, poseOf, type Pose } from './interp'
import { TerrainCache } from './terrainLayer'
import { clientToCell, makeViewport, viewportScale, type Viewport } from './viewport'

/** Frozen in docs/ENGINE_API.md. Implemented exactly; no extra fields. */
export interface RenderOptions {
  showElevation: boolean
  showSlope: boolean
  showHazard: boolean
  showObserved: boolean
  showPlannedRoute: boolean
  showTrail: boolean
  showAbandoned: boolean
  hoverCell: Cell | null
  selectedCell: Cell | null
}

export interface Renderer {
  draw(state: SimState, opts: RenderOptions, alpha: number): void
  resize(cssW: number, cssH: number): void
  cellAt(clientX: number, clientY: number): Cell | null
  destroy(): void
}

/** Sensible defaults, so a caller can spread and override one flag. */
export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showElevation: true,
  showSlope: true,
  showHazard: true,
  showObserved: true,
  showPlannedRoute: true,
  showTrail: true,
  showAbandoned: true,
  hoverCell: null,
  selectedCell: null,
}

/**
 * Upper bound on the device-pixel ratio we allocate a backing store for.
 *
 * A 3x display at 1600 CSS px wide is a 4800 px backing store, which is 4x the
 * fill cost of 2x for a difference almost nobody can see on a map made of flat
 * cells. Capping bounds the worst case; it does not affect layout, because all
 * drawing is in CSS pixels.
 */
const MAX_DPR = 3

function currentDpr(): number {
  if (typeof window === 'undefined') return 1
  const d = window.devicePixelRatio
  if (!Number.isFinite(d) || d <= 0) return 1
  return Math.min(d, MAX_DPR)
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const maybeCtx = canvas.getContext('2d')
  if (maybeCtx === null) {
    throw new Error(
      'createRenderer: this canvas has no 2D context. The renderer cannot run without one.',
    )
  }
  // Re-bound with a non-nullable declared type. Narrowing a `const` does not
  // survive into the closures declared below it, and threading a null check
  // through every draw helper would be noise for a condition that is already
  // impossible by the time any of them can run.
  const ctx: CanvasRenderingContext2D = maybeCtx

  const terrain = new TerrainCache()

  let cssW = canvas.clientWidth || canvas.width || 1
  let cssH = canvas.clientHeight || canvas.height || 1
  let dpr = currentDpr()

  // Grid dimensions from the most recent draw. `cellAt` needs them, and they
  // are not known until a state has been seen.
  let gridW = 0
  let gridH = 0

  // Pose interpolation. `prev` and `curr` are the last two *engine ticks*, not
  // the last two frames — see interp.ts for why we interpolate backwards.
  let prev: Pose | null = null
  let curr: Pose | null = null
  let lastTick = Number.NaN

  let destroyed = false

  function applyBackingStore(): void {
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    // Assigning width/height resets the whole context state, so only do it
    // when it actually changed — otherwise every frame would clear the canvas
    // twice and throw away the transform we are about to set.
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
  }

  function viewport(): Viewport {
    return makeViewport(cssW, cssH, gridW, gridH)
  }

  function resize(nextCssW: number, nextCssH: number): void {
    if (destroyed) return
    cssW = Math.max(1, nextCssW)
    cssH = Math.max(1, nextCssH)
    dpr = currentDpr()
    applyBackingStore()
  }

  function draw(state: SimState, opts: RenderOptions, alpha: number): void {
    if (destroyed) return

    gridW = state.belief.width
    gridH = state.belief.height

    // The ratio can change mid-session when a window moves between monitors.
    const nextDpr = currentDpr()
    if (nextDpr !== dpr) {
      dpr = nextDpr
    }
    applyBackingStore()

    // setTransform rather than scale: it *replaces* the matrix, so a frame
    // that threw halfway through cannot leave a doubled scale behind. Every
    // coordinate below this line is a CSS pixel.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()

    const v = viewport()
    drawBackdrop(ctx, v)

    if (gridW > 0 && gridH > 0 && viewportScale(v) > 0) {
      drawStatic(state, opts, v)
      drawDynamic(state, opts, v, alpha)
      drawGridFrame(ctx, v)
    }

    ctx.restore()
  }

  function drawStatic(state: SimState, opts: RenderOptions, v: Viewport): void {
    const staticOpts = {
      showElevation: opts.showElevation,
      showSlope: opts.showSlope,
      showHazard: opts.showHazard,
      showObserved: opts.showObserved,
    }
    const ready = terrain.ensure(state, staticOpts)
    const bitmap = terrain.bitmap
    const s = viewportScale(v)
    const ox = (cssW - gridW * s) / 2
    const oy = (cssH - gridH * s) / 2

    if (ready && bitmap !== null) {
      ctx.save()
      // Cells are data, not a photograph: smoothing would bleed a hazard cell
      // into its clear neighbour and make the boundary a lie.
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(bitmap as CanvasImageSource, ox, oy, gridW * s, gridH * s)
      ctx.restore()
    } else {
      terrain.paintDirect(ctx, state, staticOpts, ox, oy, s)
    }
  }

  function drawDynamic(state: SimState, opts: RenderOptions, v: Viewport, alpha: number): void {
    if (opts.showHazard) {
      drawDiscoveredHazards(
        ctx,
        v,
        terrain.discovered,
        terrain.discoveredSeverities,
        state.belief.width,
      )
      drawHazardPulses(ctx, v, state)
    }

    if (opts.showAbandoned) drawAbandonedRoutes(ctx, v, state.abandonedRoutes)
    if (opts.showTrail) drawTrail(ctx, v, state.trail)
    if (opts.showPlannedRoute && state.rover.route !== null) {
      drawPlannedRoute(ctx, v, state.rover.route, state.rover.routeProgress)
    }

    drawWaypoints(ctx, v, state.config.waypoints, state.rover.waypointIndex)

    // Pose: shift the window on a tick boundary, then interpolate inside it.
    if (state.tick !== lastTick) {
      prev = curr ?? poseOf(state.rover)
      curr = poseOf(state.rover)
      lastTick = state.tick
    } else if (curr === null) {
      curr = poseOf(state.rover)
      prev = curr
    }
    const pose = interpolatePose(prev ?? curr, curr, alpha)

    drawRover(ctx, v, pose, state.config.rover.sensorRangeCells, state.rover.mode)

    if (opts.hoverCell !== null) {
      drawCellOutline(ctx, v, opts.hoverCell, PALETTE.selection, 0.45, 1.5)
    }
    if (opts.selectedCell !== null) {
      drawCellOutline(ctx, v, opts.selectedCell, PALETTE.accent, 1, 2)
    }
  }

  /**
   * Client pixels -> cell.
   *
   * The element's laid-out rectangle is the source of truth for where the
   * canvas is and how big CSS made it, which is what keeps this correct when
   * the element is stretched or sits inside a transformed ancestor. The
   * device-pixel ratio deliberately plays no part: `getBoundingClientRect`
   * reports CSS pixels, and the backing store's scale is already accounted for
   * by the single `setTransform` in `draw`. Dividing by dpr here is the
   * classic double-scale bug — it would make the mapping correct only on a
   * 1x display.
   */
  function cellAt(clientX: number, clientY: number): Cell | null {
    if (destroyed || gridW === 0 || gridH === 0) return null
    const rect = canvas.getBoundingClientRect()
    return clientToCell(viewport(), clientX, clientY, rect)
  }

  function destroy(): void {
    destroyed = true
    terrain.destroy()
    prev = null
    curr = null
  }

  applyBackingStore()
  return { draw, resize, cellAt, destroy }
}
