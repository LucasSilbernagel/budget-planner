/**
 * Takes currency primitives, not useFormattedAmount's function: a new function each render would
 * re-run validation on every render.
 */
import { MAX_MONEY_CENTS } from '@budget-planner/core/finance/money-limits'
import { type CurrencyOptions, formatCurrency } from '@budget-planner/core/format/currency'

export function exceedsMoneyLimit(cents: number): boolean {
	return cents > MAX_MONEY_CENTS
}

export function moneyLimitMessage(
	preferences: Pick<CurrencyOptions, 'mode' | 'currency' | 'locale'>
): string {
	return `Enter an amount up to ${formatCurrency(MAX_MONEY_CENTS, preferences)}`
}
