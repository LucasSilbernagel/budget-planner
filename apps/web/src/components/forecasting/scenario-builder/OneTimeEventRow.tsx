import { currencySymbol, formatForInputDisplay } from '@budget-planner/core/format/currency'
import type React from 'react'
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { cn } from '@/lib/cn'
import { parseMoneyDraft } from '../../../lib/money-input'
import { sanitizeMoneyChange } from '../../../lib/sanitized-input'
import { useCurrencyPreferences } from '../../../stores/currencyStore'
import { amountProblem, reechoAmountOnBlur } from './amount-field'
import type { OneTimeEvent } from './types'
import { useWithdrawValidityOnUnmount } from './useWithdrawValidityOnUnmount'

type OneTimeEventRowProps = {
	event: OneTimeEvent
	onUpdate: (id: string, field: keyof OneTimeEvent, value: string | number) => void
	onDelete: (id: string) => void
	maxYear: number
	onValidityChange: (rowId: string, valid: boolean) => void
}

export function OneTimeEventRow({
	event,
	onUpdate,
	onDelete,
	maxYear,
	onValidityChange,
}: OneTimeEventRowProps): React.ReactElement {
	const preferences = useCurrencyPreferences()
	const { mode, currency, locale } = preferences

	// The stored amount stays signed; direction is derived from it when non-zero.
	// State only remembers the choice at 0, where the sign carries nothing.
	const [pendingDirection, setPendingDirection] = useState<'in' | 'out'>(
		event.amount < 0 ? 'out' : 'in'
	)
	const direction: 'in' | 'out' =
		event.amount !== 0 ? (event.amount < 0 ? 'out' : 'in') : pendingDirection

	// cents === 0 is returned unnegated: a stored -0 would reload as Money in.
	const signed = (cents: number, dir: 'in' | 'out') =>
		dir === 'out' && cents !== 0 ? -cents : cents

	// A draft magnitude string, for the same reason as FinancialItemRow's draft.
	const [draft, setDraft] = useState<string>(() =>
		formatForInputDisplay(Math.abs(event.amount), locale)
	)
	const [amountError, setAmountError] = useState<string | null>(null)
	useWithdrawValidityOnUnmount(event.id, onValidityChange)

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		const typedMinus = raw.startsWith('-')
		const hasDigit = /\d/.test(raw)
		// A typed minus selects Money out; a lone - stays visible until a digit follows.
		setDraft(typedMinus && hasDigit ? raw.slice(1) : raw)

		if (!hasDigit) {
			setAmountError(null)
			onValidityChange(event.id, true)
			if (raw === '') {
				// Keep the chosen direction through zero, where the sign cannot hold it.
				if (pendingDirection !== direction) setPendingDirection(direction)
				onUpdate(event.id, 'amount', 0)
				return
			}
			// A digit-free partial (-, .) writes nothing; a lone - is how the minus selects Money out on the first keystroke.
			if (typedMinus && direction !== 'out') setPendingDirection('out')
			return
		}

		// A typed minus selects Money out rather than erasing the entry, and is honoured before validation
		// so a refused entry keeps that intent.
		const nextDirection = typedMinus ? 'out' : direction
		if (nextDirection !== direction) setPendingDirection(nextDirection)
		const parsed = parseMoneyDraft(raw, locale)
		// Refused (unreadable or above the money limit): reported on this field, nothing written.
		const problem = amountProblem(parsed, preferences, true)
		setAmountError(problem)
		onValidityChange(event.id, problem === null)
		if (problem !== null || !('cents' in parsed)) {
			// A non-zero amount's sign is the direction, so re-sign the kept amount; pendingDirection alone would be ignored.
			if (nextDirection !== direction && event.amount !== 0) {
				onUpdate(event.id, 'amount', signed(Math.abs(event.amount), nextDirection))
			}
			return
		}
		onUpdate(event.id, 'amount', signed(Math.abs(parsed.cents), nextDirection))
	}

	const handleDirectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const next = e.target.value === 'out' ? 'out' : 'in'
		setPendingDirection(next)
		onUpdate(event.id, 'amount', signed(Math.abs(event.amount), next))
	}

	const amountId = `event-amount-${event.id}`
	const directionId = `event-direction-${event.id}`
	const yearId = `event-year-${event.id}`
	const nameId = `event-name-${event.id}`
	const yearCalendarId = `${yearId}-calendar`
	const yearHelpId = `${yearId}-help`
	// Year 1 is the first projected year. Read at render: event rows only exist client-side, so no hydration mismatch.
	const calendarYear = new Date().getFullYear() + event.year

	const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const year = Math.max(1, Math.min(maxYear, Number.parseInt(e.target.value, 10) || 1))
		onUpdate(event.id, 'year', year)
	}

	return (
		<Card className="p-4 shadow-sm border border-default">
			{/* items-start: the year cell has two lines under its input. */}
			<div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
				<FormField>
					<FormLabel htmlFor={nameId}>Event Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={event.name}
						onChange={(e) => onUpdate(event.id, 'name', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Bonus, house deposit, etc."
					/>
				</FormField>

				<FormField>
					<FormLabel htmlFor={directionId}>Direction</FormLabel>
					<select
						id={directionId}
						value={direction}
						onChange={handleDirectionChange}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded text-sm"
					>
						<option value="in">Money in</option>
						<option value="out">Money out</option>
					</select>
				</FormField>

				<FormField>
					<FormLabel htmlFor={amountId}>Amount</FormLabel>
					<div className="relative">
						{mode === 'symbol' && (
							<span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
								{currencySymbol(currency)}
							</span>
						)}
						<input
							id={amountId}
							type="text"
							inputMode="decimal"
							// Magnitude only: direction carries the sign.
							value={draft}
							onChange={handleAmountChange}
							onBlur={(e) => reechoAmountOnBlur(e.target.value, locale, setDraft)}
							aria-invalid={amountError ? true : undefined}
							aria-describedby={amountError ? `${amountId}-error` : undefined}
							className={cn(
								'w-full',
								mode === 'symbol' ? 'px-6' : 'px-2',
								'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
							)}
							placeholder="0.00"
						/>
					</div>
					{amountError && (
						<p id={`${amountId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
							{amountError}
						</p>
					)}
				</FormField>

				{/* A count from the forecast start, not a calendar year; the calendar year shows beside it. */}
				<FormField>
					{/* whitespace-nowrap: under CI's DejaVu Sans this label wraps near 768px and drops the input. */}
					<FormLabel htmlFor={yearId} className="whitespace-nowrap">
						Years from now
					</FormLabel>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<input
							id={yearId}
							type="number"
							value={event.year}
							onChange={handleYearChange}
							min={1}
							max={maxYear}
							step={1}
							aria-describedby={`${yearCalendarId} ${yearHelpId}`}
							className="w-20 shrink-0 px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						/>
						<span id={yearCalendarId} className="text-sm text-muted whitespace-nowrap">
							Year {event.year} ({calendarYear})
						</span>
					</div>
					<p id={yearHelpId} className="mt-1 text-xs text-muted">
						1 = the first year of your forecast
					</p>
				</FormField>

				<div className="flex justify-end md:pt-6">
					<button
						type="button"
						onClick={() => onDelete(event.id)}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}
