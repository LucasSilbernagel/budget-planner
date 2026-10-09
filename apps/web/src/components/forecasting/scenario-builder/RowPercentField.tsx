import type React from 'react'
import { useId } from 'react'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import type { usePercentDraft } from './usePercentDraft'

export function RowPercentField({
	label,
	rowLabel,
	field,
}: {
	label: string
	rowLabel: string
	field: ReturnType<typeof usePercentDraft>
}): React.ReactElement {
	const id = useId()
	return (
		<FormField>
			<FormLabel htmlFor={id}>{label}</FormLabel>
			<input
				id={id}
				type="text"
				inputMode="decimal"
				value={field.draft}
				onChange={field.onChange}
				aria-label={`${label} for ${rowLabel}`}
				autoComplete="off"
				aria-invalid={field.error ? true : undefined}
				aria-describedby={field.error ? `${id}-error` : undefined}
				className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
			/>
			{field.error && (
				<p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
					{field.error}
				</p>
			)}
		</FormField>
	)
}
