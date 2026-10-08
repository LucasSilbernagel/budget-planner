import { netWorthFromTotals } from '../lib/net-worth'
import {
	useTotalAssetBalance,
	useTotalDebtBalance,
	useTotalInvestmentBalance,
} from '../stores/balanceStore'
import { useTotalSavings } from '../stores/savingsStore'

export function useNetWorth(): number {
	const investmentsCents = useTotalInvestmentBalance()
	const savingsCents = useTotalSavings()
	const assetsCents = useTotalAssetBalance()
	const debtsCents = useTotalDebtBalance()

	return netWorthFromTotals({ investmentsCents, savingsCents, assetsCents, debtsCents })
}
