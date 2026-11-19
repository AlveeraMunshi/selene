/**
 * Fixed-width stdout tables.
 *
 * Deliberately not a dependency. The harness has to run in CI with nothing
 * installed beyond what the app already needs, and a column-aligned table is
 * forty lines. Output is plain ASCII with no colour: it is read in a CI log
 * as often as in a terminal, and escape codes there are noise.
 */

export type Align = 'l' | 'r'

export interface Column {
  header: string
  align?: Align
}

function pad(s: string, width: number, align: Align): string {
  if (s.length >= width) return s
  const fill = ' '.repeat(width - s.length)
  return align === 'r' ? fill + s : s + fill
}

export function table(columns: readonly Column[], rows: readonly (readonly string[])[]): string {
  const widths = columns.map((c, i) => {
    let w = c.header.length
    for (const r of rows) {
      const cell = r[i] ?? ''
      if (cell.length > w) w = cell.length
    }
    return w
  })
  const line = (cells: readonly string[]) =>
    cells.map((c, i) => pad(c ?? '', widths[i], columns[i]?.align ?? 'l')).join('  ').trimEnd()
  const head = line(columns.map((c) => c.header))
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  return [head, rule, ...rows.map(line)].join('\n')
}

export function heading(text: string): string {
  return `\n${text}\n${'='.repeat(text.length)}`
}

export function subheading(text: string): string {
  return `\n${text}\n${'-'.repeat(text.length)}`
}

/** Number to a fixed number of decimals, with a readable dash for NaN. */
export function num(v: number, decimals = 1): string {
  return Number.isFinite(v) ? v.toFixed(decimals) : '-'
}

/** "median [p25-p75]" — the standard cell for a continuous quantity here. */
export function spread(s: { median: number; p25: number; p75: number }, decimals = 1): string {
  if (!Number.isFinite(s.median)) return '-'
  return `${num(s.median, decimals)} [${num(s.p25, decimals)}-${num(s.p75, decimals)}]`
}

/** A signed percentage, for paired deltas where the sign is the finding. */
export function signedPct(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(decimals)}%`
}
