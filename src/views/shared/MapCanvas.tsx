/**
 * The map.
 *
 * WHY THIS COMPONENT IS A LEAF AND STAYS A LEAF: it is the one place that
 * subscribes to a whole SimState, which changes identity on every tick. A
 * tick therefore re-renders exactly this component -- a single canvas element
 * with a stable ref callback -- and nothing above it. Putting a panel, a
 * legend or a telemetry readout *inside* this component's subtree would undo
 * that, so overlays are passed in as children and rendered as siblings.
 *
 * The pixels are drawn by the renderer's own rAF loop, which reads the state
 * from a ref. React's only job here is to hand it a canvas and the current
 * options, and to translate pointer events into cells through `cellAt`.
 */

import { useCallback, useMemo, useState, type PointerEvent, type ReactNode } from 'react'

import { idx } from '@/core/terrain'
import type { Cell, SimState } from '@/core/types'
import { useRenderer, type RenderOptions } from '@/render'
import { cn } from '@/ui'

import { fmtDegrees, fmtNumber, fmtPercent } from '@/lib/format'
import { useRenderOptions } from '@/state/selectors'

export interface MapCanvasProps {
  state: SimState | null
  onCellClick?: (cell: Cell) => void
  /**
   * Per-map overrides on the stored layer preferences -- the planner hides
   * the trail, for instance. Memoize it at the call site; a fresh object each
   * render would hand the renderer new options every frame it re-renders.
   */
  overrides?: Partial<RenderOptions>
  /** Overlay content, positioned over the canvas and outside its render path. */
  children?: ReactNode
  className?: string
  /** The hovered-cell terrain readout. Off for small inline maps. */
  showReadout?: boolean
  /** Stops the rAF loop when the map is on a hidden tab. */
  enabled?: boolean
}

interface CellSample {
  cell: Cell
  elevation: number
  slopeDeg: number
  hazard: number
  observed: boolean
}

/**
 * Read the believed values at a cell.
 *
 * Belief rather than terrain on purpose: the readout shows what the rover
 * knows, not ground truth, or the operator can see through the fog the whole
 * autonomy story depends on (D4).
 */
function sampleCell(state: SimState, cell: Cell): CellSample | null {
  const b = state.belief
  if (cell.x < 0 || cell.y < 0 || cell.x >= b.width || cell.y >= b.height) return null
  const i = idx(b.width, cell.x, cell.y)
  return {
    cell,
    elevation: b.elevation[i],
    slopeDeg: b.slopeDeg[i],
    hazard: b.hazard[i],
    observed: b.observed[i] !== 0,
  }
}

export function MapCanvas({
  state,
  onCellClick,
  overrides,
  children,
  className,
  showReadout = true,
  enabled = true,
}: MapCanvasProps) {
  const stored = useRenderOptions()
  // Hover is local, never in the store: it changes on every mouse move, and a
  // store write per move would re-render every subscriber in the app.
  const [hover, setHover] = useState<Cell | null>(null)

  const options = useMemo<RenderOptions>(
    () => ({ ...stored, ...overrides, hoverCell: hover }),
    [stored, overrides, hover],
  )

  const { canvasRef, cellAt } = useRenderer(state, options, { enabled })

  const handleMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const cell = cellAt(e.clientX, e.clientY)
      setHover((prev) => {
        // Only re-render when the cell under the cursor actually changed;
        // a pointermove inside one cell is roughly 20 events per cell.
        if (prev === null && cell === null) return prev
        if (prev && cell && prev.x === cell.x && prev.y === cell.y) return prev
        return cell ? { x: cell.x, y: cell.y } : null
      })
    },
    [cellAt],
  )

  const handleLeave = useCallback(() => setHover(null), [])

  const handleClick = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (!onCellClick) return
      const cell = cellAt(e.clientX, e.clientY)
      if (cell) onCellClick(cell)
    },
    [cellAt, onCellClick],
  )

  const sample = hover && state ? sampleCell(state, hover) : null

  return (
    <div className={cn('relative isolate h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onClick={handleClick}
        className={cn('block h-full w-full touch-none', onCellClick && 'cursor-crosshair')}
        aria-label="Mission map"
      />
      {children}
      {showReadout && sample ? <CellReadout sample={sample} /> : null}
    </div>
  )
}

/**
 * Hovered-cell values.
 *
 * Says "orbital only" rather than printing a hazard number as though the
 * rover had measured it: the orbital layer is believed, not known, and the
 * difference is the point of the simulation.
 */
function CellReadout({ sample }: { sample: CellSample }) {
  return (
    <div className="num pointer-events-none absolute bottom-2 left-2 rounded-control border border-line bg-void/80 px-2.5 py-1.5 text-2xs leading-relaxed text-ink-muted backdrop-blur-sm">
      <span className="text-ink-faint">cell</span> {sample.cell.x},{sample.cell.y}
      {'  '}
      <span className="text-ink-faint">elev</span> {fmtNumber(sample.elevation, 1)}m
      {'  '}
      <span className="text-ink-faint">slope</span> {fmtDegrees(sample.slopeDeg)}
      {'  '}
      <span className="text-ink-faint">hazard</span> {fmtPercent(sample.hazard)}
      {'  '}
      <span className={sample.observed ? 'text-good' : 'text-warn'}>
        {sample.observed ? 'observed' : 'orbital only'}
      </span>
    </div>
  )
}
