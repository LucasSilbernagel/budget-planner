import { currencySymbol } from '@budget-planner/core/format/currency'
import type React from 'react'
import { useId } from 'react'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { cn } from '@/lib/cn'
import { useCurrencyPreferences } from '../../../stores/currencyStore'
import type { useMoneyDraft } from './useMoneyDraft'

export function RowMoneyField({
	label,
	rowLabel,
	field,
}: {
	label: string
	rowLabel: string
	field: ReturnType<typeof useMoneyDraft>
}): React.ReactElement {
	const { mode, currency } = useCurrencyPreferences()
	const id = useId()
	return (
		<FormField>
			<FormLabel htmlFor={id}>{label}</FormLabel>
			<div className="relative">
				{mode === 'symbol' && (
					<span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
						{currencySymbol(currency)}
					</span>
				)}
				<input
					id={id}
					type="text"
					inputMode="decimal"
					value={field.draft}
					onChange={field.onChange}
					onBlur={field.onBlur}
					aria-label={`${label} for ${rowLabel}`}
					autoComplete="off"
					aria-invalid={field.error ? true : undefined}
					aria-describedby={field.error ? `${id}-error` : undefined}
					className={cn(
						'w-full',
						mode === 'symbol' ? 'px-6' : 'px-2',
						'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
					)}
					placeholder="0.00"
				/>
			</div>
			{field.error && (
				<p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
					{field.error}
				</p>
			)}
		</FormField>
	)
}
