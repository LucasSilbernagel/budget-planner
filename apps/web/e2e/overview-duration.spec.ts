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
    .getByText(/^Total Income \(per (week|month|year)\)$/)
    .locator('xpath=following-sibling::p')
  await expect(incomeValue).toHaveText('$14,400.00')

  // Switch to Monthly — the single control drives both label and figure.
  await selector.selectOption('monthly')
  await expect(page.getByText('Total Income (per month)')).toBeVisible()
  await expect(incomeValue).toHaveText('$1,200.00')
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
