/**
 * A deterministic fake SimState, for developing and testing the renderer
 * without the engine.
 *
 * WHY IT IS SELF-CONTAINED. It imports `core/types` and nothing else — no
 * terrain generator, no planner, no engine. That is deliberate: the renderer
 * was built in parallel with the engine and had to be runnable before it
 * existed, and more importantly a renderer test that depends on the engine
 * fails when the *engine* regresses, which makes it useless as a renderer
 * test. Everything below is a plausible shape, not a correct simulation: the
 * terrain is noise and craters, the route is a swept arc, and the costs are
 * made up. Nothing here is a reference implementation of anything in core/.
 *
 * It is deterministic for the same seed, so a visual difference between two
 * runs is always a renderer change.
 */

import type {
  Belief,
  Cell,
  MissionConfig,
  Route,
  RoverSpec,
  RoverState,
  SimEvent,
  SimState,
  Terrain,
} from '@/core/types'
import { METRES_PER_CELL, TICK_SECONDS } from '@/core/types'

export interface MockOptions {
  width?: number
  height?: number
  seed?: number
  /** 0..1 — how far along its route the rover has driven. */
  progress?: number
  /** Include a discarded route, so the replan ghost is visible. */
  withAbandoned?: boolean
}

export const MOCK_ROVER: RoverSpec = {
  maxSpeedMs: 0.35,
  capacityWh: 1800,
  flatWhPerM: 0.45,
  climbWhPerMPerDeg: 0.035,
  sensorRangeCells: 7,
  idleW: 12,
}

/** mulberry32, the same cheap deterministic generator the engine uses. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Value noise on a coarse lattice, bilinearly interpolated with a smoothstep. */
function valueNoise(grid: Float32Array, gw: number, gh: number, x: number, y: number): number {
  const gx = Math.min(gw - 1, Math.max(0, x))
  const gy = Math.min(gh - 1, Math.max(0, y))
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(gw - 1, x0 + 1)
  const y1 = Math.min(gh - 1, y0 + 1)
  const fx = smoothstep(gx - x0)
  const fy = smoothstep(gy - y0)
  const a = grid[y0 * gw + x0]
  const b = grid[y0 * gw + x1]
  const c = grid[y1 * gw + x0]
  const d = grid[y1 * gw + x1]
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
}

function lattice(n: number, r: () => number): Float32Array {
  const g = new Float32Array(n * n)
  for (let i = 0; i < g.length; i++) g[i] = r()
  return g
}

function makeTerrain(width: number, height: number, seed: number): Terrain {
  const r = rng(seed)
  const n = width * height
  const elevation = new Float32Array(n)
  const slopeDeg = new Float32Array(n)
  const hazard = new Float32Array(n)
  const hiddenHazard = new Float32Array(n)

  // Four octaves of value noise, each on a finer lattice at half the weight.
  const octaves = [
    { size: 4, amp: 1 },
    { size: 8, amp: 0.5 },
    { size: 16, amp: 0.25 },
    { size: 32, amp: 0.125 },
  ].map((o) => ({ ...o, grid: lattice(o.size, r) }))

  const relief = 60
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0
      let norm = 0
      for (const o of octaves) {
        v += o.amp * valueNoise(o.grid, o.size, o.size, (x / width) * (o.size - 1), (y / height) * (o.size - 1))
        norm += o.amp
      }
      elevation[y * width + x] = (v / norm) * relief
    }
  }

  // Craters: a bowl with a raised rim. Without them the field reads as dunes
  // rather than as the Moon.
  const craters = 14
  for (let k = 0; k < craters; k++) {
    const cx = r() * width
    const cy = r() * height
    const rad = 4 + r() * 14
    const depth = 4 + r() * 16
    const x0 = Math.max(0, Math.floor(cx - rad * 1.5))
    const x1 = Math.min(width - 1, Math.ceil(cx + rad * 1.5))
    const y0 = Math.max(0, Math.floor(cy - rad * 1.5))
    const y1 = Math.min(height - 1, Math.ceil(cy + rad * 1.5))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad
        if (d > 1.5) continue
        const i = y * width + x
        elevation[i] += d < 1 ? -depth * (1 - d * d) : depth * 0.35 * (1.5 - d) * 2
      }
    }
  }

  // Slope from the central difference of the heightfield.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const xl = x > 0 ? i - 1 : i
      const xr = x < width - 1 ? i + 1 : i
      const yu = y > 0 ? i - width : i
      const yd = y < height - 1 ? i + width : i
      const dx = (elevation[xr] - elevation[xl]) / (2 * METRES_PER_CELL)
      const dy = (elevation[yd] - elevation[yu]) / (2 * METRES_PER_CELL)
      slopeDeg[i] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI
    }
  }

  // Orbit-visible rubble fields: soft blobs the planner can route around from
  // the start.
  for (let k = 0; k < 7; k++) {
    const cx = r() * width
    const cy = r() * height
    const rad = 5 + r() * 11
    const peak = 0.45 + r() * 0.55
    const x0 = Math.max(0, Math.floor(cx - rad))
    const x1 = Math.min(width - 1, Math.ceil(cx + rad))
    const y0 = Math.max(0, Math.floor(cy - rad))
    const y1 = Math.min(height - 1, Math.ceil(cy + rad))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad
        if (d > 1) continue
        const i = y * width + x
        hazard[i] = Math.min(1, hazard[i] + peak * (1 - d * d))
      }
    }
  }
  // Steep ground is hazardous from orbit too, via altimetry.
  for (let i = 0; i < n; i++) {
    hazard[i] = Math.min(1, hazard[i] + Math.max(0, (slopeDeg[i] - 18) / 45))
  }

  // What only the rover can find: small patches of soft regolith.
  for (let k = 0; k < 90; k++) {
    const cx = Math.floor(r() * width)
    const cy = Math.floor(r() * height)
    const rad = 1 + Math.floor(r() * 3)
    const peak = 0.3 + r() * 0.6
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const d = Math.hypot(x - cx, y - cy) / (rad + 0.5)
        if (d > 1) continue
        const i = y * width + x
        hiddenHazard[i] = Math.min(1, hiddenHazard[i] + peak * (1 - d))
      }
    }
  }

  return { width, height, seed, elevation, slopeDeg, hazard, hiddenHazard }
}

/** A swept arc from start to goal, 8-connected and snapped to cells. */
function arcRoute(start: Cell, goal: Cell, bow: number, width: number, height: number): Cell[] {
  const steps = Math.max(Math.abs(goal.x - start.x), Math.abs(goal.y - start.y))
  const cells: Cell[] = []
  let last = ''
  const dx = goal.x - start.x
  const dy = goal.y - start.y
  const len = Math.hypot(dx, dy) || 1
  // Unit normal, so the bow pushes the path sideways rather than lengthening it.
  const nx = -dy / len
  const ny = dx / len
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const off = Math.sin(t * Math.PI) * bow
    const x = Math.round(start.x + dx * t + nx * off)
    const y = Math.round(start.y + dy * t + ny * off)
    const cx = Math.min(width - 1, Math.max(0, x))
    const cy = Math.min(height - 1, Math.max(0, y))
    const key = `${cx},${cy}`
    if (key === last) continue
    last = key
    cells.push({ x: cx, y: cy })
  }
  return cells
}

function routeFrom(belief: Belief, cells: Cell[]): Route {
  let distanceM = 0
  let peakHazard = 0
  let peakSlopeDeg = 0
  let hazardSum = 0
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const idx = c.y * belief.width + c.x
    const h = belief.hazard[idx]
    const s = belief.slopeDeg[idx]
    if (h > peakHazard) peakHazard = h
    if (s > peakSlopeDeg) peakSlopeDeg = s
    hazardSum += h
    if (i > 0) {
      const p = cells[i - 1]
      distanceM += Math.hypot(c.x - p.x, c.y - p.y) * METRES_PER_CELL
    }
  }
  const meanHazard = cells.length > 0 ? hazardSum / cells.length : 0
  const energyWh = distanceM * MOCK_ROVER.flatWhPerM
  return {
    cells,
    cost: {
      distance: distanceM,
      slope: peakSlopeDeg * 2,
      hazard: meanHazard * 400,
      energy: energyWh,
      total: distanceM + peakSlopeDeg * 2 + meanHazard * 400 + energyWh,
    },
    distanceM,
    energyWh,
    peakHazard,
    meanHazard,
    peakSlopeDeg,
  }
}

/**
 * Build a complete, plausible SimState.
 *
 * The belief is revealed in a corridor around the part of the route already
 * driven, which is the shape the real engine produces and the one the fog
 * layer exists to show.
 */
export function makeMockState(options: MockOptions = {}): SimState {
  const width = options.width ?? 128
  const height = options.height ?? 128
  const seed = options.seed ?? 20260217
  const progress = Math.min(1, Math.max(0, options.progress ?? 0.45))
  const withAbandoned = options.withAbandoned ?? true

  const terrain = makeTerrain(width, height, seed)
  const n = width * height

  const start: Cell = { x: Math.round(width * 0.1), y: Math.round(height * 0.85) }
  const waypoints: Cell[] = [
    { x: Math.round(width * 0.45), y: Math.round(height * 0.55) },
    { x: Math.round(width * 0.82), y: Math.round(height * 0.2) },
  ]

  const belief: Belief = {
    width,
    height,
    observed: new Uint8Array(n),
    hazard: Float32Array.from(terrain.hazard),
    slopeDeg: Float32Array.from(terrain.slopeDeg),
    elevation: Float32Array.from(terrain.elevation),
  }

  const legA = arcRoute(start, waypoints[0], 9, width, height)
  const legB = arcRoute(waypoints[0], waypoints[1], -7, width, height)
  const full = legA.concat(legB.slice(1))

  const drivenCount = Math.max(1, Math.floor(full.length * progress))
  const trail = full.slice(0, drivenCount)

  // Reveal a sensor-radius corridor around everything the rover has driven.
  const range = MOCK_ROVER.sensorRangeCells
  const events: SimEvent[] = [{ type: 'mission-started', tick: 0 }]
  for (let t = 0; t < trail.length; t++) {
    const c = trail[t]
    for (let y = c.y - range; y <= c.y + range; y++) {
      for (let x = c.x - range; x <= c.x + range; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (Math.hypot(x - c.x, y - c.y) > range) continue
        const i = y * width + x
        if (belief.observed[i] === 1) continue
        belief.observed[i] = 1
        const hidden = terrain.hiddenHazard[i]
        if (hidden > 0) {
          belief.hazard[i] = Math.min(1, belief.hazard[i] + hidden)
          if (hidden > 0.35) {
            events.push({
              type: 'hazard-discovered',
              tick: t * 3,
              cell: { x, y },
              severity: hidden,
              onRoute: full.some((rc, ri) => ri > t && rc.x === x && rc.y === y),
            })
          }
        }
      }
    }
  }

  const tick = trail.length * 3
  const head = trail[trail.length - 1]
  const before = trail.length > 1 ? trail[trail.length - 2] : head
  const heading = Math.atan2(head.y - before.y, head.x - before.x)

  const route = routeFrom(belief, full.slice(drivenCount - 1))
  const abandoned = withAbandoned
    ? [routeFrom(belief, arcRoute(start, waypoints[0], -14, width, height))]
    : []

  const config: MissionConfig = {
    scenarioId: 'mock',
    seed,
    start,
    waypoints,
    riskTolerance: 0.45,
    energyPriority: 0.4,
    batteryReserveFrac: 0.2,
    maxSlopeDeg: 25,
    autonomyLevel: 'supervised',
    rover: MOCK_ROVER,
  }

  const rover: RoverState = {
    mode: 'driving',
    pos: { x: head.x, y: head.y },
    cell: { x: head.x, y: head.y },
    heading,
    battery: Math.max(0.1, 1 - progress * 0.55),
    odometerM: trail.length * METRES_PER_CELL,
    energyUsedWh: trail.length * METRES_PER_CELL * MOCK_ROVER.flatWhPerM,
    waypointIndex: drivenCount > legA.length ? 1 : 0,
    route,
    routeProgress: 0,
  }

  return {
    tick,
    elapsedS: tick * TICK_SECONDS,
    config,
    terrain,
    belief,
    rover,
    events,
    decisions: [],
    pendingIntervention: null,
    resolutions: [],
    abandonedRoutes: abandoned,
    trail,
    replanCount: abandoned.length,
    effectiveMaxHazard: 0.55,
    outcome: null,
  }
}
