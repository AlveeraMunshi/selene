/**
 * The map.
 *
 * WHY THIS COMPONENT IS A LEAF AND STAYS A LEAF: it is the one place that
 * subscribes to a whole SimState, which changes identity on every tick. A
 * tick therefore re-renders exactly this component — a single canvas element
 * with a stable ref callback — and nothing above it. Putting a panel, a
 * legend or a telemetry readout *inside* this component's subtree would undo
 * that; overlays are passed in as children and rendered as siblings that do
 * not read the ticking state.
 *
 * The actual pixels are drawn by the renderer's own rAF loop (Agent D), not
 * by React. React's only job here is to hand it a canvas and the current
 * options.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { idx } from '@/core/terrain'
import type { Cell, SimState } from '@/core/types'
import type { RenderOptions } from '@/render/scene'
import { useRenderer } from '@/render/useRenderer'

import { cn } from '@/ui'
import { fmtDegrees, fmtNumber, fmtPercent } from '@/lib/format'
import { useRenderOptions } from '@/state/selectors'

export interface MapCanvasProps {
  state: SimState | null
  onCellClick?: (cell: Cell) => void
  /**
   * Per-map overrides on the stored layer preferences — the planner pins
   * `selectedCell` to the start, for instance. Memoize it at the call site;
   * a fresh object each render would churn the renderer's options.
   */
  overrides?: Partial<RenderOptions>
  /** Overlay content, positioned over the canvas and outside its render path. */
  children?: ReactNode
  className?: string
  /** The hovered-cell terrain readout. Off for small inline maps. */
  showReadout?: boolean
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
 * Belief rather than terrain on purpose: the readout must show what the rover
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
}: MapCanvasProps) {
  const stored = useRenderOptions()
  // Hover is local, never in the store: it changes on every mouse move, and a
  // store write per move would re-render every subscriber in the app.
  const [hover, setHover] = useState<Cell | null>(null)

  const handleHover = useCallback((cell: Cell | null) => {
    setHover((prev) => {
      if (prev === null && cell === null) return prev
      if (prev && cell && prev.x === cell.x && prev.y === cell.y) return prev
      return cell ? { x: cell.x, y: cell.y } : null
    })
  }, [])

  const options = useMemo<RenderOptions>(
    () => ({ ...stored, ...overrides, hoverCell: hover }),
    [stored, overrides, hover],
  )

  const { canvasRef } = useRenderer({ state, options, onCellClick, onCellHover: handleHover })

  const sample = hover && state ? sampleCell(state, hover) : null

  return (
    <div className={cn('relative isolate h-full w-full overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        // The canvas is the interaction surface; the renderer resolves clicks
        // to cells, so it needs to be focusable for keyboard users to reach
        // the controls around it in a sensible order.
        tabIndex={-1}
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
 * Shows "unobserved" explicitly rather than printing a hazard number the
 * rover has not actually measured — the orbital layer is believed, not known,
 * and the difference is the point of the simulation.
 */
function CellReadout({ sample }: { sample: CellSample }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-neutral-300 backdrop-blur-sm">
      <span className="text-neutral-500">cell</span> {sample.cell.x},{sample.cell.y}
      {'  '}
      <span className="text-neutral-500">elev</span> {fmtNumber(sample.elevation, 1)}m
      {'  '}
      <span className="text-neutral-500">slope</span> {fmtDegrees(sample.slopeDeg)}
      {'  '}
      <span className="text-neutral-500">hazard</span> {fmtPercent(sample.hazard)}
      {'  '}
      <span className={sample.observed ? 'text-emerald-400' : 'text-amber-400'}>
        {sample.observed ? 'observed' : 'orbital only'}
      </span>
    </div>
  )
}
