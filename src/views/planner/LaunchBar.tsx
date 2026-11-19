/**
 * Seed control and the Launch button.
 *
 * The disabled state always carries its reason. A greyed-out Launch with no
 * explanation is the most common way a planning UI wastes someone's time, and
 * the reason here is the planner's own verdict from the preview rather than a
 * guess made in the view.
 */

import { Button, Field, Panel } from '@/ui'
import type { LaunchValidity } from '@/state/selectors'

export interface LaunchBarProps {
  seed: number
  onSeed: (seed: number) => void
  validity: LaunchValidity
  onLaunch: () => void
  /** True while a mission is already running; launching would discard it. */
  missionInProgress: boolean
}

export function LaunchBar({ seed, onSeed, validity, onLaunch, missionInProgress }: LaunchBarProps) {
  return (
    <Panel title="Launch">
      <div className="grid gap-3">
        <Field label="Seed" hint="The same seed regenerates the same terrain, exactly.">
          <input
            type="number"
            value={seed}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next)) onSeed(next)
            }}
            className="num focus-ring h-8 w-full rounded-control border border-line bg-surface-2 px-2.5 text-[0.8125rem] text-ink hover:border-line-strong"
          />
        </Field>

        <Button
          variant="primary"
          full
          loading={validity.pending}
          disabled={!validity.canLaunch}
          onClick={onLaunch}
        >
          {missionInProgress ? 'Relaunch mission' : 'Launch mission'}
        </Button>

        {validity.reason ? (
          <p className="text-2xs leading-4 text-warn-strong">{validity.reason}</p>
        ) : null}
        {missionInProgress && validity.canLaunch ? (
          <p className="text-2xs leading-4 text-ink-dim">
            A mission is already running. Launching starts a new one; the old one is discarded
            unless it has already finished and been saved.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
