/**
 * Route planning: A* over the rover's BELIEF, plus a uniform-cost oracle.
 *
 * WHY A* AND NOT SOMETHING CLEVERER. The grid is at most ~16k cells and the
 * cost function is non-negative and edge-local, which is precisely the regime
 * A* was designed for. Anything sampling-based (RRT, PRM) would give up
 * optimality for no speed benefit at this size, and optimality is what makes
 * the explanation layer honest: "this route was chosen" only means something
 * if no cheaper route existed.
 *
 * WHY THE ORACLE EXISTS. `planUniformCost` is the same search with h = 0 —
 * Dijkstra. With `heuristicWeight = 1` the heuristic is admissible and
 * consistent (see `minCostPerCellStep`), so A* must return exactly the same
 * total cost. That equality is asserted over twenty random terrains in the
 * tests, and it is the only real proof that the heuristic is not quietly
 * making the planner suboptimal.
 */

import type { Cell, PlanRequest, PlanResult, PlannerStats, RoverSpec } from './types'
import { minCostPerCellStep, passable, routeStats, stepCost } from './cost'
import { idx, inBounds } from './terrain'
import { DEFAULT_ROVER } from './scenarios'

const SQRT2 = Math.SQRT2

/** 8-connected neighbourhood, orthogonals first so ties favour straight lines. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

// ---------------------------------------------------------------------------
// Binary min-heap
// ---------------------------------------------------------------------------

/**
 * A hand-rolled binary heap over two parallel arrays.
 *
 * Sorting an array on every pop is O(n log n) per expansion and turns a 16k
 * cell search into something visibly slow in a browser; a heap makes push and
 * pop O(log n). Two parallel arrays rather than an array of objects so the
 * hot loop does no allocation at all.
 *
 * Decrease-key is handled by LAZY DELETION — a node can appear in the heap
 * several times and stale entries are skipped on pop via the closed set. That
 * costs a little memory and avoids maintaining an index-to-heap-position map,
 * which is where sift bugs live.
 */
interface Heap {
  node: number[]
  f: number[]
  size: number
}

function heapCreate(): Heap {
  return { node: [], f: [], size: 0 }
}

function heapPush(h: Heap, node: number, f: number): void {
  let i = h.size++
  h.node[i] = node
  h.f[i] = f
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (h.f[parent] <= h.f[i]) break
    swap(h, i, parent)
    i = parent
  }
}

/** Pops the lowest-f node. Caller must check `size` first. */
function heapPop(h: Heap): number {
  const top = h.node[0]
  const last = --h.size
  if (last > 0) {
    h.node[0] = h.node[last]
    h.f[0] = h.f[last]
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let smallest = i
      if (l < last && h.f[l] < h.f[smallest]) smallest = l
      if (r < last && h.f[r] < h.f[smallest]) smallest = r
      if (smallest === i) break
      swap(h, i, smallest)
      i = smallest
    }
  }
  return top
}

function swap(h: Heap, a: number, b: number): void {
  const n = h.node[a]
  h.node[a] = h.node[b]
  h.node[b] = n
  const f = h.f[a]
  h.f[a] = h.f[b]
  h.f[b] = f
}

// ---------------------------------------------------------------------------
// Heuristic
// ---------------------------------------------------------------------------

/**
 * Octile distance in cell-lengths: the shortest possible path length on an
 * 8-connected grid ignoring every obstacle.
 *
 * (dx + dy) counts every move as orthogonal; each diagonal move then saves
 * (2 - √2) because it does the work of two orthogonals for √2 of length.
 */
export function octileDistance(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * ROVER SPEC AND THE FROZEN CONTRACT.
 *
 * `PlanRequest` carries no `RoverSpec`, but the energy term of the cost model
 * needs one (see docs/CONTRACT_ISSUES.md). Rather than edit the frozen types,
 * the rover is an OPTIONAL SECOND ARGUMENT: `plan(req)` still type-checks and
 * still works, falling back to `DEFAULT_ROVER`, while the engine passes the
 * mission's actual rover so the energy term reflects the real vehicle.
 */
export function plan(req: PlanRequest, rover: RoverSpec = DEFAULT_ROVER): PlanResult {
  return search(req, rover, true)
}

/**
 * Dijkstra: the same search with the heuristic forced to zero.
 *
 * EXISTS SOLELY AS A TEST ORACLE. Nothing in the engine calls it — it is
 * strictly slower than A* and returns the same answer. Its value is that it
 * cannot be wrong about optimality, so it can catch an A* that is.
 */
export function planUniformCost(req: PlanRequest, rover: RoverSpec = DEFAULT_ROVER): PlanResult {
  return search(req, rover, false)
}

function search(req: PlanRequest, rover: RoverSpec, useHeuristic: boolean): PlanResult {
  // WALL CLOCK: this is the one permitted use of a real clock inside core/.
  // It is a MEASUREMENT taken at the boundary of the search and it is never
  // read by the search itself — no branch, no budget, no timeout depends on
  // it — so it cannot affect which route comes back. Determinism is preserved
  // in everything except `PlannerStats.elapsedMs`, which the determinism
  // tests therefore exclude from comparison.
  const startedAt = performance.now()

  const { belief, start, goal, weights, constraints } = req
  const w = belief.width
  const h = belief.height
  const n = w * h
  const stats: PlannerStats = { nodesExpanded: 0, frontierPeak: 0, elapsedMs: 0 }

  // Single exit point, so elapsedMs is stamped exactly once no matter which
  // of the six ways out of this function is taken.
  const finish = (result: PlanResult): PlanResult => {
    stats.elapsedMs = performance.now() - startedAt
    return result
  }

  if (!inBounds(w, h, start.x, start.y) || !passable(belief, constraints, start.x, start.y)) {
    return finish({ ok: false, reason: 'start-impassable', stats })
  }
  if (!inBounds(w, h, goal.x, goal.y) || !passable(belief, constraints, goal.x, goal.y)) {
    return finish({ ok: false, reason: 'goal-impassable', stats })
  }

  const startIdx = idx(w, start.x, start.y)
  const goalIdx = idx(w, goal.x, goal.y)

  if (startIdx === goalIdx) {
    const route = routeStats(belief, [{ ...start }], weights, constraints, rover)
    return finish({ ok: true, route, stats })
  }

  // Heuristic scale. Passing the real constraints tightens the bound (the
  // energy normaliser shrinks with maxSlopeDeg) while keeping it admissible.
  const hScale = useHeuristic
    ? minCostPerCellStep(weights, rover, constraints) * (req.heuristicWeight ?? 1)
    : 0

  const g = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)

  g[startIdx] = 0
  const open = heapCreate()
  heapPush(open, startIdx, hScale * octileDistance(start, goal))

  // Every cell is expanded at most once (closed-set guard), so exceeding the
  // cell count means the search is in a state that should be impossible.
  // Defensive rather than expected; `search-exhausted` reports it honestly
  // instead of silently looping.
  const maxExpansions = n + 1

  const from: Cell = { x: 0, y: 0 }
  const to: Cell = { x: 0, y: 0 }

  while (open.size > 0) {
    if (open.size > stats.frontierPeak) stats.frontierPeak = open.size
    const cur = heapPop(open)
    if (closed[cur] !== 0) continue // stale lazy-deletion entry
    closed[cur] = 1
    stats.nodesExpanded++

    if (cur === goalIdx) {
      const cells = reconstruct(cameFrom, w, startIdx, goalIdx)
      const route = routeStats(belief, cells, weights, constraints, rover)
      return finish({ ok: true, route, stats })
    }

    if (stats.nodesExpanded > maxExpansions) {
      return finish({ ok: false, reason: 'search-exhausted', stats })
    }

    const cx = cur % w
    const cy = (cur - cx) / w
    from.x = cx
    from.y = cy

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inBounds(w, h, nx, ny)) continue
      const nIdx = idx(w, nx, ny)
      if (closed[nIdx] !== 0) continue

      // NO CORNER CUTTING. A diagonal move is only legal when both of the
      // orthogonal cells it squeezes between are themselves passable —
      // otherwise the rover would slip through the corner contact point
      // between two boulder fields, which is geometrically impossible for a
      // vehicle with width.
      if (dx !== 0 && dy !== 0) {
        if (!passable(belief, constraints, cx + dx, cy)) continue
        if (!passable(belief, constraints, cx, cy + dy)) continue
      }

      to.x = nx
      to.y = ny
      const c = stepCost(belief, from, to, weights, constraints, rover)
      if (c === null) continue

      const tentative = g[cur] + c.total
      if (tentative < g[nIdx]) {
        g[nIdx] = tentative
        cameFrom[nIdx] = cur
        const hv = useHeuristic ? hScale * octileDistance(to, goal) : 0
        heapPush(open, nIdx, tentative + hv)
      }
    }
  }

  return finish({ ok: false, reason: 'goal-unreachable', stats })
}

/** Walk `cameFrom` back from the goal and reverse, giving start..goal inclusive. */
function reconstruct(cameFrom: Int32Array, w: number, startIdx: number, goalIdx: number): Cell[] {
  const out: Cell[] = []
  let cur = goalIdx
  while (cur !== -1) {
    const x = cur % w
    out.push({ x, y: (cur - x) / w })
    if (cur === startIdx) break
    cur = cameFrom[cur]
  }
  out.reverse()
  return out
}
