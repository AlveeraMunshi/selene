/**
 * A labelled numeric parameter.
 *
 * WHY A WRAPPER: every mission parameter needs the same three things beside
 * the track — a name, the current value formatted in its own units, and one
 * line saying what moving it does to the route. Repeating that per slider is
 * how four sliders end up with four different layouts. It also keeps the
 * design system's `Slider` used only for its numeric props, so the seam with
 * Agent B is one component wide.
 */

import { Field, Slider } from '@/ui'

export interface ParamSliderProps {
  label: string
  /** What this parameter does to the plan, in one sentence. */
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** Renders the current value in its own units. */
  format: (value: number) => string
  disabled?: boolean
}

export function ParamSlider({
  label,
  hint,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  disabled,
}: ParamSliderProps) {
  return (
    <Field label={<ParamLabel label={label} value={format(value)} />} hint={hint}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
    </Field>
  )
}

function ParamLabel({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex w-full items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="font-mono text-xs tabular-nums text-neutral-400">{value}</span>
    </span>
  )
}
