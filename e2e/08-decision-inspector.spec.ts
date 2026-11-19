/**
 * The decision inspector -- the claim the whole project rests on.
 *
 * PRODUCT_SPEC: "Opening one shows generated prose AND the structured record
 * it was generated from -- each candidate route with its per-term costs,
 * which was chosen, and the stated caveats."
 *
 * That is four separate things, and three of them work. The fourth is a
 * layout defect documented as an expected failure at the bottom of this file.
 */

import { expect, test } from '@playwright/test'

import { interventionOption, launch, openApp, panel } from './fixtures/app'

/** Launch the default supervised mission, approve, and open the first decision. */
async function openFirstDecision(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page)
  await launch(page)
  await interventionOption(page, 'Proceed on the planned route').click()
  await panel(page, 'Decision stream')
    .getByRole('button', { name: /Initial plan/ })
    .click()
}

test('an opened decision shows the prose, the record and every candidate', async ({ page }) => {
  await openFirstDecision(page)
  const inspector = panel(page, 'Decision inspector')

  // The generated sentence. It is built from the record by
  // `explainDecision()`, so it must name the thing it chose.
  await expect(inspector).toContainText('Current preferences')
  await expect(inspector).toContainText(/t=0s/)

  // The record behind it. The VALUES are there -- see the documented defect
  // below for the labels.
  await expect(inspector).toContainText('lower-total-cost')
  await expect(inspector).toContainText('4, 88')

  // Every candidate, not only the one taken: "a decision that showed only
  // what was chosen would not be an explanation."
  await expect(inspector).toContainText('Candidates evaluated (3)')
  await expect(inspector.getByText('Selected', { exact: true })).toHaveCount(1)
  await expect(inspector).toContainText('Risk-averse')
  await expect(inspector).toContainText('Most direct')
  // A rejected candidate carries the cost that rejected it, rather than a
  // bare "not taken": "scored 24.71 against 24.54".
  await expect(inspector.getByText(/scored [\d.]+ against [\d.]+/)).toHaveCount(2)

  // With their per-term costs, which is what makes "lower hazard cost" a
  // consequence rather than an assertion.
  await expect(inspector.getByText('Peak hazard', { exact: true })).toHaveCount(3)
  await expect(inspector).toContainText('Total cost')
  await expect(inspector).toContainText(/w: dist .* haz .* energy/)
})

test('selecting and deselecting a decision is reversible', async ({ page }) => {
  await openFirstDecision(page)
  const inspector = panel(page, 'Decision inspector')
  await expect(inspector).toContainText('Candidates evaluated')

  // Clicking the selected row clears it, so the inspector can be dismissed
  // without hunting for a close control.
  await panel(page, 'Decision stream')
    .getByRole('button', { name: /Initial plan/ })
    .click()
  await expect(inspector).toContainText('No decision selected')
})

/**
 * KNOWN DEFECT, documented as an expected failure.
 *
 * A single long value hides EVERY label in the record block. On the
 * "Intervention resolved" decision the `Trigger` row reads
 * `operator chose "Proceed on the planned route"` and measures 334px; the
 * operator is then shown a column of eight unlabelled values -- `0`,
 * `Intervention resolved`, `Driving`, `4, 88`, a sentence, a reason code and
 * two percentages -- with nothing saying which is which.
 *
 * MECHANISM. `KeyValue` lays out `grid-cols-[minmax(0,1fr)_auto]`: key
 * elastic, value content-sized with no cap. Each row is
 * `grid-cols-subgrid`, so all rows SHARE those two tracks -- which is what
 * turns one long value into eight missing labels rather than one. The
 * decision column is a fixed 380px, the `auto` track takes 334 of it, and
 * the `minmax(0,1fr)` key track resolves to 0. `truncate` on the `<dt>` then
 * hides it with no ellipsis, because the box itself has no width.
 *
 * Measured `grid-template-columns` on that `<dl>`: `0px 334px`, identically
 * at viewport widths 1440, 1700, 2000 and 2400 -- the column is fixed, so
 * this is not a narrow-window case and widening the browser does not help.
 * The "Initial plan" decision, whose trigger is the four-character
 * "mission start", renders correctly, which is why this is easy to miss.
 * The same component is fine in Analysis's "Planned against executed", where
 * every value is a short figure.
 *
 * The labels are in the DOM and in the accessibility tree, so a screen
 * reader is unaffected; this is a sighted-reader defect only. A `max-w` or a
 * `wrap-anywhere` on the value cell would close it.
 */
test(
  'a long value never collapses the key column in the record block',
  async ({ page }) => {
    await openApp(page)
    await launch(page)
    await interventionOption(page, 'Proceed on the planned route').click()
    await panel(page, 'Decision stream')
      .getByRole('button', { name: /Intervention resolved/ })
      .click()

    const inspector = panel(page, 'Decision inspector')
    await expect(inspector).toContainText('operator chose')

    const widths = await inspector.evaluate((el) =>
      [...el.querySelectorAll('dt')].map((d) => Math.round(d.getBoundingClientRect().width)),
    )

    expect(widths.length, 'the record block should render its rows').toBeGreaterThan(4)
    expect(
      widths.filter((w) => w === 0),
      `labels collapsed to zero width: [${widths.join(', ')}]`,
    ).toHaveLength(0)
  },
)
