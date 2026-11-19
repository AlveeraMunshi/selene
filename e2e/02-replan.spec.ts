/**
 * Journey 2 -- replanning on `dynamic-hazard`.
 *
 * DEVIATION FROM docs/TEST_PLAN.md, STATED ON PURPOSE. The plan says "run
 * dynamic-hazard to completion at speed". That mission is 1,026 ticks, which
 * is a little over two minutes at the fastest playback the UI offers, so a
 * test that did it would be a two-minute test whose assertions all concern
 * something that happens at tick 7. Running it to completion also proves
 * nothing the shorter run does not: the replan either fires or it does not.
 *
 * So this drives the clock with the Step control instead -- one engine tick
 * per click, no wall-clock dependency anywhere -- and asserts at the first
 * replan. Measured against the engine directly, `dynamic-hazard` replans at
 * ticks 7, 13, 19 and 25, so the 60-step bound is roughly eight times the
 * distance needed and a failure means the engine changed, not that the
 * machine was slow.
 *
 * WHAT CANNOT BE ASSERTED HERE: that the abandoned route is DRAWN. The map
 * is a canvas, and its pixels are reviewed by screenshot rather than
 * asserted. What is assertable, and is stronger than a pixel check, is that
 * the layer is enabled and that the decision record behind the ghost exists
 * and agrees with the telemetry.
 */

import { expect, test } from '@playwright/test'

import {
  header,
  launch,
  openApp,
  panel,
  setAutonomous,
  statValue,
  transport,
} from './fixtures/app'

test('a discovered hazard forces a replan, and the record matches the route taken', async ({
  page,
}) => {
  await openApp(page)

  await page.getByRole('radio', { name: /^Regolith Trap/ }).click()
  await expect(header(page)).toContainText('Regolith Trap')

  // Autonomous: supervised raises `repeated-replanning` at tick 25, which
  // would stop the stepping loop. The replan under test is at tick 7 either
  // way -- the autonomy level does not change when the hazard is found, only
  // whether the rover eventually stops to ask about it.
  await setAutonomous(page)
  await launch(page)

  const traverse = panel(page, 'Traverse')
  const objective = panel(page, 'Objective')
  const replans = statValue(objective, 'Replans')

  await expect(replans).toHaveText('0')

  // --- drive forward one tick at a time until the rover replans ----------
  const { step, pause } = transport(page)
  if (await pause.isVisible()) await pause.click()

  let ticksSpent = 0
  for (let i = 0; i < 60; i++) {
    if ((await replans.innerText()) !== '0') break
    await expect(step).toBeEnabled()
    await step.click()
    ticksSpent++
  }

  await expect(replans).not.toHaveText('0')
  expect(ticksSpent, 'a replan should occur early in this scenario').toBeLessThan(60)

  // --- the decision stream gained a replan entry -------------------------
  const stream = panel(page, 'Decision stream')
  const replanEntry = stream.getByRole('button', { name: /Replan/ }).first()
  await expect(replanEntry).toBeVisible()
  await expect(stream.getByRole('button', { name: /Initial plan/ })).toBeVisible()

  // --- its numbers match the route actually being driven -----------------
  // PRODUCT_SPEC's acceptance for this scenario. The telemetry rail prints
  // the live route's predicted energy; the decision record prints the energy
  // of the candidate it selected. Both go through `fmtEnergy`, so a mismatch
  // means the rover is driving a route other than the one it recorded
  // choosing.
  await replanEntry.click()
  const inspector = panel(page, 'Decision inspector')
  await expect(inspector).toContainText('Replan')
  await expect(inspector).toContainText('Candidates evaluated')

  // `.last()` is the innermost div holding the "Selected" badge, which is the
  // card's header row; its parent is the candidate card itself. `.first()` on
  // "Energy" because the card prints it twice -- once as a route figure and
  // once as a cost-breakdown term -- and the route figure comes first.
  const selectedCard = inspector
    .locator('div')
    .filter({ has: page.getByText('Selected', { exact: true }) })
    .last()
    .locator('xpath=..')
  const chosenEnergy = await selectedCard
    .getByText('Energy', { exact: true })
    .first()
    .locator('xpath=following-sibling::span[1]')
    .innerText()

  await expect(statValue(objective, 'Route predicts')).toHaveText(chosenEnergy)

  // --- the ghost of the abandoned plan is enabled ------------------------
  // The canvas cannot be asserted on; that the layer is on, and that the
  // engine has something to put in it, is what is checkable from the DOM.
  await expect(page.getByRole('switch', { name: 'Abandoned routes' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // And the mission really did move while this happened.
  await expect(statValue(traverse, 'Distance')).not.toHaveText('0.0 m')
})
