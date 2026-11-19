/**
 * The states PRODUCT_SPEC says every screen must handle.
 *
 * Four of the eight are covered by the journeys -- no waypoints and route
 * infeasible in 04, mission not started in 01, awaiting approval in 03, no
 * saved missions in 05. This file covers the rest, plus two that are only
 * reachable by arranging the environment rather than by driving the UI:
 * storage being unavailable, and a mission the engine FAILED.
 *
 * "Render context lost" is covered at component level in
 * `tests/error-boundary.integration.test.tsx`, because forcing a real canvas
 * context loss from Playwright would mean reaching into `src/`.
 */

import { expect, test } from '@playwright/test'

import {
  header,
  launch,
  missionRows,
  openApp,
  openView,
  panel,
  setAutonomous,
  statValue,
  transport,
} from './fixtures/app'
import {
  failedRecord,
  MISSIONS_KEY,
  missionsEnvelope,
  unresolvableRecord,
} from './fixtures/records'

test('a failed mission is recorded with the engine stated reason, not a generic error', async ({
  page,
}) => {
  const record = failedRecord()
  expect(record.outcome).toBe('failed')

  await openApp(page, [record])
  await openView(page, 'Analysis')

  await expect(panel(page, 'Saved missions')).toContainText('Failed')
  await expect(statValue(panel(page, 'Metrics'), 'Waypoints')).toHaveText('0 / 1')

  // The engine's own words, carried through the record's event log. This is
  // the only place in the application where the failure reason is rendered;
  // the mission view shows the outcome as a badge and does not state why.
  await expect(panel(page, 'Event log')).toContainText('Mission failed')
  await expect(panel(page, 'Event log')).toContainText('battery fell below the 15% reserve')
})

test('a finished mission is saved and the next launch does not lose it', async ({ page }) => {
  await openApp(page)
  await setAutonomous(page)
  await launch(page)

  // Abort is the one way to end a mission on demand; the engine records it
  // as an outcome exactly like a completion, which is what puts it in the
  // list.
  await transport(page).abort.click()
  await expect(header(page)).toContainText('Finished')
  await expect(transport(page).abort).toBeDisabled()

  await openView(page, 'Analysis')
  await expect(missionRows(page)).toHaveCount(1)

  // Launch a second mission; the first must still be on file.
  await openView(page, 'Planner')
  await launch(page)
  await transport(page).abort.click()
  await openView(page, 'Analysis')
  await expect(missionRows(page)).toHaveCount(2)
})

test('storage being unavailable is stated, and does not take the app down', async ({ page }) => {
  // Safari private browsing, a full quota and a blocked embedded context all
  // present as `localStorage` THROWING rather than returning null, which is
  // the case `src/lib/persist.ts` is written around.
  await page.addInitScript(() => {
    const blocked = {
      getItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      clear() {
        throw new DOMException('denied', 'SecurityError')
      },
      key() {
        throw new DOMException('denied', 'SecurityError')
      },
      length: 0,
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => blocked })
  })
  await page.goto('/')

  // The planner is unaffected: nothing about placing a route touches storage.
  await expect(panel(page, 'Route preview')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Layer toggles write through to storage on every flip and must not throw.
  await setAutonomous(page)
  await launch(page)
  await page.getByRole('switch', { name: 'Slope' }).click()
  await expect(page.getByRole('switch', { name: 'Slope' })).toHaveAttribute('aria-checked', 'true')

  // The mission still records in memory, and the view says the truth about
  // what will survive a reload rather than pretending it saved.
  await transport(page).abort.click()
  await openView(page, 'Analysis')
  await expect(missionRows(page)).toHaveCount(1)
  await expect(panel(page, 'Saved missions')).toContainText(
    'Storage is unavailable in this browser',
  )
})

test('a record that cannot be replayed to its end says so and keeps its metrics', async ({
  page,
}) => {
  // A record whose resolutions do not cover its interventions cannot be
  // replayed past the first one. The app must list it, show the stored
  // metrics, and state that the reconstruction stops short -- rather than
  // presenting a partial replay as the mission.
  await page.addInitScript(
    ([key, payload]: [string, string]) => window.localStorage.setItem(key, payload),
    [MISSIONS_KEY, missionsEnvelope([unresolvableRecord()])] as [string, string],
  )
  await page.goto('/')
  await openView(page, 'Analysis')

  await expect(missionRows(page)).toHaveCount(1)
  await expect(panel(page, 'Metrics')).toBeVisible()
  await expect(panel(page, 'Replay')).toContainText('could not be replayed to its end')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
