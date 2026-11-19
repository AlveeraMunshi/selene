/**
 * One decision, in prose and in numbers, on the same screen.
 *
 * THIS PAIRING IS THE POINT OF THE FEATURE. `explainDecision()` generates the
 * sentence from the record (D6), and the record is printed underneath it, so
 * a reader can check the claim against the arithmetic without leaving the
 * panel. Showing only the prose would be a chatbot; showing only the numbers
 * would be a debug dump.
 *
 * Every rejected candidate is listed with the cost that rejected it. A
 * decision that showed only what was chosen would not be an explanation.
 */

import { explainDecision } from '@/core/explain'
import type { DecisionRecord, Route, RouteCandidate } from '@/core/types'
import { Badge, EmptyState, KeyValue, Panel, cn } from '@/ui'
import {
  fmtCell,
  fmtCost,
  fmtDegrees,
  fmtDistance,
  fmtEnergy,
  fmtPercent,
  humanizeCode,
} from '@/lib/format'
import { CostBreakdown } from '@/views/shared/CostBreakdown'

export interface DecisionInspectorProps {
  decision: DecisionRecord | null
  className?: string
}

export function DecisionInspector({ decision, className }: DecisionInspectorProps) {
  return (
    <Panel
      title="Decision inspector"
      subtitle={decision ? humanizeCode(decision.kind) : undefined}
      scroll
      className={className}
    >
      {decision ? (
        <DecisionBody decision={decision} />
      ) : (
        <EmptyState
          compact
          title="No decision selected"
          body="Pick an entry in the decision stream to see the routes it compared and why it took the one it did."
        />
      )}
    </Panel>
  )
}

function DecisionBody({ decision }: { decision: DecisionRecord }) {
  return (
    <div className="grid gap-5">
      {/* The generated sentence. Measured at ~70ch because this is the one
          block of real prose in the application. */}
      <p className="max-w-[70ch] text-[0.8125rem] leading-6 text-ink">
        {explainDecision(decision)}
      </p>

      <section>
        <p className="eyebrow mb-2">Record</p>
        <KeyValue
          divided
          rows={[
            { k: 'Tick', v: decision.tick },
            { k: 'Kind', v: humanizeCode(decision.kind) },
            { k: 'Rover state', v: humanizeCode(decision.roverState) },
            { k: 'Position', v: fmtCell(decision.position) },
            { k: 'Trigger', v: decision.trigger },
            { k: 'Reason code', v: decision.reasonCode },
            { k: 'Observed', v: fmtPercent(decision.observedFraction) },
            { k: 'Battery', v: fmtPercent(decision.batteryFrac) },
          ]}
        />
      </section>

      <section>
        <p className="eyebrow mb-2">
          Candidates evaluated ({decision.candidates.length})
        </p>
        {decision.candidates.length === 0 ? (
          <EmptyState
            compact
            title="No candidates recorded"
            body="This decision was taken without the planner producing a route to compare."
          />
        ) : (
          <div className="grid gap-2">
            {decision.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                selected={c.id === decision.selectedId}
              />
            ))}
          </div>
        )}
      </section>

      {decision.caveats.length > 0 ? (
        <section>
          <p className="eyebrow mb-2">Caveats</p>
          {/* Caveats are the engine's own statement of what this decision did
              not know. Burying them would make the explanation overconfident. */}
          <ul className="grid gap-1.5">
            {decision.caveats.map((caveat, i) => (
              <li
                key={i}
                className="rounded-control border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-2xs leading-4 text-ink-muted"
              >
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function CandidateCard({
  candidate,
  selected,
}: {
  candidate: RouteCandidate
  selected: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-control border p-3',
        selected ? 'border-good/40 bg-good/5' : 'border-line bg-surface-2',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-ink">{candidate.label}</span>
        {selected ? (
          <Badge tone="good">Selected</Badge>
        ) : candidate.rejected ? (
          <Badge tone="warn">{candidate.rejected}</Badge>
        ) : (
          <Badge>Not taken</Badge>
        )}
      </div>

      {candidate.route ? (
        <>
          <RouteFigures route={candidate.route} />
          <div className="mt-3 border-t border-line pt-3">
            <CostBreakdown cost={candidate.route.cost} compact />
          </div>
        </>
      ) : (
        <p className="mt-1.5 text-2xs leading-4 text-ink-dim">
          No route: this candidate's search did not produce one.
        </p>
      )}

      {/* The weights and constraints are what make two candidates different.
          Without them, "lower hazard cost" is an assertion rather than a
          consequence of a setting you can see. */}
      <p className="num mt-3 text-2xs leading-4 text-ink-faint">
        w: dist {fmtCost(candidate.weights.distance)} &middot; slope{' '}
        {fmtCost(candidate.weights.slope)} &middot; haz {fmtCost(candidate.weights.hazard)} &middot;
        energy {fmtCost(candidate.weights.energy)}
        {' | '}
        max slope {fmtDegrees(candidate.constraints.maxSlopeDeg, 0)} &middot; max hazard{' '}
        {fmtPercent(candidate.constraints.maxHazard)} &middot; reserve{' '}
        {fmtPercent(candidate.constraints.batteryReserveFrac)}
      </p>
    </div>
  )
}

export function RouteFigures({ route }: { route: Route }) {
  return (
    <div className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-ink-muted sm:grid-cols-4">
      <Figure label="Distance" value={fmtDistance(route.distanceM)} />
      <Figure label="Energy" value={fmtEnergy(route.energyWh)} />
      <Figure label="Peak hazard" value={fmtPercent(route.peakHazard)} />
      <Figure label="Peak slope" value={fmtDegrees(route.peakSlopeDeg)} />
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink-muted">{value}</span>
    </span>
  )
}
