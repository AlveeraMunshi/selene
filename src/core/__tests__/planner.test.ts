/**
 * The planner.
 *
 * The centrepiece is the ADMISSIBILITY PROOF: over twenty independently
 * generated terrains, A* and the uniform-cost oracle must agree on total cost
 * to within floating-point noise. Dijkstra cannot be wrong about optimality,
 * so any heuristic that is secretly inadmissible shows up here as a
 * disagreement — and nothing else in the suite would catch it, because a
 * slightly-too-strong heuristic still returns a plausible-looking route.
 */

import { describe, expect, it } from 'vitest'
import { octileDistance, plan, planUniformCost } from '../planner'
import { constraintsFor, passable, weightsFor } from '../cost'
import { createBelief, generateTerrain, idx } from '../terrain'
import { DEFAULT_ROVER, SCENARIOS } from '../scenarios'
import type { Belief, Cell, PlanRequest, TerrainParams } from '../types'
import { configFor, flatBelief, pathKey, setHazard, TEST_CONSTRAINTS, TEST_WEIGHTS } from './helpers'

const ROVER = DEFAULT_ROVER
const SIZE = 48

const VARIED: TerrainParams = {
  octaves: 4,
  relief: 45,
  craters: 9,
  orbitalVisibility: 0.6,
  hiddenHazardDensity: 0.15,
  rubbleFields: 7,
}

/** Twenty-plus independent planning problems on independent terrains. */
function randomProblems(count: number): { req: PlanRequest; belief: Belief }[] {
  const out: { req: PlanRequest; belief: Belief }[] = []
  const config = configFor(SCENARIOS[0], { riskTolerance: 0.55, energyPriority: 0.45 })
  const weights = weightsFor(config)
  const constraints = constraintsFor(config)

  for (let seed = 1; out.length < count && seed < 400; seed++) {
    const terrain = generateTerrain(VARIED, SIZE, SIZE, seed)
    const belief = createBelief(terrain)
    // Start and goal in opposite corners-ish, nudged to the nearest passable
    // cell so the problem is a real traverse rather than an instant failure.
    const start = nearestPassable(belief, { x: 4, y: 4 }, constraints.maxSlopeDeg, constraints.maxHazard)
    const goal = nearestPassable(
      belief,
      { x: SIZE - 5, y: SIZE - 5 },
      constraints.maxSlopeDeg,
      constraints.maxHazard,
    )
    if (!start || !goal) continue
    const probe = plan({ belief, start, goal, weights, constraints }, ROVER)
    if (!probe.ok) continue
    out.push({ req: { belief, start, goal, weights, constraints }, belief })
  }
  return out
}

function nearestPassable(b: Belief, near: Cell, maxSlope: number, maxHaz: number): Cell | null {
  let best: Cell | null = null
  let bestD = Infinity
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const i = idx(b.width, x, y)
      if (b.hazard[i] > maxHaz || b.slopeDeg[i] > maxSlope) continue
      const d = (x - near.x) ** 2 + (y - near.y) ** 2
      if (d < bestD) {
        bestD = d
        best = { x, y }
      }
    }
  }
  return best
}

describe('octileDistance', () => {
  it('counts a diagonal as √2 and an orthogonal as 1', () => {
    expect(octileDistance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBeCloseTo(3, 10)
    expect(octileDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBeCloseTo(3 * Math.SQRT2, 10)
    expect(octileDistance({ x: 0, y: 0 }, { x: 5, y: 2 })).toBeCloseTo(3 + 2 * Math.SQRT2, 10)
  })
})

describe('A* optimality against the uniform-cost oracle', () => {
  const problems = randomProblems(24)

  it('found enough problems to be worth asserting on', () => {
    expect(problems.length).toBeGreaterThanOrEqual(20)
  })

  it('returns exactly the uniform-cost optimum on every terrain', () => {
    for (const { req } of problems) {
      const a = plan(req, ROVER)
      const d = planUniformCost(req, ROVER)
      expect(a.ok).toBe(true)
      expect(d.ok).toBe(true)
      if (!a.ok || !d.ok) continue
      // The admissibility assertion. 1e-9 absolute on totals of order 10-50.
      expect(Math.abs(a.route.cost.total - d.route.cost.total)).toBeLessThan(1e-9)
    }
  })

  it('expands strictly fewer nodes than uniform cost, on average', () => {
    let aSum = 0
    let dSum = 0
    let aWins = 0
    for (const { req } of problems) {
      const a = plan(req, ROVER)
      const d = planUniformCost(req, ROVER)
      aSum += a.stats.nodesExpanded
      dSum += d.stats.nodesExpanded
      if (a.stats.nodesExpanded < d.stats.nodesExpanded) aWins++
    }
    expect(aSum).toBeLessThan(dSum)
    // Not merely better on average — better on the overwhelming majority, or
    // the heuristic is doing nothing useful on most maps.
    expect(aWins).toBeGreaterThan(problems.length * 0.8)
  })

  it('reports plausible stats', () => {
    const { req } = problems[0]
    const r = plan(req, ROVER)
    expect(r.stats.nodesExpanded).toBeGreaterThan(0)
    expect(r.stats.frontierPeak).toBeGreaterThan(0)
    expect(r.stats.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('never exceeds the optimum when the heuristic is weighted either', () => {
    // Weighted A* trades optimality for speed, so it may be WORSE — it must
    // never be better, which would mean the oracle was wrong.
    for (const { req } of problems.slice(0, 8)) {
      const optimal = planUniformCost(req, ROVER)
      const fast = plan({ ...req, heuristicWeight: 2.5 }, ROVER)
      expect(fast.ok).toBe(true)
      if (!fast.ok || !optimal.ok) continue
      expect(fast.route.cost.total).toBeGreaterThanOrEqual(optimal.route.cost.total - 1e-9)
      expect(fast.stats.nodesExpanded).toBeLessThanOrEqual(optimal.stats.nodesExpanded)
    }
  })
})

describe('route shape', () => {
  const problems = randomProblems(6)

  it('starts at the start, ends at the goal, and is 8-connected throughout', () => {
    for (const { req } of problems) {
      const r = plan(req, ROVER)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const cells = r.route.cells
      expect(cells[0]).toEqual(req.start)
      expect(cells[cells.length - 1]).toEqual(req.goal)
      for (let i = 1; i < cells.length; i++) {
        const dx = Math.abs(cells[i].x - cells[i - 1].x)
        const dy = Math.abs(cells[i].y - cells[i - 1].y)
        expect(Math.max(dx, dy)).toBe(1)
      }
    }
  })

  it('never visits an impassable cell', () => {
    for (const { req, belief } of problems) {
      const r = plan(req, ROVER)
      if (!r.ok) continue
      for (const c of r.route.cells) {
        expect(passable(belief, req.constraints, c.x, c.y)).toBe(true)
      }
    }
  })
})

describe('corner cutting is impossible', () => {
  it('refuses a diagonal squeezed between two impassable cells', () => {
    // 2x2: the only way from (0,0) to (1,1) is the diagonal, and both of the
    // orthogonal cells it passes between are blocked.
    const b = flatBelief(2, 2)
    setHazard(b, 1, 0, 1)
    setHazard(b, 0, 1, 1)
    const r = plan(
      {
        belief: b,
        start: { x: 0, y: 0 },
        goal: { x: 1, y: 1 },
        weights: TEST_WEIGHTS,
        constraints: TEST_CONSTRAINTS,
      },
      ROVER,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('goal-unreachable')
  })

  it('allows the same diagonal once one orthogonal neighbour opens up', () => {
    // The positive control: without it, the test above would also pass if the
    // planner were simply broken.
    const b = flatBelief(2, 2)
    setHazard(b, 1, 0, 1)
    const r = plan(
      {
        belief: b,
        start: { x: 0, y: 0 },
        goal: { x: 1, y: 1 },
        weights: TEST_WEIGHTS,
        constraints: TEST_CONSTRAINTS,
      },
      ROVER,
    )
    expect(r.ok).toBe(true)
  })

  it('holds as a property over generated terrain', () => {
    for (const { req, belief } of randomProblems(10)) {
      const r = plan(req, ROVER)
      if (!r.ok) continue
      const cells = r.route.cells
      for (let i = 1; i < cells.length; i++) {
        const a = cells[i - 1]
        const c = cells[i]
        if (a.x === c.x || a.y === c.y) continue
        expect(passable(belief, req.constraints, c.x, a.y)).toBe(true)
        expect(passable(belief, req.constraints, a.x, c.y)).toBe(true)
      }
    }
  })
})

describe('failure modes', () => {
  const base = {
    weights: TEST_WEIGHTS,
    constraints: TEST_CONSTRAINTS,
  }

  it('reports goal-impassable when the goal itself is over the ceiling', () => {
    const b = flatBelief(8, 8)
    setHazard(b, 7, 7, 0.9)
    const r = plan({ belief: b, start: { x: 0, y: 0 }, goal: { x: 7, y: 7 }, ...base }, ROVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('goal-impassable')
  })

  it('reports start-impassable when the rover is on bad ground', () => {
    const b = flatBelief(8, 8)
    setHazard(b, 0, 0, 0.9)
    const r = plan({ belief: b, start: { x: 0, y: 0 }, goal: { x: 7, y: 7 }, ...base }, ROVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('start-impassable')
  })

  it('reports goal-unreachable when the goal is walled off', () => {
    const b = flatBelief(8, 8)
    for (let y = 0; y < 8; y++) setHazard(b, 4, y, 1)
    const r = plan({ belief: b, start: { x: 0, y: 0 }, goal: { x: 7, y: 7 }, ...base }, ROVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('goal-unreachable')
  })

  it('reports out-of-bounds goals as impassable rather than throwing', () => {
    const b = flatBelief(8, 8)
    const r = plan({ belief: b, start: { x: 0, y: 0 }, goal: { x: 99, y: 0 }, ...base }, ROVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('goal-impassable')
  })

  it('returns a one-cell route when start and goal coincide', () => {
    const b = flatBelief(8, 8)
    const r = plan({ belief: b, start: { x: 3, y: 3 }, goal: { x: 3, y: 3 }, ...base }, ROVER)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.route.cells).toEqual([{ x: 3, y: 3 }])
      expect(r.route.distanceM).toBe(0)
    }
  })
})

describe('preference sensitivity', () => {
  it('a different risk tolerance produces a different route', () => {
    // The competing-objectives scenario exists for exactly this; its seed was
    // chosen by sweeping for the widest gap between the two postures.
    const s = SCENARIOS.find((x) => x.id === 'competing-objectives')!
    const terrain = generateTerrain(s.terrain, s.width, s.height, s.seed)
    const belief = createBelief(terrain)
    const goal = s.suggestedWaypoints[s.suggestedWaypoints.length - 1]

    const timidCfg = configFor(s, { riskTolerance: 0.15 })
    const boldCfg = configFor(s, { riskTolerance: 0.9 })
    const timid = plan(
      {
        belief,
        start: s.start,
        goal,
        weights: weightsFor(timidCfg),
        constraints: constraintsFor(timidCfg),
      },
      ROVER,
    )
    const bold = plan(
      {
        belief,
        start: s.start,
        goal,
        weights: weightsFor(boldCfg),
        constraints: constraintsFor(boldCfg),
      },
      ROVER,
    )
    expect(timid.ok).toBe(true)
    expect(bold.ok).toBe(true)
    if (!timid.ok || !bold.ok) return

    expect(pathKey(timid.route.cells)).not.toBe(pathKey(bold.route.cells))
    // And the difference is in the expected DIRECTION and is substantial —
    // a one-cell wiggle would technically pass the inequality above.
    expect(timid.route.distanceM).toBeGreaterThan(bold.route.distanceM * 1.2)
    expect(timid.route.peakHazard).toBeLessThan(bold.route.peakHazard - 0.2)
  })

  it('a different energy priority can also change the route', () => {
    const s = SCENARIOS.find((x) => x.id === 'baseline-traverse')!
    const terrain = generateTerrain(s.terrain, s.width, s.height, s.seed)
    const belief = createBelief(terrain)
    const goal = s.suggestedWaypoints[s.suggestedWaypoints.length - 1]
    const routes = [0, 1].map((e) => {
      const c = configFor(s, { energyPriority: e })
      const r = plan(
        { belief, start: s.start, goal, weights: weightsFor(c), constraints: constraintsFor(c) },
        ROVER,
      )
      return r.ok ? r.route : null
    })
    expect(routes[0]).not.toBeNull()
    expect(routes[1]).not.toBeNull()
    expect(pathKey(routes[0]!.cells)).not.toBe(pathKey(routes[1]!.cells))
    // The energy-thrifty route should actually use less energy.
    expect(routes[1]!.energyWh).toBeLessThan(routes[0]!.energyWh)
  })
})

describe('determinism', () => {
  it('two identical plan calls return identical routes', () => {
    const { req } = randomProblems(1)[0]
    const a = plan(req, ROVER)
    const b = plan(req, ROVER)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(pathKey(a.route.cells)).toBe(pathKey(b.route.cells))
      expect(a.route.cost.total).toBe(b.route.cost.total)
      expect(a.stats.nodesExpanded).toBe(b.stats.nodesExpanded)
    }
  })
})
