/**
 * Start and the ordered waypoint list.
 *
 * The numbering here is the drive order, not a sort: the engine visits
 * `config.waypoints` in array order, so the chip labelled 2 is genuinely the
 * second leg.
 */

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
          aria-label="Map click places"
          className="flex rounded-md border border-neutral-800 p-0.5"
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
          <li className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5">
            <Badge variant="outline">Start</Badge>
            <span className="font-mono text-xs text-neutral-400">{fmtCell(start)}</span>
          </li>
          {waypoints.map((wp, i) => (
            <li
              key={`${wp.x},${wp.y},${i}`}
              className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5"
            >
              <Badge>{i + 1}</Badge>
              <span className="font-mono text-xs text-neutral-400">{fmtCell(wp)}</span>
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
            title="No waypoints"
            description="The mission needs at least one. Click anywhere on the map to add the first."
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
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grow rounded px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500',
        active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}
