import type { ForecastInputData } from '@budget-planner/core/finance/forecasting'
import type { NormalizableFinancialItem } from '@budget-planner/core/finance/normalization'
import type { ForecastRows, LocalFinancialItem } from './types'

export function toNormalizableItems(items: LocalFinancialItem[]): NormalizableFinancialItem[] {
	return items.map(({ id: _id, ...rest }) => rest)
}

// Totals are the rows' sums, so they can't disagree (the engine refuses a mismatch).
// One conversion for scenario and today's data, so an unedited scenario equals the baseline.
export function forecastInputFromRows(rows: ForecastRows): ForecastInputData {
	return {
		income: toNormalizableItems(rows.incomeItems),
		expenses: toNormalizableItems(rows.expenseItems),
		savings: rows.savingsAccounts.reduce((sum, account) => sum + account.balance, 0),
		investments: rows.balanceAccounts.reduce(
			(sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
			0
		),
		savingsAccounts: rows.savingsAccounts.map(({ balance, monthlyContribution }) => ({
			balance,
			monthlyContribution,
		})),
		balanceAccounts: rows.balanceAccounts.map(
			({
				type,
				balance,
				contribution,
				frequency,
				contributionRecordedAsExpense,
				annualReturn,
			}) => ({
				type,
				balance,
				contribution,
				frequency,
				contributionRecordedAsExpense,
				...(type === 'investment' ? { annualReturn } : {}),
			})
		),
		assets: rows.assetAccounts.reduce((sum, account) => sum + account.balance, 0),
	}
}
