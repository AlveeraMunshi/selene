/**
 * Journey 3 -- the operator decision.
 *
 * "Run supervised until the approval panel appears, choose an option, assert
 * the mission resumes."
 *
 * No running is needed. Under supervised autonomy `createSimulation` plans
 * the opening route and raises an approval request for it before the clock
 * has started, so the default configuration -- Mare Traverse, supervised --
 * opens the mission view already waiting, at tick 0, on
 * `risk-exceeds-tolerance`. That is the behaviour the store comments call out
 * and it is why this journey is instant rather than a two-minute wait.
 *
 * The important half of the assertion is not that the panel appears. It is
 * that the mission is VISIBLY stopped while it is up -- `step()` is a no-op
 * against a pending request, so a mission whose transport still offered Play
 * would be lying about being able to move.
 */

import { expect, test } from '@playwright/test'

import {
  header,
  interventionOption,
  interventionPanel,
  launch,
  openApp,
  panel,
  statValue,
  transport,
} from './fixtures/app'

test.describe('operator intervention', () => {
  test('a supervised mission holds for the operator and resumes on a choice', async ({ page }) => {
    await openApp(page)

    // The default is supervised; assert that rather than assume it, because
    // the whole journey hangs off it.
    await expect(page.getByRole('switch', { name: 'Supervised autonomy' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await launch(page)

    // --- the mission is held ----------------------------------------------
    const dialog = interventionPanel(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Risk exceeds tolerance')
    await expect(dialog).toContainText('The mission is stopped and will not advance')

    // Stated in the header too, so an operator looking at the clock knows why
    // it is not moving.
    await expect(header(page)).toContainText('Awaiting operator')
    await expect(panel(page, 'Rover')).toContainText('Awaiting approval')

    // The transport must not offer to advance a mission that cannot advance.
    await expect(transport(page).play).toBeDisabled()
    await expect(transport(page).step).toBeDisabled()
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).toHaveText('0')

    // --- the alternatives are real, and carry their costs ------------------
    // "Choosing between Detour and Push through with no numbers is not a
    // decision, it is a coin toss." Both routed options show their figures.
    await expect(dialog).toContainText('Proceed on the planned route')
    await expect(dialog).toContainText('Take the risk-averse route')
    await expect(dialog).toContainText('Abort the mission')
    await expect(dialog.getByText('Peak hazard', { exact: true })).toHaveCount(2)

    // --- choose, and the mission resumes -----------------------------------
    await interventionOption(page, 'Proceed on the planned route').click()

    await expect(dialog).toBeHidden()
    await expect(header(page)).toContainText('Running')
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).not.toHaveText('0')
    await expect(panel(page, 'Rover')).toContainText('Driving')

    // The choice is recorded, not just acted on.
    await expect(
      panel(page, 'Decision stream').getByRole('button', { name: /Intervention resolved/ }),
    ).toBeVisible()
  })

  test('choosing abort ends the mission and records it', async ({ page }) => {
    await openApp(page)
    await launch(page)

    const dialog = interventionPanel(page)
    await expect(dialog).toBeVisible()

    // The abort option renders its own button rather than a "Choose", which
    // is the one place the option cards distinguish themselves by name.
    await dialog.getByRole('button', { name: 'Abort' }).click()

    await expect(dialog).toBeHidden()
    await expect(header(page)).toContainText('Finished')
    await expect(panel(page, 'Rover')).toContainText('Aborted')

    // A finished mission is saved automatically; that is what makes the
    // Analysis view reachable without a save step.
    await page.getByRole('tab', { name: 'Analysis' }).click()
    await expect(panel(page, 'Saved missions').getByRole('listitem')).toHaveCount(1)
    await expect(panel(page, 'Saved missions')).toContainText('Aborted')
    await expect(panel(page, 'Saved missions')).toContainText('Mare Traverse')
  })
})
