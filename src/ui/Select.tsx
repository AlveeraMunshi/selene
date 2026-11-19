/**
 * Select — choose one of a short, known list: scenario, overlay, autonomy
 * level.
 *
 * WHY IT IS A NATIVE <select> WRAPPED IN A SKIN RATHER THAN A CUSTOM LISTBOX:
 * a custom listbox is roughly two hundred lines of focus management, typeahead
 * and portal positioning to reproduce behaviour the platform already ships,
 * and it breaks on mobile, where the native control becomes a proper picker.
 * The only thing worth replacing is the chrome, so that is all this replaces:
 * the native arrow is removed in CSS and an icon is drawn over the element.
 */
import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  label?: string
  value: string
  options: SelectOption[]
  onChange(v: string): void
  disabled?: boolean
  className?: string
  /** Required when no visible label is given, so the control is announced. */
  'aria-label'?: string
}

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: SelectProps) {
  const id = useId()
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="eyebrow mb-1.5 block truncate">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-label={label ? undefined : (ariaLabel ?? 'Select an option')}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={cn(
            'selene-select focus-ring h-8 w-full truncate',
            'rounded-control border border-line bg-surface-2',
            'pr-8 pl-2.5 text-[0.8125rem] text-ink',
            'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-instrument)]',
            'hover:border-line-strong',
            'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line',
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-dim"
        />
      </div>
    </div>
  )
}
