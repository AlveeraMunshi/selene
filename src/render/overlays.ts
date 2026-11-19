/**
 * The dynamic layer: everything redrawn every frame.
 *
 * All of it is vector work over tens-to-hundreds of elements, which is why it
 * is not cached — unlike the per-cell terrain bake, this is already cheap, and
 * caching it would mean invalidating on the rover's position, i.e. on every
 * frame.
 *
 * CANVAS STATE DISCIPLINE: every helper here wraps its body in save()/restore().
 * The 2D context is one big mutable object, and the failure it produces is
 * delayed and confusing — a `setLineDash` left set by the abandoned-route pass
 * turns the *rover's* outline dashed two helpers later, and the bug appears to
 * be in the rover code. save/restore is the only discipline that scales.
 */

import type { Cell, RoverMode, Route, SimState } from '@/core/types'
import {
  DISCOVERED_MARKER_FLOOR,
  PALETTE,
  RGB,
  cssRgb,
  hazardColor,
} from './colors'
import { pulseEnvelope } from './interp'
import type { Pose } from './interp'
import { cellCentreToCss, gridToCss, viewportRect, viewportScale, type Viewport } from './viewport'

/** How many engine ticks a hazard-discovery flash lasts. */
export const PULSE_TICKS = 8

/** Smallest on-screen rover, in CSS px, so it stays findable when zoomed out. */
const MIN_ROVER_PX = 9

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/** Clear to the page background and plate the grid area, including letterbox. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, v: Viewport): void {
  ctx.save()
  ctx.fillStyle = PALETTE.background
  ctx.fillRect(0, 0, v.cssW, v.cssH)
  const r = viewportRect(v)
  ctx.fillStyle = PALETTE.gridBackdrop
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.restore()
}

/** Hairline around the grid so the map's extent is unambiguous. */
export function drawGridFrame(ctx: CanvasRenderingContext2D, v: Viewport): void {
  const r = viewportRect(v)
  ctx.save()
  ctx.strokeStyle = PALETTE.gridBorder
  ctx.lineWidth = 1
  // Half-pixel offset so a 1px stroke lands on a pixel instead of straddling
  // two and rendering as a 2px smear.
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h))
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Hazard the rover's own sensors found
// ---------------------------------------------------------------------------

/**
 * Mark cells whose hazard was discovered rather than known from orbit.
 *
 * THIS IS THE POINT OF THE WHOLE PROJECT MADE VISIBLE. Orbit-known hazard is a
 * flat tint baked into the terrain bitmap; sensor-discovered hazard carries a
 * hatch and a ring on top of it. The user has to be able to tell at a glance
 * which obstacles the planner could have avoided from the start and which ones
 * forced a replan, and a difference in *texture* survives at small cell sizes
 * where a difference in hue would not.
 *
 * The index list comes from the terrain bake, so this walks hundreds of cells
 * rather than the full grid.
 */
export function drawDiscoveredHazards(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  cells: readonly number[],
  severities: readonly number[],
  gridW: number,
): void {
  if (cells.length === 0) return
  const s = viewportScale(v)
  if (s <= 0) return

  ctx.save()
  ctx.lineCap = 'butt'

  // Hatch first, as a single path per severity band would need sorting; one
  // path for all of them is fine because the stroke colour is constant and the
  // per-cell severity is carried by the ring instead.
  ctx.beginPath()
  for (let n = 0; n < cells.length; n++) {
    const i = cells[n]
    const cx = i % gridW
    const cy = (i / gridW) | 0
    const p = gridToCss(v, cx, cy)
    // Two diagonals per cell: enough texture to read as "surveyed" without
    // turning a dense hazard field into a solid block.
    ctx.moveTo(p.x, p.y + s)
    ctx.lineTo(p.x + s, p.y)
    ctx.moveTo(p.x + s * 0.5, p.y + s)
    ctx.lineTo(p.x + s, p.y + s * 0.5)
  }
  ctx.strokeStyle = cssRgb(RGB.hazardDiscovered, 0.55)
  ctx.lineWidth = Math.max(0.6, s * 0.1)
  ctx.stroke()

  // A ring only where the find was significant, so the map does not fill with
  // circles the moment the rover crosses a lightly textured field.
  if (s >= 4) {
    for (let n = 0; n < cells.length; n++) {
      const sev = severities[n]
      if (sev < DISCOVERED_MARKER_FLOOR * 2) continue
      const i = cells[n]
      const c = cellCentreToCss(v, i % gridW, (i / gridW) | 0)
      ctx.beginPath()
      ctx.arc(c.x, c.y, s * 0.3, 0, Math.PI * 2)
      ctx.strokeStyle = cssRgb(hazardColor(Math.min(1, sev * 2)), 0.9)
      ctx.lineWidth = Math.max(0.8, s * 0.09)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * Expanding flash on hazards found in the last few ticks.
 *
 * Read from the event log rather than from a renderer-side diff of the belief:
 * the engine already decided what counts as a discovery, and recomputing it
 * here would be a second, drifting definition of the same thing.
 */
export function drawHazardPulses(ctx: CanvasRenderingContext2D, v: Viewport, state: SimState): void {
  const s = viewportScale(v)
  if (s <= 0) return
  const now = state.tick
  const events = state.events

  ctx.save()
  ctx.lineWidth = Math.max(1, s * 0.12)
  // Events are appended in tick order, so walking backwards lets us stop as
  // soon as we are past the window instead of scanning a log that grows all
  // mission.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.tick < now - PULSE_TICKS) break
    if (e.type !== 'hazard-discovered') continue
    const age = (now - e.tick) / PULSE_TICKS
    const env = pulseEnvelope(1 - age)
    if (env <= 0.01) continue
    const c = cellCentreToCss(v, e.cell.x, e.cell.y)
    const radius = s * (0.45 + 1.5 * age)
    ctx.beginPath()
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2)
    // A discovery that landed on the route being driven is the one that costs
    // a replan, so it flashes red rather than amber.
    ctx.strokeStyle = cssRgb(e.onRoute ? RGB.hazardHigh : RGB.hazardLow, env * 0.85)
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function tracePath(ctx: CanvasRenderingContext2D, v: Viewport, cells: readonly Cell[]): void {
  ctx.beginPath()
  for (let i = 0; i < cells.length; i++) {
    const p = cellCentreToCss(v, cells[i].x, cells[i].y)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
}

/**
 * The route the rover is executing, split at how far along it has driven.
 *
 * The driven portion is dimmed rather than hidden: "where the plan said to go"
 * and "how much of it is done" are both worth seeing, and erasing the first
 * half would make a long route look like it is shrinking rather than
 * progressing.
 *
 * `progress` is a float index into `cells`, so the split happens mid-segment
 * and the join tracks the rover rather than snapping a cell at a time.
 */
export function drawPlannedRoute(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  route: Route,
  progress: number,
): void {
  const cells = route.cells
  if (cells.length < 2) return
  const s = viewportScale(v)
  const width = Math.max(1.5, s * 0.22)

  const clamped = Math.max(0, Math.min(cells.length - 1, progress))
  const whole = Math.floor(clamped)
  const frac = clamped - whole

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Driven: dim.
  if (whole > 0 || frac > 0) {
    const driven = cells.slice(0, whole + 1)
    tracePath(ctx, v, driven)
    if (frac > 0 && whole + 1 < cells.length) {
      const a = cellCentreToCss(v, cells[whole].x, cells[whole].y)
      const b = cellCentreToCss(v, cells[whole + 1].x, cells[whole + 1].y)
      ctx.lineTo(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac)
    }
    ctx.strokeStyle = cssRgb(RGB.accentDim, 0.55)
    ctx.lineWidth = width * 0.8
    ctx.stroke()
  }

  // Remaining: crisp, with a soft glow so it reads over a bright highland.
  const rest = cells.slice(whole)
  if (rest.length >= 2) {
    tracePath(ctx, v, rest)
    ctx.strokeStyle = cssRgb(RGB.accent, 0.18)
    ctx.lineWidth = width * 2.4
    ctx.stroke()
    ctx.strokeStyle = cssRgb(RGB.accent, 0.95)
    ctx.lineWidth = width
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Routes a replan threw away, as faint dashed ghosts.
 *
 * Showing the discarded plan beside the current one is what makes a replan
 * legible as a *decision* rather than as the line twitching. Older ones fade
 * further, so a sequence of replans reads in order.
 */
export function drawAbandonedRoutes(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  routes: readonly Route[],
): void {
  if (routes.length === 0) return
  const s = viewportScale(v)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  ctx.setLineDash([Math.max(3, s * 0.5), Math.max(3, s * 0.55)])
  ctx.lineWidth = Math.max(1, s * 0.12)
  const last = routes.length - 1
  for (let i = 0; i < routes.length; i++) {
    const cells = routes[i].cells
    if (cells.length < 2) continue
    // Most recent at 0.5, fading to 0.14 for the oldest still on screen.
    const recency = last === 0 ? 1 : i / last
    ctx.strokeStyle = cssRgb(RGB.abandoned, 0.14 + 0.36 * recency)
    tracePath(ctx, v, cells)
    ctx.stroke()
  }
  ctx.restore()
}

/** Where the rover has physically been, as opposed to where it planned to go. */
export function drawTrail(ctx: CanvasRenderingContext2D, v: Viewport, trail: readonly Cell[]): void {
  if (trail.length < 2) return
  const s = viewportScale(v)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  tracePath(ctx, v, trail)
  ctx.strokeStyle = cssRgb(RGB.trail, 0.32)
  ctx.lineWidth = Math.max(1, s * 0.3)
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------

/**
 * Numbered mission waypoints; reached ones filled, pending ones outlined.
 *
 * Numbers rather than plain dots because the order is a mission parameter the
 * user chose, and a replan can make the rover visit them in a visually
 * surprising sequence.
 */
export function drawWaypoints(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  waypoints: readonly Cell[],
  currentIndex: number,
): void {
  if (waypoints.length === 0) return
  const s = viewportScale(v)
  const r = Math.max(5, Math.min(13, s * 0.85))

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.round(r * 1.05)}px ui-sans-serif, system-ui, sans-serif`
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i]
    const c = cellCentreToCss(v, w.x, w.y)
    const reached = i < currentIndex

    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    if (reached) {
      ctx.fillStyle = cssRgb(RGB.waypointReached, 0.9)
      ctx.fill()
      ctx.fillStyle = PALETTE.roverDark
    } else {
      ctx.fillStyle = 'rgba(7,8,10,0.72)'
      ctx.fill()
      ctx.strokeStyle = cssRgb(RGB.waypointPending, 0.85)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = PALETTE.waypointPending
    }
    if (r >= 7) ctx.fillText(String(i + 1), c.x, c.y + 0.5)
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Rover
// ---------------------------------------------------------------------------

/** Modes in which the rover is stopped and waiting on something. */
const HALTED: ReadonlySet<RoverMode> = new Set<RoverMode>([
  'awaiting-approval',
  'failed',
  'aborted',
])

/**
 * The rover: a chassis with a heading, six wheels and a sensor ring.
 *
 * Drawn in a rotated local frame so the geometry below reads as a side-on
 * plan rather than as trigonometry. Deliberately a small, precise instrument
 * shape — it has to stay legible at ~6 px per cell and sit on a data map
 * without looking like a game sprite.
 */
export function drawRover(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  pose: Pose,
  sensorRangeCells: number,
  mode: RoverMode,
): void {
  const s = viewportScale(v)
  if (s <= 0) return
  const c = gridToCss(v, pose.pos.x + 0.5, pose.pos.y + 0.5)

  // Sensor reach, in the same units as the grid so it is honest about range.
  if (sensorRangeCells > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(c.x, c.y, sensorRangeCells * s, 0, Math.PI * 2)
    ctx.strokeStyle = cssRgb(RGB.accent, 0.3)
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    ctx.stroke()
    ctx.fillStyle = cssRgb(RGB.accent, 0.04)
    ctx.fill()
    ctx.restore()
  }

  const len = Math.max(MIN_ROVER_PX, s * 1.7)
  const wid = len * 0.66

  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(pose.heading)

  // Wheels: two bogies a side, drawn under the hull.
  ctx.fillStyle = PALETTE.roverDark
  const wr = len * 0.17
  for (const dx of [-len * 0.3, len * 0.3]) {
    for (const dy of [-wid * 0.52, wid * 0.52]) {
      ctx.beginPath()
      ctx.ellipse(dx, dy, wr, wr * 0.62, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Hull.
  const hx = len * 0.44
  const hy = wid * 0.42
  ctx.beginPath()
  ctx.moveTo(-hx, -hy)
  ctx.lineTo(hx * 0.62, -hy)
  ctx.lineTo(hx, 0)
  ctx.lineTo(hx * 0.62, hy)
  ctx.lineTo(-hx, hy)
  ctx.closePath()
  ctx.fillStyle = HALTED.has(mode) ? cssRgb(RGB.hazardLow) : PALETTE.roverBody
  ctx.fill()
  ctx.strokeStyle = PALETTE.roverDark
  ctx.lineWidth = Math.max(0.8, len * 0.07)
  ctx.stroke()

  // Mast and heading tick: the only thing that tells you which way it faces at
  // small sizes, so it is drawn in the accent rather than in the hull colour.
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(hx * 1.55, 0)
  ctx.strokeStyle = cssRgb(RGB.accent, 0.95)
  ctx.lineWidth = Math.max(1, len * 0.1)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, Math.max(1.2, len * 0.13), 0, Math.PI * 2)
  ctx.fillStyle = cssRgb(RGB.accent)
  ctx.fill()

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Hover and selection
// ---------------------------------------------------------------------------

export function drawCellOutline(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  cell: Cell,
  color: string,
  alpha: number,
  lineWidth: number,
): void {
  const s = viewportScale(v)
  if (s <= 0) return
  const p = gridToCss(v, cell.x, cell.y)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  // Inset by half the stroke so the outline sits inside the cell and a
  // neighbouring cell's outline does not overlap it.
  const h = lineWidth / 2
  ctx.strokeRect(p.x + h, p.y + h, s - lineWidth, s - lineWidth)
  ctx.restore()
}
