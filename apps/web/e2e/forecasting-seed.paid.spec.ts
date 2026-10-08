import { expect, test } from '@playwright/test'
import { mockSignedIn } from './helpers/nav-more'

// Only chromium-paid runs `.paid.spec.ts`; /forecasting is premium, so the free
// server would only show the upgrade prompt.

// Every store uses `skipHydration`, which is why localStorage written in
// addInitScript before goto takes effect.

async function seedOwnFinances(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const now = '2026-09-22T00:00:00.000Z'
    const flowRow = (id: string, name: string, amount: number) => ({
      id,
      userId: 0,
      name,
      amount,
      frequency: 'monthly',
      categoryId: null,
      createdAt: now,
      updatedAt: now,
    })

    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: { incomeSources: [flowRow('inc-1', 'Lucas Consulting', 720000)] },
        version: 2,
      })
    )
    localStorage.setItem(
      'budget-planner-expenses-v1',
      JSON.stringify({
        state: { expenses: [flowRow('exp-1', 'Lucas Mortgage', 210000)] },
        version: 2,
      })
    )
    localStorage.setItem(
      'budget-planner:savings-goals',
      JSON.stringify({
        state: {
          savingsGoals: [
            {
              id: 'sav-1',
              name: 'Emergency fund',
              targetAmount: 1000000,
              currentBalance: 345600,
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
    localStorage.setItem(
      'budget-planner:balance-tracking',
      JSON.stringify({
        state: {
          entries: [
            {
              id: 'bal-1',
              type: 'investment',
              name: 'Index fund',
              currentBalance: 987600,
              monthlyContribution: 0,
              frequency: 'monthly',
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        version: 2,
      })
    )
  })
}

// Reads live `.value`s: an `input[value]` locator matches the attribute, which
// React doesn't keep in step for controlled inputs.
async function inputValues(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
}

test.describe('a fresh scenario seeds from the user own finances (62.1)', () => {
  test('shows the user rows and totals, and never the retired demo data', async ({ page }) => {
    await seedOwnFinances(page)
    // The paid seam's SSR seed is entitled but its real /api/auth/me answers
    // signed-out, and usePremiumAccess follows that answer, so mock an agreeing one.
    await mockSignedIn(page, { subscriptionStatus: 'active' })
    await page.goto('/forecasting')

    // Positive control first: every absence check below would also pass on an error page.
    await expect(page.getByRole('heading', { name: 'Scenario Builder' })).toBeVisible()

    // The heading is server rendered but the seed needs client hydration, which is
    // slow in dev under concurrent gates.
    await expect
      .poll(() => inputValues(page), {
        message: 'builder never seeded the user rows',
        timeout: 15_000,
      })
      .toContain('Lucas Consulting')

    const values = await inputValues(page)
    expect(values).toContain('Lucas Mortgage')
    expect(values).toContain('Emergency fund')
    expect(values).toContain('Index fund')
    expect(values).not.toContain('Salary')
    expect(values).not.toContain('Rent/Mortgage')
    expect(values).not.toContain('Utilities')
    expect(values).not.toContain('Groceries')
  })
})
