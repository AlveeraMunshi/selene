import { createHash } from 'node:crypto'
import { createSimulation, runToCompletion, replay, toRecord, resolveIntervention } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import type { MissionConfig, Scenario } from '../src/core/types'
function cfg(s: Scenario, o: Partial<MissionConfig> = {}): MissionConfig {
  return { scenarioId: s.id, seed: s.seed, start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...o }
}
const h = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16)
const cases: [string, MissionConfig][] = [
  ['sup-dh-025', cfg(SCENARIOS[1]!, { riskTolerance: 0.25, autonomyLevel: 'supervised' })],
  ['sup-co-025', cfg(SCENARIOS[2]!, { riskTolerance: 0.25, autonomyLevel: 'supervised' })],
  ['fail-late',  cfg(SCENARIOS[1]!, { seed: 77122349 })],
  ['unroutable', cfg(SCENARIOS[1]!, { seed: 77130421 })],
]
for (const [name, c] of cases) {
  const a = runToCompletion(createSimulation(c))
  const rec = toRecord(a, 'm', '2026-01-01T00:00:00.000Z')
  const r = replay(rec)
  console.log(name.padEnd(12), 'outcome', String(a.outcome).padEnd(9), 'ticks', String(a.tick).padStart(5),
    'ev', h(a.events), h(r.events), h(a.events)===h(r.events) ? 'MATCH' : 'DIVERGE')
}
// supervised with a resolution, then replay
const c = cfg(SCENARIOS[2]!, { riskTolerance: 0.25, autonomyLevel: 'supervised' })
let s = runToCompletion(createSimulation(c))
console.log('held:', s.pendingIntervention?.reason, 'options', s.pendingIntervention?.options.map(o=>o.id).join(','))
if (s.pendingIntervention) {
  const opt = s.pendingIntervention.options[0]!.id
  s = runToCompletion(resolveIntervention(s, opt))
  const rec = toRecord(s, 'm', '2026-01-01T00:00:00.000Z')
  const r = replay(rec)
  console.log('after resolve', opt, 'outcome', String(s.outcome), 'ticks', s.tick, 'res', s.resolutions.length,
    'ev', h(s.events), h(r.events), h(s.events)===h(r.events)?'MATCH':'DIVERGE')
}
