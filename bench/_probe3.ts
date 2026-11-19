import { createSimulation, computeMetrics, runToCompletion } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import type { MissionConfig, Scenario } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return { scenarioId: s.id, seed: s.seed, start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...over }
}
const dh = SCENARIOS[1]!
for (const seed of [77126385, 77130421, 77131430, 77122349]) {
  const st = runToCompletion(createSimulation(cfg(dh, { seed })))
  const fail = st.events.filter(e => e.type === 'mission-failed' || e.type === 'plan-failed')
  console.log(seed, st.outcome, 'ticks', st.tick, JSON.stringify(fail.slice(0,2)))
  const d0 = st.decisions[0]
  if (d0) console.log('   decision0 reason', d0.reasonCode, 'cands', d0.candidates.map(c => c.route ? 'ok' : c.rejected).join(' | '))
}
console.log('--- supervised at risk 0.25 ---')
for (const s of SCENARIOS) {
  const st = runToCompletion(createSimulation(cfg(s, { riskTolerance: 0.25, autonomyLevel: 'supervised' })))
  const m = computeMetrics(st)
  console.log(s.id.padEnd(22), 'outcome', String(st.outcome), 'pending', st.pendingIntervention?.reason ?? '-', 'interventions', m.interventions, 'ticks', m.ticks)
}
