/**
 * Stable digests of a mission's deterministic output.
 *
 * WHAT IS HASHED AND WHY NOT THE METRICS STRUCT. `MissionMetrics.planMsTotal`
 * is a wall-clock measurement — the same mission measured 17.6 ms live and
 * 3.1 ms on a warm replay here, a 5.6x gap — so hashing the metrics struct
 * whole would make the reproducibility gate fail on every machine for a
 * reason that has nothing to do with reproducibility. `metricsDigest`
 * therefore drops that one field by name, and `eventsDigest` hashes the event
 * log, which is fully deterministic.
 *
 * JSON.stringify is a safe serialiser here because every value on the path is
 * a number, a string, a boolean or a plain object built in a fixed order by
 * the engine; property order is insertion order and insertion order is
 * deterministic. Verified: two live runs and a replay of the same mission
 * produce byte-identical strings for events, decisions and trail.
 */

import { createHash } from 'node:crypto'
import type { Cell, DecisionRecord, MissionMetrics, SimEvent } from '../../src/core/types'

/** Truncated to 16 hex characters: long enough that a collision is not a
 *  practical concern for a few dozen golden cases, short enough to read in a
 *  diff and to sit in a committed JSON file without dominating it. */
const DIGEST_CHARS = 16

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, DIGEST_CHARS)
}

export function eventsDigest(events: readonly SimEvent[]): string {
  return digest(events)
}

export function decisionsDigest(decisions: readonly DecisionRecord[]): string {
  return digest(decisions)
}

export function trailDigest(trail: readonly Cell[]): string {
  return digest(trail)
}

/** The metrics struct minus the one field that measures the machine. */
export function deterministicMetrics(m: MissionMetrics): Omit<MissionMetrics, 'planMsTotal'> {
  const { planMsTotal: _ignored, ...rest } = m
  return rest
}

export function metricsDigest(m: MissionMetrics): string {
  return digest(deterministicMetrics(m))
}
