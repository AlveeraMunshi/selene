/**
 * Palette and ramps.
 *
 * The monotonicity assertion is the one with teeth: an elevation ramp that
 * dips in brightness anywhere renders a terrace the data does not contain, and
 * it is almost impossible to see by eye on a noisy heightfield.
 */

import { describe, expect, it } from 'vitest'
import {
  ELEVATION_STOPS,
  HAZARD_STOPS,
  PALETTE,
  RGB,
  cssRgb,
  desaturate,
  elevationColor,
  hazardColor,
  hexToRgb,
  luminance,
  mixRgb,
  sampleRamp,
} from '../colors'

describe('hexToRgb / cssRgb', () => {
  it('round-trips a hex colour', () => {
    expect(hexToRgb('#22d3ee')).toEqual({ r: 0x22, g: 0xd3, b: 0xee })
  })

  it('emits rgb() at full alpha and rgba() below it', () => {
    expect(cssRgb({ r: 1, g: 2, b: 3 })).toBe('rgb(1,2,3)')
    expect(cssRgb({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgba(1,2,3,0.5)')
  })

  it('rounds, so a mixed colour never produces a fractional channel', () => {
    expect(cssRgb({ r: 10.4, g: 10.6, b: 10.5 })).toBe('rgb(10,11,11)')
  })
})

describe('elevation ramp', () => {
  it('is monotonically increasing in luminance across its whole domain', () => {
    let previous = -1
    for (let i = 0; i <= 500; i++) {
      const l = luminance(elevationColor(i / 500))
      expect(l).toBeGreaterThan(previous)
      previous = l
    }
  })

  it('is monotonic in every channel as well, so the hue does not wander', () => {
    let last = elevationColor(0)
    for (let i = 1; i <= 200; i++) {
      const c = elevationColor(i / 200)
      expect(c.r).toBeGreaterThanOrEqual(last.r)
      expect(c.g).toBeGreaterThanOrEqual(last.g)
      expect(c.b).toBeGreaterThanOrEqual(last.b)
      last = c
    }
  })

  it('clamps outside [0,1] rather than extrapolating off the ramp', () => {
    expect(elevationColor(-5)).toEqual(ELEVATION_STOPS[0].color)
    expect(elevationColor(9)).toEqual(ELEVATION_STOPS[ELEVATION_STOPS.length - 1].color)
    expect(elevationColor(Number.NEGATIVE_INFINITY)).toEqual(ELEVATION_STOPS[0].color)
  })

  it('hits each stop exactly at its own position', () => {
    for (const stop of ELEVATION_STOPS) {
      expect(elevationColor(stop.t)).toEqual(stop.color)
    }
  })

  it('stays desaturated: no channel strays far from the cell luminance', () => {
    for (let i = 0; i <= 50; i++) {
      const c = elevationColor(i / 50)
      const l = luminance(c)
      const spread = Math.max(Math.abs(c.r - l), Math.abs(c.g - l), Math.abs(c.b - l))
      expect(spread).toBeLessThan(18)
    }
  })
})

describe('hazard ramp', () => {
  it('runs amber to red, so severity reads as hue as well as alpha', () => {
    const low = hazardColor(0)
    const high = hazardColor(1)
    expect(low.g).toBeGreaterThan(high.g)
    expect(high.r).toBeGreaterThan(100)
    expect(hazardColor(1)).toEqual(HAZARD_STOPS[HAZARD_STOPS.length - 1].color)
  })

  it('is monotonically decreasing in green, which is what carries amber->red', () => {
    let last = Infinity
    for (let i = 0; i <= 100; i++) {
      const g = hazardColor(i / 100).g
      expect(g).toBeLessThanOrEqual(last + 1e-9)
      last = g
    }
  })
})

describe('sampleRamp', () => {
  it('writes into the provided scratch object rather than allocating', () => {
    const out = { r: 0, g: 0, b: 0 }
    const result = sampleRamp(ELEVATION_STOPS, 0.5, out)
    expect(result).toBe(out)
  })

  it('handles an empty ramp without throwing', () => {
    expect(sampleRamp([], 0.5)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('handles a single-stop ramp', () => {
    const stops = [{ t: 0.5, color: { r: 10, g: 20, b: 30 } }]
    expect(sampleRamp(stops, 0)).toEqual({ r: 10, g: 20, b: 30 })
    expect(sampleRamp(stops, 1)).toEqual({ r: 10, g: 20, b: 30 })
  })
})

describe('mixRgb', () => {
  it('clamps its parameter at both ends', () => {
    const a = { r: 0, g: 0, b: 0 }
    const b = { r: 100, g: 100, b: 100 }
    expect(mixRgb(a, b, -1)).toEqual(a)
    expect(mixRgb(a, b, 2)).toEqual(b)
    expect(mixRgb(a, b, 0.5)).toEqual({ r: 50, g: 50, b: 50 })
  })
})

describe('desaturate', () => {
  it('collapses fully to the colour luminance at amount 1', () => {
    const c = { r: 200, g: 50, b: 10 }
    const l = luminance(c)
    const d = desaturate(c, 1)
    expect(d.r).toBeCloseTo(l, 6)
    expect(d.g).toBeCloseTo(l, 6)
    expect(d.b).toBeCloseTo(l, 6)
  })

  it('is the identity at amount 0', () => {
    const c = { r: 200, g: 50, b: 10 }
    expect(desaturate(c, 0)).toEqual(c)
  })
})

describe('palette discipline', () => {
  it('pre-parses every palette entry', () => {
    for (const key of Object.keys(PALETTE) as (keyof typeof PALETTE)[]) {
      expect(RGB[key]).toEqual(hexToRgb(PALETTE[key]))
    }
  })

  it('keeps the hazard colours clearly warmer than every terrain colour', () => {
    // The semantic contract: red/amber means danger and nothing else does.
    const hazardish = [RGB.hazardLow, RGB.hazardHigh, RGB.hazardDiscovered]
    const terrainish = [RGB.gridBackdrop, RGB.fog, RGB.slopeWarn, RGB.slopeWall]
    for (const h of hazardish) {
      for (const t of terrainish) {
        expect(h.r - h.b).toBeGreaterThan(t.r - t.b + 60)
      }
    }
  })
})
