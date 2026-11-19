import { createSimulation } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import { plan } from '../src/core/planner'
import { constraintsFor, weightsFor, routeStats } from '../src/core/cost'
import type { MissionConfig, Scenario, CostWeights } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return { scenarioId: s.id, seed: s.seed, start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...over }
}
const DIST_ONLY: CostWeights = { distance: 1, slope: 0, hazard: 0, energy: 0 }

for (const s of SCENARIOS) {
  const c = cfg(s)
  const st = createSimulation(c)
  const w = weightsFor(c); const con = constraintsFor(c)
  console.log('==', s.id, 'weights', JSON.stringify(Object.fromEntries(Object.entries(w).map(([k,v])=>[k,+v.toFixed(3)]))), 'maxHaz', con.maxHazard.toFixed(2))
  const goal = c.waypoints[c.waypoints.length-1]!
  for (const [name, ww, cc] of [
    ['risk-aware   ', w, con],
    ['dist-only    ', DIST_ONLY, con],
    ['dist-only@max', DIST_ONLY, { ...con, maxHazard: 0.95 }],
  ] as const) {
    const r = plan({ belief: st.belief, start: c.start, goal, weights: ww, constraints: cc }, DEFAULT_ROVER)
    if (!r.ok) { console.log(' ', name, 'FAIL', r.reason); continue }
    // re-cost in common currency for comparability
    const rc = routeStats(st.belief, r.route.cells, w, con, DEFAULT_ROVER)
    console.log(' ', name, 'dist', r.route.distanceM.toFixed(0).padStart(4),
      'Wh', r.route.energyWh.toFixed(1).padStart(6),
      'peakHaz', r.route.peakHazard.toFixed(3), 'meanHaz', r.route.meanHazard.toFixed(4),
      'peakSlope', r.route.peakSlopeDeg.toFixed(1),
      'nodes', String(r.stats.nodesExpanded).padStart(5), 'commonCost', rc.cost.total.toFixed(2))
  }
}
