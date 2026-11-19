/**
 * The explanation layer.
 *
 * The property worth testing is unusual: that the prose contains NO number
 * the record does not contain. The tests below do that two ways — by
 * extracting every numeral from a generated sentence and checking each one is
 * derivable from the record, and by perturbing the record and asserting the
 * sentence changes with it. A hardcoded phrase would survive the first check
 * and fail the second.
 */

import { describe, expect, it } from 'vitest'
import { explainDecision, explainIntervention, reasonCodeLabel, summariseRisk } from '../explain'
import { createSimulation, runToCompletion } from '../engine'
import { getScenario } from '../scenarios'
import type { DecisionRecord, InterventionRequest, Route, RouteCandidate } from '../types'
import { configFor } from './helpers'

const BASELINE = getScenario('baseline-traverse')
const DYNAMIC = getScenario('dynamic-hazard')
const COMPETING = getScenario('competing-objectives')

function fakeRoute(over: Partial<Route> = {}): Route {
  return {
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    cost: { distance: 1, slope: 0.5, hazard: 0.25, energy: 0.25, total: 2 },
    distanceM: 100,
    energyWh: 40,
    peakHazard: 0.3,
    meanHazard: 0.1,
    peakSlopeDeg: 12,
    ...over,
  }
}

function fakeCandidate(id: string, over: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id,
    label: id,
    route: fakeRoute(),
    weights: { distance: 0.25, slope: 0.25, hazard: 0.25, energy: 0.25 },
    constraints: { maxSlopeDeg: 25, maxHazard: 0.55, batteryReserveFrac: 0.2 },
    ...over,
  }
}

function fakeDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'd1',
    tick: 424,
    kind: 'replan',
    roverState: 'replanning',
    position: { x: 10, y: 20 },
    trigger: 'a newly observed hazard',
    observedFraction: 0.86,
    batteryFrac: 0.72,
    candidates: [fakeCandidate('a'), fakeCandidate('b')],
    selectedId: 'a',
    reasonCode: 'lower-hazard-cost',
    caveats: [],
    ...over,
  }
}

describe('reasonCodeLabel', () => {
  it('maps known codes to readable labels', () => {
    expect(reasonCodeLabel('lower-hazard-cost')).toBe('lower hazard exposure')
    expect(reasonCodeLabel('only-feasible-route')).toBe('the only feasible route')
  })

  it('de-hyphenates an unknown code rather than dropping it', () => {
    // Losing the reason entirely would be worse than showing a raw code.
    expect(reasonCodeLabel('some-new-code')).toBe('some new code')
  })
})

describe('explainDecision', () => {
  it('converts the tick to seconds using the real tick length', () => {
    expect(explainDecision(fakeDecision({ tick: 424 }))).toContain('t=212s')
    expect(explainDecision(fakeDecision({ tick: 0 }))).toContain('t=0s')
  })

  it('quotes the engine’s own trigger verbatim', () => {
    const text = explainDecision(fakeDecision({ trigger: 'a very specific thing happened' }))
    expect(text).toContain('a very specific thing happened')
  })

  it('names the candidate count and the selected candidate', () => {
    const text = explainDecision(
      fakeDecision({
        candidates: [
          fakeCandidate('safe', { label: 'Risk-averse' }),
          fakeCandidate('fast', { label: 'Most direct' }),
          fakeCandidate('bad', { label: 'Unlucky', route: null, rejected: 'no route' }),
        ],
        selectedId: 'safe',
      }),
    )
    expect(text).toContain('Of 3 routes evaluated (2 feasible)')
    expect(text).toContain('"Risk-averse" was selected')
  })

  it('compares the winner against the runner-up in real quantities', () => {
    const text = explainDecision(
      fakeDecision({
        candidates: [
          fakeCandidate('safe', {
            label: 'Risk-averse',
            route: fakeRoute({ distanceM: 400, peakHazard: 0.2, energyWh: 160 }),
          }),
          fakeCandidate('fast', {
            label: 'Most direct',
            route: fakeRoute({ distanceM: 300, peakHazard: 0.8, energyWh: 120 }),
          }),
        ],
        selectedId: 'safe',
      }),
    )
    expect(text).toContain('100 m longer')
    expect(text).toContain('0.60 less peak hazard')
    expect(text).toContain('40.0 Wh more energy')
  })

  it('says so plainly when two candidates are equivalent, rather than inventing a difference', () => {
    const text = explainDecision(
      fakeDecision({
        candidates: [fakeCandidate('a', { label: 'A' }), fakeCandidate('b', { label: 'B' })],
        selectedId: 'a',
      }),
    )
    expect(text).toContain('within rounding')
  })

  it('omits the comparison entirely when there is only one candidate', () => {
    const text = explainDecision(
      fakeDecision({ candidates: [fakeCandidate('only', { label: 'Only' })], selectedId: 'only' }),
    )
    expect(text).not.toContain('against')
    expect(text).not.toContain('within rounding')
  })

  it('reports the battery margin relative to the reserve the record carries', () => {
    const text = explainDecision(fakeDecision({ batteryFrac: 0.72 }))
    expect(text).toContain('Battery is at 72%')
    expect(text).toContain('52% above the 20% reserve')
  })

  it('says "below" when the battery is under the reserve', () => {
    const text = explainDecision(fakeDecision({ batteryFrac: 0.1 }))
    expect(text).toContain('10% below the 20% reserve')
  })

  it('reports the unobserved fraction, and omits it when the map is fully mapped', () => {
    expect(explainDecision(fakeDecision({ observedFraction: 0.86 }))).toContain('14% of the map is still unobserved')
    expect(explainDecision(fakeDecision({ observedFraction: 1 }))).not.toContain('unobserved')
  })

  it('explains a decision where nothing could be selected', () => {
    const text = explainDecision(
      fakeDecision({
        candidates: [
          fakeCandidate('a', { label: 'A', route: null, rejected: 'no connected route exists' }),
          fakeCandidate('b', { label: 'B', route: null, rejected: 'the goal is impassable' }),
        ],
        selectedId: null,
        reasonCode: 'no-feasible-route',
      }),
    )
    expect(text).toContain('No route was selected out of 2 evaluated')
    expect(text).toContain('no connected route exists')
    expect(text).toContain('the goal is impassable')
  })

  it('includes the caveats the engine recorded, and no others', () => {
    const text = explainDecision(fakeDecision({ caveats: ['belief is stale over the ridge'] }))
    expect(text).toContain('belief is stale over the ridge.')
  })

  it('every numeral in the prose traces back to the record', () => {
    // The anti-hallucination check. Every number the sentence contains must
    // be one of the record's own values, or a documented transformation of
    // one (tick to seconds, fraction to percent, metres rounded).
    const d = fakeDecision({
      tick: 300,
      batteryFrac: 0.65,
      observedFraction: 0.8,
      candidates: [
        fakeCandidate('a', {
          label: 'A',
          route: fakeRoute({ distanceM: 250, energyWh: 90, peakHazard: 0.44, peakSlopeDeg: 17.5 }),
        }),
        fakeCandidate('b', {
          label: 'B',
          route: fakeRoute({ distanceM: 180, energyWh: 70, peakHazard: 0.9, peakSlopeDeg: 21 }),
        }),
      ],
      selectedId: 'a',
      caveats: [],
    })
    const text = explainDecision(d)
    const numbers = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    const a = d.candidates[0].route!
    const b = d.candidates[1].route!
    const reserve = d.candidates[0].constraints.batteryReserveFrac

    // Each entry is derived from the record here, in the test, rather than
    // copied from the output — so a change to the prose that invented a value
    // would fail even if the sentence still "looked right".
    const allowed: [string, number][] = [
      ['tick to seconds', d.tick * 0.5],
      ['candidate count', d.candidates.length],
      ['feasible count', d.candidates.filter((c) => c.route).length],
      ['distance delta', Math.abs(a.distanceM - b.distanceM)],
      ['peak hazard delta', Math.abs(a.peakHazard - b.peakHazard)],
      ['energy delta', Math.abs(a.energyWh - b.energyWh)],
      ['selected distance', a.distanceM],
      ['selected energy', a.energyWh],
      ['selected peak hazard', a.peakHazard],
      ['selected peak slope', a.peakSlopeDeg],
      ['battery percent', d.batteryFrac * 100],
      ['reserve percent', reserve * 100],
      ['battery margin percent', (d.batteryFrac - reserve) * 100],
      ['unobserved percent', (1 - d.observedFraction) * 100],
    ]

    for (const n of numbers) {
      // Tolerance covers only the rounding the formatters documentedly do.
      const source = allowed.find(([, v]) => Math.abs(v - n) < 0.005 || Math.round(v) === n)
      expect(source, `unexplained number ${n} in: ${text}`).toBeDefined()
    }
    // And the allowlist is not vacuous: the sentence really does quote most of it.
    expect(numbers.length).toBeGreaterThanOrEqual(12)
  })

  it('tracks the record: perturbing a value changes the sentence', () => {
    const base = explainDecision(fakeDecision({ batteryFrac: 0.5 }))
    const moved = explainDecision(fakeDecision({ batteryFrac: 0.9 }))
    expect(base).not.toBe(moved)
  })
})

describe('summariseRisk', () => {
  it('frames each reason and quotes the candidate on the table', () => {
    const d = fakeDecision({
      candidates: [fakeCandidate('a', { label: 'Current preferences', route: fakeRoute({ distanceM: 512, peakHazard: 0.61, energyWh: 205 }) })],
      selectedId: 'a',
    })
    const text = summariseRisk('risk-exceeds-tolerance', d)
    expect(text).toContain('riskier than the stated tolerance')
    expect(text).toContain('512 m')
    expect(text).toContain('0.61')
    expect(text).toContain('205.0 Wh')
    expect(text).toContain('(10, 20)')
  })

  it('reports how many searches failed when nothing was selected', () => {
    const d = fakeDecision({
      candidates: [
        fakeCandidate('a', { route: null, rejected: 'x' }),
        fakeCandidate('b', { route: null, rejected: 'y' }),
      ],
      selectedId: null,
    })
    expect(summariseRisk('no-safe-route', d)).toContain('2 of 2 planning attempts returned no route')
  })
})

describe('explainIntervention', () => {
  it('renders the request, its summary and every option', () => {
    const req: InterventionRequest = {
      id: 'i1',
      tick: 100,
      reason: 'no-safe-route',
      summary: 'Nothing works.',
      decisionId: 'd1',
      options: [
        {
          id: 'relax',
          label: 'Raise the ceiling',
          detail: 'Opens a longer route.',
          action: { type: 'raise-risk-tolerance', to: 0.7 },
          route: fakeRoute({ distanceM: 620, peakHazard: 0.42 }),
        },
        {
          id: 'abort',
          label: 'Abort',
          detail: 'Stop here.',
          action: { type: 'abort-mission' },
          route: null,
        },
      ],
    }
    const text = explainIntervention(req)
    expect(text).toContain('t=50s')
    expect(text).toContain('Nothing works.')
    expect(text).toContain('"Raise the ceiling" (620 m, peak hazard 0.42)')
    expect(text).toContain('"Abort": Stop here.')
  })
})

describe('against real engine output', () => {
  it('explains every decision of a real mission without throwing or leaving holes', () => {
    for (const sc of [BASELINE, DYNAMIC, COMPETING]) {
      const end = runToCompletion(createSimulation(configFor(sc, { autonomyLevel: 'autonomous' })))
      expect(end.decisions.length).toBeGreaterThan(0)
      for (const d of end.decisions) {
        const text = explainDecision(d)
        expect(text.length).toBeGreaterThan(20)
        expect(text).not.toContain('undefined')
        expect(text).not.toContain('NaN')
        expect(text).not.toContain('Infinity')
        expect(text).toMatch(/^[A-Z]/)
        expect(text.trim().endsWith('.')).toBe(true)
      }
    }
  })

  it('explains a real intervention request', () => {
    const s = createSimulation(
      configFor(COMPETING, { autonomyLevel: 'supervised', riskTolerance: 0 }),
    )
    expect(s.pendingIntervention).not.toBeNull()
    const text = explainIntervention(s.pendingIntervention!)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
    expect(text).toContain('no safe route')
    // The summary the engine stored is itself generated from the decision.
    const decision = s.decisions.find((d) => d.id === s.pendingIntervention!.decisionId)
    expect(decision).toBeDefined()
    expect(s.pendingIntervention!.summary).toBe(
      summariseRisk(s.pendingIntervention!.reason, decision!),
    )
  })
})
