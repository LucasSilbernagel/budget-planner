import { type Page, expect, test } from '@playwright/test'
import { Pie } from 'recharts'

/**
 * Overview breakdown pies: no in-plot slice labels, at any width (story 36.2,
 * UX-DR41).
 *
 * ⚠️⚠️ WHY THIS FILE EXISTS AND WHY IT WAITS. Unit tests cannot see any of
 * this: jsdom gives `ResponsiveContainer` a 0×0 box, so `PieChart.render()`
 * returns `null` and NO Recharts SVG reaches the DOM at all. A jsdom assertion
 * that the labels are absent passes against labels-ON code and can never fail.
 * `__tests__/HomePage.pie-labels.chart-wiring.test.tsx` pins the `label` PROP;
 * this file is the only place that can prove a real browser paints nothing.
 *
 * ⚠️⚠️ THE TRAP THIS FILE IS BUILT AROUND. Recharts renders pie labels ONLY
 * after the sector animation finishes — `Pie.renderLabels` returns `null` while
 * `isAnimationActive && !isAnimationFinished`, and the shipped defaults are
 * `isAnimationActive: !Global.isSsr` (true in Chromium), `animationBegin: 400`,
 * `animationDuration: 1500`. Playwright's `toHaveCount(0)` succeeds on its FIRST
 * poll. Measured on this page with the labels still ON:
 *
 *   t=2862ms  sectors=9  labels=0   <- a `.recharts-sector` witness is satisfied HERE
 *   t=4079ms  sectors=9  labels=9   <- the labels finally paint
 *
 * So the obvious design — assert a rendered-chart witness, then assert the
 * labels are absent — passes against labels-ON code, ~1.2s before the labels
 * could possibly exist. Every absence assertion below therefore waits out the
 * animation window explicitly. A fixed wait is normally a smell; here it is the
 * honest option, because Recharts exposes no animation-finished signal in the
 * DOM. Its sufficiency is not assumed — it is proved by mutation M4 (restore the
 * label prop and this suite must go RED with a non-zero observed count).
 *
 * ⚠️ If a future story sets `isAnimationActive={false}` on the pies, this wait
 * becomes 2.7s of dead time per case and should be dropped.
 *
 * ⚠️ Amounts print with a leading `$`: new users default to `symbol` mode and
 * `USD` (`currencyStore.ts:29`, FR38 / Epic 22). Nothing is seeded into the
 * currency store here, so these assertions ride the shipped default — which is
 * also exactly what a first-time visitor sees.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

/**
 * How long after the chart mounts a pie label could first exist.
 *
 * ⚠️ DERIVED FROM THE INSTALLED LIBRARY, NOT HARDCODED. `apps/web/package.json`
 * pins recharts as `^2.15.3`, so a minor upgrade that lengthens the animation
 * would silently reopen the false-green window — the absence assertions would
 * run before labels could paint and pass against labels-ON code, which is the
 * precise trap this file exists to close. Reading the numbers from the library
 * makes an upgrade move the wait instead of invalidating it.
 *
 * The throw is deliberate: if Recharts ever stops exposing these, this file must
 * fail loudly at load rather than silently fall back to a stale constant.
 */
const PIE_DEFAULTS = Pie.defaultProps as
  | { animationBegin?: number; animationDuration?: number }
  | undefined
if (
  typeof PIE_DEFAULTS?.animationBegin !== 'number' ||
  typeof PIE_DEFAULTS?.animationDuration !== 'number'
) {
  throw new TypeError(
    'Recharts no longer exposes Pie.defaultProps animation timings; the pie-label paint window can no longer be derived and every absence assertion in this file would be unfalsifiable.'
  )
}

/** Local margin for scheduling jitter — this part is a judgement call, not a library value. */
const PAINT_MARGIN_MS = 800
const PIE_LABEL_PAINT_MS =
  PIE_DEFAULTS.animationBegin + PIE_DEFAULTS.animationDuration + PAINT_MARGIN_MS

const INCOME_PIE = '[data-testid="breakdown-pie-income"]'
const EXPENSE_PIE = '[data-testid="breakdown-pie-expense"]'

/** The two label surfaces. `label={false}` removes the enclosing layer as well
 *  as the text, so asserting only the text would miss a partial regression. */
const LABEL_LAYER = '.recharts-pie-labels'
const LABEL_TEXT = '.recharts-pie-label-text'

interface SeedRow {
  name: string
  /** Monthly amount in cents. */
  amount: number
}

/**
 * Six expense and three income slices, all monthly and all UNCATEGORIZED — an
 * uncategorized row falls back to its own name (story 30.4b, Decision 10), so
 * distinct names become distinct slices without seeding the category store.
 *
 * The values are deliberately close together so that every sector spans well
 * under 90°. That matters only for the hover case: the pie is a DONUT, and a
 * wide sector's bounding-box centre falls in the hole.
 */
const EXPENSES: SeedRow[] = [
  { name: 'Rent', amount: 120_000 },
  { name: 'Groceries', amount: 110_000 },
  { name: 'Transport', amount: 100_000 },
  { name: 'Utilities', amount: 90_000 },
  { name: 'Insurance', amount: 80_000 },
  { name: 'Entertainment', amount: 70_000 },
]

const INCOME: SeedRow[] = [
  { name: 'Salary', amount: 400_000 },
  { name: 'Freelance', amount: 350_000 },
  { name: 'Dividends', amount: 300_000 },
]

/**
 * Totals at the DEFAULT duration, which is Annually (`overviewDurationStore.ts`
 * `DEFAULT_DURATION = 'annually'`). Annually is a ×12 integral scale, so no
 * per-entry rounding divergence applies and the pie total is the plain sum.
 *   expenses 570,000c/mo × 12 = 6,840,000c  -> $68,400.00
 *   income 1,050,000c/mo × 12 = 12,600,000c -> $126,000.00
 */
const EXPENSE_TOTAL = '$68,400.00'
const INCOME_TOTAL = '$126,000.00'

function seed(page: Page, income: SeedRow[], expenses: SeedRow[]): Promise<void> {
  return page.addInitScript(
    ({ incomeRows, expenseRows }: { incomeRows: SeedRow[]; expenseRows: SeedRow[] }) => {
      const now = new Date().toISOString()
      // ⚠️ `version: 3` and an explicit `sortOrder` — the CURRENT persisted
      // shape (`incomeStore.ts` / `expenseStore.ts` both declare `version: 3`
      // since story 34.1a's sortOrder backfill). Seeding `version: 2` would put
      // every run through `migrate` → `backfillSortOrder`, which re-sorts by
      // `createdAt` then `id`; every row here shares one `createdAt` and carries
      // a random uuid, so store order — and therefore slice colour assignment —
      // would be nondeterministic per run. Nothing asserted below is
      // order-sensitive today, so it would not fail; it would just quietly stop
      // being a fixture of real storage.
      const toRow = (seedRow: SeedRow, index: number) => ({
        id: crypto.randomUUID(),
        userId: 0,
        name: seedRow.name,
        amount: seedRow.amount,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      })
      localStorage.setItem(
        'budget-planner-income-v1',
        JSON.stringify({ state: { incomeSources: incomeRows.map(toRow) }, version: 3 })
      )
      localStorage.setItem(
        'budget-planner-expenses-v1',
        JSON.stringify({ state: { expenses: expenseRows.map(toRow) }, version: 3 })
      )
    },
    { incomeRows: income, expenseRows: expenses }
  )
}

/**
 * Witness -> wait -> absence, in that order.
 *
 * The witness exists so a count of zero cannot be satisfied by the pies falling
 * back to their `emptyLabel` placeholder (which renders no chart at all). The
 * wait exists for the reason in the file header. Both are load-bearing; neither
 * substitutes for the other.
 *
 * ⚠️ `toHaveCount` polls; `locator.count()` is a one-shot read. The hazard is on
 * the ABSENCE assertions, not the witness: a one-shot label count taken before
 * the chart has rendered reads 0 and passes vacuously. (The witness expects a
 * NONZERO sector count, so a one-shot 0 there would fail as a flake rather than
 * pass — Recharts skips any sector with `startAngle === 0 && endAngle === 0`
 * while `sectors.length !== 1`, so no sector exists for the first ~400ms.)
 * Polling on a nonzero witness is what forces the chart to exist before the
 * absence assertions are allowed to mean anything.
 */
async function assertNoInPlotLabels(
  page: Page,
  { incomeSlices, expenseSlices }: { incomeSlices: number; expenseSlices: number }
): Promise<void> {
  // ⚠️ BOTH containers get `toBeVisible()`. A bare `toHaveCount` passes on a
  // `display:none` chart, so witnessing one pie by count alone would let a
  // CSS-hidden chart through while the test's name claims it is readable.
  await expect(page.locator(`${INCOME_PIE} .recharts-responsive-container`)).toBeVisible()
  await expect(page.locator(`${EXPENSE_PIE} .recharts-responsive-container`)).toBeVisible()
  await expect(page.locator(`${INCOME_PIE} .recharts-sector`)).toHaveCount(incomeSlices)
  await expect(page.locator(`${EXPENSE_PIE} .recharts-sector`)).toHaveCount(expenseSlices)

  await page.waitForTimeout(PIE_LABEL_PAINT_MS)

  // Text first: its count is diagnostic (it equals the total slice count), and
  // Playwright stops at the first failure. Both were proved able to fail by
  // replacing `label={false}` with an UNCONDITIONAL callback — which is the
  // mutation that matters, because restoring the ORIGINAL `isNarrow ? false :
  // fn` ternary would leave the 320px case correctly green and prove nothing
  // about it. Observed under the unconditional form: LABEL_TEXT 9 (many-slice),
  // 4 (two-slice), 2 (one-slice), 9 (320px) — i.e. exactly the seeded slice
  // totals per case — and LABEL_LAYER 2, one group per pie.
  await expect(page.locator(LABEL_TEXT)).toHaveCount(0)
  await expect(page.locator(LABEL_LAYER)).toHaveCount(0)
}

test.describe('Overview breakdown pies paint no in-plot slice labels', () => {
  test('AC-4/5/6: many categories at desktop — no labels, list and accessible name intact', async ({
    page,
  }) => {
    await seed(page, INCOME, EXPENSES)
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    await assertNoInPlotLabels(page, { incomeSlices: 3, expenseSlices: 6 })

    // AC-5: the slice list beneath each pie is what carries the breakdown now,
    // so it must name every slice. One <li> per slice, no more and no fewer.
    await expect(page.locator(`${EXPENSE_PIE} li`)).toHaveCount(EXPENSES.length)
    await expect(page.locator(`${INCOME_PIE} li`)).toHaveCount(INCOME.length)
    for (const { name } of EXPENSES) {
      await expect(page.locator(`${EXPENSE_PIE} li`).filter({ hasText: name })).toBeVisible()
    }
    for (const { name } of INCOME) {
      await expect(page.locator(`${INCOME_PIE} li`).filter({ hasText: name })).toBeVisible()
    }

    // AC-5: the totals, pinned as literals. `toBeVisible()` alone would pass on
    // any string, including a wrong figure.
    await expect(page.getByTestId('breakdown-pie-total-expense')).toHaveText(EXPENSE_TOTAL)
    await expect(page.getByTestId('breakdown-pie-total-income')).toHaveText(INCOME_TOTAL)

    // AC-6: `role="img"` makes the plot opaque to assistive technology, so the
    // in-plot labels never reached the accessibility tree — the accessible name
    // plus the list above is the whole AT surface, and nothing pinned this name
    // before this story. Queried BY NAME: 9 elements expose role="img" on this
    // page, so a bare getByRole('img') is a strict-mode violation.
    await expect(
      page.getByRole('img', { name: 'Income by category (per year) breakdown chart' })
    ).toBeVisible()
    await expect(
      page.getByRole('img', { name: 'Expenses by category (per year) breakdown chart' })
    ).toBeVisible()
  })

  test('AC-8: a two-slice pie is still readable with no in-plot labels', async ({ page }) => {
    await seed(page, INCOME.slice(0, 2), EXPENSES.slice(0, 2))
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    await assertNoInPlotLabels(page, { incomeSlices: 2, expenseSlices: 2 })

    // AC-8 says the list names each slice WITH ITS AMOUNT, so pin every slice on
    // BOTH pies — not just the expense side, and not just one row of it.
    await expect(page.locator(`${EXPENSE_PIE} li`)).toHaveCount(2)
    await expect(page.locator(`${INCOME_PIE} li`)).toHaveCount(2)
    // Monthly cents × 12 (the default Annually view is an exact ×12 scale).
    for (const [name, amount] of [
      ['Rent', '$14,400.00'],
      ['Groceries', '$13,200.00'],
    ] as const) {
      await expect(page.locator(`${EXPENSE_PIE} li`).filter({ hasText: name })).toContainText(
        amount
      )
    }
    for (const [name, amount] of [
      ['Salary', '$48,000.00'],
      ['Freelance', '$42,000.00'],
    ] as const) {
      await expect(page.locator(`${INCOME_PIE} li`).filter({ hasText: name })).toContainText(amount)
    }
  })

  test('AC-8: a one-slice pie is still readable with no in-plot labels', async ({ page }) => {
    await seed(page, INCOME.slice(0, 1), EXPENSES.slice(0, 1))
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    // ⚠️ The single-slice pie is the exception to the sector-skip rule: Recharts
    // keeps a lone sector even at zero sweep, so it is present from t=0.
    await assertNoInPlotLabels(page, { incomeSlices: 1, expenseSlices: 1 })

    await expect(page.locator(`${EXPENSE_PIE} li`)).toHaveCount(1)
    await expect(page.locator(`${EXPENSE_PIE} li`)).toContainText('Rent')
    await expect(page.locator(`${EXPENSE_PIE} li`)).toContainText('$14,400.00')
    await expect(page.locator(`${INCOME_PIE} li`)).toHaveCount(1)
    await expect(page.locator(`${INCOME_PIE} li`)).toContainText('Salary')
    await expect(page.locator(`${INCOME_PIE} li`)).toContainText('$48,000.00')
  })

  test('AC-9: no in-plot labels at 320px either', async ({ page }) => {
    // The narrow branch already suppressed the labels before this story, but it
    // did so through `isNarrow`, and `matchMedia` does not exist in jsdom — so
    // the prop-capture unit test only ever sees the DESKTOP branch. A regression
    // to `label={isNarrow}` would keep that test green while painting labels
    // here. This case is the only thing that would catch it.
    await page.setViewportSize({ width: 320, height: 720 })
    await seed(page, INCOME, EXPENSES)
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    await assertNoInPlotLabels(page, { incomeSlices: 3, expenseSlices: 6 })
  })

  test('AC-7: the hover tooltip still reads out a slice with its figure and share', async ({
    page,
  }) => {
    await seed(page, INCOME, EXPENSES)
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await page.waitForLoadState('networkidle')

    const chart = page.locator(`${EXPENSE_PIE} .recharts-responsive-container`)
    await expect(chart).toBeVisible()
    await expect(page.locator(`${EXPENSE_PIE} .recharts-sector`)).toHaveCount(EXPENSES.length)
    await page.waitForTimeout(PIE_LABEL_PAINT_MS)

    const box = await chart.boundingBox()
    if (!box) {
      throw new Error('expense pie chart has no bounding box')
    }

    // ⚠️ Do NOT use `locator.hover()` on a sector. The pie is a donut
    // (innerRadius 55 / outerRadius 85) and Playwright hovers an element's
    // BOUNDING-BOX CENTRE, which for a wide sector lands in the hole and
    // hit-tests to whatever is beneath — measured: one of six sectors timed out,
    // and every successful hover reported a DIFFERENT category than the located
    // element, because DOM sector order is not visual order. Aim at a point on
    // the annulus instead: `cx`/`cy` are 50%/50% and the mid-band radius is
    // (55 + 85) / 2 = 70, so any angle lands inside some slice.
    const centreX = box.x + box.width / 2
    const centreY = box.y + box.height / 2
    const RADIUS = 70
    const angle = Math.PI / 4
    await page.mouse.move(centreX, centreY)
    await page.mouse.move(centreX + RADIUS * Math.cos(angle), centreY - RADIUS * Math.sin(angle))

    // Scoped to THIS pie: the income pie renders first, so an unscoped
    // `.recharts-tooltip-wrapper` resolves to the wrong chart and reads empty.
    const tooltip = page.locator(`${EXPENSE_PIE} .recharts-tooltip-wrapper`)
    // Assert the hover LANDED before asserting what it says, so a hover that
    // never opened fails on the hover rather than on a text mismatch.
    await expect(tooltip).toBeVisible()

    const text = (await tooltip.innerText()).trim()
    // The formatter is `${amount} (${share}%)` keyed by the category name, and
    // its percentage comes from the Tooltip's own `total > 0` branch — which
    // nothing pinned before this story.
    expect(text).toMatch(/%/)
    expect(text).toMatch(/\$/)
    expect(
      EXPENSES.some(({ name }) => text.includes(name)),
      `tooltip named no seeded expense category: ${JSON.stringify(text)}`
    ).toBeTruthy()
  })
})
