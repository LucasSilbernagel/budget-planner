import {
	currencySymbol,
	formatForInputDisplay,
	parseFromInput,
} from '@budget-planner/core/format/currency'
import type { Frequency } from '@budget-planner/db/schema'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useCategoryNameMap } from '../hooks/useCategoryLabels'
import { useIsInitialSyncPending } from '../hooks/useIsInitialSyncPending'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import { useSortHeaderAnnouncements } from '../hooks/useSortHeaderAnnouncements'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { reformatAmountOnBlur } from '../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../lib/money-limit'
import { summarizeReadableRows } from '../lib/readable-rows'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { createFlowSortExtractors, type FlowSortKey } from '../lib/table-sort-keys'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { useIncomeSources, useIncomeStore, useTotalIncome } from '../stores/incomeStore'
import { CategoryBadge } from './categories/CategoryBadge'
import { CategoryPicker } from './categories/CategoryPicker'
import { PencilIcon } from './icons/PencilIcon'
import { TrashIcon } from './icons/TrashIcon'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { CardTitle } from './ui/CardTitle'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { EmptyStateSkeleton } from './ui/EmptyStateSkeleton'
import { FormError } from './ui/FormError'
import { FormField } from './ui/FormField'
import { FormLabel } from './ui/FormLabel'
import { GroupedAmount } from './ui/GroupedAmount'
import { LoadingStatus } from './ui/LoadingStatus'
import { Modal } from './ui/Modal'
import { ModalFooter } from './ui/ModalFooter'
import { ModalHeader } from './ui/ModalHeader'
import { ModalTitle } from './ui/ModalTitle'
import { Page } from './ui/Page'
import { PageContent } from './ui/PageContent'
import { PageDescription } from './ui/PageDescription'
import { PageHeader } from './ui/PageHeader'
import { PageTitle } from './ui/PageTitle'
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
import { SortableColumnHeader } from './ui/SortableColumnHeader'
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

export function IncomePage() {
	const incomeSources = useIncomeSources()
	const formatAmount = useFormattedAmount()
	// Called unconditionally: gating it on tier would be a conditional hook call.
	const categoryNames = useCategoryNameMap()
	// `hasAccess` alone, not `!isLoading && hasAccess`: a re-check keeps hasAccess while loading.
	// Conditional JSX, not a CSS class: `max-sm:` evaluates against paper width when printing.
	const { status: premiumStatus } = usePremiumAccess()
	const showCategoryColumn = premiumStatus.hasAccess

	// Memoised on `categoryNames`: a category rename must re-sort with no row change.
	const sortExtractors = useMemo(
		() => createFlowSortExtractors(categoryNames, showCategoryColumn),
		[categoryNames, showCategoryColumn]
	)

	/** Gated like the `<th>`: the extractors omit Category for free users, so the option would silently do nothing. */
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
	const sort = useTableSort('income', incomeSources, sortExtractors)
	const sortedRows = sort.rows
	const sortA11y = useSortHeaderAnnouncements(
		sort.state
			? { label: SORT_COLUMN_LABELS[sort.state.key], direction: sort.state.direction }
			: null
	)
	const { mode, currency, locale } = useCurrencyPreferences()

	const totalIncome = useTotalIncome()
	const {
		rawTotalCents: rawTotalIncome,
		unreadableCount: unreadableIncomeCount,
		conversionApplied,
	} = summarizeReadableRows(incomeSources)
	const { addIncomeSource, updateIncomeSource, deleteIncomeSource } = useIncomeStore()

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [name, setName] = useState('')
	const [amount, setAmount] = useState('')
	const [frequency, setFrequency] = useState<Frequency>('monthly')
	// `null` (uncategorized) is always valid, so this field is never `required`.
	const [categoryId, setCategoryId] = useState<string | null>(null)

	type FieldName = 'name' | 'amount'
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
	const [submitAttempted, setSubmitAttempted] = useState(false)

	const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
	const getFieldError = (field: FieldName): string | undefined => errors[field]

	const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
		const next: Partial<Record<FieldName, string>> = {}
		if (!name.trim()) {
			next.name = 'Please enter a name for the income source'
		}
		const amountInCents = parseFromInput(amount, locale)
		if (amountInCents <= 0) {
			next.amount = 'Please enter a valid positive amount'
		} else if (exceedsMoneyLimit(amountInCents)) {
			// Above the int32 sync limit the row would save, then be silently refused at enqueue.
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
	}) => {
		setEditingId(source.id)
		setName(source.name)
		// Seed like the blur re-echo: a bare `.toString()` is misread in comma-decimal locales.
		setAmount(formatForInputDisplay(source.amount, locale))
		setFrequency(source.frequency)
		// Seeding from the row preserves a category a lapsed premium user can no longer see.
		setCategoryId(source.categoryId ?? null)
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
		clearErrors()
	}

	const [isSubmitting, setIsSubmitting] = useState(false)

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const pendingDeleteName = incomeSources.find((s) => s.id === pendingDeleteId)?.name ?? ''

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

			const newSource = {
				name: name.trim(),
				amount: parseFromInput(amount, locale),
				frequency,
				categoryId,
			}

			if (editingId !== null) {
				updateIncomeSource(editingId, newSource)
			} else {
				addIncomeSource(newSource)
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
			deleteIncomeSource(pendingDeleteId)
			setPendingDeleteId(null)
		}
	}

	const storesHydrated = useStoresHydrated()
	const isInitialSyncPending = useIsInitialSyncPending(incomeSources.length === 0)
	const hydrated = storesHydrated && !isInitialSyncPending

	return (
		<Page>
			<PageContent>
				{/* One announced region: every skeleton on this page is `aria-hidden`. */}
				{!hydrated && <LoadingStatus />}
				<PageHeader>
					<div>
						<PageTitle>Income Sources</PageTitle>
						<PageDescription>Manage your income streams and track your earnings</PageDescription>
					</div>
				</PageHeader>

				<main className="space-y-6">
					<Card as="section">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<PeriodTotal
								label="Total Income"
								monthlyTotalCents={totalIncome}
								rawTotalCents={rawTotalIncome}
								conversionApplied={conversionApplied}
								unreadableCount={unreadableIncomeCount}
								amountClassName="text-green-600 dark:text-green-400 mt-2"
								tooltipLabel="More information about the income figure"
								selectorLabel="Show income per"
							/>
							<button
								ref={addButtonRef}
								type="button"
								onClick={openAddModal}
								className="fill-green px-4 py-2 rounded-md hover:bg-green-800 transition-colors whitespace-nowrap"
							>
								+ Add Income Source
							</button>
						</div>
					</Card>

					<Card as="section">
						<CardTitle className="text-xl mb-6">Your Income Sources</CardTitle>

						{!hydrated ? (
							<EmptyStateSkeleton testId="income-list-skeleton" />
						) : incomeSources.length === 0 ? (
							<Card variant="inset" className="p-8 text-center">
								<p className="text-muted mb-4">No income sources yet</p>
								<p className="text-sm text-faint">Click "Add Income Source" to get started</p>
							</Card>
						) : (
							<>
								<TableSortControl
									label="Sort income sources"
									columns={sortColumns}
									state={sort.state}
									onSelect={sort.select}
								/>
								<TableScrollRegion
									label="Income sources table"
									className={cn(RESPONSIVE_WRAPPER_CLASS, RESPONSIVE_SCROLL_SHADOW_CLASS)}
								>
									<table className={RESPONSIVE_TABLE_CLASS}>
										<thead className={RESPONSIVE_THEAD_CLASS}>
											<tr>
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
												{/* No `aria-sort`: `none` would advertise a sortable column. */}
												<th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
											</tr>
										</thead>
										<tbody className={RESPONSIVE_TBODY_CLASS}>
											{sortedRows.map((source) => (
												<tr key={source.id} className={RESPONSIVE_ROW_CLASS}>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Name</FieldLabel>
														<div className="text-sm font-medium text-heading">{source.name}</div>
													</td>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Amount</FieldLabel>
														<div className={cn('text-sm text-muted', RESPONSIVE_AMOUNT_CLASS)}>
															<GroupedAmount text={formatAmount(source.amount)} />
														</div>
													</td>
													<td className={RESPONSIVE_CELL_CLASS}>
														<FieldLabel>Frequency</FieldLabel>
														<span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
															{source.frequency}
														</span>
													</td>
													{showCategoryColumn && (
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Category</FieldLabel>
															<CategoryBadge
																categoryId={source.categoryId}
																names={categoryNames}
																idPrefix="income"
															/>
														</td>
													)}
													<td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
														<FieldLabel>Actions</FieldLabel>
														<div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
															<button
																type="button"
																onClick={() => openEditModal(source)}
																aria-label={`Edit ${source.name}`}
																className={cn(
																	'mr-4 p-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
																	RESPONSIVE_ACTION_BUTTON_CLASS
																)}
															>
																<PencilIcon className="h-5 w-5" />
															</button>
															<button
																type="button"
																onClick={() => handleDelete(source.id)}
																aria-label={`Delete ${source.name}`}
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
					</Card>
				</main>

				<Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="income-modal-title">
					<ModalHeader>
						<ModalTitle id="income-modal-title">
							{editingId !== null ? 'Edit Income Source' : 'Add Income Source'}
						</ModalTitle>
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
					</ModalHeader>

					<form onSubmit={handleSubmit} className="space-y-4" noValidate>
						<FormField>
							<FormLabel htmlFor="name">Name *</FormLabel>
							<input
								type="text"
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., Salary, Freelance, Investment"
								className={cn(
									'w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
									hasFieldError('name')
										? 'border-red-500 focus:ring-red-500 focus:border-red-500'
										: 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
								)}
								aria-invalid={hasFieldError('name')}
								aria-required
								aria-describedby={hasFieldError('name') ? 'income-name-error' : undefined}
								data-testid="income-name-input"
							/>
							{hasFieldError('name') && (
								<FormError id="income-name-error" data-testid="income-name-error">
									{getFieldError('name')}
								</FormError>
							)}
						</FormField>

						<FormField>
							<FormLabel htmlFor="amount">Amount *</FormLabel>
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
									// Append the error id, never replace the hint: `aria-describedby` is an id list.
									aria-describedby={`income-amount-hint${
										hasFieldError('amount') ? ' income-amount-error' : ''
									}`}
									data-testid="income-amount-input"
								/>
							</div>
							{/* Avoids "net": it already means income minus expenses elsewhere in the app. */}
							<p
								id="income-amount-hint"
								className="mt-1 text-sm text-muted"
								data-testid="income-amount-hint"
							>
								Enter the amount that reaches your bank account — your pay after tax and any other
								deductions.
							</p>
							{hasFieldError('amount') && (
								<FormError id="income-amount-error" data-testid="income-amount-error">
									{getFieldError('amount')}
								</FormError>
							)}
						</FormField>

						<FormField>
							<FormLabel htmlFor="frequency">Frequency *</FormLabel>
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
						</FormField>

						<CategoryPicker
							kind="income"
							value={categoryId}
							onChange={setCategoryId}
							idPrefix="income"
						/>

						<ModalFooter>
							<Button type="button" variant="secondary" onClick={closeModal}>
								Cancel
							</Button>
							<button
								type="submit"
								disabled={isSubmitting}
								className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isSubmitting
									? 'Saving...'
									: editingId !== null
										? 'Save Changes'
										: 'Add Income Source'}
							</button>
						</ModalFooter>
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
							{pendingDeleteName ? ` "${pendingDeleteName}"` : ' this income source'}? This cannot
							be undone.
						</>
					}
				/>
			</PageContent>
		</Page>
	)
}
