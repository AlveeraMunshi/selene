import { createSimulation, computeMetrics, runToCompletion } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import type { MissionConfig, Scenario } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return {
    scenarioId: s.id, seed: s.seed,
    start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER,
    ...over,
  }
}

for (const s of SCENARIOS) {
  const t0 = performance.now()
  const st = runToCompletion(createSimulation(cfg(s)))
  const m = computeMetrics(st)
  console.log(s.id.padEnd(22), st.outcome, 'wp', m.waypointsReached + '/' + m.waypointsTotal,
    'dist', m.distanceM.toFixed(0), 'Wh', m.energyWh.toFixed(1), 'batt', (m.batteryRemaining*100).toFixed(0)+'%',
    'replans', m.replans, 'haz', m.hazardsDiscovered + '/' + m.hazardsOnRoute,
    'plans', m.planCount, 'planMs', m.planMsTotal.toFixed(1), 'peakHaz', m.peakHazardTraversed.toFixed(3),
    'ticks', m.ticks, 'wall', (performance.now()-t0).toFixed(0)+'ms')
}
