import { expect, test } from '@playwright/test'

/**
 * Net worth includes savings, on every surface (Story 32.2, FR59).
 *
 * Drives the hydrated app in a real browser to prove what unit tests cannot:
 * that the Overview, the Balance page and the Net Worth Projection page — three
 * separately-rendered routes reading two separately-persisted stores — resolve
 * the SAME figure from the same localStorage state after real rehydration.
 *
 * Both stores are `skipHydration: true` and rehydrate on mount, so a surface can
 * pass every jsdom test and still read an empty store in the browser. It also
 * catches the jsdom/Chromium accessible-name divergence measured in story 32.1 —
 * which is why every figure below is located by `data-testid`.
 *
 * ⚠️ E2E runs the PRODUCT default (`$`/USD symbols), not the currency-less mode
 * the unit suite pins. Figures print with a leading `$`.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

/**
 * investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
 *   → "-$127,000.00"
 * The pre-32.2 definition (investments − debts) gave −13,000,000c → "-$130,000.00",
 * so the two are distinguishable in the rendered string.
 */
function seedBalancesAndSavings() {
  const now = new Date().toISOString()

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
            maxContributionLimit: null,
            monthlyContribution: 0,
            frequency: 'monthly',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: crypto.randomUUID(),
            type: 'investment',
            name: 'Pension',
            currentBalance: 1200000,
            maxContributionLimit: null,
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
            maxContributionLimit: null,
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
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: crypto.randomUUID(),
            name: 'Emergency fund',
            targetAmount: 1000000,
            currentBalance: 250000,
            allocationMode: 'automatic',
            monthlyAllocation: null,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: crypto.randomUUID(),
            name: 'Rainy day',
            targetAmount: null,
            currentBalance: 50000,
            allocationMode: 'automatic',
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

/** Savings only — no investments, no debts. Net worth = 300,000c → "$3,000.00". */
function seedSavingsOnly() {
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
            currentBalance: 300000,
            allocationMode: 'automatic',
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

test('the Overview, Balance and Projection pages all show a savings-inclusive net worth', async ({
  page,
}) => {
  await page.addInitScript(seedBalancesAndSavings)

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const overview = page.getByTestId('overview-net-worth')
  await expect(overview).toHaveText('-$127,000.00')

  await page.goto('/balance')
  await page.waitForLoadState('networkidle')
  // The four stat cards must reconcile on screen: 20,000 + 3,000 − 150,000.
  await expect(page.getByTestId('stat-total-investments')).toHaveText('$20,000.00')
  await expect(page.getByTestId('stat-total-savings')).toHaveText('$3,000.00')
  await expect(page.getByTestId('stat-total-debts')).toHaveText('$150,000.00')
  await expect(page.getByTestId('stat-net-worth')).toHaveText('-$127,000.00')

  await page.goto('/net-worth-projection')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('projection-current-net-worth')).toHaveText('-$127,000.00')
})

test('a savings-only user sees a real net worth, not zero and not a "nothing tracked" hint', async ({
  page,
}) => {
  await page.addInitScript(seedSavingsOnly)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await expect(page.getByTestId('overview-net-worth')).toHaveText('$3,000.00')
  // The empty hint used to render beside this positive figure, because its gate
  // counted balance rows only.
  await expect(page.getByTestId('net-worth-empty-hint')).toHaveCount(0)

  await page.goto('/balance')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('stat-net-worth')).toHaveText('$3,000.00')
})
