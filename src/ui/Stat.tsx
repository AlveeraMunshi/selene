/**
 * Stat — one telemetry reading: a quiet label over a loud value.
 *
 * WHY `mono` DEFAULTS TO TRUE: a Stat exists to show a number that changes.
 * With proportional figures a battery percentage visibly twitches as the
 * digits change width, and an operator watching three of them side by side
 * cannot hold a reading. Tabular monospace freezes the glyph box so only the
 * digit changes. Callers showing a word rather than a number pass
 * `mono={false}`.
 *
 * The label is small, uppercase and dim; the value is large and plain. That
 * inversion — label recedes, value dominates — is what makes a wall of these
 * scannable instead of a wall of text.
 */
import type { ReactNode } from 'react'
import { cn } from './cn'
import { toneText, type Tone } from './tones'

export interface StatProps {
  label: string
  value: ReactNode
  /** Rendered small and dim beside the value: %, m, Wh, deg. */
  unit?: string
  tone?: Tone
  /** One short clarifying line under the value. */
  hint?: string
  /** Tabular monospace figures. Defaults to true; turn it off for words. */
  mono?: boolean
  className?: string
  /** Shrink to a row-friendly size for dense sidebars. */
  compact?: boolean
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  hint,
  mono = true,
  className,
  compact = false,
}: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={cn(
            'truncate font-medium tracking-tight',
            compact ? 'text-base' : 'text-xl',
            mono && 'num',
            toneText[tone],
          )}
        >
          {value}
        </span>
        {unit && (
          <span className={cn('shrink-0 text-2xs text-ink-dim', mono && 'num')}>{unit}</span>
        )}
      </div>
      {hint && <p className="mt-0.5 truncate text-2xs text-ink-dim">{hint}</p>}
    </div>
  )
}
