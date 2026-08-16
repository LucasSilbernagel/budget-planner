import { expect, test } from '@playwright/test'

/**
 * Income vs Expense Breakdown period control E2E (Story 12-3, UX-DR20; rebound
 * to the shared duration store by story 32.3).
 *
 * Drives the hydrated Home dashboard to prove what SSR/HTML smoke and mocked
 * unit tests cannot: the client-side re-aggregation that runs when the period
 * control changes. The chart normalizes each entry through the core frequency
 * engine, so the per-category breakdown figures must update on toggle. A single
 * seeded income means the pie's total equals its one category, so that figure
 * renders twice in the section (total + legend row) — the visibility checks use
 * `.first()`; the disappearance check counts all matches.
 *
 * ⚠️ New users default to `$` (USD) symbols (FR38 / Epic 22), so amounts print
 * with a leading `$`. The header comment here previously claimed currency mode
 * defaults to `none` and figures print as bare decimals — that is the UNIT-test
 * environment (`vitest.setup.ts` pins `{ mode: 'none', currency: 'NONE' }`), not
 * this one. Corrected in 32.3; `overview-duration.spec.ts` is the correct model.
 * The assertions below match on substrings, so they hold either way — but the
 * comment was pointing the next reader at the wrong environment.
 *
 * A single weekly 10000c income re-expresses as:
 *   monthly  round(10000 × 52/12) = 43333c → annually ×12 = 519996c → "$5,199.96"
 *   monthly                                  43333c            → "$433.33"
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const BREAKDOWN_SELECT = { role: 'combobox' as const, name: /show breakdown per/i }
const OVERVIEW_SELECT = { role: 'combobox' as const, name: /show income and expenses per/i }

// Seed one weekly income (cents) so the breakdown renders and its figures shift
// visibly between Annually and Monthly.
function seedWeeklyIncome() {
  const now = new Date().toISOString()
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          {
            id: crypto.randomUUID(),
            userId: 0,
            name: 'Weekly gig',
            amount: 10000,
            frequency: 'weekly',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 1,
    })
  )
}

test('breakdown control defaults to Annually, offers all four durations, and re-aggregates on toggle', async ({
  page,
}) => {
  await page.addInitScript(seedWeeklyIncome)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const selector = page.getByRole(BREAKDOWN_SELECT.role, { name: BREAKDOWN_SELECT.name })
  await expect(selector).toBeVisible()
  await expect(selector).toHaveValue('annually')

  // Four options since 32.3 — the same VALID_DURATIONS set the overview selector
  // renders. Still no date-range presets: that is 12-3's original guarantee.
  await expect(selector.getByRole('option')).toHaveText([
    'Weekly',
    'Bi-weekly',
    'Monthly',
    'Annually',
  ])

  // Scope figure assertions to the breakdown section: the same weekly→annual
  // amount also appears in the overview income card, which since 32.3 reads the
  // SAME store — so a page-wide match would be ambiguous.
  const breakdown = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Income vs Expense Breakdown' }) })

  // Annually: the weekly figure is normalized (weekly × 52/12 × 12), not raw.
  await expect(breakdown.getByText('5,199.96').first()).toBeVisible()

  // Switch to Monthly — the hydrated chart re-aggregates client-side.
  await selector.selectOption('monthly')
  await expect(selector).toHaveValue('monthly')
  await expect(breakdown.getByText('433.33').first()).toBeVisible()
  await expect(breakdown.getByText('5,199.96')).toHaveCount(0)
})

/**
 * Story 32.3, AC-8 — the two controls are LOCKSTEP, not coincidentally aligned.
 *
 * Before 32.3 both defaulted to Annually and so agreed until the user touched
 * either one; the breakdown then held its own state and the page could show the
 * same money 12× apart. This asserts the shared value in a real browser, in both
 * directions, and across a reload — the persist path a unit test cannot reach.
 */
test('either period control moves both, and the shared choice survives a reload', async ({
  page,
}) => {
  await page.addInitScript(seedWeeklyIncome)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const breakdownSelect = page.getByRole(BREAKDOWN_SELECT.role, { name: BREAKDOWN_SELECT.name })
  const overviewSelect = page.getByRole(OVERVIEW_SELECT.role, { name: OVERVIEW_SELECT.name })

  await expect(breakdownSelect).toHaveValue('annually')
  await expect(overviewSelect).toHaveValue('annually')

  // Drive the BREAKDOWN control — the overview control must follow.
  await breakdownSelect.selectOption('monthly')
  await expect(overviewSelect).toHaveValue('monthly')
  await expect(page.getByTestId('overview-total-income')).toHaveText(/433\.33/)

  // Drive the OVERVIEW control — the breakdown must follow.
  await overviewSelect.selectOption('weekly')
  await expect(breakdownSelect).toHaveValue('weekly')

  // The breakdown now writes through the persisted store, which the local
  // useState it replaced never did.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(breakdownSelect).toHaveValue('weekly')
  await expect(overviewSelect).toHaveValue('weekly')
})
