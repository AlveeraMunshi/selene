// Vitest setup. Owned by the orchestrator; Agent F may add to it but should
// not reorder these imports — jest-dom must be registered before any test
// file runs or the custom matchers are missing in a confusing way.
import '@testing-library/jest-dom/vitest'

// jsdom implements neither canvas nor ResizeObserver, and the renderer reaches
// for both. Stubbing them here keeps every component test from having to.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub
}

if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
}
