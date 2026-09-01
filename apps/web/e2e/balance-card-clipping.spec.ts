import { expect, test } from '@playwright/test'

/**
 * `/balance` summary-card CLIPPING proof (story 43.4, AC-9 / D1).
 *
 * ## Why a per-figure check and not a page-overflow check
 *
 * The card grid uses `grid-cols-*`, and Tailwind's grid columns are
 * `minmax(0, 1fr)`. A column therefore SHRINKS BELOW ITS CONTENT and clips it,
 * rather than pushing the page wide — which is precisely why no page-level
 * horizontal-overflow test can see this failure. Story 32.2's code review
 * measured that going 4-up at `md` gave each card 120px and silently clipped
 * three of the four figures while every existing test stayed green.
 *
 * Story 43.4 added a FIFTH card (`Other Assets`) and made Net Worth span the
 * row, so the measured breakpoints it inherited had to be re-proven. AC-9 asked
 * for this as an ASSERTION rather than a number written into a record — the
 * repo has twice shipped figures labelled "measured" that were never computed.
 *
 * ## The property
 *
 * For each `stat-*` figure element: `scrollWidth <= clientWidth`. A bold
 * `text-2xl` currency string has no wrap opportunity, so when the column is too
 * narrow the text overflows its own box and `scrollWidth` exceeds `clientWidth`.
 *
 * ⚠️ Run this under the CI font stack. CI resolves `system-ui` to DejaVu Sans;
 * dev boxes resolve to the NARROWER Noto Sans, so a local pass is not evidence
 * about CI (recorded: epic 34 shipped green with a broken 768px width budget):
 *
 *   FONTCONFIG_FILE=/abs/path/ci-fonts.conf pnpm playwright test balance-card-clipping
 *
 * ⚠️ The last test in this file is a POSITIVE CONTROL. Without it, a green run
 * here is indistinguishable from a check that cannot fail.
 */

/** Every figure on the page reads $127,000.00 or -$127,000.00 — the widest realistic value. */
function seedWideFigures(): void {
  const now = new Date().toISOString()
  const row = (type: string, name: string, currentBalance: number) => ({
    id: crypto.randomUUID(),
    type,
    name,
    currentBalance,
    monthlyContribution: 0,
    frequency: 'monthly',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  })

  localStorage.setItem(
    'budget-planner:balance-tracking',
    JSON.stringify({
      state: {
        entries: [
          row('investment', 'Portfolio', 12_700_000),
          row('asset', 'Condo', 12_700_000),
          // 12.7 + 12.7 + 12.7 − 50.8 = −12.7M, so Net Worth is the NEGATIVE
          // variant — one character wider than the positives, and the exact
          // string the 32.2 measurement was taken against.
          row('debt', 'Mortgage', 50_800_000),
        ],
      },
      version: 3,
    })
  )

  localStorage.setItem(
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: crypto.randomUUID(),
            name: 'Emergency fund',
            targetAmount: null,
            currentBalance: 12_700_000,
            allocationMode: 'manual',
            monthlyAllocation: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 2,
    })
  )
}

const FIGURE_TESTIDS = [
  'stat-total-investments',
  'stat-total-savings',
  'stat-total-assets',
  'stat-total-debts',
  'stat-net-worth',
] as const

/** The breakpoints D1 reasons about, plus the 320px floor. */
const VIEWPORTS = [
  { width: 320, height: 900 },
  { width: 640, height: 900 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
] as const

for (const viewport of VIEWPORTS) {
  test(`every /balance summary figure fits its card at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(seedWideFigures)
    await page.goto('/balance')
    await page.waitForLoadState('networkidle')

    // Prove the fixture actually landed — a page showing $0.00 everywhere would
    // pass every width assertion below while testing nothing.
    await expect(page.getByTestId('stat-net-worth')).toHaveText('-$127,000.00')
    await expect(page.getByTestId('stat-total-assets')).toHaveText('$127,000.00')

    // Collect EVERY violation before asserting. Failing at the first one hides
    // how widespread the problem is, which is the difference between "one card
    // is 3px short" and "the whole row clips".
    const violations: string[] = []
    for (const testId of FIGURE_TESTIDS) {
      const box = await page.getByTestId(testId).evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        text: el.textContent,
      }))
      if (box.scrollWidth > box.clientWidth) {
        violations.push(
          `${testId}: needs ${box.scrollWidth}px, has ${box.clientWidth}px for "${box.text}"`
        )
      }
    }

    expect(
      violations,
      `figures clip at ${viewport.width}px:\n  ${violations.join('\n  ')}`
    ).toEqual([])
  })
}

test('POSITIVE CONTROL: the clipping check fails when a figure genuinely overflows', async ({
  page,
}) => {
  // ⚠️ Without this, a green file above proves only that the assertions RAN.
  // Force a figure far wider than any card can hold and confirm the exact
  // comparison used above actually reports the overflow. If this test ever goes
  // green, the check is measuring something that cannot fail and the five tests
  // above are worthless.
  await page.setViewportSize({ width: 320, height: 900 })
  await page.addInitScript(seedWideFigures)
  await page.goto('/balance')
  await page.waitForLoadState('networkidle')

  const box = await page.getByTestId('stat-net-worth').evaluate((el) => {
    // Same no-wrap, same font — only the content is absurd.
    el.textContent = '-$127,000,000,000,000,000.00'
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
  })

  expect(
    box.scrollWidth,
    'the clipping detector did not fire on a deliberately over-wide figure'
  ).toBeGreaterThan(box.clientWidth)
})
