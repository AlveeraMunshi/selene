/**
 * Public surface of the render workstream.
 *
 * App code should import from here rather than from the individual modules,
 * so the internal split (cache, overlays, geometry) stays free to change.
 */

export { createRenderer, DEFAULT_RENDER_OPTIONS } from './scene'
export type { RenderOptions, Renderer } from './scene'
export { useRenderer } from './useRenderer'
export type { UseRendererConfig, UseRendererResult } from './useRenderer'
export { makeMockState, MOCK_ROVER } from './mock'
export type { MockOptions } from './mock'
export { PALETTE, RGB, elevationColor, hazardColor, cssRgb, luminance } from './colors'
export type { Rgb, RampStop } from './colors'
export {
  cellCentreToCss,
  clientToCell,
  cssToCell,
  gridToCss,
  makeViewport,
  viewportRect,
  viewportScale,
} from './viewport'
export type { Viewport } from './viewport'
