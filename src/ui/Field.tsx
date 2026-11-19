/**
 * Field — a labelled row for a control that does not label itself.
 *
 * WHY IT USES role="group" RATHER THAN A <label for>: Field takes arbitrary
 * children, so it cannot know the id of the control inside it, and a <label>
 * pointing at nothing is worse than no label. Wrapping the children in a
 * labelled group gives a screen reader the same association without inventing
 * an id, and it works when the "control" is actually three buttons or a pair
 * of inputs. Controls that CAN label themselves (Slider, Toggle, Select) take
 * a `label` prop instead and should not be wrapped in a Field.
 */
import { useId, type ReactNode } from 'react'
import { cn } from './cn'

export interface FieldProps {
  label: string
  /** One line of explanation under the control. */
  hint?: string
  children?: ReactNode
  className?: string
  /** Put the label and the control on one line instead of stacking them. */
  inline?: boolean
}

export function Field({ label, hint, children, className, inline = false }: FieldProps) {
  const labelId = useId()
  return (
    <div
      className={cn(
        inline ? 'flex items-center justify-between gap-3' : 'block',
        className,
      )}
    >
      <span id={labelId} className="eyebrow block">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className={cn(inline ? 'shrink-0' : 'mt-1.5')}
      >
        {children}
      </div>
      {hint && (
        <p className={cn('text-2xs text-ink-dim', inline ? 'mt-1 basis-full' : 'mt-1')}>
          {hint}
        </p>
      )}
    </div>
  )
}
