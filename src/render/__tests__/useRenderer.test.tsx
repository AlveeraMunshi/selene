/**
 * The hook, and specifically the stale-closure trap it exists to avoid.
 *
 * A requestAnimationFrame loop started in an effect closes over the props of
 * the render that created it. If the loop reads `state` directly it will draw
 * the state from that one render forever, and because the loop keeps running
 * and the canvas keeps being repainted the symptom is a map frozen at tick 0
 * while the rest of the UI advances — which reads as a broken engine, not a
 * broken renderer. The first test here fails outright against that
 * implementation, which is the only reason it is worth writing.
 *
 * `requestAnimationFrame` is replaced with a manual pump so a "frame" is
 * something the test decides, rather than something jsdom's timer eventually
 * does.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { Cell, SimState } from '@/core/types'
import { useRenderer } from '../useRenderer'
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from '../scene'
import { makeMockState } from '../mock'
import { installCanvasStub, stubFor, uninstallCanvasStub } from './stubCanvas'

let pending: FrameRequestCallback | null = null
let clock = 0

const realRaf = globalThis.requestAnimationFrame
const realCaf = globalThis.cancelAnimationFrame
const realRect = HTMLCanvasElement.prototype.getBoundingClientRect

beforeAll(() => {
  installCanvasStub()
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    pending = cb
    return 1
  }) as typeof globalThis.requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {
    pending = null
  }) as typeof globalThis.cancelAnimationFrame
  // jsdom lays every element out at 0x0, which would collapse the viewport
  // scale and make most of the frame skip itself.
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
})

afterAll(() => {
  uninstallCanvasStub()
  globalThis.requestAnimationFrame = realRaf
  globalThis.cancelAnimationFrame = realCaf
  HTMLCanvasElement.prototype.getBoundingClientRect = realRect
})

afterEach(() => {
  cleanup()
  pending = null
})

/** Run one animation frame, the way the browser would. */
function pump(deltaMs = 16): void {
  clock += deltaMs
  const cb = pending
  pending = null
  if (cb === null) return
  act(() => {
    cb(clock)
  })
}

interface HarnessProps {
  state: SimState | null
  opts?: RenderOptions
  onCellAt?: (fn: (x: number, y: number) => Cell | null) => void
}

function Harness({ state, opts = DEFAULT_RENDER_OPTIONS, onCellAt }: HarnessProps) {
  const { canvasRef, cellAt } = useRenderer(state, opts)
  onCellAt?.(cellAt)
  return <canvas ref={canvasRef} data-testid="map" />
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const el = container.querySelector('canvas')
  if (el === null) throw new Error('no canvas rendered')
  return el
}

/**
 * Waypoint count is the discriminator: the renderer writes one number per
 * waypoint, so `fillText` call counts say which state a frame drew.
 */
function withWaypoints(state: SimState, extra: Cell[]): SimState {
  return {
    ...state,
    tick: state.tick + 1,
    config: { ...state.config, waypoints: [...state.config.waypoints, ...extra] },
  }
}

describe('useRenderer', () => {
  it('draws the LATEST state on every frame, not the one the loop was born with', () => {
    const first = makeMockState({ width: 32, height: 32, seed: 4, progress: 0.4 })
    const { container, rerender } = render(<Harness state={first} />)
    const stub = stubFor(canvasOf(container))

    pump()
    const afterFirst = stub.calls.fillText ?? 0
    expect(afterFirst).toBe(first.config.waypoints.length)

    // A new state arrives. A loop that captured `state` would keep drawing the
    // old one and this count would go up by 2 instead of 3.
    const second = withWaypoints(first, [{ x: 1, y: 1 }])
    rerender(<Harness state={second} />)
    pump()

    expect((stub.calls.fillText ?? 0) - afterFirst).toBe(second.config.waypoints.length)
    expect(second.config.waypoints.length).toBe(3)
  })

  it('picks up changed options without restarting the loop', () => {
    const state = makeMockState({ width: 32, height: 32, seed: 4, progress: 0.4 })
    const { container, rerender } = render(<Harness state={state} />)
    const stub = stubFor(canvasOf(container))

    pump()
    const base = Object.values(stub.calls).reduce((a, b) => a + b, 0)

    rerender(<Harness state={state} opts={{ ...DEFAULT_RENDER_OPTIONS, showTrail: false }} />)
    pump()
    const withTrailOff = Object.values(stub.calls).reduce((a, b) => a + b, 0) - base

    rerender(<Harness state={state} opts={DEFAULT_RENDER_OPTIONS} />)
    pump()
    const withTrailOn =
      Object.values(stub.calls).reduce((a, b) => a + b, 0) - base - withTrailOff

    expect(withTrailOn).toBeGreaterThan(withTrailOff)
  })

  it('keeps running frame after frame', () => {
    const state = makeMockState({ width: 32, height: 32, seed: 4 })
    const { container } = render(<Harness state={state} />)
    const stub = stubFor(canvasOf(container))
    for (let i = 0; i < 5; i++) pump()
    expect(stub.calls.setTransform).toBe(5)
  })

  it('draws nothing while the state is null', () => {
    const { container } = render(<Harness state={null} />)
    const stub = stubFor(canvasOf(container))
    pump()
    pump()
    expect(stub.calls.setTransform).toBeUndefined()
  })

  it('starts drawing once a state arrives', () => {
    const { container, rerender } = render(<Harness state={null} />)
    const stub = stubFor(canvasOf(container))
    pump()
    rerender(<Harness state={makeMockState({ width: 24, height: 24 })} />)
    pump()
    expect(stub.calls.setTransform).toBe(1)
  })

  it('exposes a working cellAt bound to the mounted canvas', () => {
    let cellAt: ((x: number, y: number) => Cell | null) | null = null
    const state = makeMockState({ width: 24, height: 24, seed: 2 })
    render(<Harness state={state} onCellAt={(fn) => (cellAt = fn)} />)
    pump()
    expect(cellAt).not.toBeNull()
    // 600x600 element, 24x24 grid: 25 css px per cell, no letterbox.
    const probe = cellAt as unknown as (x: number, y: number) => Cell | null
    expect(probe(12, 12)).toEqual({ x: 0, y: 0 })
    expect(probe(312, 262)).toEqual({ x: 12, y: 10 })
    expect(probe(-50, 10)).toBeNull()
  })

  it('stops the loop and releases the renderer on unmount', () => {
    const state = makeMockState({ width: 24, height: 24 })
    const { container, unmount } = render(<Harness state={state} />)
    const stub = stubFor(canvasOf(container))
    pump()
    const before = stub.calls.setTransform ?? 0
    unmount()
    pump()
    pump()
    expect(stub.calls.setTransform ?? 0).toBe(before)
    expect(pending).toBeNull()
  })

  it('survives a canvas with no 2D context instead of taking the app down', () => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = (() => null) as never
    try {
      const state = makeMockState({ width: 16, height: 16 })
      expect(() => {
        render(<Harness state={state} />)
        pump()
      }).not.toThrow()
    } finally {
      HTMLCanvasElement.prototype.getContext = original
    }
  })
})
