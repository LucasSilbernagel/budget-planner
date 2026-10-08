import { type Page, expect, test } from '@playwright/test'

// Stores rehydrate in a root effect, but the router's Suspense boundary hydrates route
// content in a later pass, so a selector that calls a state method mismatches.

// Every seed includes savings-goals: balance selectors are pure, so a balance-only seed
// can't fail. Mismatches arrive on `pageerror`, not `console`.

/** A production build can surface a mismatch as #418, #423 or #425. */
const HYDRATION_ERROR = /Hydration failed|Minified React error #(418|423|425)/

/** Call before `goto`, or the error is missed. */
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (HYDRATION_ERROR.test(error.message)) {
      errors.push(error.message)
    }
  })
  return errors
}

/** Savings is the load-bearing store; the others make their routes render populated. */
function seedAllStores() {
  const now = new Date().toISOString()

  localStorage.setItem(
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: crypto.randomUUID(),
            name: 'Emergency fund',
            targetAmount: 1000000,
            currentBalance: 250000,
            allocationMode: 'manual',
            monthlyAllocation: 20000,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: crypto.randomUUID(),
            name: 'Rainy day',
            targetAmount: null,
            currentBalance: 50000,
            allocationMode: 'manual',
            monthlyAllocation: 10000,
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
            id: crypto.randomUUID(),
            type: 'investment',
            name: 'ISA',
            currentBalance: 800000,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: crypto.randomUUID(),
            type: 'debt',
            name: 'Mortgage',
            currentBalance: 15000000,
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

  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          {
            id: crypto.randomUUID(),
            name: 'Salary',
            amount: 500000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 2,
    })
  )

  localStorage.setItem(
    'budget-planner-expenses-v1',
    JSON.stringify({
      state: {
        expenses: [
          {
            id: crypto.randomUUID(),
            name: 'Rent',
            amount: 150000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 2,
    })
  )
}

/**
 * The marker isn't decoration: zero hydration errors also holds on a route that
 * never rendered (a 404 or an error boundary).
 */
const STORE_BACKED_ROUTES = [
  { path: '/', marker: 'overview-net-worth' },
  { path: '/income', marker: 'period-total-amount' },
  { path: '/expenses', marker: 'period-total-amount' },
  { path: '/savings', marker: 'savings-leftover-summary' },
  { path: '/balance', marker: 'stat-net-worth' },
] as const

test.describe('hydration', () => {
  for (const { path, marker } of STORE_BACKED_ROUTES) {
    test(`${path} hydrates without a mismatch when stores hold data`, async ({ page }) => {
      const hydrationErrors = collectHydrationErrors(page)

      await page.addInitScript(seedAllStores)
      const response = await page.goto(path)

      expect(response?.status(), `${path} did not return 200`).toBe(200)
      await expect(page.getByTestId(marker)).toBeVisible()

      await page.waitForLoadState('networkidle')

      expect(
        hydrationErrors,
        `hydration errors on ${path}:\n${hydrationErrors.join('\n---\n')}`
      ).toEqual([])
    })
  }

  /**
   * Guards against "fixing" the mismatch by never showing the data.
   * investments 800,000c + savings 300,000c − debts 15,000,000c = −13,900,000c
   */
  test('the Overview shows the rehydrated figures, not the defaults', async ({ page }) => {
    await page.addInitScript(seedAllStores)
    await page.goto('/')

    // The figure is empty until the client hydrates, which is slow in dev under
    // concurrent gates.
    await expect(page.getByTestId('overview-net-worth')).toHaveText('-$139,000.00', {
      timeout: 15_000,
    })
  })
})
