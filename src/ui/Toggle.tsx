/**
 * Toggle — a binary mission setting that takes effect immediately.
 *
 * WHY role="switch" AND NOT A CHECKBOX: a checkbox means "this will be true
 * when you submit the form". There is no form here; flipping autonomy from
 * supervised to autonomous changes the running simulation on the next tick.
 * `switch` is the role that says "on now", and it is announced as on/off
 * rather than checked/unchecked.
 *
 * The whole row is the hit target, including the label, because these sit in
 * a dense sidebar where a 20px track is a hard thing to hit.
 */
import { useId } from 'react'
import { cn } from './cn'

export interface ToggleProps {
  label: string
  checked: boolean
  onChange(v: boolean): void
  /** One line of explanation under the label. */
  hint?: string
  disabled?: boolean
  className?: string
}

export function Toggle({ label, checked, onChange, hint, disabled = false, className }: ToggleProps) {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            'block text-[0.8125rem] leading-5 text-ink',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-0.5 text-2xs text-ink-dim">
            {hint}
          </p>
        )}
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-ring relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center',
          'rounded-pill border transition-colors duration-[var(--duration-fast)]',
          'ease-[var(--ease-instrument)] disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-accent/50 bg-accent/30'
            : 'border-line bg-surface-2 hover:border-line-strong',
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-3.5 w-3.5 rounded-pill',
            'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-instrument)]',
            checked ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px] bg-ink-faint',
          )}
        />
      </button>
    </div>
  )
}
