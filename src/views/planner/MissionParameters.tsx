/**
 * The four cost-model parameters plus the autonomy setting.
 *
 * These are the controls the live preview exists to make legible: each one
 * feeds `weightsFor`/`constraintsFor` and therefore changes the route the
 * planner returns. The hints say what moving the control does to the plan,
 * not what the control is called -- a slider labelled "Risk tolerance" with a
 * hint reading "how much risk you tolerate" has told the operator nothing.
 */

import type { MissionConfig } from '@/core/types'
import { Panel, Slider, Toggle } from '@/ui'
import { fmtDegrees, fmtPercent } from '@/lib/format'

export interface MissionParametersProps {
  config: MissionConfig
  disabled?: boolean
  onRisk: (v: number) => void
  onEnergyPriority: (v: number) => void
  onBatteryReserve: (v: number) => void
  onMaxSlope: (v: number) => void
  onAutonomyLevel: (level: MissionConfig['autonomyLevel']) => void
}

const pct = (v: number) => fmtPercent(v)

export function MissionParameters({
  config,
  disabled,
  onRisk,
  onEnergyPriority,
  onBatteryReserve,
  onMaxSlope,
  onAutonomyLevel,
}: MissionParametersProps) {
  const supervised = config.autonomyLevel === 'supervised'

  return (
    <Panel
      title="Mission parameters"
      // Risk tolerance and max slope move the route readily; energy priority
      // measurably does not (see the note in cost.ts). Claiming otherwise
      // invites the reader to conclude the preview is broken.
      subtitle="Each control reweights the cost function. Risk tolerance and the slope limit move the route most; energy priority is deliberately a weak preference."
    >
      <div className="grid gap-4">
        <Slider
          label="Risk tolerance"
          hint="Believed hazard above this is impassable. Raising it opens shorter, nastier routes."
          value={config.riskTolerance}
          min={0}
          max={1}
          step={0.01}
          onChange={onRisk}
          format={pct}
          disabled={disabled}
        />
        <Slider
          label="Energy priority"
          hint="Weights watt-hours against distance. High values route around climbs rather than over them."
          value={config.energyPriority}
          min={0}
          max={1}
          step={0.01}
          onChange={onEnergyPriority}
          format={pct}
          disabled={disabled}
        />
        <Slider
          label="Battery reserve"
          hint="The mission stops rather than dropping below this. A floor, not a target."
          value={config.batteryReserveFrac}
          min={0}
          max={0.5}
          step={0.01}
          onChange={onBatteryReserve}
          format={pct}
          disabled={disabled}
        />
        <Slider
          label="Maximum slope"
          hint="A hard climb limit. Steeper cells are never traversable at any weighting."
          value={config.maxSlopeDeg}
          min={5}
          max={45}
          step={1}
          onChange={onMaxSlope}
          format={(v) => fmtDegrees(v, 0)}
          disabled={disabled}
        />

        <div className="border-t border-line pt-4">
          <Toggle
            checked={supervised}
            disabled={disabled}
            onChange={(next) => onAutonomyLevel(next ? 'supervised' : 'autonomous')}
            label="Supervised autonomy"
            hint={
              supervised
                ? 'The rover stops and asks when it meets a situation outside its tolerances.'
                : 'The rover resolves everything itself. Nothing will wait for you.'
            }
          />
        </div>
      </div>
    </Panel>
  )
}
