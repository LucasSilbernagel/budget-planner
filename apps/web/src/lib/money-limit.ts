/**
 * Takes currency primitives, not useFormattedAmount's function: a new function each render would
 * re-run validation on every render.
 */
import { type CurrencyOptions, MAX_MONEY_CENTS, formatCurrency } from '@budget-planner/core'

export function exceedsMoneyLimit(cents: number): boolean {
  return cents > MAX_MONEY_CENTS
}

export function moneyLimitMessage(
  preferences: Pick<CurrencyOptions, 'mode' | 'currency' | 'locale'>
): string {
  return `Enter an amount up to ${formatCurrency(MAX_MONEY_CENTS, preferences)}`
}
