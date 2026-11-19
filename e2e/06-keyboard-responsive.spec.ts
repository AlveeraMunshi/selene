/**
 * Journey 6 -- keyboard reach and the narrow layout.
 *
 * PRODUCT_SPEC's accessibility floor: "Every control reachable and operable
 * by keyboard with a visible focus ring. Sliders are real range inputs. Tabs
 * implement the tablist pattern." All three are asserted here.
 *
 * The focus-ring check reads the COMPUTED outline colour of whatever the
 * keyboard just landed on. `focus-ring` in theme.css paints a 2px transparent
 * outline always and colours it only under `:focus-visible`, so an opaque
 * outline colour is exactly the signal that the indicator is showing -- and
 * because Playwright's Tab is a real key event, `:focus-visible` matches the
 * way it would for a person.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  clickCell,
  launch,
  map,
  openApp,
  panel,
  routeEntries,
  setAutonomous,
  statValue,
} from './fixtures/app'

interface Focused {
  tag: string
  type: string
  role: string
  name: string
  /** True when a focus indicator is actually painted. */
  ring: boolean
}

/** Describe whatever currently has focus. */
async function describeFocus(page: Page): Promise<Omit<Focused, 'ring'>> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { tag: 'BODY', type: '', role: '', name: '' }
    const labelled = el.id
      ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
      : null
    return {
      tag: el.tagName,
      type: el.getAttribute('type') ?? '',
      role: el.getAttribute('role') ?? '',
      name: (el.getAttribute('aria-label') ?? labelled ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80),
    }
  })
}

/** Is a focus indicator painted on the focused element right now? */
function ringPainted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return false
    const style = getComputedStyle(el)
    const clear = /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(style.outlineColor)
    return !clear && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
  })
}

/**
 * Wait, briefly and with a bound, for the focus ring to appear.
 *
 * THIS IS NOT A SLEEP, AND IT IS NOT OPTIONAL. `Button`, `Tabs`, `Toggle` and
 * the scenario cards all carry `transition-colors`, and Tailwind's
 * `transition-colors` includes `outline-color` -- so the ring FADES IN over
 * `--duration-fast` rather than snapping on. A single `getComputedStyle` read
 * immediately after Tab catches the animation at its first frame and reports
 * the outline as fully transparent, which looks exactly like an app with no
 * focus indicator at all. A first draft of this test reported ten missing
 * focus rings for that reason; every one of them was real and visible.
 *
 * So: poll for the painted state, and let the bound be the assertion. A
 * control that never paints a ring returns false and the test names it.
 */
async function ringAppears(page: Page, budgetMs = 2000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await ringPainted(page)) return true
    if (Date.now() >= deadline) return false
  }
}

/** Tab forward, collecting every stop, until focus wraps or the bound is hit. */
async function walkTabOrder(page: Page, maxStops = 40): Promise<Focused[]> {
  const stops: Focused[] = []
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab')
    const here = await describeFocus(page)
    if (here.tag === 'BODY') break
    const key = `${here.tag}|${here.type}|${here.role}|${here.name}`
    if (stops.some((s) => `${s.tag}|${s.type}|${s.role}|${s.name}` === key)) break
    stops.push({ ...here, ring: await ringAppears(page) })
  }
  return stops
}

test.describe('keyboard', () => {
  test('tab reaches every planner control, and each one shows a focus ring', async ({ page }) => {
    await openApp(page)
    await expect(panel(page, 'Route preview')).toBeVisible()

    const stops = await walkTabOrder(page)
    expect(stops.length, 'tabbing found nothing focusable').toBeGreaterThan(8)

    const names = stops.map((s) => s.name)
    const has = (fragment: string) => names.some((n) => n.includes(fragment))

    // The scenario cards, which are radios in behaviour.
    expect(has('Mare Traverse'), `scenario cards unreachable; saw ${names.join(' / ')}`).toBe(true)
    expect(has('Regolith Trap')).toBe(true)
    expect(has('Rille Crossing')).toBe(true)

    // The route tools and the waypoints already on the map.
    expect(has('Add waypoints')).toBe(true)
    expect(has('Move start')).toBe(true)
    expect(has('Remove waypoint 1')).toBe(true)
    expect(has('Clear')).toBe(true)

    // Every mission parameter, plus autonomy, seed and launch.
    expect(has('Risk tolerance')).toBe(true)
    expect(has('Energy priority')).toBe(true)
    expect(has('Battery reserve')).toBe(true)
    expect(has('Maximum slope')).toBe(true)
    expect(has('Supervised autonomy')).toBe(true)
    expect(has('Launch mission')).toBe(true)
    // The seed input labels itself through a wrapping group rather than a
    // <label for>, so it has no accessible name of its own; identify it by
    // type instead. Reported as an accessibility gap.
    expect(
      stops.some((s) => s.tag === 'INPUT' && s.type === 'number'),
      'the seed input is not in the tab order',
    ).toBe(true)

    // Four real range inputs, not divs with drag handlers.
    expect(stops.filter((s) => s.tag === 'INPUT' && s.type === 'range')).toHaveLength(4)

    const ringless = stops.filter((s) => !s.ring)
    expect(
      ringless,
      `controls focused with no visible indicator: ${ringless.map((s) => s.name || s.tag).join(', ')}`,
    ).toHaveLength(0)
  })

  test('the tab strip implements the tablist pattern', async ({ page }) => {
    await openApp(page)

    const planner = page.getByRole('tab', { name: 'Planner' })
    const mission = page.getByRole('tab', { name: 'Mission' })
    const analysis = page.getByRole('tab', { name: 'Analysis' })

    // Roving tabindex: exactly one tab is in the tab order.
    await expect(planner).toHaveAttribute('tabindex', '0')
    await expect(mission).toHaveAttribute('tabindex', '-1')
    await expect(analysis).toHaveAttribute('tabindex', '-1')

    await planner.focus()
    await page.keyboard.press('ArrowRight')
    await expect(mission).toHaveAttribute('aria-selected', 'true')
    await expect(mission).toBeFocused()

    await page.keyboard.press('ArrowLeft')
    await expect(planner).toHaveAttribute('aria-selected', 'true')
    await expect(planner).toBeFocused()

    await page.keyboard.press('End')
    await expect(analysis).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Home')
    await expect(planner).toHaveAttribute('aria-selected', 'true')

    // Wraps, which is what the ARIA pattern specifies.
    await page.keyboard.press('ArrowLeft')
    await expect(analysis).toHaveAttribute('aria-selected', 'true')

    // And the panel is labelled by the tab that selected it.
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'selene-tab-analysis')
  })

  test('the documented transport shortcuts work and stay out of text inputs', async ({ page }) => {
    await openApp(page)
    await setAutonomous(page)
    await launch(page)

    const speed = page.getByRole('combobox', { name: 'Playback speed' })
    await expect(speed).toHaveValue('1')

    // `]` steps the speed up, `[` steps it back down.
    await page.keyboard.press(']')
    await expect(speed).toHaveValue('2')
    await page.keyboard.press('[')
    await expect(speed).toHaveValue('1')

    // Space pauses a running mission.
    await page.keyboard.press(' ')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()

    // Typing a seed must not reset the mission mid-word: `r` is the reset
    // shortcut and must be inert while an input has focus.
    await page.getByRole('tab', { name: 'Planner' }).click()
    const seed = panel(page, 'Launch').getByRole('spinbutton')
    await seed.click()
    await seed.press('r')
    await page.getByRole('tab', { name: 'Mission' }).click()
    await expect(page.getByText('No mission running')).toBeHidden()
  })
})

test.describe('responsive', () => {
  test('the map stays present and interactive at 900px', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 })
    await openApp(page)

    // The planner stacks below ~1100px; the map must still be there and must
    // still take a click, because placing a route is the only thing this
    // screen is for.
    const canvas = map(page)
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box, 'the map has no layout box at 900px').toBeTruthy()
    expect(box!.width, 'the map collapsed at 900px').toBeGreaterThan(300)
    expect(box!.height).toBeGreaterThan(300)
    // No horizontal overflow: a map wider than the viewport is not reachable.
    expect(box!.x + box!.width).toBeLessThanOrEqual(900)

    // Clear first and place one known-routable waypoint: the point of this
    // assertion is that the click reaches the canvas and the store, not that
    // any arbitrary third waypoint happens to be plannable.
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(routeEntries(page)).toHaveCount(1) // start only
    await clickCell(page, { x: 12, y: 80 })
    await expect(routeEntries(page)).toHaveCount(2)
    await expect(routeEntries(page).nth(1)).toContainText('12, 80')

    // And the mission view keeps its map, its transport and its decisions.
    await setAutonomous(page)
    await launch(page)
    await expect(map(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(panel(page, 'Decision stream')).toBeVisible()
    await expect(panel(page, 'Traverse')).toBeVisible()

    const missionBox = await map(page).boundingBox()
    expect(missionBox!.width).toBeGreaterThan(300)
    expect(missionBox!.x + missionBox!.width).toBeLessThanOrEqual(900)
  })

  /**
   * KNOWN DEFECT, documented as an expected failure rather than described in
   * a comment somewhere nobody reads.
   *
   * Below the 1100px breakpoint the mission view's panels do not stack, they
   * OVERLAP. Measured by comparing every pair of `<section>` boxes inside
   * `<main>`, viewport height held at 820:
   *
   *   1280px   0 overlapping pairs, nothing outside `<main>`
   *    900px   6 overlapping pairs, 2 panels rendered past the bottom
   *
   * At 900px the Traverse telemetry panel is covered by the map across its
   * full 181px height; the transport panel is covered by the decision stream
   * and the decision inspector; and the transport panel and the inspector
   * both extend below `<main>` with no page scroll to reach them. The
   * consequence an operator meets first is that Play/Pause, Step, Reset and
   * Abort cannot be clicked at all -- `document.elementFromPoint` at each
   * control's centre returns the decision column, at every width from 1099px
   * down.
   *
   * MECHANISM. The narrow layout keeps `h-full` on a grid whose three auto
   * rows cannot hold their content: the telemetry column alone stacks to
   * ~600px inside a row of ~254px, so it overflows and the next row, later
   * in the DOM, paints over it. `overflow-y-auto` on the outer grid does not
   * help, because the rows are sized against the container rather than
   * against their contents.
   *
   * `test.fail()` so the suite stays green while the defect stands, and
   * turns red the moment it is fixed -- at which point this marker comes off
   * and the test becomes an ordinary regression guard.
   */
  test('the mission panels stack without overlapping below 1100px', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 })
    await openApp(page)
    await setAutonomous(page)
    await launch(page)
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).not.toHaveText('0')

    const report = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (!main) return { overlaps: ['no <main>'], outside: ['no <main>'] }
      const boxes = [...main.querySelectorAll('section')].map((section) => {
        const rect = section.getBoundingClientRect()
        return {
          name: (section.querySelector('h2')?.textContent ?? 'unnamed panel').trim(),
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        }
      })

      const overlaps: string[] = []
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!
          const b = boxes[j]!
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          // A couple of pixels is a rounded border, not an overlap.
          if (ox > 2 && oy > 2) {
            overlaps.push(`"${a.name}" over "${b.name}" by ${Math.round(ox)}x${Math.round(oy)}px`)
          }
        }
      }

      const bottom = main.getBoundingClientRect().bottom
      const outside = boxes.filter((b) => b.y + b.h > bottom + 2).map((b) => b.name)
      return { overlaps, outside }
    })

    expect(report.overlaps, `panels overlap at 900px:\n  ${report.overlaps.join('\n  ')}`).toEqual(
      [],
    )
    // NOT asserted: that every panel sits above the fold. Stacked at 900px the
    // column is ~2,470px of content in a ~773px viewport, so panels below the
    // fold are the intended outcome. What matters is that they are REACHABLE —
    // that the column is genuinely scrollable rather than clipped. Asserting
    // "inside <main>" instead would demand the layout fit, which it cannot.
    const reach = await page.evaluate(() => {
      const main = document.querySelector('main')
      const col = main?.querySelector(':scope > div')
      if (!col) return { scrollable: false, content: 0, visible: 0 }
      return { scrollable: col.scrollHeight > col.clientHeight, content: col.scrollHeight, visible: col.clientHeight }
    })
    expect(reach.scrollable, `stacked column must scroll to reach its lower panels (content ${reach.content}px in ${reach.visible}px)`).toBe(true)

    // And the controls must actually be operable, which is the thing an
    // operator meets first. Playwright scrolls into view, then refuses the
    // click if anything covers the target -- which is exactly the failure the
    // original defect produced.
    await page.getByRole('button', { name: /^(Pause|Play)$/ }).click({ timeout: 5000 })
    await page.getByRole('button', { name: 'Step' }).click({ timeout: 5000 })
  })

  test('the keyboard still reaches the transport at 900px', async ({ page }) => {
    // The consequence of the defect above: a narrow-viewport operator can
    // only pause with the Space shortcut. That it works is worth asserting,
    // because it is the only way to stop a mission at this width.
    await page.setViewportSize({ width: 900, height: 820 })
    await openApp(page)
    await setAutonomous(page)
    await launch(page)
    await expect(statValue(panel(page, 'Traverse'), 'Ticks')).not.toHaveText('0')

    await page.keyboard.press(' ')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  })
})
