/**
 * React binding for the renderer: a requestAnimationFrame loop, a
 * ResizeObserver, and the interpolation clock.
 *
 * THE BUG THIS FILE IS SHAPED AROUND. A rAF loop started in an effect closes
 * over the props of the render that created it. If the loop reads `state`
 * directly, it reads the state from that one render, forever — and because the
 * loop keeps running and the canvas keeps being repainted with identical
 * pixels, the symptom is a map that is frozen at tick 0 while the numbers in
 * the sidebar advance normally. It looks exactly like a broken engine, which
 * is where the time goes. The fix is the only non-obvious thing here: the
 * latest state, options and timing live in refs, the loop is started once and
 * reads only refs, and the refs are written in a layout effect so they are
 * current before the next frame can run.
 *
 * THE INTERPOLATION CLOCK. `alpha` is how far the display is into the window
 * between the last two engine ticks. Rather than trusting a configured tick
 * rate — which is wrong the moment the user moves a speed slider, and wrong
 * again whenever the engine is paused — the hook *measures* the interval
 * between arriving ticks and smooths it. A measured interval degrades
 * gracefully: if ticks stop, alpha saturates at 1 and the rover rests exactly
 * on the last state the engine actually computed.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Cell, SimState } from '@/core/types'
import { TICK_SECONDS } from '@/core/types'
import { clamp01 } from './interp'
import { createRenderer, type RenderOptions, type Renderer } from './scene'

export interface UseRendererConfig {
  /**
   * Expected milliseconds between engine ticks, used until enough real ticks
   * have arrived to measure it. Defaults to the engine's own tick length.
   */
  tickMs?: number
  /** Set false to stop the animation loop entirely, e.g. when the map is hidden. */
  enabled?: boolean
}

export interface UseRendererResult {
  /** Attach to the `<canvas>`: `<canvas ref={canvasRef} />`. */
  canvasRef: (el: HTMLCanvasElement | null) => void
  /** Map a pointer event's client coordinates to a grid cell, or null. */
  cellAt: (clientX: number, clientY: number) => Cell | null
}

/** Clamp the measured tick interval so one stall cannot wreck the animation. */
const MIN_INTERVAL_MS = 40
const MAX_INTERVAL_MS = 4000

/** Weight of a newly measured interval in the running average. */
const INTERVAL_SMOOTHING = 0.25

export function useRenderer(
  state: SimState | null,
  opts: RenderOptions,
  config: UseRendererConfig = {},
): UseRendererResult {
  const defaultInterval = config.tickMs ?? TICK_SECONDS * 1000
  const enabled = config.enabled ?? true

  // --- the latest-value refs the loop reads -------------------------------
  const stateRef = useRef<SimState | null>(state)
  const optsRef = useRef<RenderOptions>(opts)
  const enabledRef = useRef(enabled)

  // --- interpolation clock ------------------------------------------------
  const lastTickRef = useRef<number>(Number.NaN)
  const lastTickAtRef = useRef<number>(0)
  const intervalRef = useRef<number>(defaultInterval)

  // --- owned objects ------------------------------------------------------
  const rendererRef = useRef<Renderer | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const rafRef = useRef<number>(0)
  const dprQueryRef = useRef<MediaQueryList | null>(null)
  const dprHandlerRef = useRef<(() => void) | null>(null)

  const now = useCallback((): number => {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }, [])

  /**
   * Written in a *layout* effect rather than during render. Assigning a ref
   * while rendering stores values from renders React may discard; a layout
   * effect runs after commit and before paint, so the next animation frame is
   * guaranteed to see committed data and never a frame late.
   */
  useLayoutEffect(() => {
    stateRef.current = state
    optsRef.current = opts
    enabledRef.current = enabled

    if (state === null) return
    if (state.tick !== lastTickRef.current) {
      const t = now()
      if (Number.isFinite(lastTickRef.current) && lastTickAtRef.current > 0) {
        const measured = t - lastTickAtRef.current
        if (measured >= MIN_INTERVAL_MS && measured <= MAX_INTERVAL_MS) {
          intervalRef.current =
            intervalRef.current * (1 - INTERVAL_SMOOTHING) + measured * INTERVAL_SMOOTHING
        } else {
          // A pause, a scrub or a reset: do not let it poison the average.
          intervalRef.current = defaultInterval
        }
      }
      lastTickRef.current = state.tick
      lastTickAtRef.current = t
    }
  })

  const measureInto = useCallback((el: HTMLCanvasElement, renderer: Renderer) => {
    const rect = el.getBoundingClientRect()
    const w = rect.width > 0 ? rect.width : el.clientWidth
    const h = rect.height > 0 ? rect.height : el.clientHeight
    renderer.resize(Math.max(1, w), Math.max(1, h))
  }, [])

  /**
   * Re-arm a one-shot media query that fires when the device-pixel ratio
   * changes, which happens when the window is dragged to another monitor.
   * A ResizeObserver does not fire for that — the CSS size is unchanged — so
   * without this the canvas keeps its old backing resolution and goes soft.
   */
  const watchDpr = useCallback(
    (el: HTMLCanvasElement, renderer: Renderer) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
      const arm = (): void => {
        const q = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        const onChange = (): void => {
          measureInto(el, renderer)
          arm()
        }
        q.addEventListener('change', onChange, { once: true })
        dprQueryRef.current = q
        dprHandlerRef.current = () => q.removeEventListener('change', onChange)
      }
      arm()
    },
    [measureInto],
  )

  const teardown = useCallback(() => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    observerRef.current?.disconnect()
    observerRef.current = null
    dprHandlerRef.current?.()
    dprHandlerRef.current = null
    dprQueryRef.current = null
    rendererRef.current?.destroy()
    rendererRef.current = null
  }, [])

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      teardown()
      if (el === null) return

      let renderer: Renderer
      try {
        renderer = createRenderer(el)
      } catch {
        // No 2D context (jsdom, a lost context). Leave the canvas blank rather
        // than taking the whole app down over a presentation layer.
        return
      }
      rendererRef.current = renderer
      measureInto(el, renderer)
      watchDpr(el, renderer)

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (entry === undefined) return
          const box = entry.contentRect
          renderer.resize(Math.max(1, box.width), Math.max(1, box.height))
        })
        ro.observe(el)
        observerRef.current = ro
      }

      // One loop, started once, reading only refs. See the file header.
      const frame = (t: number): void => {
        rafRef.current = requestAnimationFrame(frame)
        const r = rendererRef.current
        const s = stateRef.current
        if (r === null || s === null || !enabledRef.current) return
        const alpha = clamp01((t - lastTickAtRef.current) / intervalRef.current)
        r.draw(s, optsRef.current, alpha)
      }
      if (typeof requestAnimationFrame === 'function') {
        rafRef.current = requestAnimationFrame(frame)
      }
    },
    [measureInto, teardown, watchDpr],
  )

  useEffect(() => teardown, [teardown])

  const cellAt = useCallback((clientX: number, clientY: number): Cell | null => {
    return rendererRef.current?.cellAt(clientX, clientY) ?? null
  }, [])

  return useMemo(() => ({ canvasRef, cellAt }), [canvasRef, cellAt])
}
