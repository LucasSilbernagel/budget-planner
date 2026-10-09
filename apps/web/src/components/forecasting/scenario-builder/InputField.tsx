import type React from 'react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { sanitizeWithCaret } from '../../../lib/sanitized-input'

type InputFieldProps = {
	label: string
	value: string | number
	onChange: (value: string | number) => void
	type: 'text' | 'number'
	placeholder?: string
	min?: number
	max?: number
	step?: number
	inputMode?: 'decimal' | 'numeric'
	formatValue?: (value: string | number) => string
	parseValue?: (value: string) => string | number
	// Opt-in per call site: this component also serves non-money fields like the scenario name.
	sanitize?: (raw: string) => string
	error?: string
	// Money fields must opt out: the hydration render parses with the default locale, so de-DE 1234,56 saves 100x.
	adoptPreHydrationValue?: boolean
	autoComplete?: 'off'
}

export function InputField({
	label,
	value,
	onChange,
	type,
	placeholder,
	min,
	max,
	step,
	inputMode,
	formatValue,
	parseValue,
	sanitize,
	error,
	adoptPreHydrationValue = true,
	autoComplete,
}: InputFieldProps): React.ReactElement {
	const [internalValue, setInternalValue] = useState<string>(() => {
		// formatValue includes the symbol, so seed through the field's filter to mount a legal value.
		const seeded = formatValue ? formatValue(value) : String(value)
		return sanitize ? sanitize(seeded) : seeded
	})

	const inputRef = useRef<HTMLInputElement>(null)

	const commit = (rawValue: string) => {
		setInternalValue(rawValue)

		if (parseValue) {
			onChange(parseValue(rawValue))
		} else if (type === 'number') {
			const numValue = Number.parseFloat(rawValue)
			// isFinite, not isNaN, so no raw Infinity reaches the parent.
			onChange(Number.isFinite(numValue) ? numValue : 0)
		} else {
			onChange(rawValue)
		}
	}

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		// Filter first so displayed and lifted values come from the same string; sanitizeWithCaret keeps the cursor.
		commit(sanitize ? sanitizeWithCaret(e.target, sanitize) : e.target.value)
	}

	// Adopt text typed before hydration: hydration fires no onChange, so the next re-render would overwrite it.
	// Compare after filtering, so rejected characters only clean the DOM.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
	useLayoutEffect(() => {
		const input = inputRef.current
		if (!input || !adoptPreHydrationValue) return
		const adopted = sanitize ? sanitize(input.value) : input.value
		if (adopted !== internalValue) {
			commit(adopted)
		} else if (input.value !== adopted) {
			input.value = adopted
		}
	}, [])

	const inputId = useId()
	const errorId = `${inputId}-error`

	return (
		<FormField>
			<FormLabel htmlFor={inputId}>{label}</FormLabel>
			<input
				ref={inputRef}
				id={inputId}
				type={type}
				value={internalValue}
				onChange={handleChange}
				placeholder={placeholder}
				min={min}
				max={max}
				step={step}
				inputMode={inputMode}
				autoComplete={autoComplete}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
			/>
			{error && (
				<p id={errorId} className="mt-1 text-sm text-red-600 dark:text-red-300">
					{error}
				</p>
			)}
		</FormField>
	)
}
