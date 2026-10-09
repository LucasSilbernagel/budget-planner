import type {
	Frequency,
	NormalizableFinancialItem,
} from '@budget-planner/core/finance/normalization'

export type LocalFinancialItem = NormalizableFinancialItem & {
	id: string
	name: string
}

// Never written back to the savings store: the row is the scenario's own copy.
export type LocalSavingsAccount = {
	id: string
	name: string
	balance: number
	monthlyContribution: number
}

// balance is a positive magnitude for both types; contribution is at frequency cadence (the engine normalises).
export type LocalBalanceAccount = {
	id: string
	name: string
	type: 'investment' | 'debt'
	balance: number
	contribution: number
	frequency: Frequency
	// Already counted in Expenses, so the engine does not take it from cash again.
	contributionRecordedAsExpense: boolean
	annualReturn: number
	paidByExpenseName?: string
}

// A constant: no growth and no contribution.
export type LocalAssetAccount = {
	id: string
	name: string
	balance: number
}

export type OneTimeEvent = {
	id: string
	year: number
	amount: number // In cents
	name: string
}

export type ForecastRows = {
	incomeItems: LocalFinancialItem[]
	expenseItems: LocalFinancialItem[]
	savingsAccounts: LocalSavingsAccount[]
	balanceAccounts: LocalBalanceAccount[]
	assetAccounts: LocalAssetAccount[]
}

export type UpdateBalanceAccount = <K extends Exclude<keyof LocalBalanceAccount, 'id'>>(
	id: string,
	field: K,
	value: LocalBalanceAccount[K]
) => void
