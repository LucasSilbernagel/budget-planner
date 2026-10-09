import type { CurrencyOptions } from '@budget-planner/core/format/currency'
import { type MoneyDraft, parseMoneyDraft, reformatAmountOnBlur } from '../../../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../../../lib/money-limit'

export const AMOUNT_NEGATIVE_MESSAGE = 'Enter an amount of 0 or more.'

// allowNegative is for the event row, whose field holds a magnitude (a typed minus selects Money out).
export function amountProblem(
	draft: MoneyDraft,
	preferences: Pick<CurrencyOptions, 'mode' | 'currency' | 'locale'>,
	allowNegative = false
): string | null {
	if ('problem' in draft) return draft.problem
	if (!allowNegative && draft.cents < 0) return AMOUNT_NEGATIVE_MESSAGE
	if (exceedsMoneyLimit(Math.abs(draft.cents))) return moneyLimitMessage(preferences)
	return null
}

// Refused text stays as typed instead of re-echoing as 0.00 beside the error.
export function reechoAmountOnBlur(
	value: string,
	locale: string | undefined,
	setter: (v: string) => void
): void {
	if ('problem' in parseMoneyDraft(value, locale)) return
	reformatAmountOnBlur(value, locale, setter)
}
