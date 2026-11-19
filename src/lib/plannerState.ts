/**
 * A SimState for the planner map.
 *
 * WHY THIS SHIM IS NEEDED: the renderer draws a `SimState`, and before launch
 * there is no mission. Rather than ask the renderer for a second terrain-only
 * mode, the planner builds the state the engine itself would start from —
 * `createSimulation(config)` — which is deterministic, costs one terrain
 * generation, and guarantees the map a user plans on is pixel-identical to
 * the map the mission begins on.
 *
 * The previewed route is then attached to that state's rover. It is a real
 * `Route` scored by `routeStats`, not a fabricated one; see `preview.ts`.
 */

import { createSimulation } from '@/core/engine'
import type { MissionConfig, Route, SimState } from '@/core/types'

/**
 * Terrain generation is the expensive part, and it depends only on the
 * scenario and the seed. Start and waypoints change the state cheaply, so
 * they are patched onto a cached base rather than regenerating.
 */
const baseCache = new Map<string, SimState>()
const MAX_CACHED = 4

function baseFor(config: MissionConfig): SimState {
  const key = `${config.scenarioId}:${config.seed}`
  const hit = baseCache.get(key)
  if (hit) return hit
  const base = createSimulation(config)
  baseCache.set(key, base)
  if (baseCache.size > MAX_CACHED) {
    const oldest = baseCache.keys().next().value
    if (oldest !== undefined) baseCache.delete(oldest)
  }
  return base
}

/**
 * The state the planner map renders.
 *
 * Cheap enough to call on every render: a cache hit plus two object spreads.
 * The rover is parked at the configured start so the map shows where the
 * mission will begin, and `config` is replaced so waypoint markers follow the
 * draft rather than the cached base.
 */
export function plannerDisplayState(config: MissionConfig, route: Route | null): SimState {
  const base = baseFor(config)
  return {
    ...base,
    config,
    rover: {
      ...base.rover,
      pos: { x: config.start.x, y: config.start.y },
      cell: { x: config.start.x, y: config.start.y },
      route,
      routeProgress: 0,
      waypointIndex: 0,
    },
  }
}
