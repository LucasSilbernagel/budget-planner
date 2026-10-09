/**
 * A non-finite balance deliberately yields NaN here: headline totals partition and disclose corrupt
 * rows rather than silently dropping money.
 */

export type NetWorthTotals = {
	investmentsCents: number
	savingsCents: number
	/**
	 * Separate from investments: net worth is invariant under that misclassification, so only the
	 * component totals can catch it.
	 */
	assetsCents: number
	debtsCents: number
}

export function netWorthFromTotals(totals: NetWorthTotals): number {
	return totals.investmentsCents + totals.savingsCents + totals.assetsCents - totals.debtsCents
}
