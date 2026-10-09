import { currencySymbol, formatForInputDisplay } from '@budget-planner/core/format/currency'
import type React from 'react'
import { useId, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { cn } from '@/lib/cn'
import { parseMoneyDraft } from '../../../lib/money-input'
import { sanitizeMoneyChange } from '../../../lib/sanitized-input'
import { useCurrencyPreferences } from '../../../stores/currencyStore'
import { amountProblem, reechoAmountOnBlur } from './amount-field'
import type { LocalFinancialItem } from './types'
import { useWithdrawValidityOnUnmount } from './useWithdrawValidityOnUnmount'

type FinancialItemRowProps = {
	item: LocalFinancialItem
	frequencyOptions: { value: string; label: string }[]
	onUpdate: (field: keyof LocalFinancialItem, value: string | number) => void
	onDelete: () => void
	onValidityChange: (rowId: string, valid: boolean) => void
}

export function FinancialItemRow({
	item,
	frequencyOptions,
	onUpdate,
	onDelete,
	onValidityChange,
}: FinancialItemRowProps): React.ReactElement {
	const preferences = useCurrencyPreferences()
	const { mode, currency, locale } = preferences

	const nameId = useId()
	const amountId = useId()
	const frequencyId = useId()

	// A draft string, not item.amount: a refused entry isn't written, so a controlled value would snap back
	// to the last good amount and erase what the user typed.
	const [draft, setDraft] = useState<string>(() => formatForInputDisplay(item.amount, locale))
	const [amountError, setAmountError] = useState<string | null>(null)
	useWithdrawValidityOnUnmount(item.id, onValidityChange)

	// A bad entry is reported and not written; an empty field is still 0.
	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		setDraft(raw)
		const parsed = parseMoneyDraft(raw, locale)
		const problem = amountProblem(parsed, preferences)
		if (problem === null && 'cents' in parsed) onUpdate('amount', parsed.cents)
		setAmountError(problem)
		onValidityChange(item.id, problem === null)
	}
	const amountErrorId = `${amountId}-error`

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
				<FormField>
					<FormLabel htmlFor={nameId}>Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={item.name}
						onChange={(e) => onUpdate('name', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Income/Expense name"
					/>
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
							value={draft}
							onChange={handleAmountChange}
							onBlur={(e) => reechoAmountOnBlur(e.target.value, locale, setDraft)}
							aria-invalid={amountError ? true : undefined}
							aria-describedby={amountError ? amountErrorId : undefined}
							className={cn(
								'w-full',
								mode === 'symbol' ? 'px-6' : 'px-2',
								'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
							)}
							placeholder="0.00"
						/>
					</div>
					{amountError && (
						<p id={amountErrorId} className="mt-1 text-xs text-red-600 dark:text-red-300">
							{amountError}
						</p>
					)}
				</FormField>

				<FormField>
					<FormLabel htmlFor={frequencyId}>Frequency</FormLabel>
					<select
						id={frequencyId}
						value={item.frequency}
						onChange={(e) => onUpdate('frequency', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
					>
						{frequencyOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				<div className="flex justify-end">
					<button
						type="button"
						onClick={onDelete}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}
