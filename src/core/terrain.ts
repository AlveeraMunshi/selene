/**
 * Terrain generation, belief construction, and sensing.
 *
 * WHY THE TERRAIN AND THE BELIEF ARE SEPARATE STRUCTURES: a planner that can
 * see every hazard never has to replan, so the central question of this
 * project would be unaskable. `Terrain` is ground truth and only the simulator
 * reads it; `Belief` is what the planner is allowed to see. `observe()` is the
 * single, narrow channel between them, and the cells it reports are what drive
 * every replan in the engine.
 *
 * THE HAZARD SPLIT. One underlying hazard field is generated first — rubble
 * fields, slope-correlated instability, crater rims — and only afterwards is
 * it split into an orbit-visible layer and a hidden layer. Generating two
 * independent fields instead would produce hidden hazards that bear no
 * relation to the visible terrain, and a rover would discover soft regolith in
 * the middle of provably flat, clean ground. Splitting one field keeps the
 * hidden layer correlated with the terrain that explains it.
 */

import type { Belief, CellIndex, Cell, Terrain, TerrainParams } from './types'
import { METRES_PER_CELL } from './types'
import { makeRng, rngInt, rngRange, type Rng } from './rng'

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/** Flat index into a terrain layer. Row-major, matching the type's contract. */
export function idx(w: number, x: number, y: number): CellIndex {
  return y * w + x
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Lattice spacing, in cells, of the coarsest noise octave. 32 means the
 * lowest-frequency feature of a 96-cell map is about three cells across at
 * lattice scale — broad basins and ridges rather than uniform fuzz.
 */
const BASE_LATTICE_CELLS = 32

/** Slope at which ground starts being unstable, and where instability saturates. */
const INSTABILITY_ONSET_DEG = 9
const INSTABILITY_SATURATION_DEG = 28
/** Maximum hazard contributed purely by steepness. Deliberately below 1: slope
 *  alone never makes a cell impassable, that is what `maxSlopeDeg` is for. */
const INSTABILITY_MAX = 0.45

/** Crater geometry, as fractions of the crater's nominal radius. */
const CRATER_BOWL_FRAC = 0.78
const CRATER_RIM_OUTER_FRAC = 1.22
/** Rim height as a fraction of bowl depth. Real craters throw up far less
 *  material than they excavate; 0.28 reads correctly and makes a steep lip. */
const CRATER_RIM_HEIGHT_FRAC = 0.28
/** Hazard added on a crater rim — loose ejecta, the classic rover trap. */
const CRATER_RIM_HAZARD = 0.5

/** Lattice spacing of the concealment field. Larger than the terrain octaves
 *  so hidden hazards arrive as *patches* a rover drives into, not as noise. */
const CONCEALMENT_LATTICE_CELLS = 14
/** Width, in concealment-noise units, of the ramp from patch edge to patch
 *  core. Gives hidden patches a soft boundary instead of a cliff. */
const CONCEALMENT_RAMP = 0.1
/** Peak severity a concealed patch can reach before the visibility scaling. */
const HIDDEN_PEAK = 1.0

/** Below this, a believed-hazard change is floating-point noise, not a discovery. */
const HAZARD_EPSILON = 1e-6

// ---------------------------------------------------------------------------
// Value noise
// ---------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * One octave of value noise: a lattice of random values, smoothstep-interpolated.
 *
 * Value noise rather than Perlin/simplex because the gradient quality simply
 * does not matter here — the elevation gets differentiated into slope, and
 * smoothstep interpolation already gives a continuous first derivative, which
 * is all the slope field needs to avoid banding artefacts.
 *
 * Returns a sampler over cell coordinates, so the caller never has to think
 * about lattice space.
 */
function makeValueNoise(rng: Rng, widthCells: number, heightCells: number, latticeCells: number) {
  const gw = Math.max(1, Math.ceil(widthCells / latticeCells)) + 1
  const gh = Math.max(1, Math.ceil(heightCells / latticeCells)) + 1
  const lattice = new Float32Array(gw * gh)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng()

  return function sample(x: number, y: number): number {
    const fx = x / latticeCells
    const fy = y / latticeCells
    const x0 = Math.min(gw - 2, Math.floor(fx))
    const y0 = Math.min(gh - 2, Math.floor(fy))
    const tx = smoothstep(0, 1, fx - x0)
    const ty = smoothstep(0, 1, fy - y0)
    const v00 = lattice[y0 * gw + x0]
    const v10 = lattice[y0 * gw + x0 + 1]
    const v01 = lattice[(y0 + 1) * gw + x0]
    const v11 = lattice[(y0 + 1) * gw + x0 + 1]
    return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
  }
}

/**
 * Fractal (fBm) value noise, normalised to [0, 1].
 *
 * Each successive octave halves the lattice spacing and halves the amplitude,
 * which is the standard 1/f spectrum — broad terrain shape from octave 0, and
 * progressively finer detail that never overwhelms it.
 */
function fractalNoise(
  rng: Rng,
  w: number,
  h: number,
  octaves: number,
  baseLattice: number,
): Float32Array {
  const out = new Float32Array(w * h)
  let amplitude = 1
  let total = 0
  const n = Math.max(1, Math.floor(octaves))
  for (let o = 0; o < n; o++) {
    // Lattice never goes below 2 cells: beyond that the "noise" is per-cell
    // white noise, which produces slope spikes and no usable structure.
    const lattice = Math.max(2, Math.round(baseLattice / 2 ** o))
    const sample = makeValueNoise(rng, w, h, lattice)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[y * w + x] += amplitude * sample(x, y)
    }
    total += amplitude
    amplitude *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

// ---------------------------------------------------------------------------
// Craters
// ---------------------------------------------------------------------------

interface Crater {
  cx: number
  cy: number
  radius: number
  depth: number
}

/**
 * Stamp a crater into the heightfield.
 *
 * Profile, in units of t = distance / radius:
 *   t < 0.78            parabolic bowl, -depth at the centre rising to 0
 *   0.78 <= t < 1.22    raised rim, a half-sine peaking at t = 1
 *   t >= 1.22           untouched
 *
 * The two pieces meet at zero so the surface stays continuous; the derivative
 * does not, and that discontinuity is exactly what produces the sharp slope
 * ring that makes craters interesting to a route planner.
 */
function stampCrater(elevation: Float32Array, w: number, h: number, c: Crater): void {
  const rimHeight = c.depth * CRATER_RIM_HEIGHT_FRAC
  const reach = Math.ceil(c.radius * CRATER_RIM_OUTER_FRAC)
  const x0 = Math.max(0, Math.floor(c.cx - reach))
  const x1 = Math.min(w - 1, Math.ceil(c.cx + reach))
  const y0 = Math.max(0, Math.floor(c.cy - reach))
  const y1 = Math.min(h - 1, Math.ceil(c.cy + reach))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.cx
      const dy = y - c.cy
      const t = Math.sqrt(dx * dx + dy * dy) / c.radius
      let delta = 0
      if (t < CRATER_BOWL_FRAC) {
        const u = t / CRATER_BOWL_FRAC
        delta = -c.depth * (1 - u * u)
      } else if (t < CRATER_RIM_OUTER_FRAC) {
        const u = (t - CRATER_BOWL_FRAC) / (CRATER_RIM_OUTER_FRAC - CRATER_BOWL_FRAC)
        delta = rimHeight * Math.sin(Math.PI * u)
      }
      elevation[y * w + x] += delta
    }
  }
}

/** Hazard contributed by a crater's loose rim ejecta, peaking on the lip. */
function stampCraterRimHazard(field: Float32Array, w: number, h: number, c: Crater): void {
  const reach = Math.ceil(c.radius * CRATER_RIM_OUTER_FRAC)
  const x0 = Math.max(0, Math.floor(c.cx - reach))
  const x1 = Math.min(w - 1, Math.ceil(c.cx + reach))
  const y0 = Math.max(0, Math.floor(c.cy - reach))
  const y1 = Math.min(h - 1, Math.ceil(c.cy + reach))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - c.cx
      const dy = y - c.cy
      const t = Math.sqrt(dx * dx + dy * dy) / c.radius
      if (t < CRATER_BOWL_FRAC || t >= CRATER_RIM_OUTER_FRAC) continue
      const u = (t - CRATER_BOWL_FRAC) / (CRATER_RIM_OUTER_FRAC - CRATER_BOWL_FRAC)
      const i = y * w + x
      field[i] = Math.max(field[i], CRATER_RIM_HAZARD * Math.sin(Math.PI * u))
    }
  }
}

// ---------------------------------------------------------------------------
// Slope
// ---------------------------------------------------------------------------

/**
 * Slope in degrees from the central-difference elevation gradient.
 *
 * One-sided differences are used at the border rather than wrapping or
 * clamping to zero: a zero border would ring the map in artificially flat,
 * cheap-to-drive ground and the planner would learn to hug the edges.
 */
export function computeSlopeDeg(elevation: Float32Array, w: number, h: number): Float32Array {
  const slope = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1)
      const xp = Math.min(w - 1, x + 1)
      const ym = Math.max(0, y - 1)
      const yp = Math.min(h - 1, y + 1)
      // Span is 2 cells in the interior and 1 at the border; dividing by the
      // real span is what keeps border slopes to scale.
      const dzdx = (elevation[y * w + xp] - elevation[y * w + xm]) / ((xp - xm) * METRES_PER_CELL)
      const dzdy = (elevation[yp * w + x] - elevation[ym * w + x]) / ((yp - ym) * METRES_PER_CELL)
      const grad = Math.sqrt(dzdx * dzdx + dzdy * dzdy)
      const deg = (Math.atan(grad) * 180) / Math.PI
      slope[y * w + x] = deg < 0 ? 0 : deg > 90 ? 90 : deg
    }
  }
  return slope
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Build a terrain patch from `(params, width, height, seed)`.
 *
 * Every random draw comes from one `Rng` consumed in a fixed order, so the
 * output is a pure function of the arguments. The order below is load-bearing:
 * changing it changes every previously-generated world.
 */
export function generateTerrain(
  params: TerrainParams,
  width: number,
  height: number,
  seed: number,
): Terrain {
  const rng = makeRng(seed)
  const n = width * height

  // 1. Elevation: fractal noise scaled to the requested relief, then craters.
  const noise = fractalNoise(rng, width, height, params.octaves, BASE_LATTICE_CELLS)
  const elevation = new Float32Array(n)
  for (let i = 0; i < n; i++) elevation[i] = noise[i] * params.relief

  const craters: Crater[] = []
  for (let c = 0; c < params.craters; c++) {
    // Radius scales with the map so a scenario reads the same at any size.
    const radius = rngRange(rng, 0.035, 0.11) * Math.min(width, height)
    craters.push({
      cx: rngInt(rng, 0, width),
      cy: rngInt(rng, 0, height),
      radius,
      // Depth tied to radius keeps the rim slope in a plausible band rather
      // than producing wells a kilometre deep and a metre wide.
      depth: radius * METRES_PER_CELL * rngRange(rng, 0.09, 0.2),
    })
  }
  for (const c of craters) stampCrater(elevation, width, height, c)

  const slopeDeg = computeSlopeDeg(elevation, width, height)

  // 2. One underlying hazard field, assembled from three physical sources.
  const total = new Float32Array(n)

  //    (a) Rubble fields: discrete blobs of boulder debris.
  for (let f = 0; f < params.rubbleFields; f++) {
    const cx = rngInt(rng, 0, width)
    const cy = rngInt(rng, 0, height)
    const radius = rngRange(rng, 0.04, 0.1) * Math.min(width, height)
    const peak = rngRange(rng, 0.55, 1.0)
    const x0 = Math.max(0, Math.floor(cx - radius))
    const x1 = Math.min(width - 1, Math.ceil(cx + radius))
    const y0 = Math.max(0, Math.floor(cy - radius))
    const y1 = Math.min(height - 1, Math.ceil(cy + radius))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.sqrt(dx * dx + dy * dy) / radius
        if (d >= 1) continue
        // Cosine falloff: dense core, frayed edge, which is what a debris
        // field looks like and also means the planner can clip the fringe.
        const v = peak * 0.5 * (1 + Math.cos(Math.PI * d))
        const i = y * width + x
        total[i] = Math.max(total[i], v)
      }
    }
  }

  //    (b) Crater rims.
  for (const c of craters) stampCraterRimHazard(total, width, height, c)

  //    (c) Slope-correlated instability, added rather than maxed: steep ground
  //        inside a rubble field really is worse than either alone.
  for (let i = 0; i < n; i++) {
    const instability =
      INSTABILITY_MAX *
      smoothstep(INSTABILITY_ONSET_DEG, INSTABILITY_SATURATION_DEG, slopeDeg[i])
    total[i] = clamp01(total[i] + instability)
  }

  // 3. Split the field into what orbit sees and what only the rover can find.
  const { hazard, hiddenHazard } = splitHazard(rng, total, params, width, height)

  return { width, height, seed, elevation, slopeDeg, hazard, hiddenHazard }
}

/**
 * Split one hazard field into an orbit-visible layer and a hidden layer.
 *
 * A *concealment field* — low-frequency noise, thresholded at the quantile that
 * yields `hiddenHazardDensity` of the map — decides which cells orbit got
 * wrong. Thresholding noise rather than drawing cells independently is the
 * whole trick: it produces contiguous patches, so the rover drives *into* a
 * region of soft regolith over several ticks instead of hitting isolated
 * single-cell surprises that no route could have avoided anyway.
 *
 * Inside a concealed patch:
 *   - orbit under-reports the real field by the visibility factor, and
 *   - an additional soft-regolith term appears that orbit missed entirely,
 *     ramping from nothing at the patch edge to `HIDDEN_PEAK` at its core.
 * Outside, orbit is correct and `hiddenHazard` is exactly zero.
 */
function splitHazard(
  rng: Rng,
  total: Float32Array,
  params: TerrainParams,
  w: number,
  h: number,
): { hazard: Float32Array; hiddenHazard: Float32Array } {
  const n = w * h
  const hazard = new Float32Array(n)
  const hiddenHazard = new Float32Array(n)

  const visibility = clamp01(params.orbitalVisibility)
  const concealFactor = 1 - visibility
  const density = clamp01(params.hiddenHazardDensity)

  // Full visibility or zero density: orbit is simply right about everything.
  // Returning early also skips consuming rng draws we would never use.
  if (concealFactor <= 0 || density <= 0) {
    hazard.set(total)
    return { hazard, hiddenHazard }
  }

  const sampleNoise = makeValueNoise(rng, w, h, CONCEALMENT_LATTICE_CELLS)
  const conceal = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) conceal[y * w + x] = sampleNoise(x, y)
  }

  // Threshold at the (1 - density) quantile so the realised concealed fraction
  // matches the requested density regardless of how the noise happened to fall.
  // A fixed threshold would make density depend on the seed, which is exactly
  // the kind of silent coupling that makes a scenario untunable.
  const sorted = Float32Array.from(conceal).sort()
  const qIndex = Math.min(n - 1, Math.max(0, Math.floor((1 - density) * n)))
  const threshold = sorted[qIndex]

  for (let i = 0; i < n; i++) {
    if (conceal[i] <= threshold) {
      hazard[i] = total[i]
      continue
    }
    // `core` is 0 at the patch boundary and 1 deep inside it.
    const core = smoothstep(threshold, threshold + CONCEALMENT_RAMP, conceal[i])
    hazard[i] = total[i] * visibility
    const soft = core * HIDDEN_PEAK * concealFactor
    const missed = total[i] * concealFactor
    // Clamped against the visible layer so believed hazard never exceeds 1,
    // which the Belief contract requires.
    hiddenHazard[i] = Math.min(soft + missed, 1 - hazard[i])
  }

  return { hazard, hiddenHazard }
}

// ---------------------------------------------------------------------------
// Belief
// ---------------------------------------------------------------------------

/**
 * The rover's starting belief: orbital imagery and altimetry, nothing else.
 *
 * Elevation and slope are COPIED rather than aliased to the terrain. They are
 * never mutated, so aliasing would be safe today — but the engine hands belief
 * objects around and clones them, and a shared buffer that later acquires a
 * writer would corrupt ground truth in a way that is very hard to see.
 */
export function createBelief(terrain: Terrain): Belief {
  return {
    width: terrain.width,
    height: terrain.height,
    observed: new Uint8Array(terrain.width * terrain.height),
    hazard: Float32Array.from(terrain.hazard),
    slopeDeg: Float32Array.from(terrain.slopeDeg),
    elevation: Float32Array.from(terrain.elevation),
  }
}

/** What a sensor sweep would change, computed without writing anything. */
export interface ObservationDelta {
  /** Cells moving from unobserved to observed. */
  newlyObserved: CellIndex[]
  /**
   * Cells whose believed hazard rises. `previous` is carried alongside the new
   * value so the engine can judge whether the rise is MATERIAL: a cell that
   * goes from 0.30 to 0.31 is not a discovery worth replanning for, and
   * without the old value the engine would have to re-read a belief it has
   * already overwritten.
   */
  raised: { index: CellIndex; cell: Cell; previous: number; severity: number }[]
}

/**
 * Compute a sweep's effect without applying it.
 *
 * Split out from `observe` so the engine can keep `step()` pure cheaply: the
 * belief's typed arrays only need cloning on ticks where something actually
 * changes, and at 0.8 m/s with 4 m cells the rover's own cell changes roughly
 * every fourth tick, so most ticks skip the copy entirely.
 */
export function observationDelta(
  belief: Belief,
  terrain: Terrain,
  at: Cell,
  rangeCells: number,
): ObservationDelta {
  const { width: w, height: h } = belief
  const r = Math.max(0, rangeCells)
  const r2 = r * r
  const newlyObserved: CellIndex[] = []
  const raised: { index: CellIndex; cell: Cell; previous: number; severity: number }[] = []

  const x0 = Math.max(0, Math.floor(at.x - r))
  const x1 = Math.min(w - 1, Math.ceil(at.x + r))
  const y0 = Math.max(0, Math.floor(at.y - r))
  const y1 = Math.min(h - 1, Math.ceil(at.y + r))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - at.x
      const dy = y - at.y
      if (dx * dx + dy * dy > r2) continue // Euclidean range, not a square.
      const i = y * w + x
      if (belief.observed[i] === 0) newlyObserved.push(i)
      const truth = Math.min(1, terrain.hazard[i] + terrain.hiddenHazard[i])
      if (truth > belief.hazard[i] + HAZARD_EPSILON) {
        raised.push({ index: i, cell: { x, y }, previous: belief.hazard[i], severity: truth })
      }
    }
  }
  return { newlyObserved, raised }
}

/** True when a sweep would change the belief at all. */
export function deltaIsEmpty(d: ObservationDelta): boolean {
  return d.newlyObserved.length === 0 && d.raised.length === 0
}

/** Apply a previously-computed delta. Mutates `belief`. */
export function applyObservation(belief: Belief, delta: ObservationDelta): Cell[] {
  for (const i of delta.newlyObserved) belief.observed[i] = 1
  const cells: Cell[] = []
  for (const r of delta.raised) {
    belief.observed[r.index] = 1
    belief.hazard[r.index] = r.severity
    cells.push(r.cell)
  }
  return cells
}

/**
 * Reveal everything within `rangeCells` of `at`. Mutates `belief` in place.
 *
 * Returns ONLY the cells whose believed hazard actually rose — not every cell
 * that became observed. That distinction is the engine's replan trigger: a
 * sweep that merely confirms clean ground must not cause a replan, or the
 * rover would replan on every tick forever and the mission would never finish.
 */
export function observe(belief: Belief, terrain: Terrain, at: Cell, rangeCells: number): Cell[] {
  return applyObservation(belief, observationDelta(belief, terrain, at, rangeCells))
}

/** Fraction of the map that has been inside sensor range at least once. */
export function observedFraction(belief: Belief): number {
  let seen = 0
  for (let i = 0; i < belief.observed.length; i++) if (belief.observed[i] !== 0) seen++
  return seen / belief.observed.length
}

/**
 * A clone suitable for copy-on-write.
 *
 * `observed` and `hazard` are the only layers `observe()` writes, so only
 * those two are copied; `slopeDeg` and `elevation` are aliased. That halves
 * the per-tick allocation and is safe precisely because nothing in the engine
 * ever writes to them — a fact worth preserving if those layers ever gain a
 * writer.
 */
export function cloneBelief(belief: Belief): Belief {
  return {
    width: belief.width,
    height: belief.height,
    observed: Uint8Array.from(belief.observed),
    hazard: Float32Array.from(belief.hazard),
    slopeDeg: belief.slopeDeg,
    elevation: belief.elevation,
  }
}
