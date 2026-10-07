/**
 * The localStorage keys of the four persisted stores the Overview's `hasData`
 * reads (`components/HomePage.tsx`), each with the array field its persisted
 * `state` holds (story 117.2).
 *
 * A LEAF module (no imports) on purpose: the pre-paint bootstrap in
 * `lib/overview/no-flash-overview-data-script.ts` interpolates these, and that
 * bootstrap is also imported by `server/middleware/security-headers.ts` to hash
 * it. Importing the stores themselves there would pull zustand, the sync bridge
 * and the profile store into the server middleware.
 *
 * Each store's `persist({ name })` reads its key from HERE, so the key has one
 * source. The field names must match each store's `partialize`; the bootstrap's
 * test writes through the real stores to catch a rename.
 */

export const INCOME_STORAGE_KEY = 'budget-planner-income-v1'
export const EXPENSES_STORAGE_KEY = 'budget-planner-expenses-v1'
export const SAVINGS_GOALS_STORAGE_KEY = 'budget-planner:savings-goals'
export const BALANCE_TRACKING_STORAGE_KEY = 'budget-planner:balance-tracking'

/** `[storage key, persisted array field]` for each store `hasData` reads. */
export const OVERVIEW_DATA_STORES: ReadonlyArray<readonly [key: string, field: string]> = [
  [INCOME_STORAGE_KEY, 'incomeSources'],
  [EXPENSES_STORAGE_KEY, 'expenses'],
  [SAVINGS_GOALS_STORAGE_KEY, 'savingsGoals'],
  [BALANCE_TRACKING_STORAGE_KEY, 'entries'],
]
