/**
 * Scenario selection.
 *
 * Each card shows the scenario's own `summary` and `hypothesis` rather than
 * copy written here: the hypothesis is what the scenario was designed to
 * demonstrate, and keeping it on the card is what stops the planner and the
 * research writeup describing the same scenario differently.
 */

import { SCENARIOS } from '@/core/scenarios'
import type { Scenario } from '@/core/types'
import { Badge, cn, Panel } from '@/ui'

export interface ScenarioPickerProps {
  selectedId: string
  onSelect: (scenarioId: string) => void
  disabled?: boolean
}

export function ScenarioPicker({ selectedId, onSelect, disabled }: ScenarioPickerProps) {
  return (
    <Panel
      title="Scenario"
      subtitle="Each map is built to put a different kind of pressure on the planner."
    >
      <div className="grid gap-2">
        {SCENARIOS.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            selected={scenario.id === selectedId}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </Panel>
  )
}

function ScenarioCard({
  scenario,
  selected,
  disabled,
  onSelect,
}: {
  scenario: Scenario
  selected: boolean
  disabled?: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      // A radio in behaviour, so announce it as one rather than as a button
      // the user has to guess is exclusive.
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(scenario.id)}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
        selected
          ? 'border-sky-500/60 bg-sky-500/10'
          : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-100">{scenario.name}</span>
        <Badge variant={selected ? 'default' : 'outline'}>
          {scenario.width}&times;{scenario.height}
        </Badge>
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-neutral-400">
        {scenario.summary}
      </span>
      <span className="mt-2 block text-xs leading-relaxed text-neutral-500">
        <span className="font-medium text-neutral-400">Demonstrates: </span>
        {scenario.hypothesis}
      </span>
    </button>
  )
}
