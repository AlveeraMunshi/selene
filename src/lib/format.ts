/**
 * Presentation-only formatting.
 *
 * WHY THIS FILE EXISTS: every view needs to turn an engine number into a
 * string, and doing that inline means the same quantity gets three different
 * precisions in three panels. Nothing here derives a new fact — a formatter
 * that computed a percentage the engine did not produce would be exactly the
 * invented-metric failure the brief forbids. These functions only re-present
 * a number they are handed.
 */

/** A dash, not "0" and not "N/A" — the engine produced nothing here. */
export const NO_VALUE = '—'

/** Guard every formatter: a missing engine value must render as a dash. */
function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function fmtNumber(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return NO_VALUE
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Metres, switching to kilometres once the number stops being readable. */
export function fmtDistance(metres: number | null | undefined): string {
  if (!isNum(metres)) return NO_VALUE
  if (Math.abs(metres) >= 1000) return `${fmtNumber(metres / 1000, 2)} km`
  return `${fmtNumber(metres, metres < 10 ? 1 : 0)} m`
}

export function fmtEnergy(wh: number | null | undefined): string {
  if (!isNum(wh)) return NO_VALUE
  return `${fmtNumber(wh, wh < 10 ? 2 : 1)} Wh`
}

export function fmtSpeed(ms: number | null | undefined): string {
  if (!isNum(ms)) return NO_VALUE
  return `${fmtNumber(ms, 2)} m/s`
}

/** A 0..1 fraction as a percentage. Input must already BE a fraction. */
export function fmtPercent(frac: number | null | undefined, digits = 0): string {
  if (!isNum(frac)) return NO_VALUE
  return `${fmtNumber(frac * 100, digits)}%`
}

export function fmtDegrees(deg: number | null | undefined, digits = 1): string {
  if (!isNum(deg)) return NO_VALUE
  return `${fmtNumber(deg, digits)}°`
}

/**
 * Simulated seconds as a mission clock. Missions run for minutes of sim time,
 * so hours are included only when they exist rather than padding every clock
 * with a permanent "00:".
 */
export function fmtClock(seconds: number | null | undefined): string {
  if (!isNum(seconds)) return NO_VALUE
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Grid coordinate, for cell readouts and waypoint chips. */
export function fmtCell(cell: { x: number; y: number } | null | undefined): string {
  if (!cell) return NO_VALUE
  return `${cell.x}, ${cell.y}`
}

/** A cost term carried on a CostBreakdown; these are small, so 2dp. */
export function fmtCost(v: number | null | undefined): string {
  return fmtNumber(v, 2)
}

export function fmtMultiplier(v: number): string {
  return Number.isInteger(v) ? `${v}×` : `${v}×`
}

/** ISO timestamp from a MissionRecord, rendered in the viewer's locale. */
export function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 'mission-complete' -> 'Mission complete'. Used for event and reason codes. */
export function humanizeCode(code: string): string {
  const spaced = code.replace(/[-_]/g, ' ').trim()
  if (!spaced) return code
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
