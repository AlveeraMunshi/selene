/**
 * Interpolation between engine ticks.
 *
 * WHY THIS EXISTS: the engine steps at 2 Hz (TICK_SECONDS = 0.5) and the
 * renderer runs at 60. Drawing the raw state would show the rover teleporting
 * twice a second. The renderer therefore holds the last two poses and draws
 * `lerp(previous, current, alpha)`, where alpha is how far into the current
 * tick's display window we are.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: only *continuous physical* quantities
 * are interpolated — position and heading. Nothing that represents a decision
 * is. A half-interpolated battery reading is a number the engine never
 * computed; a half-interpolated route is a path the planner never chose; a
 * mode blended between `driving` and `replanning` is a state the machine has
 * no transition for. Those are read straight off the current state, so what
 * the user reads is always a value the engine actually produced.
 *
 * Interpolating backwards in time by one tick (rather than extrapolating
 * forwards) is the standard fixed-timestep choice: it costs one tick of display
 * latency and can never show the rover somewhere the engine did not put it.
 */

import type { RoverState, Vec2 } from '@/core/types'

export const TAU = Math.PI * 2

/** Clamp to [lo, hi]. Returns `lo` for NaN, which keeps a bad alpha from poisoning a frame. */
export function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

/** Clamp to [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Linear interpolation with a clamped parameter. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

/** Inverse lerp, clamped; `a === b` yields 0 rather than a division by zero. */
export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return 0
  return clamp01((v - a) / (b - a))
}

/**
 * Shortest-arc angle interpolation, in radians.
 *
 * A plain lerp between 350 degrees and 10 degrees spins the rover 340 degrees
 * the wrong way, once, every time it crosses north. Normalising the delta into
 * (-pi, pi] first is what makes the turn go the short way.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return a + d * clamp01(t)
}

/**
 * Normalise an angle into [0, TAU).
 *
 * The second guard is not redundant: for a tiny negative input, `m + TAU`
 * rounds to exactly TAU in double precision, which is outside the half-open
 * range this function promises and breaks any caller comparing against it.
 */
export function normalizeAngle(a: number): number {
  const m = a % TAU
  const n = m < 0 ? m + TAU : m
  return n >= TAU ? 0 : n
}

/** The continuous part of the rover's state: everything safe to interpolate. */
export interface Pose {
  pos: Vec2
  heading: number
}

export function poseOf(rover: RoverState): Pose {
  return { pos: { x: rover.pos.x, y: rover.pos.y }, heading: rover.heading }
}

/**
 * Distance in cells past which we snap rather than glide.
 *
 * A replay scrub, a scenario change or a mission reset moves the rover an
 * arbitrary distance between two consecutive draws. Gliding across that gap
 * would animate a journey that never happened; snapping is both cheaper and
 * more honest. Two cells is comfortably more than one tick of real driving.
 */
export const SNAP_DISTANCE_CELLS = 2

export function interpolatePose(prev: Pose, curr: Pose, alpha: number): Pose {
  const dx = curr.pos.x - prev.pos.x
  const dy = curr.pos.y - prev.pos.y
  if (dx * dx + dy * dy > SNAP_DISTANCE_CELLS * SNAP_DISTANCE_CELLS) {
    return { pos: { x: curr.pos.x, y: curr.pos.y }, heading: curr.heading }
  }
  const t = clamp01(alpha)
  return {
    pos: { x: lerp(prev.pos.x, curr.pos.x, t), y: lerp(prev.pos.y, curr.pos.y, t) },
    heading: lerpAngle(prev.heading, curr.heading, t),
  }
}

/**
 * Ease a 0..1 pulse into a soft attack and a long decay.
 *
 * Used for the hazard-discovery flash. A linear fade reads as a light being
 * switched off; this reads as something registering on an instrument.
 */
export function pulseEnvelope(t: number): number {
  const k = clamp01(t)
  return Math.sin(Math.PI * Math.pow(k, 0.6))
}
