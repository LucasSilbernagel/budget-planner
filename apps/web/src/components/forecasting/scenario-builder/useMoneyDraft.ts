import { formatForInputDisplay } from '@budget-planner/core/format/currency'
import type React from 'react'
import { useEffect, useState } from 'react'
import { parseMoneyDraft } from '../../../lib/money-input'
import { sanitizeMoneyChange } from '../../../lib/sanitized-input'
import { useCurrencyPreferences } from '../../../stores/currencyStore'
import { AMOUNT_NEGATIVE_MESSAGE, amountProblem, reechoAmountOnBlur } from './amount-field'
import { useWithdrawValidityOnUnmount } from './useWithdrawValidityOnUnmount'

// Not InputField: rows remount by key when the seed lands, so its pre-hydration machinery isn't needed.
export function useMoneyDraft(
	cents: number,
	validityKey: string,
	onValidityChange: (key: string, valid: boolean) => void,
	write: (cents: number) => void
) {
	const preferences = useCurrencyPreferences()
	const { locale } = preferences
	const [draft, setDraft] = useState<string>(() => formatForInputDisplay(cents, locale))
	// A negative can arrive from an old saved forecast; flag it from the first render as if typed.
	const [error, setError] = useState<string | null>(() =>
		cents < 0 ? AMOUNT_NEGATIVE_MESSAGE : null
	)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
	useEffect(() => {
		if (cents < 0) onValidityChange(validityKey, false)
	}, [])
	useWithdrawValidityOnUnmount(validityKey, onValidityChange)
	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		setDraft(raw)
		const parsed = parseMoneyDraft(raw, locale)
		const problem = amountProblem(parsed, preferences)
		if (problem === null && 'cents' in parsed) write(parsed.cents)
		setError(problem)
		onValidityChange(validityKey, problem === null)
	}
	const onBlur = (e: React.FocusEvent<HTMLInputElement>) =>
		reechoAmountOnBlur(e.target.value, locale, setDraft)
	return { draft, error, onChange, onBlur }
}
