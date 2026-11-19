/**
 * Slider — a mission parameter the operator can move: risk tolerance, energy
 * priority, slope limit.
 *
 * WHY IT IS A NATIVE <input type="range"> AND NOT A DIV WITH A DRAG HANDLER:
 * the native control already does arrow keys, Home/End, Page Up/Down, pointer
 * capture, touch, and the correct screen-reader announcement on every
 * platform. Every hand-rolled slider re-implements a subset of that and gets
 * the keyboard wrong. The skin lives in `.selene-range` in theme.css because
 * the track and thumb are only reachable through vendor pseudo-elements.
 *
 * WHY THE VALUE IS PRINTED BESIDE THE LABEL RATHER THAN IN A TOOLTIP ON THE
 * THUMB: these numbers feed a cost function and the operator needs to read
 * them while NOT touching the control — a tooltip that only appears on drag
 * hides the setting exactly when you want to compare it against the last run.
 */
import { useId } from 'react'
import { cn } from './cn'

export interface SliderMark {
  value: number
  label: string
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange(v: number): void
  /** Render the number for humans: units, precision, percent. */
  format?(v: number): string
  /** One line of explanation under the track. */
  hint?: string
  /** Reference points drawn under the track. Decorative, not snap targets. */
  marks?: SliderMark[]
  disabled?: boolean
  className?: string
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
  marks,
  disabled = false,
  className,
}: SliderProps) {
  const id = useId()
  const hintId = `${id}-hint`

  const span = max - min
  // Guard a zero-width range: a degenerate slider should render full, not NaN.
  const frac = span > 0 ? (value - min) / span : 1
  const pct = Math.min(100, Math.max(0, frac * 100))
  const shown = format ? format(value) : String(value)

  return (
    <div className={cn('min-w-0', disabled && 'opacity-60', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="eyebrow truncate">
          {label}
        </label>
        <span className="num shrink-0 text-[0.8125rem] leading-5 text-ink">{shown}</span>
      </div>

      <input
        id={id}
        type="range"
        className="selene-range mt-1.5"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        // The visible text is formatted, so the raw number a screen reader
        // would otherwise read ("0.62") is replaced by what is on screen.
        aria-valuetext={shown}
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />

      {marks && marks.length > 0 && (
        <div className="relative mt-0.5 h-3.5 select-none" aria-hidden="true">
          {marks.map((mark) => {
            const p = span > 0 ? ((mark.value - min) / span) * 100 : 0
            return (
              <span
                key={`${mark.value}-${mark.label}`}
                className="absolute top-0 -translate-x-1/2 text-2xs whitespace-nowrap text-ink-faint"
                style={{ left: `${Math.min(100, Math.max(0, p))}%` }}
              >
                {mark.label}
              </span>
            )
          })}
        </div>
      )}

      {hint && (
        <p id={hintId} className={cn('text-2xs text-ink-dim', marks?.length ? 'mt-2' : 'mt-1')}>
          {hint}
        </p>
      )}
    </div>
  )
}
