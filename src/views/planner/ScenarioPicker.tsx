/**
 * Scenario selection.
 *
 * Each card shows the scenario's own `summary` and `hypothesis` rather than
 * copy written here: the hypothesis is what the scenario was built to
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
      subtitle="Each map puts a different kind of pressure on the planner."
    >
      <div role="radiogroup" aria-label="Scenario" className="grid gap-2">
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
      // A radio in behaviour, so it is announced as one rather than as a
      // button the user has to discover is exclusive.
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(scenario.id)}
      className={cn(
        'focus-ring w-full rounded-control border p-3 text-left',
        'transition-colors duration-[var(--duration-fast)]',
        selected
          ? 'border-accent/50 bg-accent/10'
          : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-ink">{scenario.name}</span>
        <Badge tone={selected ? 'info' : 'default'} mono>
          {scenario.width}&times;{scenario.height}
        </Badge>
      </span>
      <span className="mt-1 block text-2xs leading-4 text-ink-muted">{scenario.summary}</span>
      <span className="mt-2 block text-2xs leading-4 text-ink-dim">
        <span className="font-medium text-ink-muted">Demonstrates: </span>
        {scenario.hypothesis}
      </span>
    </button>
  )
}
