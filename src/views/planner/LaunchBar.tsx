/**
 * Seed control and the Launch button.
 *
 * The disabled state always carries its reason. A greyed-out Launch with no
 * explanation is the single most common way a planning UI wastes someone's
 * time — the reason here comes from the preview, so it is the planner's own
 * verdict rather than a guess made in the view.
 */

import { Button, Panel, Spinner } from '@/ui'
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
        <label className="grid gap-1.5">
          <span className="flex items-baseline justify-between text-sm text-neutral-300">
            <span>Seed</span>
            <span className="text-xs text-neutral-500">Same seed, same terrain</span>
          </span>
          <input
            type="number"
            value={seed}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next)) onSeed(next)
            }}
            className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
          />
        </label>

        <Button
          variant="primary"
          disabled={!validity.canLaunch}
          onClick={onLaunch}
          className="w-full"
        >
          {validity.pending ? <Spinner /> : null}
          {missionInProgress ? 'Relaunch mission' : 'Launch mission'}
        </Button>

        {validity.reason ? (
          <p className="text-xs leading-relaxed text-amber-400">{validity.reason}</p>
        ) : null}
        {missionInProgress && validity.canLaunch ? (
          <p className="text-xs leading-relaxed text-neutral-500">
            A mission is already running. Launching starts a new one and discards it unsaved.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
