import { expect, test } from '@playwright/test'

/**
 * Print-stylesheet E2E for the Premium financial summary report (story 30-3,
 * FR53).
 *
 * AC-5 requires the printed output be proven legible EMPIRICALLY, in a real
 * browser under real print media — not asserted by reading the CSS. So every
 * check below goes through `page.emulateMedia({ media: 'print' })` and reads
 * COMPUTED styles.
 *
 * ## Why the report subtree is injected rather than navigated to
 *
 * `/report` is Premium, and this suite runs as an unauthenticated visitor (the
 * same constraint `premium-locked.spec.ts` works under) — there is no session
 * seeding available here, so the real report cannot be rendered. What AC-5 is
 * actually about is whether the SHIPPED CSS RULES survive contact with a real
 * rendering engine, and those rules key off `#financial-summary-report` and the
 * semantic text tokens. So the tests inject a subtree carrying the SAME id and
 * the SAME token classes the report component uses (`text-heading`, `text-body`,
 * `text-muted`, `surface`), and assert the computed result.
 *
 * That makes this a faithful test of the risk it targets — a dark-themed document
 * printing near-white text onto white paper — while the report's own markup and
 * figures are covered by `FinancialSummaryReport.test.tsx`. The gating and the
 * global chrome rules below ARE exercised against the real app.
 */

/** Injects a stand-in for the report subtree using the real token classes. */
async function injectReportStub(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const article = document.createElement('article')
    article.id = 'financial-summary-report'
    article.innerHTML = `
      <h1 class="text-heading" data-probe="heading">Financial summary</h1>
      <p class="text-muted" data-probe="muted">Generated 2026-08-08</p>
      <section class="surface" data-probe="section">
        <p class="text-body" data-probe="body">Monthly income</p>
      </section>`
    document.body.append(article)
  })
}

/** Parses `rgb(r, g, b)` / `rgba(...)` into channels. */
function parseRgb(value: string): { r: number; g: number; b: number } {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) {
    throw new Error(`Unexpected colour format: ${value}`)
  }
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
}

async function computedColour(
  page: import('@playwright/test').Page,
  probe: string
): Promise<{ r: number; g: number; b: number }> {
  const value = await page
    .locator(`[data-probe="${probe}"]`)
    .evaluate((el) => getComputedStyle(el).color)
  return parseRgb(value)
}

for (const theme of ['light', 'dark'] as const) {
  test(`report text prints as dark ink when the app is in ${theme} mode`, async ({ page }) => {
    // ⚠️ Story 61.1 (FR93): the theme follows the DEVICE, so `emulateMedia` is
    // the lever. It used to be a seeded localStorage store, and the comment here
    // warned against hand-adding a `.dark` class that `ThemeProvider` would strip
    // — that provider and that class are both gone.
    await page.emulateMedia({ colorScheme: theme })

    await page.goto('/')
    // Confirm the theme actually took, so a dark run cannot silently pass as
    // light. ⚠️ Asserts the PAINTED canvas, not the lever: re-reading the scheme
    // we just set could not fail. `body` is bg-gray-50 light / bg-gray-900 dark.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe(theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(249, 250, 251)')

    await injectReportStub(page)
    await page.emulateMedia({ media: 'print' })

    // The real failure this guards: browsers drop background colours when
    // printing but KEEP text colour, so a dark document would print near-white
    // text onto white paper — a page that looks blank. Every probe must be dark
    // ink regardless of the app's theme.
    for (const probe of ['heading', 'muted', 'body']) {
      const { r, g, b } = await computedColour(page, probe)
      expect(
        r + g + b,
        `${probe} must print as dark ink in ${theme} mode, got rgb(${r}, ${g}, ${b})`
      ).toBeLessThan(120)
    }
  })
}

test('report text is NOT forced to black on screen — the override is print-only', async ({
  page,
}) => {
  // Guards the blast radius of a global stylesheet: the print rules must not
  // leak into the screen rendering, or dark mode would break everywhere.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(17, 24, 39)')
  await injectReportStub(page)

  await page.emulateMedia({ media: 'screen' })
  const { r, g, b } = await computedColour(page, 'heading')
  // `.text-heading` is `dark:text-gray-100` — light ink on the dark canvas.
  expect(r + g + b).toBeGreaterThan(600)
})

test('app chrome is suppressed when printing, and restored on screen', async ({ page }) => {
  await page.goto('/settings')

  const chrome = page.locator('[data-print-hide]').first()
  const footer = page.locator('footer').first()
  await expect(chrome).toBeVisible()
  await expect(footer).toBeVisible()

  await page.emulateMedia({ media: 'print' })
  await expect(chrome).toBeHidden()
  await expect(footer).toBeHidden()

  // Not a one-way door: the page is unchanged for normal viewing.
  await page.emulateMedia({ media: 'screen' })
  await expect(chrome).toBeVisible()
  await expect(footer).toBeVisible()
})

test('printing another page leaves its colours untouched — the report rules are scoped', async ({
  page,
}) => {
  // ⚠️ This test previously asserted only that headings stayed VISIBLE, which no
  // colour rule could ever have broken — it could not fail against the regression
  // it was named for. It now reads a COMPUTED colour, which is the property at
  // stake: the report's forced black-on-white must not reach any other page.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings')
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(17, 24, 39)')

  // ⚠️ Probe an element that INHERITS its colour from <body>, not a heading.
  // A first attempt read the <h1>, whose own `dark:text-white` class outranks any
  // `body { color: … }` rule — so reinstating a document-wide print override left
  // the test green. Verified by mutation: with a bare inheriting node, it goes red.
  await page.evaluate(() => {
    const p = document.createElement('p')
    p.setAttribute('data-probe', 'inheriting-text')
    p.textContent = 'inherits body colour'
    document.body.append(p)
  })

  const probe = page.locator('[data-probe="inheriting-text"]')
  const onScreen = parseRgb(await probe.evaluate((el) => getComputedStyle(el).color))

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('heading', { level: 1, name: /^settings$/i })).toBeVisible()
  const onPaper = parseRgb(await probe.evaluate((el) => getComputedStyle(el).color))

  // Unchanged by print media, and still the dark theme's light ink — i.e. this
  // page prints exactly as it did before story 30-3 introduced the block.
  expect(onPaper).toEqual(onScreen)
  expect(onPaper.r + onPaper.g + onPaper.b).toBeGreaterThan(600)
})

test('an in-page (non-chrome) footer still prints — only chrome is suppressed', async ({
  page,
}) => {
  // `routes/forecasting.tsx:524` renders its own <footer> carrying that page's EU
  // data-location disclosure. A bare `footer { display: none }` in the print block
  // silently suppressed it. Suppression is keyed on `data-print-hide` instead, so
  // content footers survive. Injected here because /forecasting is Premium and
  // this suite runs unauthenticated.
  await page.goto('/settings')
  await page.evaluate(() => {
    const f = document.createElement('footer')
    f.setAttribute('data-probe', 'content-footer')
    f.textContent = 'Saved forecasts stored in the EU'
    document.body.append(f)
  })

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('[data-probe="content-footer"]')).toBeVisible()
  // …while the global chrome footer, which opts in, is gone.
  await expect(page.locator('footer[data-print-hide]')).toBeHidden()
})

test('a row-header cell carrying the report class string left-aligns in a real engine', async ({
  page,
}) => {
  // Story 56.2 (UX-DR63).
  //
  // ⚠️ THE STUB CAVEAT, up front. `/report` is Premium and every e2e suite here
  // is UNAUTHENTICATED (this file's header comment; `helpers/seed-finance-rows.ts:44-52`),
  // so the real component cannot be rendered. This test proves a CSS FACT, not
  // that the component ships it: that the class string the report now puts on
  // its `scope="row"` cells actually beats the UA stylesheet's centering of
  // `<th>` in a real engine. WHICH class string the component uses is pinned by
  // `FinancialSummaryReport.test.tsx`'s token guard. Neither layer is
  // sufficient alone, and a green run HERE is not evidence story 56.2 landed —
  // the same caution this file already carries about its `Generated 2026-08-08`
  // stub text.
  //
  // It exists because the unit layer physically cannot see alignment: jsdom
  // returns `textAlign: ""` for a `<th>` either way, and no Tailwind stylesheet
  // is loaded under Vitest at all.
  await page.goto('/')

  // Both cells carry the report's `TD_CLASS` + `font-normal`; only `fixed` also
  // carries the `text-left` this story added.
  await page.evaluate(() => {
    const base = 'px-3 py-2 text-sm text-body font-normal'
    const table = document.createElement('table')
    table.innerHTML = `
      <tbody>
        <tr><th scope="row" data-probe="fixed" class="${base} text-left">Salary</th><td>1</td></tr>
        <tr><th scope="row" data-probe="unfixed" class="${base}">Salary</th><td>2</td></tr>
      </tbody>`
    document.body.append(table)
  })

  const alignOf = (probe: string): Promise<string> =>
    page.locator(`[data-probe="${probe}"]`).evaluate((el) => getComputedStyle(el).textAlign)

  // The fix.
  expect(await alignOf('fixed')).toBe('left')

  // ⚠️ NEGATIVE CONTROL — the load-bearing half. Without it this test would
  // also pass in a world where `<th>` was never centered, i.e. where the defect
  // UX-DR63 reported did not exist, so it would say nothing about the fix being
  // necessary. This is the assertion that demonstrates the UA default is real.
  // Measured in this engine: Chromium reports exactly `"center"` here, which is
  // the defect UX-DR63 described, confirmed in a browser rather than inferred
  // from reading Tailwind's Preflight. Matched loosely all the same, because
  // engines have spelled this default differently (`-internal-center`) and the
  // claim being made is "centered, not left", not one particular string.
  expect(await alignOf('unfixed')).toMatch(/center/)
})

test('a free visitor reaching /report gets the upgrade surface, not the report', async ({
  page,
}) => {
  // The route gate, exercised against the real hydration path rather than a
  // mocked hook — the surface unit tests cannot cover (project memory, 4-11).
  await page.goto('/report')

  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()
  await expect(page.locator('#financial-summary-report')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /print \/ save as pdf/i })).toHaveCount(0)
})
