import type { Frequency } from '@budget-planner/db/schema'

export const FREQUENCY_OPTIONS = [
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'biweekly', label: 'Bi-weekly' },
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'annually', label: 'Annually' },
] satisfies { value: Frequency; label: string }[]

export const frequencyLabel = (frequency: Frequency): string =>
	FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency

/**
 * localStorage is user-editable and frequencyLabel returns the raw value, so a non-string
 * would reach React as a child and throw.
 */
export function untrustedFrequencyLabel(frequency: unknown): string {
	return typeof frequency === 'string' ? frequencyLabel(frequency as Frequency) : ''
}

/** An unreadable amount shows the name alone rather than NaN. */
export function paymentOptionLabel(
	expense: { name: unknown; amount: unknown; frequency: unknown },
	formatAmount: (cents: number) => string
): string {
	const name = typeof expense.name === 'string' ? expense.name : ''
	const cadence = untrustedFrequencyLabel(expense.frequency)
	return typeof expense.amount === 'number' && Number.isFinite(expense.amount)
		? `${name} — ${formatAmount(expense.amount)}${cadence ? ` / ${cadence}` : ''}`
		: name
}
