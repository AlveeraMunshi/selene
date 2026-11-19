/**
 * SELENE renderer palette.
 *
 * WHY EVERY COLOUR LIVES HERE AND NOWHERE ELSE: the map is the one surface in
 * the app where colour carries *meaning* rather than style. Cyan is always the
 * rover's own intent (planned route, chassis, selection). Amber through red is
 * always hazard severity and is never used decoratively — if the user sees red
 * on the map, something is dangerous. Grey is terrain. Once a second colour
 * source exists, that contract quietly rots, so the renderer is forbidden from
 * writing a literal colour anywhere but this file.
 *
 * Two representations are kept on purpose:
 *   - `Rgb` triples for the per-cell hot path, which writes ~16k pixels into an
 *     ImageData buffer and must not allocate or parse CSS strings;
 *   - CSS strings for the handful of vector overlays (routes, rover, markers),
 *     where there are tens of draw calls and legibility of the source wins.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** One stop of a colour ramp. `t` is the normalised position, 0..1. */
export interface RampStop {
  t: number
  color: Rgb
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Parse `#rrggbb`. Only ever called at module load, so the cost is irrelevant. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** CSS colour string. `alpha` of 1 emits `rgb()` so the common case stays cheap. */
export function cssRgb(c: Rgb, alpha = 1): string {
  const r = Math.round(c.r)
  const g = Math.round(c.g)
  const b = Math.round(c.b)
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

/**
 * Relative luminance, Rec. 709 coefficients on non-linear values.
 *
 * Used by the ramp test to assert monotonicity rather than by the renderer. A
 * perceptually ordered ramp is what makes the elevation layer readable as
 * height at a glance; a ramp that dips in brightness reads as a terrace that
 * does not exist in the data.
 */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** Linear blend. `t` is clamped, so callers need not pre-clamp. */
export function mixRgb(a: Rgb, b: Rgb, t: number, out?: Rgb): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  const target = out ?? { r: 0, g: 0, b: 0 }
  target.r = a.r + (b.r - a.r) * k
  target.g = a.g + (b.g - a.g) * k
  target.b = a.b + (b.b - a.b) * k
  return target
}

/**
 * Sample a ramp. Stops must be sorted by `t`; the ramp is clamped at both ends.
 *
 * Takes an optional `out` so the per-cell loop can reuse one scratch object
 * instead of allocating 16k short-lived ones per repaint.
 */
export function sampleRamp(stops: readonly RampStop[], t: number, out?: Rgb): Rgb {
  const target = out ?? { r: 0, g: 0, b: 0 }
  const n = stops.length
  if (n === 0) {
    target.r = target.g = target.b = 0
    return target
  }
  const first = stops[0]
  const last = stops[n - 1]
  if (t <= first.t) {
    target.r = first.color.r
    target.g = first.color.g
    target.b = first.color.b
    return target
  }
  if (t >= last.t) {
    target.r = last.color.r
    target.g = last.color.g
    target.b = last.color.b
    return target
  }
  for (let i = 1; i < n; i++) {
    const hi = stops[i]
    if (t <= hi.t) {
      const lo = stops[i - 1]
      const span = hi.t - lo.t
      const k = span <= 0 ? 0 : (t - lo.t) / span
      return mixRgb(lo.color, hi.color, k, target)
    }
  }
  target.r = last.color.r
  target.g = last.color.g
  target.b = last.color.b
  return target
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * The flat palette. Near-black ground, desaturated regolith greys, one cyan
 * accent, amber/red reserved for hazard. No saturated colour appears outside
 * the hazard ramp and the cyan accent — that restraint is what lets a single
 * red cell read as an alarm on a 16k-cell map.
 */
export const PALETTE = {
  /** Page-matching near-black behind everything, including the letterbox. */
  background: '#07080a',
  /** Faint plate the square grid sits on, so the map edge is findable. */
  gridBackdrop: '#0c0e12',
  /** Hairline around the grid. */
  gridBorder: '#1b1f26',

  /** Cyan accent: the rover's own intent. Never used for terrain. */
  accent: '#22d3ee',
  accentDim: '#0e7490',

  /** Hazard semantics. Amber is caution, red is impassable. */
  hazardLow: '#f59e0b',
  hazardHigh: '#ef4444',
  /** Ring drawn around hazard the rover's own sensors found. */
  hazardDiscovered: '#fb923c',

  /** Slope overlay: cold slate, deliberately unlike the hazard ramp. */
  slopeWarn: '#64748b',
  slopeWall: '#94a3b8',

  /** Fog of belief: unobserved cells are pushed toward this. */
  fog: '#0a0c10',

  /** Trail the rover has physically driven. */
  trail: '#5eead4',
  /** Ghost of a route a replan threw away. */
  abandoned: '#5b6472',

  /** Rover chassis. */
  roverBody: '#e2e8f0',
  roverDark: '#0f172a',

  /** Waypoint markers. */
  waypointPending: '#e2e8f0',
  waypointReached: '#22d3ee',

  selection: '#f8fafc',
} as const

export type PaletteKey = keyof typeof PALETTE

/** Pre-parsed palette for the per-pixel hot path. */
export const RGB: Record<PaletteKey, Rgb> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, hexToRgb(v)]),
) as Record<PaletteKey, Rgb>

// ---------------------------------------------------------------------------
// Ramps
// ---------------------------------------------------------------------------

/**
 * Hypsometric ramp for elevation: low basin to bright highland dust.
 *
 * Strictly increasing in luminance by construction, and only very slightly
 * warm at the top. A saturated hypsometric ramp (the green-to-brown of a
 * terrestrial atlas) would fight the hazard ramp for attention and is wrong
 * for the Moon anyway, which is grey.
 */
export const ELEVATION_STOPS: readonly RampStop[] = [
  { t: 0.0, color: hexToRgb('#15171b') },
  { t: 0.25, color: hexToRgb('#30343a') },
  { t: 0.5, color: hexToRgb('#565b62') },
  { t: 0.75, color: hexToRgb('#8d9096') },
  { t: 1.0, color: hexToRgb('#d6d3cc') },
]

/** Allocating convenience wrapper; the renderer uses `sampleRamp` with a scratch. */
export function elevationColor(t: number, out?: Rgb): Rgb {
  return sampleRamp(ELEVATION_STOPS, t, out)
}

/**
 * Hazard ramp: amber at the first hint of trouble, red at impassable.
 *
 * It starts at amber rather than at the terrain colour because hazard is drawn
 * as an *overlay* whose alpha already carries severity — ramping the hue as
 * well as the alpha is what separates "rough" from "do not drive here".
 */
export const HAZARD_STOPS: readonly RampStop[] = [
  { t: 0.0, color: hexToRgb('#eab308') },
  { t: 0.5, color: hexToRgb('#f59e0b') },
  { t: 1.0, color: hexToRgb('#ef4444') },
]

export function hazardColor(t: number, out?: Rgb): Rgb {
  return sampleRamp(HAZARD_STOPS, t, out)
}

// ---------------------------------------------------------------------------
// Tuning constants for the terrain bake
// ---------------------------------------------------------------------------

/**
 * How hard the hillshade modulates the base ramp, 0..1.
 *
 * Hillshading is what makes a flat colour ramp read as landform. At 1 it looks
 * like a relief photograph and swamps the hazard overlay; at 0 the terrain
 * reads as an abstract heatmap and the user cannot see a crater rim. 0.55 keeps
 * the landform legible while leaving headroom for hazard to dominate.
 */
export const HILLSHADE_STRENGTH = 0.55

/** Light direction for hillshading. Fixed: a moving light would imply time of day. */
export const LIGHT_AZIMUTH_DEG = 315
export const LIGHT_ALTITUDE_DEG = 45

/** Vertical exaggeration applied to the elevation gradient before shading. */
export const RELIEF_EXAGGERATION = 2.2

/** How far an unobserved cell is pushed toward `fog`, 0..1. */
export const FOG_STRENGTH = 0.86

/** Extra desaturation applied to unobserved cells, on top of the fog mix. */
export const FOG_DESATURATION = 0.6

/** Peak alpha of the hazard overlay at severity 1. */
export const HAZARD_MAX_ALPHA = 0.8

/** Peak alpha of the slope overlay for a cell at or past the climb limit. */
export const SLOPE_MAX_ALPHA = 0.5

/**
 * Below this severity a hazard cell is not tinted at all.
 *
 * Terrain generators sprinkle a continuous hazard field, so without a floor
 * every cell carries a faint amber wash and the layer stops meaning anything.
 * Measured against the mock terrain, two thirds of cells sit under 0.1.
 */
export const HAZARD_FLOOR = 0.08

/**
 * Exponent applied to normalised hazard before it becomes an alpha.
 *
 * Linear alpha makes the map glow everywhere: a continuous hazard field has a
 * long tail of mildly rough cells, and at alpha = severity each of them is
 * plainly visible, so a genuinely impassable cell is only a little louder than
 * ground the rover would happily cross. Above 1 this pushes the low end down
 * and leaves the top of the range alone, which is what restores the contrast
 * between "rough" and "do not drive here".
 */
export const HAZARD_ALPHA_GAMMA = 1.6

/** Severity above which the "sensors found this" marker is worth drawing. */
export const DISCOVERED_MARKER_FLOOR = 0.08

/**
 * Collapse a colour toward its own luminance. Used for fog: an unobserved cell
 * should read as *unknown*, which is dimmer AND greyer, not merely dimmer.
 */
export function desaturate(c: Rgb, amount: number, out?: Rgb): Rgb {
  const target = out ?? { r: 0, g: 0, b: 0 }
  const l = luminance(c)
  const k = amount < 0 ? 0 : amount > 1 ? 1 : amount
  target.r = c.r + (l - c.r) * k
  target.g = c.g + (l - c.g) * k
  target.b = c.b + (l - c.b) * k
  return target
}
