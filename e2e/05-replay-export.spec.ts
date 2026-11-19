/**
 * Journey 5 -- analysis, replay and export.
 *
 * WHY THE MISSION IS SEEDED RATHER THAN DRIVEN. The three shipped scenarios
 * run 1,028-1,816 ticks; the fastest playback the UI offers is 4x, so the
 * shortest of them takes over two minutes of wall clock. A test that watched
 * one finish would be a two-minute test, and it would be testing `setInterval`
 * rather than the analysis screen. So the record here is produced by the real
 * engine in Node (see `fixtures/records.ts`) and seeded into `localStorage`
 * exactly as the app would have written it.
 *
 * The browser still does all the work that matters: `buildReplaySession`
 * re-simulates the mission from (config, seed, resolutions) to produce the
 * frames, so every number this test reads is computed in the page from the
 * record, not copied out of it. The LIVE save path -- mission ends, record
 * appears in the list -- is covered in `03-intervention.spec.ts`, which
 * aborts a real mission and finds it in this same list.
 */

import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import type { MissionRecord } from '../src/core/types'
import {
  map,
  missionRows,
  openApp,
  openView,
  panel,
  replayPositionSlider,
  statValue,
} from './fixtures/app'
import { completedRecord, MISSIONS_KEY } from './fixtures/records'

test.describe('analysis and replay', () => {
  test('a saved mission reports its metrics, scrubs, and exports', async ({ page }) => {
    const record = completedRecord()
    expect(record.outcome, 'the fixture must be a genuinely completed mission').toBe('complete')

    await openApp(page, [record])
    await openView(page, 'Analysis')

    // --- the mission is listed ---------------------------------------------
    const list = panel(page, 'Saved missions')
    await expect(missionRows(page)).toHaveCount(1)
    await expect(list).toContainText('Mare Traverse')
    await expect(list).toContainText('Complete')
    await expect(list).toContainText(`${record.metrics.waypointsReached}/${record.metrics.waypointsTotal} waypoints`)

    // --- every number traces to MissionMetrics ------------------------------
    // PRODUCT_SPEC: "There is no score that the engine did not compute."
    const metrics = panel(page, 'Metrics')
    await expect(statValue(metrics, 'Waypoints')).toHaveText(
      `${record.metrics.waypointsReached} / ${record.metrics.waypointsTotal}`,
    )
    await expect(metrics).toContainText(`${record.metrics.ticks} ticks`)
    await expect(statValue(metrics, 'Replans')).toHaveText(String(record.metrics.replans))
    await expect(statValue(metrics, 'Interventions')).toHaveText(
      String(record.metrics.interventions),
    )

    // --- the reconstruction happened ---------------------------------------
    // The chart and the map only render when the record replayed; a record
    // the engine could not reproduce shows "could not be reconstructed"
    // instead, which is a different and equally testable state.
    await expect(panel(page, 'Power over time')).toBeVisible()
    await expect(panel(page, 'Traverse')).toBeVisible()
    await expect(map(page)).toBeVisible()
    await expect(panel(page, 'Replay')).not.toContainText('could not be reconstructed')

    // --- scrub --------------------------------------------------------------
    const scrubber = panel(page, 'Replay')
    const position = replayPositionSlider(page)
    // Parked at the end, because the first question asked of a finished
    // mission is what happened to it.
    await expect(position).toHaveValue(String(record.metrics.ticks))
    await expect(page.getByRole('button', { name: 'End' })).toBeDisabled()

    await position.fill('0')
    await expect(scrubber).toContainText('tick 0')
    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled()

    await page.getByRole('button', { name: 'Step forward one tick' }).click()
    await expect(scrubber).toContainText('tick 1')

    await page.getByRole('button', { name: 'End' }).click()
    await expect(scrubber).toContainText(`tick ${record.metrics.ticks}`)

    // --- the scrubber drives the real renderer ------------------------------
    // Seeking has to produce engine STATE, not just a label. Handing the map
    // to the replay and reading the live telemetry rail is what proves it:
    // the rail prints `SimState.tick`, reconstructed in the browser.
    await page.getByRole('button', { name: 'Drive the live map' }).click()
    await expect(scrubber).toContainText('Driving the map')

    await position.fill('0')
    await expect(scrubber).toContainText('tick 0')
    await openView(page, 'Mission')
    await expect(page.getByText('The map is showing a saved mission.')).toBeVisible()
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).toHaveText('0')

    await openView(page, 'Analysis')
    await page.getByRole('button', { name: 'End' }).click()
    await openView(page, 'Mission')
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).toHaveText(
      String(record.metrics.ticks),
    )

    // --- export -------------------------------------------------------------
    await openView(page, 'Analysis')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export JSON' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^selene-mission-.*\.json$/)
    const path = await download.path()
    expect(path, 'the download produced no file on disk').toBeTruthy()
    const exported = JSON.parse(await readFile(path, 'utf8')) as MissionRecord

    expect(exported.missionId).toBe(record.missionId)
    expect(exported.outcome).toBe(record.outcome)
    expect(exported.metrics.ticks).toBe(record.metrics.ticks)
    expect(exported.config.scenarioId).toBe(record.config.scenarioId)
    expect(exported.config.seed).toBe(record.config.seed)
    // The record is the inputs, not the frames: no terrain, no trajectory.
    expect(exported).not.toHaveProperty('terrain')
    expect(Array.isArray(exported.events)).toBe(true)
    expect(exported.events.length).toBeGreaterThan(0)
  })

  test('the event log and the plan-versus-executed comparison come off the record', async ({
    page,
  }) => {
    const record = completedRecord()
    await openApp(page, [record])
    await openView(page, 'Analysis')

    const log = panel(page, 'Event log')
    await expect(log).toContainText(`${record.events.length} events`)
    await expect(log.getByRole('listitem')).toHaveCount(record.events.length)
    await expect(log).toContainText('Mission started')
    await expect(log).toContainText('Mission complete')

    await expect(panel(page, 'Planned against executed')).toContainText('Planned')
    await expect(panel(page, 'Planned against executed')).toContainText('Executed')
    await expect(panel(page, 'Hazards discovered')).toContainText(
      `${record.metrics.hazardsDiscovered} found`,
    )
  })

  test('no saved missions is an empty state, not a blank grid', async ({ page }) => {
    await openApp(page)
    await openView(page, 'Analysis')

    await expect(panel(page, 'Saved missions')).toContainText('No missions yet')
    await expect(page.getByText('No mission selected')).toBeVisible()
    await expect(missionRows(page)).toHaveCount(0)
  })

  test('a corrupt stored record is discarded rather than crashing the view', async ({ page }) => {
    const good = completedRecord()
    // Three shapes a hand-edited or half-written store can really take: a
    // record missing `metrics`, one missing `config`, and a non-object. None
    // may take the analysis view down with them.
    await page.addInitScript(
      ([key, payload]: [string, string]) => window.localStorage.setItem(key, payload),
      [
        MISSIONS_KEY,
        JSON.stringify({
          v: 1,
          data: [
            { missionId: 'broken-no-metrics', config: good.config, outcome: 'complete' },
            { missionId: 'broken-no-config', metrics: good.metrics, outcome: 'complete' },
            null,
            'not-an-object',
            good,
          ],
        }),
      ] as [string, string],
    )
    await page.goto('./')
    await openView(page, 'Analysis')

    // Exactly the one sound record survives, and nothing threw on the way.
    await expect(missionRows(page)).toHaveCount(1)
    await expect(panel(page, 'Saved missions')).toContainText('Mare Traverse')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
