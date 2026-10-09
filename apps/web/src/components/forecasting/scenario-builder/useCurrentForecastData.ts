import type { ForecastInputData } from '@budget-planner/core/finance/forecasting'
import { useMemo } from 'react'
import { useIsInitialSyncPending } from '../../../hooks/useIsInitialSyncPending'
import { useStoresHydrated } from '../../../hooks/useStoresHydrated'
import { investmentContributionItems } from '../../../lib/savings/investment-contribution-items'
import { useBalanceEntries, useInvestmentEntries } from '../../../stores/balanceStore'
import { useExpenses } from '../../../stores/expenseStore'
import { useIncomeSources } from '../../../stores/incomeStore'
import { useSavingsGoals } from '../../../stores/savingsStore'
import { forecastInputFromRows } from './forecast-input'
import { balanceRowType } from './row-coercion'
import { rowsFromStores } from './store-mappers'
import type { ForecastRows, LocalFinancialItem } from './types'

// ready waits for store hydration (zustand reports the empty server snapshot while hydrating) and, on a
// fresh device, for the first sync pull; otherwise the seed and baseline would be zeros.
export function useCurrentForecastData(): {
	ready: boolean
	rows: (ForecastRows & { unfilteredExpenseItems: LocalFinancialItem[] }) | null
	data: ForecastInputData | null
} {
	const storesHydrated = useStoresHydrated()
	const storeIncome = useIncomeSources()
	const storeExpenses = useExpenses()
	const storeSavingsGoals = useSavingsGoals()
	const storeBalanceEntries = useBalanceEntries()
	const storeBalanceRowCount = useMemo(
		() =>
			storeBalanceEntries.filter(
				(entry) => balanceRowType(entry.type) !== null || entry.type === 'asset'
			).length,
		[storeBalanceEntries]
	)
	const storeInvestmentEntries = useInvestmentEntries()
	const storeContributionItems = useMemo(
		() => investmentContributionItems(storeInvestmentEntries),
		[storeInvestmentEntries]
	)
	const nothingToSeed =
		storeIncome.length === 0 &&
		storeExpenses.length === 0 &&
		// Rows, not the total: a goal with a 0 balance still seeds a row.
		storeSavingsGoals.length === 0 &&
		// Rows again: a debt-only user, an investment at 0 or an asset-only user still seeds.
		storeBalanceRowCount === 0
	const isInitialSyncPending = useIsInitialSyncPending(nothingToSeed)
	const ready = storesHydrated && !isInitialSyncPending

	const rows = useMemo(
		() =>
			ready
				? rowsFromStores({
						income: storeIncome,
						expenses: storeExpenses,
						savingsGoals: storeSavingsGoals,
						balanceEntries: storeBalanceEntries,
						contributionItems: storeContributionItems,
					})
				: null,
		[
			ready,
			storeIncome,
			storeExpenses,
			storeSavingsGoals,
			storeBalanceEntries,
			storeContributionItems,
		]
	)
	const data = useMemo(() => (rows ? forecastInputFromRows(rows) : null), [rows])
	return { ready, rows, data }
}
