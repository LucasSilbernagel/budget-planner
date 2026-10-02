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
 * ⚠️ Since story 84.5 (FR137) this file holds ONE test, flow F5's seeded
 * builder. The visible-money-field, first-paint-hydration and empty-builder
 * claims moved below the browser
 * (`src/components/forecasting/__tests__/scenario-builder.seeding.dom.test.tsx`;
 * list in `_bmad-output/implementation-artifacts/84-5-evidence/inventory.md`).
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

    // 15 s, not the default 5 s (story 85.2, MEASURED): the heading is server
    // rendered, but the seed needs client hydration, which in this DEV build took
    // up to 9.2 s after the heading while the web Vitest gate ran alongside (3.4 s
    // idle). The initial-sync gate was ruled out (same timings with it disabled).
    // With this poll back at 5 s, concurrent `pnpm gates` failed here 2 of 2.
    // `85-2-evidence/causes.md`, Cause B.
    await expect
      .poll(() => inputValues(page), {
        message: 'builder never seeded the user rows',
        timeout: 15_000,
      })
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
})
