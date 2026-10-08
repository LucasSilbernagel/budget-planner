/**
 * A leaf module (no imports): the pre-paint bootstrap interpolates these and is imported by the
 * server middleware, which must not pull in the stores.
 */

export const INCOME_STORAGE_KEY = 'budget-planner-income-v1'
export const EXPENSES_STORAGE_KEY = 'budget-planner-expenses-v1'
export const SAVINGS_GOALS_STORAGE_KEY = 'budget-planner:savings-goals'
export const BALANCE_TRACKING_STORAGE_KEY = 'budget-planner:balance-tracking'

export const OVERVIEW_DATA_STORES: ReadonlyArray<readonly [key: string, field: string]> = [
	[INCOME_STORAGE_KEY, 'incomeSources'],
	[EXPENSES_STORAGE_KEY, 'expenses'],
	[SAVINGS_GOALS_STORAGE_KEY, 'savingsGoals'],
	[BALANCE_TRACKING_STORAGE_KEY, 'entries'],
]
