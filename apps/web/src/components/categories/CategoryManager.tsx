// No nested dialogs: Modal assumes one open at a time, so renaming happens inline.

import type { CategoryKind } from '@budget-planner/db/schema'
import { type ReactElement, useRef, useState } from 'react'
import { PageDescription } from '@/components/ui/PageDescription'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageTitle } from '@/components/ui/PageTitle'
import { useCategoriesForActiveProfile } from '../../hooks/useCategoryLabels'
import { useCategoryManager, useCategoryRowCount } from '../../hooks/useCategoryManager'
import type { ClientCategory } from '../../stores/categoryStore'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CategorySection } from './category-manager/CategorySection'

const SECTIONS = [
	{
		kind: 'income',
		title: 'Income categories',
		description: 'Group income sources — for example Employment, Freelance, Dividends.',
		placeholder: 'e.g. Employment',
	},
	{
		kind: 'expense',
		title: 'Expense categories',
		description: 'Group expenses — for example Groceries, Housing, Transport.',
		placeholder: 'e.g. Groceries',
	},
] satisfies { kind: CategoryKind; title: string; description: string; placeholder: string }[]

export function CategoryManager(): ReactElement {
	const categories = useCategoriesForActiveProfile()
	const { createCategory, renameCategory, deleteCategory } = useCategoryManager()

	const [pendingDelete, setPendingDelete] = useState<ClientCategory | null>(null)
	// Reactive count: a render-time snapshot could confirm a delete against a stale number.
	const affectedRowCount = useCategoryRowCount(pendingDelete?.id)
	const listRef = useRef<HTMLElement>(null)

	const confirmDelete = (): void => {
		if (pendingDelete) {
			deleteCategory(pendingDelete.id)
			setPendingDelete(null)
		}
	}

	return (
		// Must stay one element: Modal renders in flow, and a parent space-y margin would offset its fixed overlay.
		<div>
			<PageHeader>
				<PageTitle>Categories</PageTitle>
				<PageDescription>
					Create your own categories, then assign them to income sources and expenses. Renaming a
					category updates every entry that uses it.
				</PageDescription>
			</PageHeader>

			{/* tabIndex={-1}: this is the dialog's finalFocusRef; a non-focusable element drops focus to <body>. */}
			<main className="space-y-6" ref={listRef} tabIndex={-1}>
				{SECTIONS.map((section) => (
					<CategorySection
						key={section.kind}
						kind={section.kind}
						title={section.title}
						description={section.description}
						placeholder={section.placeholder}
						categories={categories.filter((category) => category.kind === section.kind)}
						onCreate={createCategory}
						onRename={renameCategory}
						onRequestDelete={setPendingDelete}
					/>
				))}
			</main>

			<ConfirmDialog
				isOpen={pendingDelete !== null}
				onConfirm={confirmDelete}
				onCancel={() => setPendingDelete(null)}
				finalFocusRef={listRef}
				confirmLabel="Delete category"
				message={
					<>
						Delete "{pendingDelete?.name}"?{' '}
						{affectedRowCount === 0
							? 'No entries currently use it.'
							: `${affectedRowCount} ${
									affectedRowCount === 1 ? 'entry' : 'entries'
								} will be left uncategorized.`}{' '}
						This cannot be undone.
					</>
				}
			/>
		</div>
	)
}
