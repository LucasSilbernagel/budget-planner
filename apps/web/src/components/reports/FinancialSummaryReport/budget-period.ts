// Both members are core Frequency values, so denormalizeFromMonthly is the one conversion rule.
// Deliberately not the persisted overviewDurationStore: the report always opens monthly.
export type BudgetPeriod = 'monthly' | 'annually'

export const BUDGET_PERIOD_LABEL = {
	monthly: { option: 'Monthly', word: 'Monthly' },
	annually: { option: 'Annually', word: 'Annual' },
} satisfies Record<BudgetPeriod, { option: string; word: string }>
