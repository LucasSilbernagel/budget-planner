import { expect, test } from '@playwright/test'

/**
 * Global income/expense duration selector E2E (Story 12-2, FR31).
 *
 * Drives the hydrated Home dashboard to prove the behaviors that SSR/HTML smoke
 * and mocked unit tests cannot:
 *   - the overview defaults to Annually with a single duration selector;
 *   - changing it re-expresses Total Income / Total Expenses and their labels;
 *   - the choice PERSISTS across a full page reload.
 *
 * The reload case is the important one: the selection lives in a persisted
 * zustand store created with `skipHydration: true`, so it only survives a reload
 * if the store is registered for client rehydration (lib/store-hydration). A
 * missing registration passes every unit test but silently resets on reload —
 * only a real browser reload catches it.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const DURATION_SELECT = { role: 'combobox' as const, name: /show income and expenses per/i }

// Seed one monthly income (cents) so figures render and re-express predictably.
// New users default to `$` (USD) symbols (FR38 / Epic 22), so amounts print with
// a leading `$`: 120000c monthly → $14,400.00 annually, $1,200.00 monthly.
function seedMonthlyIncome() {
  const now = new Date().toISOString()
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          {
            id: crypto.randomUUID(),
            userId: 0,
            name: 'Salary',
            amount: 120000,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 1,
    })
  )
}

/**
 * Mixed frequencies (story 32.1): $200 weekly + $1,500 monthly + $600 annually.
 *   raw sum            = 230000c  <- what the FR58 defect displayed
 *   normalized monthly = 241667c  (86667 + 150000 + 5000)
 * The two differ, which is what makes this fixture able to detect the defect at
 * all — a single-frequency seed cannot.
 */
function seedMixedFrequencyIncome() {
  const now = new Date().toISOString()
  const row = (name: string, amount: number, frequency: string) => ({
    id: crypto.randomUUID(),
    userId: 0,
    name,
    amount,
    frequency,
    categoryId: null,
    createdAt: now,
    updatedAt: now,
  })
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          row('Side gig', 20000, 'weekly'),
          row('Salary', 150000, 'monthly'),
          row('Bonus', 60000, 'annually'),
        ],
      },
      version: 2,
    })
  )
}

test('overview defaults to Annually and re-expresses figures when the duration changes', async ({
  page,
}) => {
  await page.addInitScript(seedMonthlyIncome)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const selector = page.getByRole(DURATION_SELECT.role, { name: DURATION_SELECT.name })
  await expect(selector).toBeVisible()
  await expect(selector).toHaveValue('annually')
  await expect(page.getByText('Total Income (per year)')).toBeVisible()

  // The income figure is the paragraph immediately after its label; scope to it
  // so the repeated "Top Categories" summary value can't cause ambiguity.
  const incomeValue = page
    .getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)
    .locator('xpath=following-sibling::p')
  await expect(incomeValue).toHaveText('$14,400.00')

  // Switch to Monthly — the single control drives both label and figure.
  await selector.selectOption('monthly')
  await expect(page.getByText('Total Income (per month)')).toBeVisible()
  await expect(incomeValue).toHaveText('$1,200.00')

  // Bi-weekly is the fourth option added by story 32.1 (FR58):
  // round(120000 × 12/26) = 55385c -> $553.85.
  await selector.selectOption('biweekly')
  await expect(page.getByText('Total Income (per 2 weeks)')).toBeVisible()
  await expect(incomeValue).toHaveText('$553.85')
})

/**
 * Story 32.1 (FR58). The Income page's headline total used to be a RAW sum of
 * amounts across mixed frequencies, so it disagreed with the Overview on the
 * same data. This drives both surfaces in one real browser session and pins that
 * they now agree — and that the duration is genuinely one app-wide preference
 * rather than a per-page control that merely looks the same.
 */
test('the Income page total is normalized, period-labelled, and agrees with the Overview', async ({
  page,
}) => {
  await page.addInitScript(seedMixedFrequencyIncome)

  await page.goto('/income')
  await page.waitForLoadState('networkidle')

  const pageSelector = page.getByRole('combobox', { name: /show income per/i })
  await expect(pageSelector).toHaveValue('annually')

  const total = page.getByTestId('period-total-amount')

  // Normalized monthly = 241667c -> ×12 = 2900004c. A raw sum would show
  // $2,760.00 annually (230000 × 12), which is the defect's signature.
  await expect(total).toHaveText('$29,000.04')

  await pageSelector.selectOption('monthly')
  await expect(page.getByText('Total Income (per month)')).toBeVisible()
  await expect(total).toHaveText('$2,416.67')

  // The SAME preference now drives the dashboard — one source of truth.
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const overviewSelector = page.getByRole(DURATION_SELECT.role, { name: DURATION_SELECT.name })
  await expect(overviewSelector).toHaveValue('monthly')
  const overviewIncome = page
    .getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)
    .locator('xpath=following-sibling::p')
  await expect(overviewIncome).toHaveText('$2,416.67')
})

test('the chosen duration persists across a full page reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const selector = page.getByRole(DURATION_SELECT.role, { name: DURATION_SELECT.name })
  await selector.selectOption('monthly')
  await expect(selector).toHaveValue('monthly')

  await page.reload()
  await page.waitForLoadState('networkidle')

  // After rehydration the selector must reflect the persisted choice, not the
  // Annually default — this is the store-hydration registration proof.
  const reloaded = page.getByRole(DURATION_SELECT.role, { name: DURATION_SELECT.name })
  await expect(reloaded).toHaveValue('monthly')
  await expect(page.getByText('Total Income (per month)')).toBeVisible()
})
