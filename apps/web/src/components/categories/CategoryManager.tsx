// No nested dialogs: Modal assumes one open at a time, so renaming happens inline.

import type { CategoryKind } from '@budget-planner/db/schema'
import { type ReactElement, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CardTitle } from '@/components/ui/CardTitle'
import { FormError } from '@/components/ui/FormError'
import { FormField } from '@/components/ui/FormField'
import { PageDescription } from '@/components/ui/PageDescription'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageTitle } from '@/components/ui/PageTitle'
import { useCategoriesForActiveProfile } from '../../hooks/useCategoryLabels'
import {
	type CategoryValidationError,
	useCategoryManager,
	useCategoryRowCount,
} from '../../hooks/useCategoryManager'
import type { ClientCategory } from '../../stores/categoryStore'
import { ConfirmDialog } from '../ui/ConfirmDialog'

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

// not-found means the category was deleted elsewhere, which is not a name problem, so focus stays put.
function isNameError(error: CategoryValidationError): boolean {
	return error.reason === 'empty' || error.reason === 'too-long' || error.reason === 'duplicate'
}

function ErrorMessage({ error, id }: { error: CategoryValidationError; id: string }): ReactElement {
	return (
		<FormError id={id} data-testid={`category-error-${error.reason}`}>
			{error.message}
		</FormError>
	)
}

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

type CategorySectionProps = {
	kind: CategoryKind
	title: string
	description: string
	placeholder: string
	categories: ClientCategory[]
	onCreate: ReturnType<typeof useCategoryManager>['createCategory']
	onRename: ReturnType<typeof useCategoryManager>['renameCategory']
	onRequestDelete: (category: ClientCategory) => void
}

function CategorySection({
	kind,
	title,
	description,
	placeholder,
	categories,
	onCreate,
	onRename,
	onRequestDelete,
}: CategorySectionProps): ReactElement {
	const [newName, setNewName] = useState('')
	const [createError, setCreateError] = useState<CategoryValidationError | null>(null)
	// A snapshot, not an id: the live list drops tombstoned rows, which would unmount the rename form mid-edit.
	const [editing, setEditing] = useState<ClientCategory | null>(null)
	const [editingName, setEditingName] = useState('')
	const [renameError, setRenameError] = useState<CategoryValidationError | null>(null)
	const newNameRef = useRef<HTMLInputElement>(null)
	const editingNameRef = useRef<HTMLInputElement>(null)

	const visibleCategories =
		editing && !categories.some((category) => category.id === editing.id)
			? [...categories, editing]
			: categories

	const headingId = `categories-${kind}-heading`
	const createErrorId = `categories-${kind}-create-error`
	const renameErrorId = `categories-${kind}-rename-error`

	const handleCreate = (event: React.FormEvent): void => {
		event.preventDefault()
		const result = onCreate(newName, kind)
		if (!result.ok) {
			setCreateError(result.error)
			newNameRef.current?.focus()
			return
		}
		setCreateError(null)
		setNewName('')
	}

	const startEditing = (category: ClientCategory): void => {
		setEditing(category)
		setEditingName(category.name)
		setRenameError(null)
	}

	const cancelEditing = (): void => {
		setEditing(null)
		setEditingName('')
		setRenameError(null)
	}

	const handleRename = (event: React.FormEvent): void => {
		event.preventDefault()
		if (!editing) {
			return
		}
		const result = onRename(editing.id, editingName)
		if (!result.ok) {
			setRenameError(result.error)
			if (isNameError(result.error)) {
				editingNameRef.current?.focus()
			} else {
				// The message renders below the list so it outlives the row.
				setEditing(null)
				setEditingName('')
			}
			return
		}
		cancelEditing()
	}

	return (
		<Card as="section" aria-labelledby={headingId} data-testid={`category-section-${kind}`}>
			<CardTitle id={headingId} className="text-xl">
				{title}
			</CardTitle>
			<p className="mt-1 text-sm text-muted">{description}</p>

			<form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-start gap-2" noValidate>
				<FormField className="min-w-[12rem] flex-1">
					<label htmlFor={`categories-${kind}-new`} className="sr-only">
						New {kind} category name
					</label>
					<input
						ref={newNameRef}
						id={`categories-${kind}-new`}
						type="text"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						placeholder={placeholder}
						/* No maxLength: it would make the too-long error unreachable. */
						className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
						aria-invalid={createError !== null}
						aria-describedby={createError ? createErrorId : undefined}
						data-testid={`category-new-input-${kind}`}
					/>
				</FormField>
				<button
					type="submit"
					className="fill-green rounded-md px-4 py-2 transition-colors hover:bg-green-800"
					data-testid={`category-add-${kind}`}
				>
					Add category
				</button>
			</form>
			{createError && <ErrorMessage error={createError} id={createErrorId} />}

			{visibleCategories.length === 0 ? (
				<Card variant="inset" className="mt-4 p-6 text-center">
					<p className="text-muted">No {kind} categories yet</p>
				</Card>
			) : (
				<ul className="mt-4 divide-y divide-gray-200 dark:divide-gray-700">
					{visibleCategories.map((category) => (
						<li key={category.id} className="py-3" data-testid={`category-row-${category.id}`}>
							{editing?.id === category.id ? (
								<form
									onSubmit={handleRename}
									className="flex flex-wrap items-start gap-2"
									noValidate
								>
									<FormField className="min-w-[12rem] flex-1">
										<label htmlFor={`categories-edit-${category.id}`} className="sr-only">
											Rename {category.name}
										</label>
										<input
											ref={editingNameRef}
											id={`categories-edit-${category.id}`}
											type="text"
											value={editingName}
											onChange={(e) => setEditingName(e.target.value)}
											className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
											aria-invalid={renameError !== null}
											aria-describedby={renameError ? renameErrorId : undefined}
											data-testid={`category-rename-input-${kind}`}
										/>
									</FormField>
									<button
										type="submit"
										className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
										data-testid={`category-rename-save-${kind}`}
									>
										Save
									</button>
									<Button
										variant="secondary"
										type="button"
										onClick={cancelEditing}
										className="px-3 text-sm"
									>
										Cancel
									</Button>
								</form>
							) : (
								<div className="flex items-center justify-between gap-3">
									<span className="text-sm font-medium text-heading">{category.name}</span>
									<div className="flex shrink-0 items-center gap-4 text-sm">
										<button
											type="button"
											onClick={() => startEditing(category)}
											// aria-label replaces the subtree, so it must name the target row.
											aria-label={`Rename ${category.name}`}
											className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
										>
											Rename
										</button>
										<button
											type="button"
											onClick={() => onRequestDelete(category)}
											aria-label={`Delete ${category.name}`}
											className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
										>
											Delete
										</button>
									</div>
								</div>
							)}
						</li>
					))}
				</ul>
			)}
			{renameError && <ErrorMessage error={renameError} id={renameErrorId} />}
		</Card>
	)
}
