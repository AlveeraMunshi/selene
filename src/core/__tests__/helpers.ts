/**
 * Shared test fixtures.
 *
 * Not a `.test.ts` file, so vitest imports it without trying to run it as a
 * suite. The synthetic belief builder exists because most planner properties
 * — corner-cutting, impassability, failure codes — are far easier to assert
 * on a hand-drawn 5x5 grid than on generated terrain, where you can never be
 * certain the case you meant to construct actually occurred.
 */

import type { Belief, Cell, Constraints, CostWeights, MissionConfig, Scenario } from '../types'
import { DEFAULT_ROVER } from '../scenarios'

/** A perfectly flat, perfectly clean belief of the given size. */
export function flatBelief(width: number, height: number): Belief {
  const n = width * height
  return {
    width,
    height,
    observed: new Uint8Array(n).fill(1),
    hazard: new Float32Array(n),
    slopeDeg: new Float32Array(n),
    elevation: new Float32Array(n),
  }
}

export function setHazard(b: Belief, x: number, y: number, v: number): void {
  b.hazard[y * b.width + x] = v
}

export function setSlope(b: Belief, x: number, y: number, v: number): void {
  b.slopeDeg[y * b.width + x] = v
}

export const TEST_WEIGHTS: CostWeights = {
  distance: 0.25,
  slope: 0.25,
  hazard: 0.25,
  energy: 0.25,
}

export const TEST_CONSTRAINTS: Constraints = {
  maxSlopeDeg: 25,
  maxHazard: 0.5,
  batteryReserveFrac: 0.2,
}

export function configFor(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return {
    scenarioId: s.id,
    seed: s.seed,
    start: s.start,
    waypoints: s.suggestedWaypoints,
    riskTolerance: 0.5,
    energyPriority: 0.5,
    batteryReserveFrac: 0.2,
    maxSlopeDeg: 25,
    autonomyLevel: 'autonomous',
    rover: DEFAULT_ROVER,
    ...over,
  }
}

export function cellKey(c: Cell): string {
  return `${c.x},${c.y}`
}

export function pathKey(cells: Cell[]): string {
  return cells.map(cellKey).join('|')
}
