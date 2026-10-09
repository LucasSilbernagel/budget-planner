// Deliberately not PremiumFeatureGate: its locked branch opens a Modal, and this picker lives inside one.
// The locked state is a link instead; following it discards the form, which its copy warns about.

import type { CategoryKind } from '@budget-planner/db'
import type React from 'react'
import { useCategoriesForActiveProfile } from '../../hooks/useCategoryLabels'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumLockBadge } from '../premium'
import { Skeleton } from '../ui/Skeleton'

// <select> values are strings, so the empty string stands in for null.
const UNCATEGORIZED_VALUE = ''

const UNCATEGORIZED_LABEL = 'Uncategorized'

export type CategoryPickerProps = {
	kind: CategoryKind
	value: string | null
	onChange: (categoryId: string | null) => void
	idPrefix: string
}

const LABEL_CLASS = 'block text-sm font-medium text-label mb-1'

// A <span>, not a <label>: neither state renders a form control a label could target.
function InertPickerCaption(): React.ReactElement {
	return <span className={LABEL_CLASS}>Category</span>
}

export function CategoryPicker({
	kind,
	value,
	onChange,
	idPrefix,
}: CategoryPickerProps): React.ReactElement {
	const { status } = usePremiumAccess()
	const categories = useCategoriesForActiveProfile()
	const selectId = `${idPrefix}-category`

	if (status.isLoading) {
		// 42px matches the <select> this stands in for.
		return (
			<div aria-hidden="true" data-testid={`${idPrefix}-category-skeleton`}>
				<InertPickerCaption />
				<Skeleton className="block h-[42px] w-full rounded-md border border-gray-300 dark:border-gray-600 surface-inset" />
			</div>
		)
	}

	if (!status.hasAccess) {
		return (
			<div data-testid={`${idPrefix}-category-locked`}>
				<InertPickerCaption />
				{/* A link, not a button: a button would have to open a second Modal inside this one. */}
				<div className="flex w-full items-center justify-between gap-3 rounded-md border border-gray-300 dark:border-gray-600 surface-inset px-3 py-2">
					<span className="text-sm text-muted">
						Organize entries with your own categories
						{/* Only this text is the link, so the row above Submit is not a large mis-click target. */}
						<a
							href="/pricing"
							className="mt-0.5 inline-block text-xs font-medium text-accent underline rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
							See Premium plans — closes this form
						</a>
					</span>
					<PremiumLockBadge />
				</div>
			</div>
		)
	}

	const options = categories.filter((category) => category.kind === kind)

	// An unresolvable id displays as uncategorized, but form state keeps the id so an untouched submit preserves it.
	const selectedValue =
		value && options.some((category) => category.id === value) ? value : UNCATEGORIZED_VALUE

	return (
		<div>
			<label htmlFor={selectId} className={LABEL_CLASS}>
				Category
			</label>
			<select
				id={selectId}
				value={selectedValue}
				onChange={(e) => onChange(e.target.value === UNCATEGORIZED_VALUE ? null : e.target.value)}
				className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				data-testid={`${idPrefix}-category-select`}
			>
				<option value={UNCATEGORIZED_VALUE}>{UNCATEGORIZED_LABEL}</option>
				{options.map((category) => (
					<option key={category.id} value={category.id}>
						{category.name}
					</option>
				))}
			</select>
		</div>
	)
}
