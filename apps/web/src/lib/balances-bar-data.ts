/** Debts are plotted negative: the chart shows each bucket's contribution to net worth. */

export type BalancesBarDatum = {
	category: string
	amount: number
	fill: string
}

export type BalancesBarTotals = {
	savingsCents: number
	investmentsCents: number
	assetsCents: number
	debtsCents: number
}

export type BalancesBarColors = {
	savings: string
	investment: string
	asset: string
	debt: string
}

export function buildBalancesBarData(
	totals: BalancesBarTotals,
	colors: BalancesBarColors
): BalancesBarDatum[] {
	return [
		{ category: 'Savings', amount: totals.savingsCents, fill: colors.savings },
		{ category: 'Investments', amount: totals.investmentsCents, fill: colors.investment },
		{ category: 'Assets', amount: totals.assetsCents, fill: colors.asset },
		{ category: 'Debts', amount: -totals.debtsCents, fill: colors.debt },
	].filter((item) => item.amount !== 0)
}
