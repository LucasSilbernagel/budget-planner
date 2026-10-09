import {
	currencySymbol,
	formatForInputDisplay,
	parseFromInput,
} from '@budget-planner/core/format/currency'
import { resolveDebtPaymentExpense } from '@budget-planner/core/services/balanceTracking'
import type { Frequency } from '@budget-planner/db/schema'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useCategoryNameMap } from '../hooks/useCategoryLabels'
import { useIsInitialSyncPending } from '../hooks/useIsInitialSyncPending'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { debtLinkSentence } from '../lib/debt-link-sentence'
import { reformatAmountOnBlur } from '../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../lib/money-limit'
import { summarizeReadableRows } from '../lib/readable-rows'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { createFlowSortExtractors, type FlowSortKey } from '../lib/table-sort-keys'
import { useBalanceStore } from '../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { useExpenseStore, useExpenses, useTotalExpenses } from '../stores/expenseStore'
import { useShowRetirementPlanner } from '../stores/plannerVisibilityStore'
import { CategoryBadge } from './categories/CategoryBadge'
import { CategoryPicker } from './categories/CategoryPicker'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { GroupedAmount } from './ui/GroupedAmount'
import { Modal } from './ui/Modal'
import { PeriodTotal } from './ui/PeriodTotal'
import {
	FieldLabel,
	RESPONSIVE_ACTION_BUTTON_CLASS,
	RESPONSIVE_ACTIONS_CELL_CLASS,
	RESPONSIVE_ACTIONS_GROUP_CLASS,
	RESPONSIVE_AMOUNT_CLASS,
	RESPONSIVE_CELL_CLASS,
	RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
	RESPONSIVE_ROW_CLASS,
	RESPONSIVE_SCROLL_SHADOW_CLASS,
	RESPONSIVE_TABLE_CLASS,
	RESPONSIVE_TBODY_CLASS,
	RESPONSIVE_THEAD_CLASS,
	RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { PencilIcon, TrashIcon } from './ui/RowActionIcons'
import { EmptyStateSkeleton, LoadingStatus } from './ui/Skeleton'
import { SortableColumnHeader, useSortHeaderAnnouncements } from './ui/SortableColumnHeader'
import { TableScrollRegion } from './ui/TableScrollRegion'
import { TableSortControl } from './ui/TableSortControl'

const FREQUENCY_OPTIONS = [
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'biweekly', label: 'Bi-weekly' },
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'annually', label: 'Annually' },
] satisfies { value: Frequency; label: string }[]

const SORT_COLUMN_LABELS = {
	name: 'Name',
	amount: 'Amount',
	frequency: 'Frequency',
	category: 'Category',
} satisfies Record<FlowSortKey, string>

export function ExpensesPage() {
	const expenses = useExpenses()
	const formatAmount = useFormattedAmount()
	const categoryNames = useCategoryNameMap()
	// hasAccess alone is the gate: a re-check keeps hasAccess while loading, so !isLoading && would drop the column.
	// Conditional JSX, not a CSS hide: max-sm: is evaluated against paper width when printing.
	const { status: premiumStatus } = usePremiumAccess()
	const showCategoryColumn = premiumStatus.hasAccess

	// Memoised on categoryNames so renaming a category re-sorts the table.
	const sortExtractors = useMemo(
		() => createFlowSortExtractors(categoryNames, showCategoryColumn),
		[categoryNames, showCategoryColumn]
	)

	// Gated on showCategoryColumn: free users get no category extractor, so the option would silently do nothing.
	const sortColumns = useMemo<readonly { key: FlowSortKey; label: string }[]>(
		() => [
			{ key: 'name', label: SORT_COLUMN_LABELS.name },
			{ key: 'amount', label: SORT_COLUMN_LABELS.amount },
			{ key: 'frequency', label: SORT_COLUMN_LABELS.frequency },
			...(showCategoryColumn
				? [{ key: 'category' as const, label: SORT_COLUMN_LABELS.category }]
				: []),
		],
		[showCategoryColumn]
	)
	const sort = useTableSort('expenses', expenses, sortExtractors)
	const sortedRows = sort.rows
	// The effective sort state, so an orphaned Category sort reads as unsorted.
	const sortA11y = useSortHeaderAnnouncements(
		sort.state
			? { label: SORT_COLUMN_LABELS[sort.state.key], direction: sort.state.direction }
			: null
	)
	const { mode, currency, locale } = useCurrencyPreferences()

	const totalExpenses = useTotalExpenses()
	const {
		rawTotalCents: rawTotalExpenses,
		unreadableCount: unreadableExpenseCount,
		conversionApplied,
	} = summarizeReadableRows(expenses)
	const { addExpense, updateExpense, deleteExpense } = useExpenseStore()

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [name, setName] = useState('')
	const [amount, setAmount] = useState('')
	const [frequency, setFrequency] = useState<Frequency>('monthly')
	const [categoryId, setCategoryId] = useState<string | null>(null)
	const [endsBeforeRetirement, setEndsBeforeRetirement] = useState(false)
	// No pre-paint rule needed: rows render only once hydrated, and the modal's handler attaches after rehydrate.
	const showRetirementPlanner = useShowRetirementPlanner()

	type FieldName = 'name' | 'amount'
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
	const [submitAttempted, setSubmitAttempted] = useState(false)

	const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
	const getFieldError = (field: FieldName): string | undefined => errors[field]

	const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
		const next: Partial<Record<FieldName, string>> = {}
		if (!name.trim()) {
			next.name = 'Please enter a name for the expense'
		}
		const amountInCents = parseFromInput(amount, locale)
		if (amountInCents <= 0) {
			next.amount = 'Please enter a valid positive amount'
		} else if (exceedsMoneyLimit(amountInCents)) {
			// Above the int32 sync limit the row would save locally but be refused at enqueue.
			next.amount = moneyLimitMessage({ mode, currency, locale })
		}
		return next
	}, [name, amount, mode, currency, locale])

	const clearErrors = () => {
		setErrors({})
		setSubmitAttempted(false)
	}

	useEffect(() => {
		if (isModalOpen && editingId === null) {
			setName('')
			setAmount('')
			setFrequency('monthly')
			setCategoryId(null)
			setEndsBeforeRetirement(false)
		}
	}, [isModalOpen, editingId])

	useEffect(() => {
		if (submitAttempted) {
			setErrors(computeErrors())
		}
	}, [submitAttempted, computeErrors])

	const openAddModal = () => {
		setEditingId(null)
		clearErrors()
		setIsModalOpen(true)
	}

	const openEditModal = (source: {
		id: string
		name: string
		amount: number
		frequency: Frequency
		categoryId?: string | null
		endsBeforeRetirement?: boolean
	}) => {
		setEditingId(source.id)
		setName(source.name)
		// Seeded like the blur re-echo: toString() can emit ungrouped or exponent text a comma-decimal locale misreads.
		setAmount(formatForInputDisplay(source.amount, locale))
		setFrequency(source.frequency)
		// Must be seeded: handleSubmit always sends categoryId, so an unseeded edit would wipe the category.
		setCategoryId(source.categoryId ?? null)
		// Must be seeded too: while shown, every save sends this field, so an unseeded edit would un-mark the row.
		// === true because older rows lack the key.
		setEndsBeforeRetirement(source.endsBeforeRetirement === true)
		clearErrors()
		setIsModalOpen(true)
	}

	const closeModal = () => {
		setIsModalOpen(false)
		setEditingId(null)
		setName('')
		setAmount('')
		setFrequency('monthly')
		setCategoryId(null)
		setEndsBeforeRetirement(false)
		clearErrors()
	}

	const [isSubmitting, setIsSubmitting] = useState(false)

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const pendingExpense = expenses.find((e) => e.id === pendingDeleteId)
	const pendingDeleteName = pendingExpense?.name ?? ''

	// All balance rows, not the profile-scoped hook: deleting an expense unlinks a debt in any profile.
	const allBalanceEntries = useBalanceStore((state) => state.entries)
	const pendingDeleteDebtSentence = useMemo(() => {
		if (pendingExpense === undefined) return null
		const names: string[] = []
		let unnamedCount = 0
		for (const entry of allBalanceEntries) {
			if (resolveDebtPaymentExpense(entry, [pendingExpense]) === null) continue
			const name = typeof entry.name === 'string' ? entry.name.trim() : ''
			if (name === '') unnamedCount += 1
			else names.push(name)
		}
		return debtLinkSentence(names, unnamedCount)
	}, [allBalanceEntries, pendingExpense])

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		setSubmitAttempted(true)
		setIsSubmitting(true)

		try {
			const validationErrors = computeErrors()
			setErrors(validationErrors)
			if (Object.keys(validationErrors).length > 0) {
				return
			}

			const newExpense = {
				name: name.trim(),
				amount: parseFromInput(amount, locale),
				frequency,
				categoryId,
				// Sent on every save while shown: updateExpense merges, so an omitted key would keep the old true.
				// Omitted while the planner is off, so a hidden field writes nothing.
				...(showRetirementPlanner ? { endsBeforeRetirement } : {}),
			}

			if (editingId !== null) {
				updateExpense(editingId, newExpense)
			} else {
				addExpense(newExpense)
			}

			closeModal()
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleDelete = (id: string) => {
		setPendingDeleteId(id)
	}

	const confirmDelete = () => {
		if (pendingDeleteId !== null) {
			deleteExpense(pendingDeleteId)
			setPendingDeleteId(null)
		}
	}

	const storesHydrated = useStoresHydrated()
	const isInitialSyncPending = useIsInitialSyncPending(expenses.length === 0)
	const hydrated = storesHydrated && !isInitialSyncPending

	return (
		<div className="min-h-screen surface-sunken p-4 sm:p-8">
			<div className="max-w-4xl mx-auto">
				{/* One announced region per page: every skeleton is aria-hidden. */}
				{!hydrated && <LoadingStatus />}
				<header className="mb-8">
					<div>
						<h1 className="text-3xl font-bold text-heading">Expenses</h1>
						<p className="text-body mt-2">Track and categorize your spending</p>
					</div>
				</header>

				<main className="space-y-6">
					<section className="surface rounded-lg shadow-md p-6">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<PeriodTotal
								label="Total Expenses"
								monthlyTotalCents={totalExpenses}
								rawTotalCents={rawTotalExpenses}
								conversionApplied={conversionApplied}
								unreadableCount={unreadableExpenseCount}
								amountClassName="text-red-600 dark:text-red-400 mt-2"
								tooltipLabel="More information about the expenses figure"
								selectorLabel="Show expenses per"
							/>
							<button
								ref={addButtonRef}
								type="button"
								onClick={openAddModal}
								className="fill-green px-4 py-2 rounded-md hover:bg-green-800 transition-colors whitespace-nowrap"
							>
								+ Add Expense
							</button>
						</div>
					</section>

					<section className="surface rounded-lg shadow-md p-6">
						<h2 className="text-xl font-semibold text-subheading mb-6">Your Expenses</h2>

						{/* The skeleton mirrors this card's box model, so resolving causes no layout shift. */}
						{!hydrated ? (
							<EmptyStateSkeleton testId="expenses-list-skeleton" />
						) : expenses.length === 0 ? (
							<div className="surface-inset rounded-lg p-8 text-center">
								<p className="text-muted mb-4">No expenses recorded yet</p>
								<p className="text-sm text-faint">Click "Add Expense" to get started</p>
							</div>
						) : (
							<>
								<TableSortControl
									label="Sort expenses"
									columns={sortColumns}
									state={sort.state}
									onSelect={sort.select}
								/>
								<TableScrollRegion
									label="Expenses table"
									className={cn(RESPONSIVE_WRAPPER_CLASS, RESPONSIVE_SCROLL_SHADOW_CLASS)}
								>
									<table className={RESPONSIVE_TABLE_CLASS}>
										<thead className={RESPONSIVE_THEAD_CLASS}>
											<tr>
												{/* Header text stays exactly the label (the indicator is aria-hidden); tests pin it. */}
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.name}
													ariaSort={sort.ariaSort('name')}
													describedBy={sortA11y.describedBy(sort.ariaSort('name'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('name')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.amount}
													ariaSort={sort.ariaSort('amount')}
													describedBy={sortA11y.describedBy(sort.ariaSort('amount'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('amount')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.frequency}
													ariaSort={sort.ariaSort('frequency')}
													describedBy={sortA11y.describedBy(sort.ariaSort('frequency'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('frequency')}
												/>
												{/* Same expression as the matching <td>, or every column shifts. */}
												{showCategoryColumn && (
													<SortableColumnHeader
														label={SORT_COLUMN_LABELS.category}
														ariaSort={sort.ariaSort('category')}
														describedBy={sortA11y.describedBy(sort.ariaSort('category'))}
														onActivate={sortA11y.markActivated}
														onToggle={() => sort.toggle('category')}
													/>
												)}
												{/* No aria-sort at all: none would advertise a sortable column. */}
												<th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
											</tr>
										</thead>
										<tbody className={RESPONSIVE_TBODY_CLASS}>
											{sortedRows.map((expense) => (
												<tr key={expense.id} className={RESPONSIVE_ROW_CLASS}>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Name</FieldLabel>
														{/* One wrapper so the name and marker stay a single flex item below sm. */}
														<div>
															<div className="text-sm font-medium text-heading">{expense.name}</div>
															{/* Inside the Name cell, not a new column: tests pin the header array exactly. Text, not colour alone. */}
															{showRetirementPlanner && expense.endsBeforeRetirement === true && (
																<span
																	className="mt-1 px-2 py-0.5 inline-flex text-xs leading-5 font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
																	data-testid="expense-row-ends-before-retirement"
																>
																	Ends before retirement
																</span>
															)}
														</div>
													</td>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Amount</FieldLabel>
														<div className={cn('text-sm text-muted', RESPONSIVE_AMOUNT_CLASS)}>
															<GroupedAmount text={formatAmount(expense.amount)} />
														</div>
													</td>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Frequency</FieldLabel>
														<span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
															{expense.frequency}
														</span>
													</td>
													{showCategoryColumn && (
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Category</FieldLabel>
															<CategoryBadge
																categoryId={expense.categoryId}
																names={categoryNames}
																idPrefix="expense"
															/>
														</td>
													)}
													<td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
														<FieldLabel>Actions</FieldLabel>
														<div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
															<button
																type="button"
																onClick={() => openEditModal(expense)}
																aria-label={`Edit ${expense.name}`}
																className={cn(
																	'mr-4 p-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
																	RESPONSIVE_ACTION_BUTTON_CLASS
																)}
															>
																<PencilIcon className="h-5 w-5" />
															</button>
															<button
																type="button"
																onClick={() => handleDelete(expense.id)}
																aria-label={`Delete ${expense.name}`}
																className={cn(
																	'p-1 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500',
																	RESPONSIVE_ACTION_BUTTON_CLASS
																)}
															>
																<TrashIcon className="h-5 w-5" />
															</button>
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</TableScrollRegion>
								{sortA11y.nodes}
							</>
						)}
					</section>
				</main>

				<Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="expense-modal-title">
					<div className="flex justify-between items-center mb-6">
						<h3 id="expense-modal-title" className="text-lg font-medium text-heading">
							{editingId !== null ? 'Edit Expense' : 'Add Expense'}
						</h3>
						<button
							type="button"
							onClick={closeModal}
							className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
							aria-label="Close"
						>
							<svg
								aria-hidden="true"
								className="h-6 w-6"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>

					<form onSubmit={handleSubmit} className="space-y-4" noValidate>
						<div>
							<label htmlFor="name" className="block text-sm font-medium text-label mb-1">
								Name *
							</label>
							<input
								type="text"
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., Rent, Groceries, Utilities"
								className={cn(
									'w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
									hasFieldError('name')
										? 'border-red-500 focus:ring-red-500 focus:border-red-500'
										: 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
								)}
								aria-invalid={hasFieldError('name')}
								aria-required
								aria-describedby={hasFieldError('name') ? 'expense-name-error' : undefined}
								data-testid="expense-name-input"
							/>
							{hasFieldError('name') && (
								<p
									id="expense-name-error"
									className="mt-1 text-sm text-red-600 dark:text-red-400"
									role="alert"
									data-testid="expense-name-error"
								>
									{getFieldError('name')}
								</p>
							)}
							{/* Plain prose, not a <Link>: this page renders without a router in several test suites. */}
							<p className="mt-1 text-xs text-muted" data-testid="expense-mortgage-hint">
								Paying off a loan or mortgage? Enter the payment here, and the amount still owed on
								the Balance Tracking page.
							</p>
						</div>

						<div>
							<label htmlFor="amount" className="block text-sm font-medium text-label mb-1">
								Amount *
							</label>
							<div className="relative rounded-md shadow-sm">
								{mode === 'symbol' && (
									<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
										<span className="text-muted text-sm">{currencySymbol(currency)}</span>
									</div>
								)}
								<input
									type="text"
									inputMode="decimal"
									id="amount"
									value={amount}
									onChange={(e) => setAmount(sanitizeMoneyChange(e.target, locale))}
									onBlur={(e) => reformatAmountOnBlur(e.target.value, locale, setAmount)}
									placeholder="0.00"
									className={cn(
										'w-full px-3 py-2',
										mode === 'symbol' && 'pl-7',
										'border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
										hasFieldError('amount')
											? 'border-red-500 focus:ring-red-500 focus:border-red-500'
											: 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
									)}
									aria-invalid={hasFieldError('amount')}
									aria-required
									aria-describedby={hasFieldError('amount') ? 'expense-amount-error' : undefined}
									data-testid="expense-amount-input"
								/>
							</div>
							{hasFieldError('amount') && (
								<p
									id="expense-amount-error"
									className="mt-1 text-sm text-red-600 dark:text-red-400"
									role="alert"
									data-testid="expense-amount-error"
								>
									{getFieldError('amount')}
								</p>
							)}
						</div>

						<div>
							<label htmlFor="frequency" className="block text-sm font-medium text-label mb-1">
								Frequency *
							</label>
							<select
								id="frequency"
								value={frequency}
								onChange={(e) => setFrequency(e.target.value as Frequency)}
								className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
								required
							>
								{FREQUENCY_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>

						<CategoryPicker
							kind="expense"
							value={categoryId}
							onChange={setCategoryId}
							idPrefix="expense"
						/>

						{/* Copy avoids "must": the planner needs a prediction, not a commitment. */}
						{showRetirementPlanner && (
							<div>
								<div className="flex items-start gap-2">
									<input
										type="checkbox"
										id="endsBeforeRetirement"
										checked={endsBeforeRetirement}
										onChange={(e) => setEndsBeforeRetirement(e.target.checked)}
										className="mt-0.5 border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-green-500 w-4 h-4 text-green-600"
										aria-describedby="expense-ends-before-retirement-help"
										data-testid="expense-ends-before-retirement"
									/>
									<label htmlFor="endsBeforeRetirement" className="font-medium text-label text-sm">
										This expense ends before I retire
									</label>
								</div>
								<p id="expense-ends-before-retirement-help" className="mt-1 text-muted text-xs">
									Tick this for a cost that will have stopped by the time you retire — a mortgage
									you'll have paid off, tuition, daycare or a commute. The retirement planner uses
									it to suggest what your income needs to cover.
								</p>
							</div>
						)}

						<div className="flex justify-end gap-3 pt-4">
							<button
								type="button"
								onClick={closeModal}
								className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={isSubmitting}
								className="fill-green px-4 py-2 rounded-md hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isSubmitting ? 'Saving...' : editingId !== null ? 'Save Changes' : 'Add Expense'}
							</button>
						</div>
					</form>
				</Modal>

				<ConfirmDialog
					isOpen={pendingDeleteId !== null}
					onConfirm={confirmDelete}
					onCancel={() => setPendingDeleteId(null)}
					finalFocusRef={addButtonRef}
					message={
						<>
							Are you sure you want to delete
							{pendingDeleteName ? ` "${pendingDeleteName}"` : ' this expense'}?
							{pendingDeleteDebtSentence ? ` ${pendingDeleteDebtSentence}` : ''} This cannot be
							undone.
						</>
					}
				/>
			</div>
		</div>
	)
}
