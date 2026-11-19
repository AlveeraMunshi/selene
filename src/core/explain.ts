/**
 * Natural-language explanation, generated FROM the decision record.
 *
 * THE RULE THIS MODULE ENFORCES: no sentence here may assert anything that is
 * not a number or a string already present in the `DecisionRecord`. The
 * explanation is a rendering of the arithmetic, not a commentary written
 * alongside it — which is why the engine never writes prose and this module
 * never does arithmetic the engine did not already do.
 *
 * The practical consequence is that clauses are OMITTED rather than guessed.
 * If a decision has one candidate there is no comparison clause; if no
 * candidate was selected there is no selection clause. A missing clause is
 * always better than an invented number, because a user cannot tell an
 * invented number from a measured one.
 */

import type { DecisionRecord, InterventionReason, InterventionRequest, RouteCandidate } from './types'
import { TICK_SECONDS } from './types'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function seconds(tick: number): string {
  return `${Math.round(tick * TICK_SECONDS)}s`
}

function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`
}

function metres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

function num(v: number, dp = 2): string {
  return v.toFixed(dp)
}

/** Below this, a difference between two candidates is rounding, not a reason. */
const MATERIAL_COST = 0.05
const MATERIAL_HAZARD = 0.02
const MATERIAL_METRES = 4

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<string, string> = {
  'lower-total-cost': 'lowest total cost',
  'lower-hazard-cost': 'lower hazard exposure',
  'lower-energy-cost': 'lower energy draw',
  'shorter-route': 'shorter route',
  'only-feasible-route': 'the only feasible route',
  'no-feasible-route': 'no feasible route',
  'operator-choice': 'operator choice',
  'goal-reached': 'goal reached',
  'mission-complete': 'all waypoints reached',
  'mission-aborted': 'mission aborted',
}

/**
 * Human label for a machine reason code.
 *
 * Unknown codes are de-hyphenated rather than dropped: a code this module has
 * not been taught about should still surface in the UI, because the
 * alternative is an explanation that silently loses the reason.
 */
export function reasonCodeLabel(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/-/g, ' ')
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const KIND_VERBS: Record<DecisionRecord['kind'], string> = {
  'initial-plan': 'Planned',
  replan: 'Replanned',
  'waypoint-reached': 'Reached a waypoint',
  'intervention-required': 'Paused for approval',
  'intervention-resolved': 'Resumed after operator input',
  abort: 'Aborted',
  'mission-complete': 'Completed',
}

function selected(d: DecisionRecord): RouteCandidate | null {
  if (d.selectedId === null) return null
  return d.candidates.find((c) => c.id === d.selectedId) ?? null
}

/** The cheapest candidate that was NOT selected, which is what the selected
 *  one actually beat. Comparing against an arbitrary other candidate would
 *  overstate the margin. */
function runnerUp(d: DecisionRecord): RouteCandidate | null {
  let best: RouteCandidate | null = null
  for (const c of d.candidates) {
    if (c.id === d.selectedId || c.route === null) continue
    if (best === null || c.route.cost.total < best.route!.cost.total) best = c
  }
  return best
}

/**
 * Describe how the chosen route differs from the best rejected one, using only
 * quantities both routes carry. Returns the clauses that are materially
 * different; an empty list means the two routes were effectively equivalent
 * and the explanation says so instead of inventing a distinction.
 */
function comparisonClauses(sel: RouteCandidate, other: RouteCandidate): string[] {
  const a = sel.route
  const b = other.route
  if (!a || !b) return []
  const out: string[] = []

  const dDist = a.distanceM - b.distanceM
  if (Math.abs(dDist) >= MATERIAL_METRES) {
    out.push(`${metres(Math.abs(dDist))} ${dDist > 0 ? 'longer' : 'shorter'}`)
  }

  const dPeak = a.peakHazard - b.peakHazard
  if (Math.abs(dPeak) >= MATERIAL_HAZARD) {
    out.push(`${num(Math.abs(dPeak))} ${dPeak > 0 ? 'more' : 'less'} peak hazard`)
  }

  const dMean = a.meanHazard - b.meanHazard
  if (Math.abs(dMean) >= MATERIAL_HAZARD) {
    out.push(`${num(Math.abs(dMean))} ${dMean > 0 ? 'more' : 'less'} mean hazard`)
  }

  const dEnergy = a.energyWh - b.energyWh
  if (Math.abs(dEnergy) >= 1) {
    out.push(`${num(Math.abs(dEnergy), 1)} Wh ${dEnergy > 0 ? 'more' : 'less'} energy`)
  }

  const dCost = a.cost.total - b.cost.total
  if (Math.abs(dCost) >= MATERIAL_COST) {
    out.push(`${num(Math.abs(dCost))} ${dCost > 0 ? 'above' : 'below'} it on total cost`)
  }

  return out
}

/**
 * Render a decision as prose.
 *
 * Structure: what happened and when, what was chosen out of what, how it
 * differs from the runner-up, what state the rover was in, and finally the
 * caveats the engine itself recorded.
 */
export function explainDecision(d: DecisionRecord): string {
  const parts: string[] = []
  const verb = KIND_VERBS[d.kind] ?? 'Decided'

  parts.push(`${verb} at t=${seconds(d.tick)}: ${d.trigger}.`)

  const sel = selected(d)
  const planned = d.candidates.filter((c) => c.route !== null).length

  if (sel && sel.route) {
    const why = reasonCodeLabel(d.reasonCode)
    const head =
      d.candidates.length > 1
        ? `Of ${d.candidates.length} routes evaluated (${planned} feasible), "${sel.label}" was selected on ${why}`
        : `"${sel.label}" was selected on ${why}`

    const other = runnerUp(d)
    const clauses = other ? comparisonClauses(sel, other) : []
    if (other && clauses.length > 0) {
      parts.push(`${head} — against "${other.label}" it is ${joinList(clauses)}.`)
    } else if (other) {
      parts.push(`${head}; it was within rounding of "${other.label}" on every measure.`)
    } else {
      parts.push(`${head}.`)
    }

    parts.push(
      `The route runs ${metres(sel.route.distanceM)} for ${num(sel.route.energyWh, 1)} Wh, ` +
        `peaking at hazard ${num(sel.route.peakHazard)} and ${num(sel.route.peakSlopeDeg, 1)}° of slope.`,
    )

    // Battery margin is only quoted when the record carries the reserve it is
    // a margin ABOVE — otherwise the percentage would be meaningless.
    const reserve = sel.constraints.batteryReserveFrac
    const margin = d.batteryFrac - reserve
    if (Number.isFinite(reserve)) {
      parts.push(
        `Battery is at ${pct(d.batteryFrac)}, ${pct(Math.abs(margin))} ` +
          `${margin >= 0 ? 'above' : 'below'} the ${pct(reserve)} reserve.`,
      )
    }
  } else if (d.candidates.length > 0) {
    const reasons = d.candidates
      .filter((c) => c.rejected)
      .map((c) => `"${c.label}" (${c.rejected})`)
    parts.push(
      `No route was selected out of ${d.candidates.length} evaluated` +
        (reasons.length ? `: ${joinList(reasons)}.` : '.'),
    )
  }

  const unobserved = 1 - d.observedFraction
  if (unobserved > 0.005) {
    parts.push(`${pct(unobserved)} of the map is still unobserved.`)
  }

  for (const c of d.caveats) parts.push(c.endsWith('.') ? c : `${c}.`)

  return parts.join(' ')
}

function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

const REASON_FRAMING: Record<InterventionReason, string> = {
  'no-safe-route': 'No route to the next waypoint satisfies the current constraints',
  'risk-exceeds-tolerance': 'The best available route is legal but riskier than the stated tolerance',
  'battery-reserve-breach': 'Driving this route is projected to breach the battery reserve',
  'repeated-replanning': 'The planner has replanned repeatedly for the same waypoint',
}

/**
 * One-paragraph framing of why a human is being asked, built from the decision
 * that triggered it. Called by the engine to populate
 * `InterventionRequest.summary`, so that field is itself derived rather than
 * authored — the same discipline as `explainDecision`.
 */
export function summariseRisk(reason: InterventionReason, d: DecisionRecord): string {
  const parts: string[] = [`${REASON_FRAMING[reason]}.`]
  const sel = selected(d)
  if (sel?.route) {
    parts.push(
      `The candidate on the table, "${sel.label}", runs ${metres(sel.route.distanceM)} ` +
        `at a peak hazard of ${num(sel.route.peakHazard)} and costs ${num(sel.route.energyWh, 1)} Wh.`,
    )
  } else {
    const failed = d.candidates.filter((c) => c.route === null).length
    if (failed > 0) parts.push(`${failed} of ${d.candidates.length} planning attempts returned no route.`)
  }
  parts.push(`Rover at (${d.position.x}, ${d.position.y}) with ${pct(d.batteryFrac)} battery.`)
  return parts.join(' ')
}

/** Render a pending request and its options for a human reader. */
export function explainIntervention(r: InterventionRequest): string {
  const parts: string[] = [`t=${seconds(r.tick)} — ${reasonCodeLabel(r.reason)}.`, r.summary]
  if (r.options.length > 0) {
    const opts = r.options.map((o) => {
      const cost = o.route ? ` (${metres(o.route.distanceM)}, peak hazard ${num(o.route.peakHazard)})` : ''
      return `"${o.label}"${cost}: ${o.detail}`
    })
    parts.push(`Options — ${joinList(opts)}.`)
  }
  return parts.join(' ')
}
