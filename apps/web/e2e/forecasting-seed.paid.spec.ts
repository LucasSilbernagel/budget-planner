import { expect, test } from '@playwright/test'

/**
 * A fresh scenario opens on the user's own finances (story 62.1, FR94).
 *
 * ⚠️ `.paid.spec.ts` is load-bearing: only the `chromium-paid` project (:5174,
 * booted with an entitled `E2E_SESSION_SEED`) runs this file. `/forecasting` is
 * a premium route, so on the free server this spec would only ever see the
 * upgrade prompt. Rename it and it stops testing anything. See
 * `playwright.config.ts`.
 *
 * ## What only this layer can prove
 *
 * The unit suite covers the seeding rules, and
 * `scenario-builder.seeding.dom.test.tsx` reproduces a real React hydration with
 * `renderToString` + `hydrateRoot`. What neither can see is the REAL document:
 * the actual SSR response, the real `@tanstack/react-router` Suspense boundary
 * the root `<Outlet/>` sits behind, and the real `StoreHydration` effect
 * ordering that the whole AC-9 decision turns on. That ordering is the reason
 * the seed is an effect gated on `useStoresHydrated()` rather than a lazy
 * `useState` initializer, and this is the only layer that exercises it as
 * shipped.
 *
 * ⚠️ Every store uses `skipHydration: true`, which is why writing localStorage
 * in `addInitScript` before `goto` takes effect.
 */

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

/**
 * Every text/number input's LIVE value.
 *
 * ⚠️ Playwright has no `getByDisplayValue` (that is testing-library), and an
 * `input[value="..."]` CSS locator matches the ATTRIBUTE, which React does not
 * keep in step with a controlled input's property. Reading `.value` off the
 * elements is the only form that sees what the user actually sees.
 */
async function inputValues(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
}

test.describe('a fresh scenario seeds from the user own finances (62.1)', () => {
  test('shows the user rows and totals, and never the retired demo data', async ({ page }) => {
    await seedOwnFinances(page)
    await page.goto('/forecasting')

    // Positive control FIRST: the builder actually rendered. Without it every
    // absence assertion below would pass just as happily on an error page or an
    // upgrade prompt.
    await expect(page.getByRole('heading', { name: 'Scenario Builder' })).toBeVisible()

    await expect
      .poll(() => inputValues(page), { message: 'builder never seeded the user rows' })
      .toContain('Lucas Consulting')

    const values = await inputValues(page)
    expect(values).toContain('Lucas Mortgage')
    // The retired demo rows are gone for good. `Rent/Mortgage` is the exact old
    // string, and is distinct from the seeded 'Lucas Mortgage' above.
    expect(values).not.toContain('Salary')
    expect(values).not.toContain('Rent/Mortgage')
    expect(values).not.toContain('Utilities')
    expect(values).not.toContain('Groceries')
  })

  test('seeds savings and investments into the visible money fields', async ({ page }) => {
    await seedOwnFinances(page)
    await page.goto('/forecasting')
    await expect(page.getByRole('heading', { name: 'Scenario Builder' })).toBeVisible()

    // ⚠️ This is the assertion that catches the `InputField` remount defect
    // specifically. `InputField` snapshots its display string in a lazy
    // initializer and never resyncs, so without the `key={...hasSeeded}` remount
    // the seeded total reaches component state — and the saved scenario — while
    // the field on screen still reads the pre-seed value. Asserting the STATE
    // would miss it entirely; only a rendered value can see it.
    // ⚠️ ANCHORED (code review 62.1). The first version used unanchored
    // `/3[,.]?456/` and `/9[,.]?876/`, which match `345600.00` and `987600.00`
    // just as happily — so a cents/dollars scale error, the single most likely
    // mistake in a money seed, passed. The `not.toHaveValue(/^0(\.00)?$/)`
    // controls were also useless in any currency mode that prefixes a symbol,
    // since `$0.00` does not match `^0`. Compare parsed numbers instead.
    const savings = page.getByLabel('Current Savings')
    const investments = page.getByLabel('Current Investments')
    //
    // ⚠️ `expect.poll`, not a bare `expect(await ...)` — MEASURED (code review
    // 62.1). Since the seed is gated on `useIsInitialSyncPending`, a PAID
    // session defers it until the first pull resolves (or times out), so the
    // fields legitimately read `0.00` for a moment after the heading appears.
    // A one-shot read raced that and failed at `0`; `toHaveValue` had hidden it
    // only because that matcher auto-retries. The delay is the intended cost of
    // not latching an empty seed on a fresh device — see the production comment.
    const asNumber = async (locator: ReturnType<typeof page.getByLabel>) =>
      Number((await locator.inputValue()).replace(/[^0-9.-]/g, ''))
    await expect.poll(() => asNumber(savings)).toBeCloseTo(3456, 2)
    await expect.poll(() => asNumber(investments)).toBeCloseTo(9876, 2)
  })

  test('a first paint on the real SSR document raises no hydration error', async ({ page }) => {
    // ⚠️⚠️ `pageerror`, NOT `console` (code review 62.1). The first version of
    // this test listened on `page.on('console')` and was a SILENT GREEN: React
    // 19 does not warn about a hydration mismatch, it routes one through
    // `onRecoverableError`, whose default implementation calls `reportError` —
    // which Chromium raises as an uncaught exception and Playwright surfaces on
    // `pageerror`. This repo had ALREADY MEASURED it: `e2e/hydration.spec.ts:30-34`
    // records "console.error entries 0, pageerror entries 1", and that spec
    // listens on `pageerror` (`:66`). Nothing in this app overrides
    // `onRecoverableError`, so the console channel is permanently empty.
    // `"did not match"` is React 18 phrasing and is kept only for the dev build.
    const hydrationErrors: string[] = []
    const record = (text: string) => {
      if (/hydrat/i.test(text) || /did not match/i.test(text) || /#418|#423|#425/.test(text)) {
        hydrationErrors.push(text)
      }
    }
    page.on('pageerror', (error) => record(String(error)))
    // Kept as a second arm rather than a replacement: a dev build can still log
    // a mismatch to the console, and listening to both cannot produce a false
    // green. It was listening ONLY here that was wrong.
    page.on('console', (message) => {
      if (message.type() === 'error') record(message.text())
    })

    await seedOwnFinances(page)
    await page.goto('/forecasting')
    await expect(page.getByRole('heading', { name: 'Scenario Builder' })).toBeVisible()
    // Let the seed effect and the 500ms debounced recompute settle, so a
    // mismatch raised after first paint is still caught.
    await expect.poll(() => inputValues(page)).toContain('Lucas Consulting')

    expect(hydrationErrors, `console errors: ${hydrationErrors.join(' | ')}`).toEqual([])
  })

  test('a user with nothing recorded gets an empty builder, not demo rows', async ({ page }) => {
    // No seed at all — the genuine empty user.
    await page.goto('/forecasting')

    await expect(page.getByRole('heading', { name: 'Scenario Builder' })).toBeVisible()
    // The add-row affordances are the escape hatch, and they double as the
    // positive control for the absence assertions below.
    await expect(page.getByRole('button', { name: '+ Add Income' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Add Expense' })).toBeVisible()

    // ⚠️ AC-1 pinned in a REAL BROWSER (code review 62.1). The record for this
    // story originally claimed the blank growth-rate field was "MEASURED", but
    // it was measured in jsdom only and the browser half was inferred. Since
    // the fields are now `type="text"` they carry the string, and this is the
    // observable a jsdom test cannot stand in for.
    await expect(page.getByLabel('Income Growth Rate')).toHaveValue('0.00%')
    await expect(page.getByLabel('Expense Growth Rate')).toHaveValue('0.00%')

    // ⚠️ Assert EMPTINESS, not the absence of three specific strings (code
    // review 62.1). The old form passed against a fallback that used any other
    // names — including rows delivered by a sync pull. There are no row-name
    // inputs at all on an empty builder; the placeholder identifies them.
    await expect(page.locator('input[placeholder="Income/Expense name"]')).toHaveCount(0)
    const values = await inputValues(page)
    expect(values).not.toContain('Salary')
    expect(values).not.toContain('Rent/Mortgage')
    expect(values).not.toContain('Utilities')
    expect(values).not.toContain('Groceries')
  })
})
