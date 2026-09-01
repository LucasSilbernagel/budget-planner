import type { Page } from '@playwright/test'

/**
 * Shared adversarial finance-row seed (extracted from `responsive-320.spec.ts`
 * by story 42.2).
 *
 * ⚠️ EXTRACTED RATHER THAN COPIED, deliberately. `src/test/responsive-table-tokens.ts:5-10`
 * records that divergent copies of a guard fixture mean the WEAKEST copy
 * defines the protection. Both `responsive-320.spec.ts` (which asserts these
 * rows fit at 320px) and `table-scroll-affordance.spec.ts` (which asserts they
 * OVERFLOW at 768px and are signposted) must be measuring the same rows, or the
 * two suites silently drift apart and one of them stops describing the app.
 *
 * ⚠️ Do NOT also share the `WIDE_FONT` style tag. The convention runs the other
 * way for measurement ENVIRONMENTS — `premium-locked.spec.ts:280-281`:
 * "Deliberately re-declared rather than exported across specs — nothing depends
 * on these two strings matching; each spec pins its own measurement
 * environment." Share the fixture, re-declare the font pin.
 */

export const FINANCE_THEME_KEY = 'budget-planner-theme-prefs-v1'

// A single unbroken 138-character run (46 x 3). Reachable in production: none of the
// four name inputs has a `maxLength`. `overflow-wrap: break-word` does NOT
// reduce min-content width, so an auto-layout table sizes to this whole run —
// which is exactly the failure mode this seed has to produce.
export const LONG_UNBROKEN_NAME = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)

/**
 * Seed all four finance stores plus categories, currency (symbol mode, the
 * widest figures) and the theme.
 *
 * Store keys, wrapper shapes and versions are the CURRENT ones — note that
 * savings/balance break the `-v1` convention (colon-separated keys), currency
 * persists `{ mode, currency }` at version 2 (`locale` was removed in story
 * 8-1 and is derived), and a balance row without `frequency` makes the
 * normalization engine throw. Every store uses `skipHydration: true`, which is
 * why writing localStorage in `addInitScript` before `goto` takes effect.
 */
/**
 * ⚠️ THE CATEGORY ASSIGNMENTS BELOW ARE NOW INERT — deliberately kept, not
 * overlooked (story 33.3, FR57).
 *
 * `inc-1`/`exp-1` carry real `categoryId`s so the Category pill would contribute
 * width to the 320px measurement. Since 33.3 that column renders only for
 * entitled users, and this suite — like every e2e suite here — is
 * UNAUTHENTICATED, so the pill never appears and the seeded ids change nothing
 * about what is measured.
 *
 * They stay because they cost nothing and because a future story that gives e2e
 * a way to seed an entitled session would want them back. ⚠️ They do NOT protect
 * anything today: `categories-premium.spec.ts` has its OWN file-local
 * `seedCategorizedRows`, so this seed has no effect on that suite's assertions
 * (an earlier version of this comment claimed otherwise — code review 33.3).
 * Do not read their presence as evidence that this sweep exercises the Category
 * column: it cannot, at any width, in either tier.
 *
 * ⚠️ Related blind spot, recorded rather than "fixed": the desktop header check
 * in this file asserts `visibleHeaderCells > 0`, not a specific count. That is
 * correct here (an unauthenticated visitor now legitimately sees four columns,
 * not five) but it means this suite is structurally insensitive to the column
 * count. Header/cell parity is pinned in `category-assignment.test.tsx`, which
 * is the only layer that can render both tiers.
 */
export async function seedFinanceRows(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([longName, themeValue, themeKey]) => {
      const now = '2026-08-11T00:00:00.000Z'

      localStorage.setItem(
        'budget-planner-categories-v1',
        JSON.stringify({
          state: {
            categories: [
              {
                id: 'cat-income-1',
                userId: 0,
                profileId: null,
                name: 'Employment Income',
                kind: 'income',
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'cat-expense-1',
                userId: 0,
                profileId: null,
                name: 'Household & Utilities',
                kind: 'expense',
                isDeleted: false,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 1,
        })
      )

      const flowRow = (id: string, name: string, amount: number, categoryId: string | null) => ({
        id,
        userId: 0,
        name,
        amount,
        frequency: 'monthly',
        categoryId,
        createdAt: now,
        updatedAt: now,
      })

      localStorage.setItem(
        'budget-planner-income-v1',
        JSON.stringify({
          state: {
            incomeSources: [
              flowRow('inc-1', longName, 1234567890, 'cat-income-1'),
              flowRow('inc-2', 'Freelance & Consulting', 45678900, null),
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
              flowRow('exp-1', longName, 987654321, 'cat-expense-1'),
              flowRow('exp-2', 'Groceries', 65432100, null),
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
                id: 'sav-1',
                name: longName,
                targetAmount: 5000000000,
                currentBalance: 1234567890,
                allocationMode: 'manual',
                monthlyAllocation: 98765400,
                createdAt: now,
                updatedAt: now,
              },
              {
                // Account row (null target) — exercises the "No target" / "N/A"
                // progress branch alongside the goal row above.
                id: 'sav-2',
                name: 'Emergency Fund',
                targetAmount: null,
                currentBalance: 87654300,
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

      localStorage.setItem(
        'budget-planner:balance-tracking',
        JSON.stringify({
          state: {
            entries: [
              {
                // ⚠️ Story 49.1 (FR75) deleted the Max Contribution and Remaining
                // Room columns, so `/balance` is now FIVE columns, not seven, and
                // this row no longer carries a `maxContributionLimit`. The seeded
                // figures below still drive the width fixtures in
                // `table-scroll-affordance.spec.ts` — do not shrink them casually.
                id: 'bal-1',
                type: 'investment',
                name: longName,
                currentBalance: 1234567890,
                monthlyContribution: 45678900,
                frequency: 'biweekly',
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'bal-2',
                type: 'debt',
                name: 'Mortgage',
                currentBalance: -98765432100,
                monthlyContribution: 234567800,
                frequency: 'monthly',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )

      // Explicit-symbols mode renders the widest currency-formatted figures.
      // Current persist shape: `{ mode, currency }` at version 2.
      localStorage.setItem(
        'budget-planner-currency-prefs-v1',
        JSON.stringify({ state: { mode: 'symbol', currency: 'USD' }, version: 2 })
      )

      // Seed the theme STORE — never hand-add `.dark` to <html>: ThemeProvider
      // re-applies the persisted preference shortly after mount and would strip
      // a hand-added class, silently turning a dark test into a light one.
      localStorage.setItem(themeKey, JSON.stringify({ state: { theme: themeValue }, version: 0 }))
    },
    [LONG_UNBROKEN_NAME, theme, FINANCE_THEME_KEY] as const
  )
}
