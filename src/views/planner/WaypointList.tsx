/**
 * Start and the ordered waypoint list.
 *
 * The numbering here is the drive order, not a sort: the engine visits
 * `config.waypoints` in array order, so the chip labelled 2 is genuinely the
 * second leg.
 */

import type { ReactNode } from 'react'

import type { Cell } from '@/core/types'
import { Badge, Button, cn, EmptyState, Panel } from '@/ui'
import { fmtCell } from '@/lib/format'

export type MapClickMode = 'waypoint' | 'start'

export interface WaypointListProps {
  start: Cell
  waypoints: Cell[]
  mode: MapClickMode
  onModeChange: (mode: MapClickMode) => void
  onRemove: (cell: Cell) => void
  onClear: () => void
  disabled?: boolean
}

export function WaypointList({
  start,
  waypoints,
  mode,
  onModeChange,
  onRemove,
  onClear,
  disabled,
}: WaypointListProps) {
  return (
    <Panel
      title="Route"
      subtitle="Click the map to place points. Clicking an existing waypoint removes it."
      actions={
        waypoints.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
            Clear
          </Button>
        ) : null
      }
    >
      <div className="grid gap-3">
        <div
          role="radiogroup"
          aria-label="What a map click places"
          className="flex rounded-control border border-line p-0.5"
        >
          <ModeButton
            active={mode === 'waypoint'}
            disabled={disabled}
            onClick={() => onModeChange('waypoint')}
          >
            Add waypoints
          </ModeButton>
          <ModeButton
            active={mode === 'start'}
            disabled={disabled}
            onClick={() => onModeChange('start')}
          >
            Move start
          </ModeButton>
        </div>

        <ol className="grid gap-1.5">
          <li className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-2.5 py-1.5">
            <Badge tone="info">Start</Badge>
            <span className="num text-2xs text-ink-muted">{fmtCell(start)}</span>
          </li>
          {waypoints.map((wp, i) => (
            <li
              key={`${wp.x},${wp.y},${i}`}
              className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-2.5 py-1.5"
            >
              <Badge mono>{i + 1}</Badge>
              <span className="num text-2xs text-ink-muted">{fmtCell(wp)}</span>
              <span className="grow" />
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onRemove(wp)}
                aria-label={`Remove waypoint ${i + 1}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>

        {waypoints.length === 0 ? (
          <EmptyState
            compact
            title="No waypoints"
            body="The mission needs at least one. Click anywhere on the map to add the first."
          />
        ) : null}
      </div>
    </Panel>
  )
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'focus-ring grow rounded-control px-2.5 py-1 text-2xs font-medium',
        'transition-colors duration-[var(--duration-fast)]',
        active ? 'bg-surface-3 text-ink' : 'text-ink-dim hover:text-ink-muted',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}
