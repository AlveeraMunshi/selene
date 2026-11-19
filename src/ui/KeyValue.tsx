/**
 * KeyValue — a definition list for the facts behind a decision.
 *
 * WHY A REAL <dl> AND NOT A TABLE OR A STACK OF DIVS: these rows are
 * name/value pairs, and a screen reader walking a <dl> announces them as
 * pairs. A table would imply columns that can be compared down their length,
 * which is false — "peak hazard 0.62" and "nodes expanded 9,481" share no
 * unit and no axis.
 *
 * Values are tabular monospace by default because almost every value here is
 * a number read against the one above it, and ragged figures break the column.
 */
import type { ReactNode } from 'react'
import { cn } from './cn'
import { toneText, type Tone } from './tones'

export interface KeyValueRow {
  k: ReactNode
  v: ReactNode
  tone?: Tone
}

export interface KeyValueProps {
  rows: KeyValueRow[]
  className?: string
  /** Turn off tabular monospace for value cells that hold prose. */
  mono?: boolean
  /** Hairline between rows. Useful past about five rows. */
  divided?: boolean
}

export function KeyValue({ rows, className, mono = true, divided = false }: KeyValueProps) {
  if (rows.length === 0) return null
  return (
    <dl className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4', className)}>
      {rows.map((row, i) => (
        // The index is part of the key because `k` is a ReactNode and two
        // rows are legitimately allowed to share a name across sections.
        <div
          key={i}
          className={cn(
            'col-span-2 grid grid-cols-subgrid items-baseline py-1',
            divided && i > 0 && 'border-t border-line',
          )}
        >
          <dt className="min-w-0 truncate text-2xs text-ink-dim">{row.k}</dt>
          <dd
            className={cn(
              'justify-self-end text-right text-[0.8125rem] leading-5',
              mono && 'num',
              toneText[row.tone ?? 'default'],
            )}
          >
            {row.v}
          </dd>
        </div>
      ))}
    </dl>
  )
}
