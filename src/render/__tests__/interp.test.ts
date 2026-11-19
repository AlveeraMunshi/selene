/**
 * Interpolation helpers.
 *
 * Clamping is the behaviour under test rather than the arithmetic: alpha
 * arrives from a wall clock, so it will be out of range the first time a tab
 * is backgrounded, and a frame drawn at alpha = 3 would put the rover three
 * ticks ahead of anything the engine computed.
 */

import { describe, expect, it } from 'vitest'
import {
  SNAP_DISTANCE_CELLS,
  TAU,
  clamp,
  clamp01,
  interpolatePose,
  invLerp,
  lerp,
  lerpAngle,
  normalizeAngle,
  poseOf,
  pulseEnvelope,
} from '../interp'
import type { RoverState } from '@/core/types'

describe('clamp', () => {
  it('bounds at both ends and passes the interior through', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(4, 0, 10)).toBe(4)
  })

  it('maps NaN to the lower bound rather than propagating it into a frame', () => {
    expect(clamp(Number.NaN, 2, 9)).toBe(2)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('bounds infinities', () => {
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0)
  })
})

describe('lerp', () => {
  it('clamps its parameter, so an overshooting alpha cannot extrapolate', () => {
    expect(lerp(0, 10, -1)).toBe(0)
    expect(lerp(0, 10, 2)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })

  it('returns exact endpoints', () => {
    expect(lerp(3, 7, 0)).toBe(3)
    expect(lerp(3, 7, 1)).toBe(7)
  })
})

describe('invLerp', () => {
  it('is the inverse of lerp on the interior', () => {
    expect(invLerp(10, 20, 15)).toBe(0.5)
  })

  it('returns 0 for a zero-width span instead of dividing by zero', () => {
    expect(invLerp(5, 5, 5)).toBe(0)
    expect(Number.isFinite(invLerp(5, 5, 9))).toBe(true)
  })
})

/** Signed shortest difference between two bearings, in (-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

describe('lerpAngle', () => {
  it('takes the short way round across the wrap point', () => {
    const from = (350 * Math.PI) / 180
    const to = (10 * Math.PI) / 180
    const mid = lerpAngle(from, to, 0.5)
    // Halfway from 350 to 10 is 0 (i.e. 360), not 180.
    expect(angleDelta(mid, 0)).toBeCloseTo(0, 6)
  })

  it('goes the short way in the negative direction too', () => {
    const from = (10 * Math.PI) / 180
    const to = (350 * Math.PI) / 180
    // Compare as a signed angular difference: the midpoint is 0, and an exact
    // 0 and an exact TAU are the same bearing.
    expect(angleDelta(lerpAngle(from, to, 0.5), 0)).toBeCloseTo(0, 6)
  })

  it('never travels more than half a turn', () => {
    for (let a = 0; a < TAU; a += 0.37) {
      for (let b = 0; b < TAU; b += 0.41) {
        expect(Math.abs(lerpAngle(a, b, 1) - a)).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })

  it('clamps its parameter like lerp does', () => {
    expect(lerpAngle(0, 1, -3)).toBe(0)
    expect(lerpAngle(0, 1, 5)).toBe(1)
  })
})

describe('normalizeAngle', () => {
  it('brings any angle into [0, TAU)', () => {
    for (const a of [-7 * TAU - 0.3, -0.1, 0, 0.5, TAU, TAU * 3 + 1]) {
      const n = normalizeAngle(a)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(TAU)
    }
  })
})

function rover(x: number, y: number, heading: number): RoverState {
  return {
    mode: 'driving',
    pos: { x, y },
    cell: { x: Math.round(x), y: Math.round(y) },
    heading,
    battery: 1,
    odometerM: 0,
    energyUsedWh: 0,
    waypointIndex: 0,
    route: null,
    routeProgress: 0,
  }
}

describe('interpolatePose', () => {
  it('blends position and heading between the two ticks', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(1, 1, Math.PI / 2))
    const mid = interpolatePose(a, b, 0.5)
    expect(mid.pos).toEqual({ x: 0.5, y: 0.5 })
    expect(mid.heading).toBeCloseTo(Math.PI / 4, 6)
  })

  it('rests exactly on the current tick at alpha 1', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(1, 2, 1))
    expect(interpolatePose(a, b, 1).pos).toEqual({ x: 1, y: 2 })
  })

  it('clamps an out-of-range alpha instead of flying past the rover', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(1, 0, 0))
    expect(interpolatePose(a, b, 4).pos.x).toBe(1)
    expect(interpolatePose(a, b, -4).pos.x).toBe(0)
  })

  it('snaps rather than gliding across a jump, which is a reset not a drive', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(40, 40, 3))
    const mid = interpolatePose(a, b, 0.5)
    expect(mid.pos).toEqual({ x: 40, y: 40 })
    expect(mid.heading).toBe(3)
  })

  it('still glides at exactly the snap threshold', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(SNAP_DISTANCE_CELLS, 0, 0))
    expect(interpolatePose(a, b, 0.5).pos.x).toBe(SNAP_DISTANCE_CELLS / 2)
  })

  it('does not alias the input poses', () => {
    const a = poseOf(rover(0, 0, 0))
    const b = poseOf(rover(1, 1, 0))
    const out = interpolatePose(a, b, 0.5)
    out.pos.x = 99
    expect(a.pos.x).toBe(0)
    expect(b.pos.x).toBe(1)
  })
})

describe('poseOf', () => {
  it('copies the position, so a later engine mutation cannot move a past pose', () => {
    const r = rover(3, 4, 1)
    const p = poseOf(r)
    r.pos.x = 100
    expect(p.pos.x).toBe(3)
  })
})

describe('pulseEnvelope', () => {
  it('starts and ends at zero with a peak in between', () => {
    expect(pulseEnvelope(0)).toBeCloseTo(0, 6)
    expect(pulseEnvelope(1)).toBeCloseTo(0, 6)
    expect(pulseEnvelope(0.5)).toBeGreaterThan(0.5)
  })

  it('clamps out-of-range input', () => {
    expect(pulseEnvelope(-1)).toBeCloseTo(0, 6)
    expect(pulseEnvelope(5)).toBeCloseTo(0, 6)
  })
})
