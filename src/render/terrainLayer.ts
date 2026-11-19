/**
 * The cached static layer: elevation, hillshade, slope, hazard and fog.
 *
 * WHY A CACHE AT ALL. A 128x128 grid is 16,384 cells. Deciding a colour for
 * each one means reading five typed arrays, running a Horn gradient over nine
 * neighbours and compositing three overlays — a few million operations. Doing
 * that 60 times a second to produce a bitmap that only changes twice a second
 * is the single largest avoidable cost in the renderer, and it is the cost that
 * starts dropping frames once the route, trail and marker overlays are on.
 *
 * WHY IT IS ONE PIXEL PER CELL. The bake writes into an ImageData of exactly
 * gridW x gridH and is blitted with `drawImage` and smoothing off. That is
 * ~16k integer writes instead of ~16k `fillRect` calls with ~16k CSS colour
 * strings to allocate and parse, and it is roughly an order of magnitude
 * faster. It also makes the cache resolution-independent: resizing the window
 * does not invalidate it, because the scaling happens at blit time.
 *
 * WHAT IS DELIBERATELY *NOT* IN HERE. The "this hazard was found by the
 * rover's own sensors" markers are hatches and rings, which cannot be drawn one
 * pixel per cell. Rather than keep a second, resolution-dependent cache, the
 * bake records the *indices* of those cells in a list and the overlay pass
 * strokes them each frame. There are hundreds of them, not 16k, so that is
 * cheap — and it keeps them crisp at any zoom.
 *
 * GROUND TRUTH IS NEVER READ. The hazard the user sees comes from
 * `belief.hazard`. `terrain.hazard` is read only as the orbit-visible
 * baseline, which the mission planner is defined to know before launch.
 * `terrain.hiddenHazard` is not referenced anywhere in this file, and must not
 * be: drawing it would show the user hazards the rover has not discovered and
 * destroy the entire point of the simulation.
 */

import type { Belief, SimState, Terrain } from '@/core/types'
import { METRES_PER_CELL } from '@/core/types'
import {
  DISCOVERED_MARKER_FLOOR,
  FOG_DESATURATION,
  FOG_STRENGTH,
  HAZARD_ALPHA_GAMMA,
  HAZARD_FLOOR,
  HAZARD_MAX_ALPHA,
  HILLSHADE_STRENGTH,
  LIGHT_ALTITUDE_DEG,
  LIGHT_AZIMUTH_DEG,
  RELIEF_EXAGGERATION,
  RGB,
  SLOPE_MAX_ALPHA,
  desaturate,
  elevationColor,
  hazardColor,
  mixRgb,
  type Rgb,
} from './colors'

/** Any surface we can bake into and later use as a `drawImage` source. */
export type OffscreenSurface = OffscreenCanvas | HTMLCanvasElement

/** The subset of RenderOptions that changes the baked bitmap. */
export interface StaticLayerOptions {
  showElevation: boolean
  showSlope: boolean
  showHazard: boolean
  showObserved: boolean
}

/**
 * Everything that can change the baked bitmap, and nothing that cannot.
 *
 * `revealed` is the load-bearing field and is explained at `countObserved`.
 */
interface CacheKey {
  terrain: Terrain
  gridW: number
  gridH: number
  revealed: number
  maxSlopeDeg: number
  maxHazard: number
  optionsMask: number
}

/** Pack the four static toggles into one integer so key comparison is one `!==`. */
function optionsMask(o: StaticLayerOptions): number {
  return (
    (o.showElevation ? 1 : 0) |
    (o.showSlope ? 2 : 0) |
    (o.showHazard ? 4 : 0) |
    (o.showObserved ? 8 : 0)
  )
}

/**
 * Count cells the rover has seen.
 *
 * THIS IS THE CACHE-INVALIDATION SIGNAL, and the reasoning behind it is the
 * only interesting decision in this module.
 *
 * Object identity is not usable on its own in either direction. `observe()` is
 * specified to mutate the belief in place, so the belief object can be the same
 * while its contents have changed; and `step()` is pure, so a fresh belief
 * object can arrive whose contents are identical. Keying on identity therefore
 * gives both stale frames and pointless repaints.
 *
 * What is true of `Belief` is that *everything mutable in it is a function of
 * which cells have been observed*: `hazard` is the orbital layer everywhere
 * plus the hidden layer on observed cells, and `slopeDeg` and `elevation` are
 * copied from the terrain at creation and never change. `observed` only ever
 * goes 0 -> 1; a cell is never un-seen. So the number of observed cells is
 * strictly monotonic within a mission, and any change to the belief's contents
 * implies that number has gone up. Counting it is therefore *sufficient* —
 * not a heuristic — and it is one pass over a Uint8Array of 0s and 1s, which
 * is a few microseconds.
 *
 * It is also correct across the discontinuities a mission has: a reset or a
 * replay scrub moves the count *down*, which is a difference and so repaints;
 * and a fresh mission on the same seed with the same count genuinely has an
 * identical bitmap, so skipping is right rather than lucky.
 *
 * The one thing it cannot see is a *different terrain* that happens to have the
 * same number of revealed cells, which is why the terrain object identity is in
 * the key beside it. Terrain is allocated once by `generateTerrain` and never
 * mutated, so identity is exact for it.
 */
export function countObserved(observed: Uint8Array): number {
  let n = 0
  for (let i = 0; i < observed.length; i++) n += observed[i]
  return n
}

/** Light vector in screen space: +x right, +y down, +z out of the map. */
function lightVector(): { x: number; y: number; z: number } {
  const alt = (LIGHT_ALTITUDE_DEG * Math.PI) / 180
  const az = (LIGHT_AZIMUTH_DEG * Math.PI) / 180
  // Azimuth is measured clockwise from "up on screen", so north is -y.
  return {
    x: Math.cos(alt) * Math.sin(az),
    y: Math.cos(alt) * -Math.cos(az),
    z: Math.sin(alt),
  }
}

const LIGHT = lightVector()

/**
 * Bake one cell's colour into an RGBA buffer.
 *
 * Split out of the loop body only for readability of the composite order,
 * which is the part that matters: terrain first, then the two *advisory*
 * overlays (slope, hazard), then fog last so that an unobserved cell is dimmed
 * no matter what is drawn under it. Fog applied before the hazard tint would
 * let a bright hazard colour leak out of the unexplored region and tell the
 * user something the rover has not learned.
 */
function createSurface(w: number, h: number): OffscreenSurface | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h)
    } catch {
      // Fall through to the DOM canvas; some environments expose the
      // constructor without a working 2d context for it.
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

function surfaceContext(s: OffscreenSurface): CanvasRenderingContext2D | null {
  // The two surface types have incompatible context unions in lib.dom, and we
  // only ever use the shared 2D subset, so one cast at the boundary is cleaner
  // than threading a union through every draw helper.
  const ctx = (s as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null
  return ctx
}

export class TerrainCache {
  private surface: OffscreenSurface | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private image: ImageData | null = null
  private key: CacheKey | null = null

  /** Flat indices of cells whose hazard the rover's own sensors uncovered. */
  private discoveredCells: number[] = []
  /** Severity of the *discovered* component, parallel to `discoveredCells`. */
  private discoveredSeverity: number[] = []

  /** Guards the O(n) observed-count: the belief cannot change without a step. */
  private countedTick = -1
  private countedObserved: Uint8Array | null = null
  private revealed = 0

  /** True once we have given up on an offscreen surface in this environment. */
  private offscreenUnavailable = false

  /**
   * How many times the per-cell bake has actually run.
   *
   * Exposed because the cache's whole reason to exist is a claim about this
   * number — that it tracks belief changes rather than frames — and that claim
   * is otherwise unobservable from outside. The tests assert on it, and it is
   * cheap enough to leave in for a performance HUD.
   */
  private bakeCount = 0

  /**
   * Bring the cache up to date with `state`. Returns false when no bitmap is
   * available, in which case the caller should use `paintDirect`.
   */
  ensure(state: SimState, opts: StaticLayerOptions): boolean {
    const { belief, terrain } = state
    const mask = optionsMask(opts)
    const revealed = this.observedCount(state)

    const k = this.key
    const fresh =
      k !== null &&
      k.terrain === terrain &&
      k.gridW === belief.width &&
      k.gridH === belief.height &&
      k.revealed === revealed &&
      k.maxSlopeDeg === state.config.maxSlopeDeg &&
      k.maxHazard === state.effectiveMaxHazard &&
      k.optionsMask === mask

    if (fresh && this.surface !== null) return true
    if (this.offscreenUnavailable) {
      // Still refresh the marker list, which the overlay pass needs either way.
      this.scan(belief, terrain)
      return false
    }

    const w = belief.width
    const h = belief.height
    if (w <= 0 || h <= 0) return false

    if (this.surface === null || this.surface.width !== w || this.surface.height !== h) {
      this.surface = createSurface(w, h)
      this.ctx = this.surface ? surfaceContext(this.surface) : null
      this.image = null
      if (this.ctx === null) {
        this.offscreenUnavailable = true
        this.surface = null
        this.scan(belief, terrain)
        return false
      }
    }

    const ctx = this.ctx
    if (ctx === null) return false
    if (this.image === null || this.image.width !== w || this.image.height !== h) {
      this.image = ctx.createImageData(w, h)
    }

    this.bake(state, opts, this.image.data)
    ctx.putImageData(this.image, 0, 0)

    this.key = {
      terrain,
      gridW: w,
      gridH: h,
      revealed,
      maxSlopeDeg: state.config.maxSlopeDeg,
      maxHazard: state.effectiveMaxHazard,
      optionsMask: mask,
    }
    return true
  }

  /** The baked bitmap, or null when this environment has no offscreen surface. */
  get bitmap(): OffscreenSurface | null {
    return this.surface
  }

  /** Indices of sensor-discovered hazard cells, rebuilt whenever the bake runs. */
  get discovered(): readonly number[] {
    return this.discoveredCells
  }

  get discoveredSeverities(): readonly number[] {
    return this.discoveredSeverity
  }

  /** Number of cells currently observed, as used by the cache key. */
  get observedCells(): number {
    return this.revealed
  }

  /** Diagnostic: how many per-cell bakes have run since construction. */
  get bakes(): number {
    return this.bakeCount
  }

  destroy(): void {
    this.surface = null
    this.ctx = null
    this.image = null
    this.key = null
    this.discoveredCells = []
    this.discoveredSeverity = []
  }

  /**
   * The O(n) count, behind a guard that skips it on ~29 of every 30 frames.
   *
   * The belief cannot change unless the engine stepped, and a step always
   * advances `tick`. So an unchanged tick with the same `observed` array is a
   * proof that the count is unchanged — no scan needed. The array identity is
   * checked as well so that loading a *different* state that happens to share
   * a tick number (a replay, a saved mission) still recounts.
   */
  private observedCount(state: SimState): number {
    const obs = state.belief.observed
    if (this.countedTick === state.tick && this.countedObserved === obs) return this.revealed
    this.revealed = countObserved(obs)
    this.countedTick = state.tick
    this.countedObserved = obs
    return this.revealed
  }

  /**
   * Rebuild the discovered-hazard marker list without baking a bitmap.
   * Only used on the degraded path where no offscreen surface exists.
   */
  private scan(belief: Belief, terrain: Terrain): void {
    const n = belief.width * belief.height
    this.discoveredCells = []
    this.discoveredSeverity = []
    for (let i = 0; i < n; i++) {
      if (belief.observed[i] === 0) continue
      const extra = belief.hazard[i] - terrain.hazard[i]
      if (extra > DISCOVERED_MARKER_FLOOR) {
        this.discoveredCells.push(i)
        this.discoveredSeverity.push(extra)
      }
    }
  }

  /**
   * Write one RGBA pixel per cell.
   *
   * Hot loop. No allocation inside it: two scratch colours are reused, the
   * palette is pre-parsed, and the hillshade uses the normal-dot-light form
   * (one square root per cell) rather than the textbook slope/aspect form
   * (five transcendentals per cell).
   */
  private bake(state: SimState, opts: StaticLayerOptions, out: Uint8ClampedArray): void {
    this.bakeCount++
    const { belief, terrain, config } = state
    const w = belief.width
    const h = belief.height
    const n = w * h

    const elev = belief.elevation
    const slope = belief.slopeDeg
    const bHaz = belief.hazard
    const oHaz = terrain.hazard
    const observed = belief.observed

    // Normalise elevation across the patch rather than against an absolute
    // datum: relief is what the user needs to read, and a 20 m patch and a
    // 200 m patch should both use the full ramp.
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < n; i++) {
      const v = elev[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo > 1e-6 ? hi - lo : 1

    const maxSlope = config.maxSlopeDeg > 0 ? config.maxSlopeDeg : 30
    const maxHazard = state.effectiveMaxHazard
    const invCell = 1 / METRES_PER_CELL

    const base: Rgb = { r: 0, g: 0, b: 0 }
    const tint: Rgb = { r: 0, g: 0, b: 0 }
    const flatGrey = RGB.gridBackdrop

    this.discoveredCells = []
    this.discoveredSeverity = []

    for (let y = 0; y < h; y++) {
      const yUp = y > 0 ? y - 1 : 0
      const yDn = y < h - 1 ? y + 1 : h - 1
      const rowUp = yUp * w
      const rowMid = y * w
      const rowDn = yDn * w

      for (let x = 0; x < w; x++) {
        const i = rowMid + x
        const xL = x > 0 ? x - 1 : 0
        const xR = x < w - 1 ? x + 1 : w - 1

        if (opts.showElevation) {
          elevationColor((elev[i] - lo) / span, base)

          // Horn's 3x3 gradient. Border cells clamp to themselves, which
          // flattens the outermost ring slightly rather than inventing a cliff
          // at the map edge.
          const a = elev[rowUp + xL]
          const b = elev[rowUp + x]
          const c = elev[rowUp + xR]
          const d = elev[rowMid + xL]
          const f = elev[rowMid + xR]
          const g = elev[rowDn + xL]
          const hh = elev[rowDn + x]
          const k = elev[rowDn + xR]

          const dzdx = ((c + 2 * f + k - (a + 2 * d + g)) / 8) * invCell * RELIEF_EXAGGERATION
          const dzdy = ((g + 2 * hh + k - (a + 2 * b + c)) / 8) * invCell * RELIEF_EXAGGERATION

          const nx = -dzdx
          const ny = -dzdy
          const len = Math.sqrt(nx * nx + ny * ny + 1)
          // Divide through by LIGHT.z so that flat ground lands on exactly 1
          // and the ramp keeps the brightness the elevation stop asked for.
          let shade = (nx * LIGHT.x + ny * LIGHT.y + LIGHT.z) / (len * LIGHT.z)
          if (shade < 0) shade = 0
          else if (shade > 1.4) shade = 1.4
          const m = 1 - HILLSHADE_STRENGTH + HILLSHADE_STRENGTH * shade
          base.r *= m
          base.g *= m
          base.b *= m
        } else {
          base.r = flatGrey.r
          base.g = flatGrey.g
          base.b = flatGrey.b
        }

        if (opts.showSlope) {
          const s = slope[i]
          if (s >= maxSlope) {
            // At or past the climb limit: read as a wall, not as a warning.
            mixRgb(base, RGB.slopeWall, SLOPE_MAX_ALPHA, base)
          } else if (s > maxSlope * 0.6) {
            const t = (s - maxSlope * 0.6) / (maxSlope * 0.4)
            mixRgb(base, RGB.slopeWarn, t * SLOPE_MAX_ALPHA * 0.7, base)
          }
        }

        const believed = bHaz[i]

        if (opts.showHazard && believed > HAZARD_FLOOR) {
          // Severity is scaled against the *effective* risk tolerance so both
          // the hue and the alpha track the constraint the rover is actually
          // driving under: raising the tolerance slider visibly relaxes the
          // map, which is the point of the slider.
          const sev = maxHazard > 0 ? Math.min(1, believed / Math.max(maxHazard, 0.05)) : 1
          hazardColor(sev, tint)
          mixRgb(base, tint, Math.pow(sev, HAZARD_ALPHA_GAMMA) * HAZARD_MAX_ALPHA, base)
        }

        // The sensor-discovered component: what the belief knows beyond what
        // orbit could see. Recorded here rather than in a second pass because
        // we are already walking every cell.
        if (observed[i] === 1) {
          const extra = believed - oHaz[i]
          if (extra > DISCOVERED_MARKER_FLOOR) {
            this.discoveredCells.push(i)
            this.discoveredSeverity.push(extra)
          }
        } else if (opts.showObserved) {
          // Fog last, so nothing drawn above leaks out of the unknown region.
          desaturate(base, FOG_DESATURATION, base)
          mixRgb(base, RGB.fog, FOG_STRENGTH, base)
        }

        const p = i << 2
        out[p] = base.r
        out[p + 1] = base.g
        out[p + 2] = base.b
        out[p + 3] = 255
      }
    }
  }

  /**
   * Degraded path: paint the static layer straight onto the target context,
   * one `fillRect` per cell.
   *
   * Only reachable where no offscreen 2D context can be created at all. It is
   * an order of magnitude slower and is here so that such an environment
   * renders a correct map rather than an empty one.
   */
  paintDirect(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    opts: StaticLayerOptions,
    originX: number,
    originY: number,
    scale: number,
  ): void {
    const w = state.belief.width
    const h = state.belief.height
    const buf = new Uint8ClampedArray(w * h * 4)
    this.bake(state, opts, buf)
    // +1 on the size closes the seam a fractional scale leaves between cells.
    const size = Math.ceil(scale) + 1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) << 2
        ctx.fillStyle = `rgb(${buf[p]},${buf[p + 1]},${buf[p + 2]})`
        ctx.fillRect(Math.floor(originX + x * scale), Math.floor(originY + y * scale), size, size)
      }
    }
  }
}
