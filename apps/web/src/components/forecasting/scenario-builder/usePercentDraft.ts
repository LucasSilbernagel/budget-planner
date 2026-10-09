import {
	isValidGrowthRate,
	MAX_GROWTH_RATE,
	MIN_GROWTH_RATE,
} from '@budget-planner/core/finance/forecasting'
import type React from 'react'
import { useEffect, useState } from 'react'
import { formatPercentage, parsePercentText } from './percentage'
import { useWithdrawValidityOnUnmount } from './useWithdrawValidityOnUnmount'

const RETURN_INVALID_MESSAGE = `Enter an annual return from ${MIN_GROWTH_RATE * 100}% to ${
	MAX_GROWTH_RATE * 100
}%.`

export function usePercentDraft(
	rate: number,
	validityKey: string,
	onValidityChange: (key: string, valid: boolean) => void,
	write: (rate: number) => void
) {
	const [draft, setDraft] = useState<string>(() => formatPercentage(rate))
	const [error, setError] = useState<string | null>(() =>
		isValidGrowthRate(rate) ? null : RETURN_INVALID_MESSAGE
	)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
	useEffect(() => {
		if (!isValidGrowthRate(rate)) onValidityChange(validityKey, false)
	}, [])
	useWithdrawValidityOnUnmount(validityKey, onValidityChange)
	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value
		setDraft(raw)
		const parsed = parsePercentText(raw)
		const problem = isValidGrowthRate(parsed) ? null : RETURN_INVALID_MESSAGE
		if (problem === null) write(parsed)
		setError(problem)
		onValidityChange(validityKey, problem === null)
	}
	return { draft, error, onChange }
}
