import type { Page } from '@playwright/test'

// One unbroken run: no name input has a maxLength, and `overflow-wrap: break-word`
// doesn't reduce min-content width, so an auto-layout table sizes to it.
const LONG_UNBROKEN_NAME = 'Longestpossibleaccountnicknamewithoutanyspaces'.repeat(3)

/**
 * Savings/balance keys break the `-v1` convention, and a balance row without
 * `frequency` makes the normalization engine throw.
 */
export async function seedFinanceRows(page: Page): Promise<void> {
  await page.addInitScript(
    ([longName]) => {
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
                currentBalance: 98765432100,
                monthlyContribution: 0,
                frequency: 'monthly',
                paymentExpenseId: 'exp-1',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          version: 2,
        })
      )

      localStorage.setItem(
        'budget-planner-currency-prefs-v1',
        JSON.stringify({ state: { mode: 'symbol', currency: 'USD' }, version: 2 })
      )
    },
    [LONG_UNBROKEN_NAME] as const
  )
}
