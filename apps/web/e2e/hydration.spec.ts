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
 * The five routes that read a persisted store through a component-level hook, each
 * paired with a testid that only renders once that store-backed content has
 * mounted. (Six until story 43.3 removed `/net-worth-projection` — the warning
 * below is exactly the case that removal creates, so the entry left with it.)
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
   * Story 41.3 made the account strip's markup ROUTE-DEPENDENT for the first
   * time: on `/login` its unauthenticated branch renders nothing. That branch
   * runs on the server as well as the client, so the two must agree about the
   * route or the root subtree is discarded — and `/login` is not in
   * STORE_BACKED_ROUTES, so nothing above covered it.
   *
   * The read is `useRouterState`, whose location store is seeded from
   * `history.location` at router construction, before React's first render
   * (`GlobalNav.tsx` documents why that makes it as hydration-safe as the
   * `activeProps` this app already ships). This test is what turns that argument
   * into evidence on the one route where the two renders could disagree.
   */
  test('/login hydrates cleanly now that the account strip is route-dependent', async ({
    page,
  }) => {
    const hydrationErrors = collectHydrationErrors(page)

    await page.addInitScript(seedAllStores)
    const response = await page.goto('/login')

    expect(response?.status(), '/login did not return 200').toBe(200)

    // Both halves are preconditions. A hydration-clean result means nothing if
    // the strip never mounted, and it means nothing about story 41.3 unless the
    // route-dependent branch is the one that rendered.
    //
    // ⚠️ The count is asserted AFTER the page settles, deliberately. Raised in
    // code review as a possible auto-pass — the worry being that `toHaveCount(0)`
    // could succeed during the loading branch, which has no link either, and so
    // hold even against a route-blind strip. Checked by mutation rather than
    // argued: with `!isOnLoginPage` removed, this test fails right here with
    // `Received: 1`, because the SSR seed resolves the session server-side and
    // the link is in the server HTML from the first byte. The ordering was never
    // load-bearing — but a reader should not have to re-run that mutation to
    // find out, so the assertion now sits where it plainly cannot race.
    const indicator = page.getByRole('status', { name: /account status/i })
    await expect(indicator).toBeVisible()

    await page.waitForLoadState('networkidle')

    await expect(indicator.getByRole('link', { name: /sign in/i })).toHaveCount(0)

    expect(
      hydrationErrors,
      `hydration errors on /login:\n${hydrationErrors.join('\n---\n')}`
    ).toEqual([])
  })

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
   * Story 38.2 added skeletons to the pending render, which means the markup
   * React now hydrates on these routes is DIFFERENT markup — placeholders where
   * figures used to be. This case pins that the substitution did not reintroduce
   * the very mismatch 38.1 removed, in this file rather than only in the story's
   * own spec: the server must serve a skeleton, the client must hydrate that
   * markup, and no hydration error may result.
   *
   * ⚠️ Added in code review. 38.2's AC-4 asked for pending-state coverage HERE and
   * the implementation put it all in `loading-state.spec.ts` instead — met in
   * substance, missed in letter.
   */
  test('the pending markup 38.2 introduced hydrates without a mismatch', async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page)

    await page.addInitScript(seedAllStores)
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    // What the server actually sent is a placeholder, not a figure.
    const html = await response?.text()
    expect(html).toContain('overview-net-worth-skeleton')
    expect(html).not.toContain('$0.00')

    // ...and that markup hydrated into the real figure, cleanly.
    await expect(page.getByTestId('overview-net-worth')).toHaveText('-$139,000.00')
    await page.waitForLoadState('networkidle')
    expect(
      hydrationErrors,
      `hydration errors on the pending markup:\n${hydrationErrors.join('\n---\n')}`
    ).toEqual([])
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
