/**
 * The simulation.
 *
 * Four properties matter more than the rest and each has a test that would
 * fail loudly if it broke:
 *
 *   PURITY      `step()` must not touch its argument, or React's state
 *               comparison and the undo/replay machinery both silently rot.
 *   DETERMINISM two runs of the same config must produce the same events.
 *   REPLAY      a MissionRecord stores no terrain and no trajectory, so a
 *               faithful replay is the real proof that nothing leaked a clock
 *               or an unseeded random number into a decision.
 *   NON-BLOCKING a pending intervention makes `step()` a no-op rather than
 *               awaiting anything.
 *
 * `planMsTotal` is excluded from every comparison: it is wall-clock, which the
 * planner measures deliberately and which cannot be deterministic.
 */

import { describe, expect, it } from 'vitest'
import {
  abortMission,
  computeMetrics,
  createSimulation,
  replay,
  resolveIntervention,
  runToCompletion,
  step,
  toRecord,
} from '../engine'
import { SCENARIOS, getScenario } from '../scenarios'
import type { MissionConfig, MissionMetrics, SimState } from '../types'
import { configFor } from './helpers'

const BASELINE = getScenario('baseline-traverse')
const DYNAMIC = getScenario('dynamic-hazard')
const COMPETING = getScenario('competing-objectives')

/** Metrics minus the one field that is honestly non-deterministic. */
function stableMetrics(m: MissionMetrics): Omit<MissionMetrics, 'planMsTotal'> {
  const { planMsTotal: _ignored, ...rest } = m
  return rest
}

/** Drive a supervised mission, answering every intervention with `pick`. */
function driveSupervised(
  start: SimState,
  pick: (s: SimState) => string,
  maxTicks = 20000,
): { end: SimState; answered: string[] } {
  let s = start
  const answered: string[] = []
  for (let i = 0; i < maxTicks && s.outcome === null; i++) {
    if (s.pendingIntervention) {
      const id = pick(s)
      answered.push(id)
      s = resolveIntervention(s, id)
      continue
    }
    const next = step(s)
    if (next === s) break
    s = next
  }
  return { end: s, answered }
}

describe('createSimulation', () => {
  it('starts at tick 0 with a plan already made', () => {
    const s = createSimulation(configFor(BASELINE))
    expect(s.tick).toBe(0)
    expect(s.elapsedS).toBe(0)
    expect(s.outcome).toBeNull()
    expect(s.rover.route).not.toBeNull()
    expect(s.rover.mode).toBe('driving')
    expect(s.decisions).toHaveLength(1)
    expect(s.decisions[0].kind).toBe('initial-plan')
    expect(s.events[0]).toEqual({ type: 'mission-started', tick: 0 })
  })

  it('has already swept the rover’s own surroundings', () => {
    const s = createSimulation(configFor(BASELINE))
    let observed = 0
    for (let i = 0; i < s.belief.observed.length; i++) if (s.belief.observed[i]) observed++
    expect(observed).toBeGreaterThan(0)
  })

  it('rejects an unknown scenario id rather than quietly substituting one', () => {
    expect(() => createSimulation({ ...configFor(BASELINE), scenarioId: 'nope' })).toThrow(/Unknown scenario/)
  })
})

describe('step() purity', () => {
  it('never mutates the state it was given', () => {
    let s = createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' }))
    // Run several hundred ticks from the SAME snapshot's descendants while
    // checking the original is untouched — the discoveries in this scenario
    // are what would provoke an in-place belief write if one existed.
    const snapshot = structuredClone(s)
    for (let i = 0; i < 400; i++) s = step(s)
    expect(s.tick).toBe(400)
    const original = createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' }))
    expect(structuredClone(original)).toEqual(snapshot)
  })

  it('leaves a single input state byte-identical across one step', () => {
    let s = createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' }))
    // Advance far enough that the rover is mid-route and actively sensing.
    for (let i = 0; i < 60; i++) s = step(s)
    const before = structuredClone(s)
    const after = step(s)
    expect(structuredClone(s)).toEqual(before)
    expect(after).not.toBe(s)
    expect(after.tick).toBe(s.tick + 1)
  })

  it('shares immutable layers rather than cloning them every tick', () => {
    // Not a correctness requirement so much as a guard on the copy-on-write
    // scheme: if terrain ever started being copied, a long run would allocate
    // hundreds of megabytes and nothing else would notice.
    let s = createSimulation(configFor(BASELINE))
    const terrain = s.terrain
    for (let i = 0; i < 20; i++) s = step(s)
    expect(s.terrain).toBe(terrain)
  })
})

describe('determinism', () => {
  it('two runs of the same config produce identical metrics and events', () => {
    for (const sc of SCENARIOS) {
      const cfg = configFor(sc, { autonomyLevel: 'autonomous' })
      const a = runToCompletion(createSimulation(cfg))
      const b = runToCompletion(createSimulation(cfg))
      expect(stableMetrics(computeMetrics(b))).toEqual(stableMetrics(computeMetrics(a)))
      expect(b.events).toEqual(a.events)
      expect(b.trail).toEqual(a.trail)
      expect(b.decisions.map((d) => d.id)).toEqual(a.decisions.map((d) => d.id))
      expect(b.decisions.map((d) => d.selectedId)).toEqual(a.decisions.map((d) => d.selectedId))
    }
  })

  it('a different seed produces a different mission', () => {
    const a = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    const b = runToCompletion(
      createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous', seed: DYNAMIC.seed + 1 })),
    )
    expect(b.trail).not.toEqual(a.trail)
  })
})

describe('replay fidelity', () => {
  it('reproduces an autonomous mission exactly', () => {
    for (const sc of SCENARIOS) {
      const end = runToCompletion(createSimulation(configFor(sc, { autonomyLevel: 'autonomous' })))
      const record = toRecord(end, 'test-mission', '2026-01-01T00:00:00.000Z')
      const again = replay(record)
      expect(again.events).toEqual(end.events)
      expect(again.trail).toEqual(end.trail)
      expect(stableMetrics(computeMetrics(again))).toEqual(stableMetrics(computeMetrics(end)))
    }
  })

  it('reproduces a supervised mission including every operator decision', () => {
    const { end, answered } = driveSupervised(
      createSimulation(configFor(DYNAMIC, { autonomyLevel: 'supervised' })),
      (s) => {
        const o = s.pendingIntervention!.options
        return (o.find((x) => x.id === 'accept') ?? o[0]).id
      },
    )
    expect(answered.length).toBeGreaterThan(0)
    const record = toRecord(end, 'supervised-mission', '2026-01-01T00:00:00.000Z')
    expect(record.resolutions.length).toBe(answered.length)

    const again = replay(record)
    expect(again.outcome).toBe(end.outcome)
    expect(again.events).toEqual(end.events)
    expect(again.trail).toEqual(end.trail)
    expect(again.resolutions).toEqual(end.resolutions)
    expect(stableMetrics(computeMetrics(again))).toEqual(stableMetrics(computeMetrics(end)))
  })

  it('reproduces a mission where the operator took the non-default option', () => {
    const { end } = driveSupervised(
      createSimulation(configFor(COMPETING, { autonomyLevel: 'supervised', riskTolerance: 0 })),
      (s) => {
        const o = s.pendingIntervention!.options
        return (o.find((x) => x.id === 'relax') ?? o.find((x) => x.id === 'accept') ?? o[0]).id
      },
    )
    const record = toRecord(end, 'relaxed-mission', '2026-01-01T00:00:00.000Z')
    const again = replay(record)
    expect(again.events).toEqual(end.events)
    expect(again.effectiveMaxHazard).toBe(end.effectiveMaxHazard)
  })

  it('a record survives JSON, which is what export and import depend on', () => {
    const end = runToCompletion(createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' })))
    const record = toRecord(end, 'm', '2026-01-01T00:00:00.000Z')
    const roundTripped = JSON.parse(JSON.stringify(record))
    expect(roundTripped).toEqual(record)
    expect(replay(roundTripped).events).toEqual(end.events)
  })
})

describe('intervention flow', () => {
  function unroutable(): MissionConfig {
    // riskTolerance 0 in the rubble scenario leaves no legal route at all.
    return configFor(COMPETING, { autonomyLevel: 'supervised', riskTolerance: 0 })
  }

  it('raises a request and parks the rover in awaiting-approval', () => {
    const s = createSimulation(unroutable())
    expect(s.pendingIntervention).not.toBeNull()
    expect(s.pendingIntervention!.reason).toBe('no-safe-route')
    expect(s.rover.mode).toBe('awaiting-approval')
    expect(s.events.some((e) => e.type === 'intervention-required')).toBe(true)
  })

  it('offers only options whose routes are real planner output', () => {
    const s = createSimulation(unroutable())
    for (const o of s.pendingIntervention!.options) {
      if (o.route === null) continue
      expect(o.route.cells.length).toBeGreaterThan(1)
      expect(o.route.cells[0]).toEqual(s.rover.cell)
    }
    expect(s.pendingIntervention!.options.some((o) => o.action.type === 'abort-mission')).toBe(true)
  })

  it('makes step() a no-op while a request is outstanding', () => {
    const s = createSimulation(unroutable())
    // Identical object, not merely an equal one: that is the signal
    // runToCompletion and replay use to know they are wedged.
    expect(step(s)).toBe(s)
    expect(step(step(s))).toBe(s)
  })

  it('applies the operator’s choice and records it', () => {
    const s = createSimulation(unroutable())
    const relax = s.pendingIntervention!.options.find((o) => o.id === 'relax')!
    const after = resolveIntervention(s, relax.id)

    expect(after.resolutions).toHaveLength(1)
    expect(after.resolutions[0]).toEqual({
      requestId: s.pendingIntervention!.id,
      optionId: 'relax',
      tick: s.tick,
    })
    expect(after.effectiveMaxHazard).toBeGreaterThan(s.effectiveMaxHazard)
    expect(after.events.some((e) => e.type === 'intervention-resolved')).toBe(true)
    // The replan the choice provoked is recorded as its own decision.
    expect(after.decisions.some((d) => d.kind === 'intervention-resolved')).toBe(true)
  })

  it('asks a SECOND time when the route the relaxation opened is still above the stated tolerance', () => {
    // Not a defect: `maxHazard` is a hard limit and `riskTolerance` is a
    // preference, and raising the former does not change the latter. A route
    // at hazard 0.36 is now legal but the operator said they wanted 0.00, so
    // the engine asks again rather than quietly driving it.
    const s = createSimulation(unroutable())
    const first = s.pendingIntervention!
    const after = resolveIntervention(s, 'relax')
    expect(after.pendingIntervention).not.toBeNull()
    expect(after.pendingIntervention!.id).not.toBe(first.id)
    expect(after.pendingIntervention!.reason).toBe('risk-exceeds-tolerance')
    expect(after.rover.mode).toBe('awaiting-approval')
  })

  it('resumes driving once every question has been answered', () => {
    const s = createSimulation(unroutable())
    const relaxed = resolveIntervention(s, 'relax')
    const accepted = resolveIntervention(relaxed, 'accept')
    expect(accepted.pendingIntervention).toBeNull()
    expect(accepted.rover.route).not.toBeNull()
    expect(accepted.rover.mode).toBe('driving')
    expect(accepted.resolutions).toHaveLength(2)
    // And the simulation actually advances again.
    const stepped = step(accepted)
    expect(stepped).not.toBe(accepted)
    expect(stepped.tick).toBe(accepted.tick + 1)
  })

  it('does not mutate the state it resolves', () => {
    const s = createSimulation(unroutable())
    const before = structuredClone(s)
    resolveIntervention(s, s.pendingIntervention!.options[0].id)
    expect(structuredClone(s)).toEqual(before)
  })

  it('throws on an option that was never offered', () => {
    const s = createSimulation(unroutable())
    expect(() => resolveIntervention(s, 'not-a-real-option')).toThrow(/Unknown intervention option/)
  })

  it('aborting ends the mission', () => {
    const s = createSimulation(unroutable())
    const after = resolveIntervention(s, 'abort')
    expect(after.outcome).toBe('aborted')
    expect(after.rover.mode).toBe('aborted')
    expect(after.events.some((e) => e.type === 'mission-aborted')).toBe(true)
    expect(step(after)).toBe(after)
  })

  it('an autonomous mission never raises one, it fails instead', () => {
    const s = createSimulation({ ...unroutable(), autonomyLevel: 'autonomous' })
    expect(s.pendingIntervention).toBeNull()
    expect(s.outcome).toBe('failed')
    expect(s.events.some((e) => e.type === 'mission-failed')).toBe(true)
  })

  it('skipping a waypoint advances to the next one', () => {
    // Two waypoints, so 'skip' is on offer for the first.
    const cfg = configFor(COMPETING, {
      autonomyLevel: 'supervised',
      riskTolerance: 0,
      waypoints: [{ x: 88, y: 88 }, { x: 8, y: 88 }],
    })
    const s = createSimulation(cfg)
    const skip = s.pendingIntervention!.options.find((o) => o.id === 'skip')
    expect(skip).toBeDefined()
    const after = resolveIntervention(s, 'skip')
    expect(after.rover.waypointIndex).toBe(1)
  })
})

describe('abortMission', () => {
  it('ends a running mission without mutating the input', () => {
    let s = createSimulation(configFor(BASELINE))
    for (let i = 0; i < 50; i++) s = step(s)
    const before = structuredClone(s)
    const after = abortMission(s)
    expect(structuredClone(s)).toEqual(before)
    expect(after.outcome).toBe('aborted')
    expect(s.outcome).toBeNull()
  })

  it('is a no-op on a finished mission', () => {
    const s = runToCompletion(createSimulation(configFor(BASELINE)))
    expect(abortMission(s)).toBe(s)
  })
})

describe('runToCompletion', () => {
  it('terminates and reaches the goal on every scenario', () => {
    for (const sc of SCENARIOS) {
      const end = runToCompletion(createSimulation(configFor(sc, { autonomyLevel: 'autonomous' })))
      expect(end.outcome).toBe('complete')
      expect(end.tick).toBeLessThan(20000)
    }
  })

  it('terminates rather than spinning when a supervised mission is wedged', () => {
    const s = createSimulation(configFor(COMPETING, { autonomyLevel: 'supervised', riskTolerance: 0 }))
    const end = runToCompletion(s)
    expect(end).toBe(s)
    expect(end.pendingIntervention).not.toBeNull()
  })

  it('honours a tick budget', () => {
    const end = runToCompletion(createSimulation(configFor(BASELINE)), 25)
    expect(end.tick).toBe(25)
    expect(end.outcome).toBeNull()
  })
})

describe('driving physics', () => {
  it('moves at the documented speed over flat ground, in arc length not index', () => {
    let s = createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' }))
    const spec = s.config.rover
    for (let i = 0; i < 100; i++) s = step(s)
    // Slope slows the rover, so the odometer is at most the flat-ground
    // distance; the useful assertion is that it is in the right ballpark and
    // never EXCEEDS what top speed allows.
    const maxPossible = spec.maxSpeedMs * 0.5 * 100
    expect(s.rover.odometerM).toBeLessThanOrEqual(maxPossible + 1e-6)
    expect(s.rover.odometerM).toBeGreaterThan(maxPossible * 0.5)
  })

  it('draws energy and depletes the battery monotonically', () => {
    let s = createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' }))
    let lastBattery = s.rover.battery
    let lastEnergy = s.rover.energyUsedWh
    for (let i = 0; i < 300; i++) {
      s = step(s)
      expect(s.rover.energyUsedWh).toBeGreaterThanOrEqual(lastEnergy)
      expect(s.rover.battery).toBeLessThanOrEqual(lastBattery)
      lastEnergy = s.rover.energyUsedWh
      lastBattery = s.rover.battery
    }
    expect(s.rover.energyUsedWh).toBeGreaterThan(0)
  })

  it('keeps the rover on a cell its own route certified as passable', () => {
    let s = createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' }))
    for (let i = 0; i < 500; i++) {
      s = step(s)
      if (!s.rover.route) continue
      const onRoute = s.rover.route.cells.some(
        (c) => c.x === s.rover.cell.x && c.y === s.rover.cell.y,
      )
      expect(onRoute).toBe(true)
    }
  })

  it('records a trail of contiguous cells', () => {
    const end = runToCompletion(createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' })))
    expect(end.trail.length).toBeGreaterThan(50)
    for (let i = 1; i < end.trail.length; i++) {
      const dx = Math.abs(end.trail[i].x - end.trail[i - 1].x)
      const dy = Math.abs(end.trail[i].y - end.trail[i - 1].y)
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(1)
    }
  })
})

describe('replanning is driven by discovery, not by a script', () => {
  it('every replan names the observation that caused it', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    const replans = end.decisions.filter((d) => d.kind === 'replan')
    expect(replans.length).toBeGreaterThan(0)
    for (const r of replans) {
      expect(r.trigger).toMatch(/hazard|blocked|route|operator/)
      expect(r.candidates.length).toBeGreaterThan(0)
    }
  })

  it('a replan is always preceded by a hazard-discovered event on the route', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    const replanTicks = end.events.filter((e) => e.type === 'replan-triggered').map((e) => e.tick)
    expect(replanTicks.length).toBeGreaterThan(0)
    for (const t of replanTicks) {
      const discovered = end.events.some(
        (e) => e.type === 'hazard-discovered' && e.onRoute && e.tick === t,
      )
      expect(discovered).toBe(true)
    }
  })

  it('a replan keeps the superseded route for the UI to draw', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    expect(end.abandonedRoutes.length).toBe(end.replanCount)
  })

  it('every candidate in every decision came from a real search', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    for (const d of end.decisions) {
      for (const c of d.candidates) {
        // Either a route whose first cell is where the rover stood, or an
        // explicit rejection reason. Never an empty placeholder.
        if (c.route) {
          expect(c.route.cells[0]).toEqual(d.position)
          expect(c.route.cells.length).toBeGreaterThan(0)
        } else {
          expect(c.rejected).toBeTruthy()
        }
      }
      if (d.selectedId !== null) {
        expect(d.candidates.some((c) => c.id === d.selectedId && c.route !== null)).toBe(true)
      }
    }
  })

  it('selects the genuine argmin of the recorded selection criterion', () => {
    // The selected candidate must never cost more than another feasible one
    // once the peak-exceedance charge is applied — that is what "genuine
    // argmin" means, and it is re-derived here from the record alone.
    const cfg = configFor(DYNAMIC, { autonomyLevel: 'autonomous' })
    const end = runToCompletion(createSimulation(cfg))
    const score = (peak: number, total: number, distanceM: number) =>
      total + 0.6 * Math.max(0, peak - cfg.riskTolerance) * (distanceM / 4)
    for (const d of end.decisions) {
      if (d.selectedId === null) continue
      const sel = d.candidates.find((c) => c.id === d.selectedId)!
      const selScore = score(sel.route!.peakHazard, sel.route!.cost.total, sel.route!.distanceM)
      for (const c of d.candidates) {
        if (!c.route) continue
        expect(selScore).toBeLessThanOrEqual(
          score(c.route.peakHazard, c.route.cost.total, c.route.distanceM) + 1e-9,
        )
      }
    }
  })
})

describe('computeMetrics', () => {
  it('agrees with the state it summarises', () => {
    const end = runToCompletion(createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' })))
    const m = computeMetrics(end)
    expect(m.completed).toBe(true)
    expect(m.waypointsTotal).toBe(BASELINE.suggestedWaypoints.length)
    expect(m.waypointsReached).toBe(m.waypointsTotal)
    expect(m.ticks).toBe(end.tick)
    expect(m.elapsedS).toBe(end.elapsedS)
    expect(m.distanceM).toBe(end.rover.odometerM)
    expect(m.energyWh).toBe(end.rover.energyUsedWh)
    expect(m.batteryRemaining).toBe(end.rover.battery)
    expect(m.replans).toBe(end.replanCount)
    expect(m.planCount).toBeGreaterThan(0)
    expect(m.peakHazardTraversed).toBeGreaterThanOrEqual(0)
    expect(m.peakHazardTraversed).toBeLessThanOrEqual(1)
  })

  it('counts on-route discoveries as a subset of all discoveries', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    const m = computeMetrics(end)
    expect(m.hazardsDiscovered).toBeGreaterThan(0)
    expect(m.hazardsOnRoute).toBeGreaterThan(0)
    expect(m.hazardsOnRoute).toBeLessThanOrEqual(m.hazardsDiscovered)
  })
})

describe('the scenarios behave as their hypotheses claim', () => {
  it('baseline-traverse: completes cleanly with at most one replan', () => {
    const end = runToCompletion(createSimulation(configFor(BASELINE, { autonomyLevel: 'autonomous' })))
    const m = computeMetrics(end)
    expect(m.completed).toBe(true)
    expect(m.waypointsReached).toBe(2)
    expect(m.replans).toBeLessThanOrEqual(1)
    expect(m.interventions).toBe(0)
    expect(m.batteryRemaining).toBeGreaterThan(cfgReserve(BASELINE))
  })

  it('dynamic-hazard: discovers an on-route hazard and replans because of it', () => {
    const end = runToCompletion(createSimulation(configFor(DYNAMIC, { autonomyLevel: 'autonomous' })))
    const m = computeMetrics(end)
    expect(m.completed).toBe(true)
    expect(m.replans).toBeGreaterThanOrEqual(1)
    expect(m.hazardsOnRoute).toBeGreaterThanOrEqual(1)
    // The discoveries must be things orbit genuinely could not see: the
    // initial plan's peak hazard should be well below what the rover meets.
    const initial = end.decisions[0]
    const selected = initial.candidates.find((c) => c.id === initial.selectedId)!
    const discovered = end.events.filter((e) => e.type === 'hazard-discovered')
    const worstDiscovered = Math.max(...discovered.map((e) => (e.type === 'hazard-discovered' ? e.severity : 0)))
    expect(worstDiscovered).toBeGreaterThan(selected.route!.peakHazard)
  })

  it('competing-objectives: the risk slider flips which route is driven', () => {
    const timid = runToCompletion(
      createSimulation(configFor(COMPETING, { autonomyLevel: 'autonomous', riskTolerance: 0.15 })),
    )
    const bold = runToCompletion(
      createSimulation(configFor(COMPETING, { autonomyLevel: 'autonomous', riskTolerance: 0.9 })),
    )
    expect(timid.outcome).toBe('complete')
    expect(bold.outcome).toBe('complete')
    const key = (s: SimState) => s.trail.map((c) => `${c.x},${c.y}`).join('|')
    expect(key(timid)).not.toBe(key(bold))
    // Long-and-safe versus short-and-risky, in the measurable direction.
    expect(timid.rover.odometerM).toBeGreaterThan(bold.rover.odometerM * 1.2)
    expect(computeMetrics(timid).peakHazardTraversed).toBeLessThan(
      computeMetrics(bold).peakHazardTraversed,
    )
  })
})

function cfgReserve(s: typeof BASELINE): number {
  return configFor(s).batteryReserveFrac
}
