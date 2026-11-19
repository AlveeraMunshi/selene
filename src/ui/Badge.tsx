/**
 * Badge — a one-word state, attached to something else.
 *
 * WHY IT IS NOT A BUTTON AND HAS NO HOVER: a badge reports; it never acts.
 * Giving it any interactive affordance would make operators click rover modes
 * and hazard levels looking for a menu that is not there.
 *
 * Tone is the whole point of the component. `warn` and `danger` here mean
 * exactly what they mean everywhere else in the system — see the colour rule
 * in src/styles/theme.css.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { toneChip, type ToneExtended } from './tones'

export interface BadgeProps {
  tone?: ToneExtended
  children?: ReactNode
  /** Decorative; the text carries the meaning. */
  icon?: LucideIcon
  className?: string
  /** Numerals inside the badge get tabular figures so counts do not jitter. */
  mono?: boolean
}

export function Badge({ tone = 'default', children, icon: Icon, className, mono }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-control border px-1.5 py-0.5',
        'text-2xs leading-4 font-medium whitespace-nowrap',
        toneChip[tone],
        mono && 'num',
        className,
      )}
    >
      {Icon && <Icon size={11} strokeWidth={2.25} aria-hidden="true" className="shrink-0" />}
      {children}
    </span>
  )
}
