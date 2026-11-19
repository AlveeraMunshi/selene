/**
 * A minimal recording 2D context for tests.
 *
 * jsdom ships no canvas implementation, so `getContext('2d')` returns null and
 * `createRenderer` refuses to start. Rather than pull in the native `canvas`
 * package — a compiled dependency, for tests that never look at a pixel — this
 * stands up a Proxy that answers every drawing call with a no-op and records
 * how many times each one was made. That is enough to exercise the real
 * renderer end to end and to assert the one thing the pixels cannot tell us:
 * how often the terrain was re-baked.
 *
 * `createImageData` returns a genuine buffer, so the bake really runs and a
 * crash or an out-of-range write in it still fails the test.
 */

export interface CanvasStub {
  calls: Record<string, number>
  /** Arguments of the most recent call to each method. */
  lastArgs: Record<string, unknown[]>
  props: Record<string, unknown>
  reset(): void
}

const stubs = new WeakMap<object, CanvasStub>()

function makeContext(): { ctx: CanvasRenderingContext2D; stub: CanvasStub } {
  const calls: Record<string, number> = {}
  const lastArgs: Record<string, unknown[]> = {}
  const props: Record<string, unknown> = {}

  const target: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, key) {
      const k = String(key)
      if (k === 'createImageData') {
        return (w: number, h: number) => ({
          width: w,
          height: h,
          colorSpace: 'srgb',
          data: new Uint8ClampedArray(w * h * 4),
        })
      }
      if (k === 'getImageData') {
        return (_x: number, _y: number, w: number, h: number) => ({
          width: w,
          height: h,
          colorSpace: 'srgb',
          data: new Uint8ClampedArray(w * h * 4),
        })
      }
      if (k === 'measureText') return () => ({ width: 8 })
      if (k in props) return props[k]
      return (...args: unknown[]) => {
        calls[k] = (calls[k] ?? 0) + 1
        lastArgs[k] = args
        return undefined
      }
    },
    set(_t, key, value) {
      props[String(key)] = value
      return true
    },
  }

  const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D
  const stub: CanvasStub = {
    calls,
    lastArgs,
    props,
    reset() {
      for (const k of Object.keys(calls)) delete calls[k]
      for (const k of Object.keys(lastArgs)) delete lastArgs[k]
    },
  }
  return { ctx, stub }
}

let installed = false
let original: typeof HTMLCanvasElement.prototype.getContext | undefined

/**
 * Patch `HTMLCanvasElement.prototype.getContext` for the whole file. One
 * context per element, so a renderer's main canvas and its offscreen cache get
 * separate recorders.
 */
export function installCanvasStub(): void {
  if (installed) return
  installed = true
  original = HTMLCanvasElement.prototype.getContext
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null
    let ctx = contexts.get(this)
    if (ctx === undefined) {
      const made = makeContext()
      ctx = made.ctx
      contexts.set(this, ctx)
      stubs.set(ctx as unknown as object, made.stub)
    }
    return ctx
  } as never
}

export function uninstallCanvasStub(): void {
  if (!installed) return
  installed = false
  if (original !== undefined) HTMLCanvasElement.prototype.getContext = original
}

/** The recorder behind a canvas's 2D context. */
export function stubFor(canvas: HTMLCanvasElement): CanvasStub {
  const ctx = canvas.getContext('2d') as unknown as object
  const s = stubs.get(ctx)
  if (s === undefined) throw new Error('stubFor: canvas stub not installed')
  return s
}

/** A canvas with a fixed laid-out rectangle, which jsdom otherwise reports as 0x0. */
export function makeCanvas(
  rect: { left: number; top: number; width: number; height: number },
): HTMLCanvasElement {
  const el = document.createElement('canvas')
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect
  return el
}

/** Temporarily set `window.devicePixelRatio`, which jsdom leaves writable. */
export function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    writable: true,
    value,
  })
}
