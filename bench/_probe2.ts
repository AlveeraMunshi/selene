import { createSimulation, computeMetrics, runToCompletion } from '../src/core/engine'
import { SCENARIOS, DEFAULT_ROVER } from '../src/core/scenarios'
import type { MissionConfig, Scenario } from '../src/core/types'

function cfg(s: Scenario, over: Partial<MissionConfig> = {}): MissionConfig {
  return {
    scenarioId: s.id, seed: s.seed,
    start: { ...s.start }, waypoints: s.suggestedWaypoints.map(c => ({ ...c })),
    riskTolerance: 0.45, energyPriority: 0.4, batteryReserveFrac: 0.15,
    maxSlopeDeg: 25, autonomyLevel: 'autonomous', rover: DEFAULT_ROVER, ...over,
  }
}
const t0 = performance.now()
for (const s of SCENARIOS) {
  const out: string[] = []
  for (let k = 0; k < 12; k++) {
    const seed = s.seed + k * 1009
    const st = runToCompletion(createSimulation(cfg(s, { seed })))
    const m = computeMetrics(st)
    out.push(`${String(seed).padStart(9)} ${String(st.outcome ?? 'none').padEnd(8)} d=${m.distanceM.toFixed(0).padStart(4)} r=${m.replans} ph=${m.peakHazardTraversed.toFixed(2)} t=${m.ticks}`)
  }
  console.log('==', s.id); console.log(out.join('\n'))
}
console.log('total wall', (performance.now()-t0).toFixed(0)+'ms')
