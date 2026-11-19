/**
 * Journey 4 -- the risk slider reaches the cost function.
 *
 * PRODUCT_SPEC states the acceptance in the strongest terms available: "If it
 * does not, the cost model is not wired to the UI and the feature is a lie."
 * So this asserts more than "something changed". `competing-objectives` was
 * seeded to produce two genuinely different homotopy classes -- a long safe
 * detour and a short risky corridor -- and the scenario records the measured
 * figures: 752 m at peak hazard 0.27 for riskTolerance 0.15, and 490 m at
 * peak hazard 0.75 for riskTolerance 0.90.
 *
 * The assertion is therefore directional: raising tolerance must make the
 * previewed route SHORTER and RISKIER. A change in the wrong direction is a
 * cost model wired up backwards, which "the text differs" would pass.
 *
 * READING THE PREVIEW IS THE WHOLE DIFFICULTY. The store debounces planning
 * by 120 ms, so the figures on screen immediately after a control moves are
 * the PREVIOUS plan's. A first draft of this test read them too early, took
 * Mare Traverse's 482 m as the cautious distance, and failed comparing it
 * against Rille Crossing's 490 m -- a real race, caught on the first run.
 * Every read below is therefore gated on the figure changing away from a
 * captured previous value, never on a timer.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'

import { header, openApp, panel, sliderValue, statValue } from './fixtures/app'

/** "752 m" / "1.23 km" -> metres. */
async function metres(locator: Locator): Promise<number> {
  const text = (await locator.innerText()).trim()
  const value = Number(text.replace(/[^0-9.]/g, ''))
  expect(Number.isFinite(value), `unreadable distance: ${text}`).toBe(true)
  return /km/.test(text) ? value * 1000 : value
}

/** "27%" -> 27. */
async function percent(locator: Locator): Promise<number> {
  const text = (await locator.innerText()).trim()
  const value = Number(text.replace(/[^0-9.]/g, ''))
  expect(Number.isFinite(value), `unreadable percentage: ${text}`).toBe(true)
  return value
}

function riskValue(page: Page): Locator {
  return sliderValue(panel(page, 'Mission parameters'), 'Risk tolerance')
}

test('risk tolerance changes the previewed route on competing-objectives', async ({ page }) => {
  await openApp(page)

  const preview = panel(page, 'Route preview')
  const distance = statValue(preview, 'Distance')
  const peakHazard = statValue(preview, 'Peak hazard')
  const risk = page.getByRole('slider', { name: 'Risk tolerance' })

  await page.getByRole('radio', { name: /^Rille Crossing/ }).click()
  await expect(header(page)).toContainText('Rille Crossing')
  // Rille Crossing has one waypoint and Mare Traverse has two, so the leg
  // count is proof the preview on screen belongs to the new scenario rather
  // than being the old one still sitting there behind the debounce.
  await expect(preview).toContainText('1 leg')

  // --- cautious ----------------------------------------------------------
  const atDefaultTolerance = await distance.innerText()
  await risk.fill('0.15')
  await expect(riskValue(page)).toHaveText('15%')
  await expect(distance).not.toHaveText(atDefaultTolerance, { timeout: 15_000 })

  const cautiousText = await distance.innerText()
  const cautiousDistance = await metres(distance)
  const cautiousHazard = await percent(peakHazard)

  // --- bold ---------------------------------------------------------------
  await risk.fill('0.9')
  await expect(riskValue(page)).toHaveText('90%')
  await expect(distance).not.toHaveText(cautiousText, { timeout: 15_000 })

  const boldDistance = await metres(distance)
  const boldHazard = await percent(peakHazard)

  // --- the route genuinely swapped class ----------------------------------
  expect(
    boldDistance,
    'raising risk tolerance should open the short corridor, not lengthen the route',
  ).toBeLessThan(cautiousDistance)
  expect(
    boldHazard,
    'the short corridor is the risky one; peak hazard must rise with tolerance',
  ).toBeGreaterThan(cautiousHazard)

  // --- and the slider really is a range input -----------------------------
  // PRODUCT_SPEC's accessibility floor says so explicitly, and a div with a
  // drag handler would pass every assertion above.
  await expect(risk).toHaveAttribute('type', 'range')
  await risk.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(riskValue(page)).toHaveText('89%')
})

test('an unsatisfiable constraint is reported as the planner stated it', async ({ page }) => {
  await openApp(page)

  // A 5-degree climb limit on cratered mare terrain is not a route the
  // planner can find. PRODUCT_SPEC requires the preview be replaced by the
  // planner's own failure reason, and Launch disabled carrying that reason
  // rather than greyed out in silence.
  await page.getByRole('slider', { name: 'Maximum slope' }).fill('5')
  await expect(sliderValue(panel(page, 'Mission parameters'), 'Maximum slope')).toHaveText('5°')

  await expect(page.getByRole('button', { name: /^(Launch|Relaunch) mission$/ })).toBeDisabled({
    timeout: 15_000,
  })
  await expect(panel(page, 'Launch')).toContainText(/Waypoint \d/)
  await expect(panel(page, 'Route preview').getByText(/cannot be planned/i)).toBeVisible()
})
