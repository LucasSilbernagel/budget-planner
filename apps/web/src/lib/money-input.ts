import { formatForInputDisplay, parseFromInput } from '@budget-planner/core/format/currency'

export const AMOUNT_NOT_A_NUMBER_MESSAGE = 'Enter a number.'

/**
 * Both guards are load-bearing: empty must not become zero, and digit-free partials like "-" must
 * stay visible rather than turn into 0.00.
 */
export function reformatAmountOnBlur(
	value: string,
	locale: string | undefined,
	setter: (v: string) => void
): void {
	if (value.trim() === '' || !/\d/.test(value)) return
	setter(formatForInputDisplay(parseFromInput(value, locale), locale))
}

export type MoneyDraft = { cents: number } | { problem: string }

/** Known edge: an amount under one cent truncates to 0 and is refused as "Enter a number.". */
export function parseMoneyDraft(raw: string, locale: string | undefined): MoneyDraft {
	if (raw.trim() === '') return { cents: 0 }
	const cents = parseFromInput(raw, locale)
	if (cents === 0 && /[1-9]/.test(raw)) return { problem: AMOUNT_NOT_A_NUMBER_MESSAGE }
	return { cents }
}
