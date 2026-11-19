import { createSimulation } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import { plan, planUniformCost } from '../src/core/planner'
import { constraintsFor, weightsFor } from '../src/core/cost'
import type { MissionConfig, Scenario } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return { scenarioId: s.id, seed: s.seed, start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...over }
}
for (const s of SCENARIOS) {
  const c = cfg(s); const st = createSimulation(c)
  const w = weightsFor(c), con = constraintsFor(c)
  const goal = c.waypoints[c.waypoints.length-1]!
  const req = { belief: st.belief, start: c.start, goal, weights: w, constraints: con }
  const ucs = planUniformCost(req, DEFAULT_ROVER)
  if (!ucs.ok) { console.log(s.id, 'UCS FAIL'); continue }
  console.log('==', s.id, 'UCS cost', ucs.route.cost.total.toFixed(6), 'nodes', ucs.stats.nodesExpanded)
  for (const hw of [1, 1.25, 1.5, 2, 3, 5]) {
    const r = plan({ ...req, heuristicWeight: hw }, DEFAULT_ROVER)
    if (!r.ok) continue
    const sub = (r.route.cost.total / ucs.route.cost.total - 1) * 100
    console.log(`   hw=${hw}`.padEnd(10), 'nodes', String(r.stats.nodesExpanded).padStart(5),
      'cost', r.route.cost.total.toFixed(6), 'subopt', sub.toFixed(3)+'%',
      'dist', r.route.distanceM.toFixed(0), 'peakHaz', r.route.peakHazard.toFixed(3))
  }
}
