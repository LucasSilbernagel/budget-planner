/**
 * Story 106.1 (FR174): the form-side half of the shared money limit.
 *
 * Every money form refuses an amount above core's `MAX_MONEY_CENTS` (the int32
 * column bound the sync gate enforces) BEFORE saving, because a larger amount
 * would be saved on this device and then refused at enqueue, with only a
 * console log: the row would never reach the server.
 *
 * ⚠️ The message takes the currency PRIMITIVES, not `useFormattedAmount()`'s
 * function. That hook returns a new function every render, and each page's
 * `computeErrors` is a `useCallback` re-run by an effect whenever it changes.
 * A fresh function in its deps would re-run validation on every render.
 */
import { type CurrencyOptions, MAX_MONEY_CENTS, formatCurrency } from '@budget-planner/core'

/** True when an amount in cents is too large to sync. */
export function exceedsMoneyLimit(cents: number): boolean {
  return cents > MAX_MONEY_CENTS
}

/** "Enter an amount up to $21,474,836.47", in the user's currency format. */
export function moneyLimitMessage(
  preferences: Pick<CurrencyOptions, 'mode' | 'currency' | 'locale'>
): string {
  return `Enter an amount up to ${formatCurrency(MAX_MONEY_CENTS, preferences)}`
}
