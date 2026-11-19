/**
 * Review artifacts, not assertions.
 *
 * The map is a canvas and its pixels cannot be asserted on, so the four
 * screens that matter are captured here for a human to look at. These write
 * to `e2e/screenshots/` and are deliberately a separate file so they can be
 * skipped (`--grep-invert screenshot`) without losing a journey.
 *
 * The viewport is pinned so two captures are comparable; nothing here fails
 * on a pixel difference, because a renderer that is one shade off is a design
 * review and not a test failure.
 */

import { expect, test } from '@playwright/test'

import {
  interventionOption,
  interventionPanel,
  launch,
  map,
  openApp,
  openView,
  panel,
  replayPositionSlider,
  setAutonomous,
  statValue,
  transport,
} from './fixtures/app'
import { completedRecord } from './fixtures/records'

const DIR = 'e2e/screenshots'

test.use({ viewport: { width: 1440, height: 900 } })

test.describe('screenshot', () => {
  test('planner', async ({ page }) => {
    await openApp(page)
    // Wait for a planned route rather than for a duration: the map is worth
    // looking at only once the preview has drawn a line on it.
    await expect(statValue(panel(page, 'Route preview'), 'Distance')).toHaveText(/\d/)
    await expect(map(page)).toBeVisible()
    await page.screenshot({ path: `${DIR}/01-planner.png`, fullPage: false })
  })

  test('intervention', async ({ page }) => {
    await openApp(page)
    await launch(page)
    await expect(interventionPanel(page)).toBeVisible()
    await page.screenshot({ path: `${DIR}/02-intervention.png` })
  })

  test('live mission', async ({ page }) => {
    await openApp(page)
    await launch(page)
    await interventionOption(page, 'Proceed on the planned route').click()

    // Let the rover get somewhere worth photographing: drive it to a decision
    // or a hundred ticks, whichever comes first, by stepping.
    await transport(page).pause.click()
    const ticks = statValue(panel(page, 'Traverse'), 'Ticks')
    for (let i = 0; i < 60; i++) {
      if (!(await transport(page).step.isEnabled())) break
      await transport(page).step.click()
    }
    await expect(ticks).not.toHaveText('0')

    // With a decision selected, so the inspector has content in the frame.
    await panel(page, 'Decision stream').getByRole('button').first().click()
    await page.screenshot({ path: `${DIR}/03-mission.png` })
  })

  test('analysis', async ({ page }) => {
    await openApp(page, [completedRecord()])
    await openView(page, 'Analysis')
    await expect(panel(page, 'Power over time')).toBeVisible()
    await expect(map(page)).toBeVisible()
    await page.screenshot({ path: `${DIR}/04-analysis.png` })

    // Scrubbed back to the start, which is the state that proves the replay
    // drives the renderer rather than only the label.
    await replayPositionSlider(page).fill('0')
    await expect(panel(page, 'Replay')).toContainText('tick 0')
    await page.screenshot({ path: `${DIR}/05-analysis-scrubbed.png` })
  })

  test('mission at 900px', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 })
    await openApp(page)
    await setAutonomous(page)
    await launch(page)
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).not.toHaveText('0')
    // Space rather than the Pause button: at this width the transport is
    // covered by the decision column and the click is intercepted. See the
    // documented defect in 06-keyboard-responsive.spec.ts -- this screenshot
    // is the evidence for it.
    await page.keyboard.press(' ')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
    await page.screenshot({ path: `${DIR}/06-mission-900px.png`, fullPage: true })
  })
})
