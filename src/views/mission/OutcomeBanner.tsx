/**
 * OutcomeBanner — what happened, said on the screen the operator is already
 * looking at.
 *
 * WHY THIS EXISTS: a finished mission used to surface only as a small "Failed"
 * badge in the telemetry rail. The engine's own sentence for *why* it failed —
 * "battery fell below the 15% reserve" — was rendered nowhere except the event
 * log in the Analysis view, which means the operator had to leave the mission
 * screen to find out what had become of the mission. The product spec asks for
 * "the engine's stated reason, not a generic error", and this is it.
 *
 * The reason is read from the terminal event rather than composed here, for
 * the same reason the decision explanations are generated from their records:
 * a sentence written at the display site drifts away from the engine that
 * produced it.
 */
import { CheckCircle2, CircleSlash, TriangleAlert } from 'lucide-react'

import type { MissionOutcome, SimEvent } from '@/core/types'
import { Panel, cn } from '@/ui'

const PRESENTATION: Record<
  MissionOutcome,
  { title: string; tone: string; border: string; Icon: typeof CheckCircle2 }
> = {
  complete: {
    title: 'Mission complete',
    tone: 'text-good',
    border: 'border-good/40',
    Icon: CheckCircle2,
  },
  failed: {
    title: 'Mission failed',
    tone: 'text-danger',
    border: 'border-danger/40',
    Icon: TriangleAlert,
  },
  aborted: {
    title: 'Mission aborted',
    tone: 'text-warn',
    border: 'border-warn/40',
    Icon: CircleSlash,
  },
}

/** The engine's own words, pulled off the terminal event. */
function reasonFor(outcome: MissionOutcome, events: SimEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (outcome === 'failed' && e.type === 'mission-failed') return e.reason
    if (outcome === 'complete' && e.type === 'mission-complete') return null
    if (outcome === 'aborted' && e.type === 'mission-aborted') return null
  }
  return null
}

export function OutcomeBanner({
  outcome,
  events,
  waypointsReached,
  waypointsTotal,
  className,
}: {
  outcome: MissionOutcome
  events: SimEvent[]
  waypointsReached: number
  waypointsTotal: number
  className?: string
}) {
  const { title, tone, border, Icon } = PRESENTATION[outcome]
  const reason = reasonFor(outcome, events)

  return (
    <Panel className={cn('border', border, className)}>
      {/* role/aria-live on an inner element because Panel renders a <section>
          and does not forward arbitrary ARIA. A mission ending is exactly the
          kind of change a screen reader should announce without being asked. */}
      <div className="flex items-start gap-3" role="status" aria-live="polite">
        <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
        <div className="min-w-0">
          <p className={cn('text-[0.9375rem] font-medium', tone)}>{title}</p>
          <p className="mt-1 text-2xs leading-4 text-ink-muted">
            {reason ?? (
              <>
                <span className="num">{waypointsReached}</span> of{' '}
                <span className="num">{waypointsTotal}</span>{' '}
                {waypointsTotal === 1 ? 'objective' : 'objectives'} reached.
              </>
            )}
          </p>
        </div>
      </div>
    </Panel>
  )
}
