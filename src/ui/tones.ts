/**
 * Semantic tone, declared once.
 *
 * WHY THIS FILE EXISTS: eight components take a `tone` prop and every one of
 * them must agree on what amber means. Keeping the class strings here rather
 * than in each component is what stops `warn` drifting into a slightly
 * different amber in the Timeline than in the Stat, and it is what makes the
 * reserved-colour rule enforceable by reading one file.
 *
 * The strings are written out in full, never assembled from fragments, because
 * Tailwind scans source text for literal class names — a template literal like
 * `text-${tone}` produces no CSS at all.
 */

/** Risk-semantic tone. See the colour rule in src/styles/theme.css. */
export type Tone = 'default' | 'good' | 'warn' | 'danger'

/** Tone plus a non-risk informational variant, for labels and log entries. */
export type ToneExtended = Tone | 'info'

/** Foreground only. For a value, a numeral, an icon. */
export const toneText: Record<ToneExtended, string> = {
  default: 'text-ink',
  good: 'text-good',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
}

/** A low-alpha fill with a matching hairline. For badges and chips. */
export const toneChip: Record<ToneExtended, string> = {
  default: 'bg-surface-2 text-ink-muted border-line',
  good: 'bg-good/10 text-good-strong border-good/30',
  warn: 'bg-warn/10 text-warn-strong border-warn/30',
  danger: 'bg-danger/10 text-danger-strong border-danger/30',
  info: 'bg-info/10 text-info-strong border-info/30',
}

/** A solid fill. For a meter bar or a timeline dot. */
export const toneFill: Record<ToneExtended, string> = {
  default: 'bg-ink-faint',
  good: 'bg-good',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
}

/** A left edge or rail accent. */
export const toneBorder: Record<ToneExtended, string> = {
  default: 'border-line',
  good: 'border-good/40',
  warn: 'border-warn/40',
  danger: 'border-danger/40',
  info: 'border-info/40',
}
