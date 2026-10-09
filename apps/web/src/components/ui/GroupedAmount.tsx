/**
 * A `<wbr>` after each digit-flanked group separator, so a figure wraps only between groups.
 * Server and first client render must agree: render inside `hydrated` or where all stores are `skipHydration`.
 */

import type React from 'react'
import { Fragment } from 'react'
import { useCurrencyPreferences } from '../../stores/currencyStore'
import { groupSeparator, splitAtGroupSeparators } from './group-separators'

export function GroupedAmount({ text }: { text: string }): React.ReactElement {
	const { mode, currency, locale } = useCurrencyPreferences()
	// Mirrors `formatCurrency`'s branch: currency-less (or `NONE`) is decimal style.
	const symbolCurrency = mode === 'none' || currency === 'NONE' ? null : currency
	const segments = splitAtGroupSeparators(text, groupSeparator(locale, symbolCurrency))
	return (
		<>
			{segments.map((segment, i) => (
				// Index keys are correct here: the segments are a pure function of
				// `text` and have no identity of their own.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<Fragment key={i}>
					{i > 0 && <wbr />}
					{segment}
				</Fragment>
			))}
		</>
	)
}
