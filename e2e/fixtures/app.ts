/**
 * Page helpers shared by the journey specs.
 *
 * TWO RULES THIS FILE ENFORCES, BOTH OF THEM ABOUT FLAKINESS.
 *
 * 1. NOTHING HERE SLEEPS. The simulation runs at `2 x speed` Hz, so any
 *    assertion phrased as "wait 3 seconds and hope" is a test that passes on
 *    this laptop and fails on a loaded CI box. Every wait below is a wait for
 *    observable state: a text change, a control becoming enabled, a panel
 *    appearing. `advanceUntil` is the one loop that drives the clock, and it
 *    drives it by clicking Step -- one tick per click, no timing at all.
 *
 * 2. ACCESSIBLE QUERIES FIRST. Roles and names are stable across a restyle
 *    and double as an accessibility assertion. Two things in the app have no
 *    accessible anchor and need a structural locator instead; both are called
 *    out at the helper that works around them, and both are reported as
 *    accessibility gaps rather than quietly papered over.
 */

import { expect, type Locator, type Page } from '@playwright/test'

import type { Cell, MissionRecord } from '../../src/core/types'
import { MISSIONS_KEY, missionsEnvelope } from './records'

/** Every shipped scenario is 96x96; the renderer letterboxes a square grid. */
export const GRID = 96

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

/**
 * The value rendered by a `Stat` with this label.
 *
 * STRUCTURAL, NOT ACCESSIBLE, AND THAT IS A FINDING. `Stat` renders a label
 * div followed by a value div with no `aria-labelledby`, no `role` and no
 * `data-*` hook, so there is no accessible way to ask for "the value of
 * Ticks" -- a screen reader hears two unrelated runs of text. The XPath below
 * depends only on that two-div shape, not on any class name, which is the
 * least brittle thing available without editing `src/`.
 *
 * `.first()` because a few panels show the same word twice: "Distance" is a
 * Stat in the route preview AND a row in the cost breakdown underneath it.
 * The Stat always comes first in those panels.
 */
export function statValue(scope: Locator | Page, label: string): Locator {
  return scope
    .getByText(label, { exact: true })
    .first()
    .locator('xpath=following-sibling::div[1]')
}

/** The number printed beside a `Slider`'s label, e.g. "45%". */
export function sliderValue(scope: Locator | Page, label: string): Locator {
  return scope
    .getByText(label, { exact: true })
    .first()
    .locator('xpath=following-sibling::span[1]')
}

/**
 * The app header, which carries the mission clock and the status badge.
 *
 * Filtered by the tab strip rather than taken as "the banner", because the
 * intervention panel's own `<header>` is ALSO exposed as a banner landmark by
 * Chrome -- a second top-level landmark appearing on the page whenever the
 * rover asks a question. That is an accessibility defect in `src/` and is
 * reported as one; here it just means the plain query is ambiguous.
 */
export function header(page: Page): Locator {
  return page.getByRole('banner').filter({ has: page.getByRole('tablist') })
}

/**
 * A `Panel`, by its heading.
 *
 * `exact` is not optional here: Playwright matches an accessible name as a
 * SUBSTRING by default, and the planner carries both "Route" and "Route
 * preview", so the loose form silently resolves to two regions.
 */
export function panel(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true })
}

/** The one canvas on screen. Both the planner and the mission label it. */
export function map(page: Page): Locator {
  return page.getByLabel('Mission map')
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type ViewName = 'Planner' | 'Mission' | 'Analysis'

export async function openView(page: Page, name: ViewName): Promise<void> {
  await page.getByRole('tab', { name }).click()
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

/**
 * Load the app with a known-empty saved-mission list.
 *
 * Playwright gives each test its own context, so storage is already clean;
 * this is here so a test that WANTS seeded records and one that wants none
 * read the same way, and so the intent is explicit at the call site.
 */
export async function openApp(page: Page, records: MissionRecord[] = []): Promise<void> {
  await page.addInitScript(
    ([key, payload]: [string, string]) => {
      if (payload) window.localStorage.setItem(key, payload)
      else window.localStorage.removeItem(key)
    },
    [MISSIONS_KEY, records.length > 0 ? missionsEnvelope(records) : ''] as [string, string],
  )
  await page.goto('./')
  // The shell is up when the tab strip is; everything else renders under it.
  await expect(page.getByRole('tab', { name: 'Planner' })).toBeVisible()
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * The position, within the canvas element, of a cell's centre.
 *
 * Mirrors `src/render/viewport.ts`: the grid is scaled to fit by the smaller
 * axis and centred, with zoom 1 and no pan. Returning the CENTRE matters --
 * a cell is 5-7 CSS pixels across at the sizes this app renders at, so a
 * click aimed at a cell corner lands on its neighbour.
 */
export function cellPoint(
  box: { width: number; height: number },
  cell: Cell,
  grid: number = GRID,
): { x: number; y: number } {
  const scale = Math.min(box.width / grid, box.height / grid)
  const originX = (box.width - grid * scale) / 2
  const originY = (box.height - grid * scale) / 2
  return { x: originX + (cell.x + 0.5) * scale, y: originY + (cell.y + 0.5) * scale }
}

/** Click the centre of a specific grid cell on the visible map. */
export async function clickCell(page: Page, cell: Cell, grid: number = GRID): Promise<void> {
  const canvas = map(page)
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Map canvas has no layout box; the view is not rendered.')
  await canvas.click({ position: cellPoint(box, cell, grid) })
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/** The ordered route list: start first, then one entry per waypoint. */
export function routeEntries(page: Page): Locator {
  return panel(page, 'Route').getByRole('listitem')
}

export function launchButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(Launch|Relaunch) mission$/ })
}

/**
 * Wait for the debounced preview to finish and the planner to accept the
 * configuration. Launch becoming enabled is the store's own verdict that a
 * real A* run succeeded over every leg, so there is nothing better to wait on.
 */
export async function expectLaunchable(page: Page): Promise<void> {
  await expect(launchButton(page)).toBeEnabled({ timeout: 15_000 })
}

/**
 * Launch and land on the mission view.
 *
 * `PlannerView` switches tabs itself on a successful launch, so asserting the
 * tab is what proves the store actually created a simulation rather than
 * refusing an invalid config.
 */
export async function launch(page: Page): Promise<void> {
  await expectLaunchable(page)
  await launchButton(page).click()
  await expect(page.getByRole('tab', { name: 'Mission' })).toHaveAttribute('aria-selected', 'true')
}

/** Turn supervised autonomy off, so a launch starts driving immediately. */
export async function setAutonomous(page: Page): Promise<void> {
  const supervised = page.getByRole('switch', { name: 'Supervised autonomy' })
  if ((await supervised.getAttribute('aria-checked')) === 'true') await supervised.click()
  await expect(supervised).toHaveAttribute('aria-checked', 'false')
}

// ---------------------------------------------------------------------------
// Mission transport
// ---------------------------------------------------------------------------

export function transport(page: Page) {
  return {
    play: page.getByRole('button', { name: 'Play' }),
    pause: page.getByRole('button', { name: 'Pause' }),
    step: page.getByRole('button', { name: 'Step' }),
    reset: page.getByRole('button', { name: 'Reset' }),
    abort: page.getByRole('button', { name: 'Abort', exact: true }),
    speed: page.getByRole('combobox', { name: 'Playback speed' }),
  }
}

/** Current tick, read off the telemetry rail. */
export async function currentTick(page: Page): Promise<number> {
  const text = await statValue(panel(page, 'Traverse'), 'Ticks').innerText()
  return Number(text.replace(/[^0-9]/g, ''))
}

/**
 * Drive the simulation forward, one tick per click of Step, until `done`.
 *
 * WHY STEP AND NOT PLAY. `stepOnce` advances the engine exactly one tick and
 * leaves the mission paused, so this loop is a function of the engine alone
 * and not of how fast the machine happened to be running. A `play()` plus a
 * text-change assertion would also work, but it makes the number of ticks
 * elapsed when the assertion fires depend on the scheduler -- which is fine
 * for "did anything move" and wrong for "did the thing that happens at tick 7
 * happen".
 *
 * `maxSteps` is a bound, not a timeout: exceeding it means the engine's
 * behaviour changed, which should fail loudly rather than hang.
 */
export async function advanceUntil(
  page: Page,
  done: () => Promise<boolean>,
  maxSteps = 60,
): Promise<number> {
  const { step, pause } = transport(page)
  // Stepping requires the mission to be stopped; launching an unsupervised
  // mission starts the clock.
  if (await pause.isVisible()) await pause.click()

  for (let i = 0; i < maxSteps; i++) {
    if (await done()) return i
    if (!(await step.isEnabled())) {
      throw new Error(
        `Step became unavailable after ${i} ticks: the mission ended or is awaiting an operator.`,
      )
    }
    await step.click()
  }
  if (await done()) return maxSteps
  throw new Error(`Condition not reached within ${maxSteps} ticks.`)
}

// ---------------------------------------------------------------------------
// Intervention panel
// ---------------------------------------------------------------------------

export function interventionPanel(page: Page): Locator {
  return page.getByRole('alertdialog', { name: 'Operator decision required' })
}

/**
 * The button that commits to a named intervention option.
 *
 * STRUCTURAL, AND THIS ONE IS A REAL ACCESSIBILITY DEFECT. Every option card
 * renders a button whose entire accessible name is "Choose", so a form with
 * four options announces "Choose, Choose, Choose, Abort" and a screen-reader
 * user cannot tell which route they are committing to -- on the one screen in
 * the application where the operator is making an irreversible decision. The
 * XPath walks from the option's label paragraph to the button beside it,
 * which is the association a sighted user gets from proximity.
 */
export function interventionOption(page: Page, label: string): Locator {
  return interventionPanel(page)
    .getByText(label, { exact: true })
    .locator('xpath=parent::div/following-sibling::button')
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function missionRows(page: Page): Locator {
  return panel(page, 'Saved missions').getByRole('listitem')
}

export function replayPositionSlider(page: Page): Locator {
  return page.getByRole('slider', { name: 'Position' })
}
