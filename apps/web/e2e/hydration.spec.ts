import { type Page, expect, test } from '@playwright/test'

/**
 * No route fails React hydration with real persisted data (Story 38.1, BUG-F).
 *
 * ## What this proves that nothing else can
 *
 * Every persisted store is `skipHydration: true` and is rehydrated by a single
 * mount effect (`lib/store-hydration.tsx`) that lives in the ROOT subtree, while
 * the route content sits inside the Suspense boundary `@tanstack/react-router`
 * wraps around the root `<Outlet/>` unconditionally (`Match.js:286-289`). React
 * hydrates that boundary in a LATER pass, by which point the stores are already
 * full. A selector that reads the snapshot React hands it is unaffected; a
 * selector that CALLS a state method reaches past the snapshot into live state
 * and produces a text mismatch, which React resolves by discarding the tree.
 *
 * jsdom cannot see any of this — nothing in `apps/web` hydrates in a unit test,
 * and there is no SSR document there. Only a real browser against the real SSR
 * response can falsify it. The unit-level counterpart lives in
 * `src/stores/__tests__/store-selector-hydration.dom.test.tsx`.
 *
 * ## ⚠️ Two traps this file is built around — both measured, both mutation-armed
 *
 * 1. **The seed decides whether these tests can fail at all.** Seeding only
 *    `budget-planner:balance-tracking` makes the Overview's net worth flip from
 *    `$0.00` to `-$142,000.00` with ZERO hydration errors, because both balance
 *    selectors are pure. The obvious seed for a testid called
 *    `overview-net-worth` is therefore structurally incapable of failing.
 *    **Every seed here includes `budget-planner:savings-goals`.**
 * 2. **`page.on('console')` is GREEN against the broken code.** React 19 routes
 *    a hydration mismatch through `onRecoverableError` →
 *    `reportGlobalError` → `reportError`, i.e. the UNCAUGHT ERROR channel.
 *    Playwright surfaces that on `pageerror` and NOT on `console`. Measured:
 *    console.error entries 0, pageerror entries 1.
 *
 * ⚠️ The listener must be attached BEFORE `goto`, or the error is missed.
 *
 * ⚠️ `playwright.config.ts` boots `pnpm dev`, so React's readable message is
 * available. Against a production build the same defect minifies to React error
 * #418 — match the code, not the prose, if this is ever pointed at a build.
 *
 * ⚠️ E2E runs the PRODUCT default (`$`/USD). The unit suite pins currency-less
 * mode, so figure strings do not transfer between the two layers.
 */

/**
 * ⚠️ React surfaces a hydration mismatch under several minified codes, not just
 * one: #418 (text mismatch), #423 (the root switched to client rendering after an
 * error while hydrating) and #425 (text content did not match). The first version
 * of this file matched #418 alone — against a production build a mismatch
 * surfacing as #423/#425 would have filtered to zero and every route test would
 * have gone green against broken code, which is the exact failure mode the rest of
 * this file exists to prevent. Raised in code review.
 */
const HYDRATION_ERROR = /Hydration failed|Minified React error #(418|423|425)/

/**
 * Collects hydration errors for one page. Call BEFORE `goto`.
 *
 * Returns the live array so a failure message can name what was seen — an empty
 * `toEqual([])` failure that prints only "expected [] to equal []" tells the
 * next reader nothing.
 */
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (HYDRATION_ERROR.test(error.message)) {
      errors.push(error.message)
    }
  })
  return errors
}

/**
 * Seeds all four financial stores.
 *
 * ⚠️ `version: 2` against a `version: 3` store forces zustand's `migrate` to run
 * (it fires on any MISMATCH), which backfills `sortOrder`. That matters for
 * ordering-dependent specs. It does NOT matter for hydration — measured: savings
 * at `version: 2` and at `version: 3` both produce exactly one hydration error.
 * Recorded so a future reader does not credit the version with work it is not
 * doing.
 *
 * Savings is the load-bearing store here (trap 1). The others are seeded so the
 * routes that read them render populated rather than empty.
 */
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
 * The six routes that read a persisted store through a component-level hook, each
 * paired with a testid that only renders once that store-backed content has
 * mounted.
 *
 * ⚠️ THE MARKER IS NOT DECORATION. Code review found that asserting only "zero
 * hydration errors" passes VACUOUSLY on a route that never rendered — a 404, an
 * SSR throw into an error boundary, or a route removed by a later story would all
 * produce zero errors because nothing hydrated. The marker is what makes a green
 * result mean "this route hydrated cleanly" instead of "nothing happened".
 */
const STORE_BACKED_ROUTES = [
  { path: '/', marker: 'overview-net-worth' },
  { path: '/income', marker: 'period-total-amount' },
  { path: '/expenses', marker: 'period-total-amount' },
  { path: '/savings', marker: 'savings-leftover-summary' },
  { path: '/balance', marker: 'stat-net-worth' },
  { path: '/net-worth-projection', marker: 'projection-current-net-worth' },
] as const

test.describe('hydration', () => {
  for (const { path, marker } of STORE_BACKED_ROUTES) {
    test(`${path} hydrates without a mismatch when stores hold data`, async ({ page }) => {
      const hydrationErrors = collectHydrationErrors(page)

      await page.addInitScript(seedAllStores)
      const response = await page.goto(path)

      // The route was actually served, and its store-backed content actually
      // mounted. Both must hold before "no hydration errors" means anything.
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
   * Negative control. With no persisted data the server render and the client
   * render agree trivially, so a clean result here proves the detector is not
   * simply always-green for a reason unrelated to the defect — it is the
   * populated case above that has to do the work.
   */
  test('the Overview hydrates cleanly with empty storage (negative control)', async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    expect(hydrationErrors, hydrationErrors.join('\n---\n')).toEqual([])
    await expect(page.getByTestId('overview-net-worth')).toHaveText('$0.00')
  })

  /**
   * The figures still resolve after rehydration. Guards against "fixing" the
   * mismatch by never showing the user their data — a page that renders `$0.00`
   * forever would satisfy every assertion above.
   *
   * investments 800,000c + savings 300,000c − debts 15,000,000c = −13,900,000c
   */
  test('the Overview shows the rehydrated figures, not the defaults', async ({ page }) => {
    await page.addInitScript(seedAllStores)
    await page.goto('/')

    await expect(page.getByTestId('overview-net-worth')).toHaveText('-$139,000.00')
  })
})
