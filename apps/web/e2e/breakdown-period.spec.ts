import { expect, test } from '@playwright/test'

/**
 * Income vs Expense Breakdown period control E2E (Story 12-3, UX-DR20).
 *
 * Drives the hydrated Home dashboard to prove what SSR/HTML smoke and mocked
 * unit tests cannot: the client-side re-aggregation that runs when the
 * Monthly/Annually control changes. The chart normalizes each entry through the
 * core frequency engine, so the "Top Categories" figures must update on toggle.
 *
 * Currency mode defaults to `none`, so figures print as locale-grouped decimals
 * (story 14-2). A single weekly 10000c income re-expresses as:
 *   monthly  round(10000 × 52/12) = 43333c → annually ×12 = 519996c → "5,199.96"
 *   monthly                                 43333c            → "433.33"
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const BREAKDOWN_SELECT = { role: 'combobox' as const, name: /show breakdown per/i }

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

test('breakdown control defaults to Annually, offers only Monthly/Annually, and re-aggregates on toggle', async ({
  page,
}) => {
  await page.addInitScript(seedWeeklyIncome)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const selector = page.getByRole(BREAKDOWN_SELECT.role, { name: BREAKDOWN_SELECT.name })
  await expect(selector).toBeVisible()
  await expect(selector).toHaveValue('annually')

  // Exactly two options, Monthly and Annually — no date-range presets.
  await expect(selector.getByRole('option')).toHaveText(['Monthly', 'Annually'])

  // Scope figure assertions to the breakdown section: the same weekly→annual
  // amount also appears in the overview income card (which independently
  // defaults to Annually), so a page-wide match would be ambiguous.
  const breakdown = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Income vs Expense Breakdown' }) })

  // Annually: the weekly figure is normalized (weekly × 52/12 × 12), not raw,
  // and grouped by the currency-less formatter (story 14-2).
  await expect(breakdown.getByText('5,199.96')).toBeVisible()

  // Switch to Monthly — the hydrated chart re-aggregates client-side.
  await selector.selectOption('monthly')
  await expect(selector).toHaveValue('monthly')
  await expect(breakdown.getByText('433.33')).toBeVisible()
  await expect(breakdown.getByText('5,199.96')).toHaveCount(0)
})
