/**
 * Journey 1 -- the vertical slice.
 *
 * "Choose scenario, set start and a waypoint, see a preview, launch, observe
 * the rover's position change, pause, reset."
 *
 * The waypoint placed here is (12, 80), eight cells from the default start.
 * That is deliberate: it is a real cell on real terrain that the planner
 * routes to, and the mission it produces is 143 ticks rather than the 1,440
 * of the scenario's own suggested route -- short enough that the test could
 * in principle watch it finish, though it does not need to.
 */

import { expect, test } from '@playwright/test'

import {
  clickCell,
  expectLaunchable,
  header,
  launch,
  map,
  openApp,
  panel,
  routeEntries,
  setAutonomous,
  statValue,
  transport,
} from './fixtures/app'

test.describe('vertical slice', () => {
  test('choose a scenario, place a route, launch it, pause it, reset it', async ({ page }) => {
    await openApp(page)

    // --- choose a scenario ------------------------------------------------
    // Switching scenarios must replace start and waypoints wholesale: cells
    // from the previous map have no meaning on this one.
    await page.getByRole('radio', { name: /^Rille Crossing/ }).click()
    await expect(routeEntries(page).first()).toContainText('8, 8')

    await page.getByRole('radio', { name: /^Mare Traverse/ }).click()
    await expect(page.getByRole('radio', { name: /^Mare Traverse/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(routeEntries(page).first()).toContainText('4, 88')
    await expect(header(page)).toContainText('Mare Traverse')

    // --- set the start ----------------------------------------------------
    await page.getByRole('radio', { name: 'Move start' }).click()
    await clickCell(page, { x: 4, y: 87 })
    await expect(routeEntries(page).first()).toContainText('4, 87')

    // Placing a start is a one-shot tool: the next click must add a waypoint
    // rather than move the start again.
    await expect(page.getByRole('radio', { name: 'Add waypoints' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // --- set a waypoint ---------------------------------------------------
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(panel(page, 'Route')).toContainText('No waypoints')
    await expect(page.getByRole('button', { name: 'Launch mission' })).toBeDisabled()
    await expect(panel(page, 'Launch')).toContainText('Add at least one waypoint on the map.')

    await clickCell(page, { x: 12, y: 80 })
    await expect(routeEntries(page)).toHaveCount(2) // start + one waypoint
    await expect(routeEntries(page).nth(1)).toContainText('12, 80')

    // --- see a preview ----------------------------------------------------
    const preview = panel(page, 'Route preview')
    await expect(statValue(preview, 'Distance')).toHaveText(/^\d+(\.\d+)? m$/)
    await expect(statValue(preview, 'Predicted energy')).toHaveText(/Wh$/)
    await expect(preview).toContainText('1 leg')
    await expectLaunchable(page)

    // --- launch -----------------------------------------------------------
    // Autonomous, so the clock starts on launch. The supervised path -- which
    // opens paused on an approval request -- is journey 3.
    await setAutonomous(page)
    await expectLaunchable(page)
    await launch(page)

    await expect(header(page)).toContainText('Running')
    await expect(map(page)).toBeVisible()

    // --- observe the rover move -------------------------------------------
    // Observable state, not elapsed time: the tick counter and the odometer
    // are engine readings, and both are zero until the simulation advances.
    const traverse = panel(page, 'Traverse')
    await expect(statValue(traverse, 'Ticks')).not.toHaveText('0')
    await expect(statValue(traverse, 'Distance')).not.toHaveText('0.0 m')
    await expect(panel(page, 'Rover')).toContainText('Driving')

    // --- pause ------------------------------------------------------------
    await transport(page).pause.click()
    await expect(header(page)).toContainText('Paused')
    await expect(transport(page).play).toBeEnabled()

    // --- reset ------------------------------------------------------------
    await transport(page).reset.click()
    await expect(page.getByText('No mission running')).toBeVisible()
    await expect(header(page)).toContainText('Idle')
    await expect(header(page)).toContainText('--:--')
  })

  test('the empty mission view sends the operator back to the planner', async ({ page }) => {
    await openApp(page)
    await page.getByRole('tab', { name: 'Mission' }).click()

    await expect(page.getByText('No mission running')).toBeVisible()
    await page.getByRole('button', { name: 'Open the planner' }).click()
    await expect(page.getByRole('tab', { name: 'Planner' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(panel(page, 'Scenario')).toBeVisible()
  })
})
