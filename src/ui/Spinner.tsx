/**
 * Spinner — "the engine is working and has not forgotten you".
 *
 * WHY IT IS A RING AND NOT A PULSING DOT OR A SKELETON: a planner run is
 * short and bursty. A skeleton implies layout that is about to arrive; here
 * the layout is already on screen and only a number is pending, so the right
 * signal is a small, quiet, in-place one that does not reflow anything.
 *
 * It announces itself as a live region so a screen reader says "planning"
 * rather than leaving the user in silence while A* expands 40,000 nodes.
 */
import { cn } from './cn'

export interface SpinnerProps {
  /** Announced to assistive tech, and shown beside the ring when provided. */
  label?: string
  /** Diameter in pixels. Defaults to 16 so it sits on a text baseline. */
  size?: number
  className?: string
  /** Hide the visible text and keep only the screen-reader announcement. */
  labelHidden?: boolean
}

export function Spinner({ label, size = 16, className, labelHidden }: SpinnerProps) {
  const stroke = size <= 16 ? 2 : size <= 24 ? 2.5 : 3
  return (
    <span
      className={cn('inline-flex items-center gap-2 align-middle', className)}
      role="status"
      aria-live="polite"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="selene-spin shrink-0"
      >
        {/* The full ring is the track; the arc is the moving part. Drawing
            both keeps the element's visual weight constant as it turns. */}
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={stroke} opacity="0.18" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      </svg>
      {label ? (
        <span className={labelHidden ? 'sr-only' : 'text-2xs text-ink-dim'}>{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </span>
  )
}
