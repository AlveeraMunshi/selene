/**
 * Meter — a bounded quantity as a bar: battery, risk, observed fraction.
 *
 * WHY role="meter" RATHER THAN role="progressbar": these are gauges of a
 * current level within a known range, not the progress of a task toward
 * completion. A screen reader should say "battery, 41 percent", not imply
 * something is loading. Where a value really is task progress, pass
 * `role="progressbar"` through.
 *
 * WHY THE BAR DOES NOT ANIMATE ITS WIDTH ON EVERY TICK: battery updates twice
 * a second. A 200ms width transition on a value that changes every 500ms is
 * permanently mid-flight, which means the bar never shows the real number.
 * The fill transitions colour (tone changes are state changes worth seeing)
 * and snaps on width.
 */
import type { ReactNode } from 'react'
import { useId } from 'react'
import { cn } from './cn'
import { toneFill, toneText, type Tone } from './tones'

export interface MeterProps {
  label?: string
  /** 0..1. Values outside the range are clamped rather than overflowing. */
  value: number
  tone?: Tone
  /** Free text under the bar — a raw figure, a limit, a caveat. */
  caption?: ReactNode
  /** Show the percentage at the right of the label row. */
  showPct?: boolean
  className?: string
  /** ARIA role override for the rare case this really is task progress. */
  role?: 'meter' | 'progressbar'
}

export function Meter({
  label,
  value,
  tone = 'default',
  caption,
  showPct = true,
  className,
  role = 'meter',
}: MeterProps) {
  const labelId = useId()
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const pct = Math.round(safe * 100)

  return (
    <div className={cn('min-w-0', className)}>
      {(label || showPct) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label ? (
            <span id={labelId} className="eyebrow truncate">
              {label}
            </span>
          ) : (
            <span />
          )}
          {showPct && (
            <span className={cn('num shrink-0 text-2xs tabular-nums', toneText[tone])}>
              {pct}%
            </span>
          )}
        </div>
      )}

      <div
        role={role}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : 'Level'}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-3"
      >
        <div
          className={cn(
            'h-full rounded-pill transition-colors duration-[var(--duration-base)]',
            'ease-[var(--ease-instrument)]',
            toneFill[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {caption && <p className="mt-1 text-2xs text-ink-dim">{caption}</p>}
    </div>
  )
}
