import { createHash } from 'node:crypto'
import { createSimulation, computeMetrics, runToCompletion, replay, toRecord } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import type { MissionConfig, Scenario } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return { scenarioId: s.id, seed: s.seed, start: { ...s.start },
    waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...over }
}
const h = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16)

for (const s of SCENARIOS) {
  const c = cfg(s)
  const a = runToCompletion(createSimulation(c))
  const b = runToCompletion(createSimulation(c))
  const rec = toRecord(a, 'm', '2026-01-01T00:00:00.000Z')
  const r = replay(rec)
  console.log(s.id.padEnd(22), 'events', h(a.events), h(b.events), h(r.events),
    '| decisions', h(a.decisions), h(r.decisions),
    '| trail', h(a.trail) === h(r.trail))
  // metrics field-by-field minus planMsTotal
  const ma = computeMetrics(a) as any, mr = computeMetrics(r) as any
  const diff = Object.keys(ma).filter(k => ma[k] !== mr[k])
  console.log('   metric diffs:', diff.length ? diff.map(k => `${k} ${ma[k]} vs ${mr[k]}`).join(', ') : 'none')
}
// timing variance of a single plan
import { plan } from '../src/core/planner'
import { constraintsFor, weightsFor } from '../src/core/cost'
const s0 = SCENARIOS[2]!, c0 = cfg(s0), st0 = createSimulation(c0)
const req = { belief: st0.belief, start: c0.start, goal: c0.waypoints[0]!, weights: weightsFor(c0), constraints: constraintsFor(c0) }
for (let i = 0; i < 30; i++) plan(req, DEFAULT_ROVER) // warm
const ts: number[] = []
for (let i = 0; i < 60; i++) { const t = performance.now(); plan(req, DEFAULT_ROVER); ts.push(performance.now() - t) }
ts.sort((a,b)=>a-b)
console.log('plan ms  min', ts[0]!.toFixed(3), 'p25', ts[15]!.toFixed(3), 'median', ts[30]!.toFixed(3), 'p75', ts[45]!.toFixed(3), 'max', ts[59]!.toFixed(3))
