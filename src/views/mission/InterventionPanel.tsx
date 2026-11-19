/**
 * The mission is waiting for a human.
 *
 * WHY THIS IS LOUD: `step()` is a no-op while a request is outstanding (D5),
 * so an operator who does not notice this panel is looking at a mission that
 * has silently stopped. The amber border, the explicit "waiting" line and the
 * `role="alertdialog"` are all there to make a stopped mission look stopped.
 *
 * The prose comes from `explainIntervention()` so it cannot drift from the
 * decision record behind it, and each option shows the route it would commit
 * to rather than only its name -- choosing between "Detour" and "Push
 * through" with no numbers is not a decision, it is a coin toss.
 */

import { explainIntervention } from '@/core/explain'
import type { InterventionOption, InterventionRequest } from '@/core/types'
import { Badge, Button, cn } from '@/ui'
import { humanizeCode } from '@/lib/format'
import { RouteFigures } from './DecisionInspector'

export interface InterventionPanelProps {
  request: InterventionRequest
  onResolve: (optionId: string) => void
  className?: string
}

export function InterventionPanel({ request, onResolve, className }: InterventionPanelProps) {
  return (
    <section
      role="alertdialog"
      aria-live="assertive"
      aria-label="Operator decision required"
      className={cn(
        'rounded-panel border-2 border-warn/60 bg-warn/5 shadow-panel',
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-warn/25 px-3.5 py-2.5">
        <Badge tone="warn">Awaiting operator</Badge>
        <span className="text-[0.8125rem] font-medium text-ink">
          {humanizeCode(request.reason)}
        </span>
        <span className="num ml-auto text-2xs text-ink-dim">tick {request.tick}</span>
      </header>

      <div className="grid gap-4 p-3.5">
        <p className="max-w-[70ch] text-[0.8125rem] leading-6 text-ink">
          {explainIntervention(request)}
        </p>
        <p className="text-2xs text-warn-strong">
          The mission is stopped and will not advance until one of these is chosen.
        </p>

        <div className="grid gap-2">
          {request.options.map((option) => (
            <OptionCard key={option.id} option={option} onResolve={onResolve} />
          ))}
        </div>
      </div>
    </section>
  )
}

function OptionCard({
  option,
  onResolve,
}: {
  option: InterventionOption
  onResolve: (optionId: string) => void
}) {
  return (
    <div className="rounded-control border border-line bg-surface-1 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium text-ink">{option.label}</p>
          <p className="mt-0.5 max-w-[60ch] text-2xs leading-4 text-ink-muted">{option.detail}</p>
        </div>
        <Button
          variant={option.action.type === 'abort-mission' ? 'danger' : 'primary'}
          size="sm"
          onClick={() => onResolve(option.id)}
          // The visible text is "Choose" on every option, which is right on
          // screen — the label it belongs to is directly beside it. Announced
          // on its own it is four identical buttons, so a screen-reader user
          // cannot tell which route they are committing to on the one screen
          // where the decision cannot be undone.
          aria-label={`${option.action.type === 'abort-mission' ? 'Abort' : 'Choose'}: ${option.label}`}
        >
          {option.action.type === 'abort-mission' ? 'Abort' : 'Choose'}
        </Button>
      </div>

      {/* Only options that commit to driving a route carry one; a
          skip-waypoint or abort has nothing to show, and inventing figures
          for them would be worse than the gap. */}
      {option.route ? <RouteFigures route={option.route} /> : null}
    </div>
  )
}
