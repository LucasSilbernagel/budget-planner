import {
	currencySymbol,
	formatForInputDisplay,
	parseFromInput,
} from '@budget-planner/core/format/currency'
import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import {
	debtOwedCents,
	resolveDebtPaymentExpense,
} from '@budget-planner/core/services/balanceTracking'
import type { Frequency } from '@budget-planner/db/schema'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useIsInitialSyncPending } from '../hooks/useIsInitialSyncPending'
import { useNetWorth } from '../hooks/useNetWorth'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { reformatAmountOnBlur } from '../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../lib/money-limit'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import {
	type BalanceRow,
	type BalanceSortKey,
	createBalanceSortExtractors,
} from '../lib/table-sort-keys'
import type { FinanceType } from '../stores/balanceStore'
import {
	useBalanceEntries,
	useBalanceStore,
	useTotalAssetBalance as useTotalAssets,
	useTotalDebtBalance as useTotalDebts,
	useTotalInvestmentBalance as useTotalInvestments,
} from '../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { useExpenses } from '../stores/expenseStore'
import { useTotalSavings } from '../stores/savingsStore'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { CardHeader } from './ui/CardHeader'
import { CardTitle } from './ui/CardTitle'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { FormError } from './ui/FormError'
import { FormField } from './ui/FormField'
import { FormLabel } from './ui/FormLabel'
import { GroupedAmount } from './ui/GroupedAmount'
import { Modal } from './ui/Modal'
import { ModalFooter } from './ui/ModalFooter'
import { ModalHeader } from './ui/ModalHeader'
import { ModalTitle } from './ui/ModalTitle'
import { Page } from './ui/Page'
import { PageContent } from './ui/PageContent'
import { PageDescription } from './ui/PageDescription'
import { PageHeader } from './ui/PageHeader'
import { PageTitle } from './ui/PageTitle'
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
import { EmptyStateSkeleton, LoadingStatus, PendingFigure } from './ui/Skeleton'
import { SortableColumnHeader, useSortHeaderAnnouncements } from './ui/SortableColumnHeader'
import { TableScrollRegion } from './ui/TableScrollRegion'
import { TableSortControl } from './ui/TableSortControl'

const TYPE_OPTIONS = [
	{
		value: 'investment',
		label: 'Investment',
		color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
	},
	{
		value: 'debt',
		label: 'Debt',
		color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
	},
	{
		// Amber keeps it distinct from investment's green and debt's red in both themes.
		value: 'asset',
		label: 'Asset',
		color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
	},
] satisfies { value: FinanceType; label: string; color: string }[]

/**
 * `Exclude`, not `satisfies readonly FinanceType[]`: a short list is assignable, so a
 * missing type would compile clean.
 */
type _AllTypesHaveAnOption =
	Exclude<FinanceType, (typeof TYPE_OPTIONS)[number]['value']> extends never ? true : never
const _optionCoverage: _AllTypesHaveAnOption = true
void _optionCoverage

/**
 * Descriptive common nouns only, never a single-country product. No cash example for
 * assets: it contradicts the asset hint and invites double-counting savings.
 */
const NAME_PLACEHOLDERS = {
	investment: 'e.g., Investment Account, Pension, Index Fund',
	debt: 'e.g., Mortgage, Car Loan, Credit Card',
	asset: 'e.g., Property, Vehicle, Artwork',
} as const satisfies Record<FinanceType, string>

/**
 * A `Record` requires every key, so `satisfies` already catches a missing type. Runtime
 * values outside FinanceType are handled by the `??` fallback at the call site.
 */
type _AllTypesHaveAPlaceholder =
	Exclude<FinanceType, keyof typeof NAME_PLACEHOLDERS> extends never ? true : never
const _placeholderCoverage: _AllTypesHaveAPlaceholder = true
void _placeholderCoverage

const FREQUENCY_OPTIONS = [
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'biweekly', label: 'Bi-weekly' },
	{ value: 'monthly', label: 'Monthly' },
	{ value: 'annually', label: 'Annually' },
] satisfies { value: Frequency; label: string }[]

const frequencyLabel = (frequency: Frequency): string =>
	FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency

/** An unreadable amount keeps the "Paid by" line and drops the figure rather than showing NaN. */
function DebtPaymentCell({
	expense,
}: {
	expense: { name: unknown; amount: unknown; frequency: unknown } | null
}) {
	const formatAmount = useFormattedAmount()
	if (expense === null) {
		return <div className="text-muted text-sm">Not linked</div>
	}
	const name = typeof expense.name === 'string' ? expense.name : ''
	return (
		<div>
			{typeof expense.amount === 'number' && Number.isFinite(expense.amount) && (
				<>
					<div className={cn('text-muted text-sm', RESPONSIVE_AMOUNT_CLASS)}>
						<GroupedAmount text={formatAmount(expense.amount)} />
					</div>
					<div className="text-faint text-xs">{untrustedFrequencyLabel(expense.frequency)}</div>
				</>
			)}
			<div className="text-faint text-xs">Paid by {name}</div>
		</div>
	)
}

/** Contains spaces, which no generated uuid has, so it can't be mistaken for an expense id. */
const PAYMENT_LINK_UNAVAILABLE = 'linked expense unavailable'

/**
 * localStorage is user-editable and frequencyLabel returns the raw value, so a non-string
 * would reach React as a child and throw.
 */
function untrustedFrequencyLabel(frequency: unknown): string {
	return typeof frequency === 'string' ? frequencyLabel(frequency as Frequency) : ''
}

/** An unreadable amount shows the name alone rather than NaN. */
function paymentOptionLabel(
	expense: { name: unknown; amount: unknown; frequency: unknown },
	formatAmount: (cents: number) => string
): string {
	const name = typeof expense.name === 'string' ? expense.name : ''
	const cadence = untrustedFrequencyLabel(expense.frequency)
	return typeof expense.amount === 'number' && Number.isFinite(expense.amount)
		? `${name} — ${formatAmount(expense.amount)}${cadence ? ` / ${cadence}` : ''}`
		: name
}

const SORT_COLUMN_LABELS = {
	type: 'Type',
	name: 'Name',
	// The key, sort key, DOM id and testids stay `currentBalance`: renaming the label is a
	// copy change, renaming the value a sync change.
	currentBalance: 'Current Balance/Value',
	contribution: 'Contribution',
} satisfies Record<BalanceSortKey, string>

/** Module scope: TableSortControl memoises its options on this identity. */
const BALANCE_SORT_COLUMNS = [
	{ key: 'type', label: SORT_COLUMN_LABELS.type },
	{ key: 'name', label: SORT_COLUMN_LABELS.name },
	{ key: 'currentBalance', label: SORT_COLUMN_LABELS.currentBalance },
	{ key: 'contribution', label: SORT_COLUMN_LABELS.contribution },
] satisfies readonly { key: BalanceSortKey; label: string }[]

export function BalancePage() {
	const balanceEntries = useBalanceEntries()
	const totalInvestments = useTotalInvestments()
	const totalDebts = useTotalDebts()
	const totalAssets = useTotalAssets()
	// Savings also gets its own card: a savings-inclusive net worth beside only Investments
	// and Debts would read as broken arithmetic.
	const totalSavings = useTotalSavings()
	const netWorth = useNetWorth()
	const { addBalanceEntry, updateBalanceEntry, deleteBalanceEntry } = useBalanceStore()

	// A view-level projection (never writes sortOrder), kept local. Debt rows sort by their
	// linked expense, so expenses feed the extractors and an expense edit re-sorts.
	const expenses = useExpenses()
	const sortExtractors = useMemo(
		() =>
			createBalanceSortExtractors((row: BalanceRow) => {
				const expense = resolveDebtPaymentExpense(row, expenses)
				return expense === null ? null : { amount: expense.amount, frequency: expense.frequency }
			}),
		[expenses]
	)
	const sort = useTableSort('balance', balanceEntries, sortExtractors)
	const sortedRows = sort.rows
	const sortA11y = useSortHeaderAnnouncements(
		sort.state
			? { label: SORT_COLUMN_LABELS[sort.state.key], direction: sort.state.direction }
			: null
	)
	const formatAmount = useFormattedAmount()
	const { mode, currency, locale } = useCurrencyPreferences()

	const [isModalOpen, setIsModalOpen] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [type, setType] = useState<FinanceType>('investment')
	const [name, setName] = useState('')
	const [currentBalance, setCurrentBalance] = useState('')
	const [monthlyContribution, setMonthlyContribution] = useState('')
	const [frequency, setFrequency] = useState<Frequency>('monthly')
	// The user says this contribution is already allowed for (taken from pay, or also listed
	// on Expenses), so the savings pool must not deduct it again.
	const [contributionRecordedAsExpense, setContributionRecordedAsExpense] = useState(false)
	// `storedPaymentExpenseId` keeps a link this device can't resolve, so it survives a save.
	const [paymentExpenseId, setPaymentExpenseId] = useState<string | null>(null)
	const [storedPaymentExpenseId, setStoredPaymentExpenseId] = useState<string | null>(null)

	// One expense pays at most one debt; the edited debt's own choice always stays listed.
	const linkedToOtherDebts = useMemo(() => {
		const ids = new Set<string>()
		for (const entry of balanceEntries) {
			if (entry.id === editingId) continue
			const expense = resolveDebtPaymentExpense(entry, expenses)
			if (expense !== null) ids.add(expense.id)
		}
		return ids
	}, [balanceEntries, editingId, expenses])
	const paymentOptions = useMemo(
		() =>
			expenses.filter(
				(expense) => expense.id === paymentExpenseId || !linkedToOtherDebts.has(expense.id)
			),
		[expenses, linkedToOtherDebts, paymentExpenseId]
	)
	// An unresolvable stored link shows as its own option and is kept on save: clearing it
	// would silently erase a link made on another device.
	const storedLinkUnavailable =
		storedPaymentExpenseId !== null &&
		!expenses.some((expense) => expense.id === storedPaymentExpenseId)

	type FieldName = 'name' | 'currentBalance' | 'monthlyContribution'
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
	const [submitAttempted, setSubmitAttempted] = useState(false)

	const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
	const getFieldError = (field: FieldName): string | undefined => errors[field]

	const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
		const next: Partial<Record<FieldName, string>> = {}
		if (!name.trim()) {
			next.name = 'Please enter a name for the balance entry'
		}
		const balanceInCents = parseFromInput(currentBalance, locale)
		if (balanceInCents < 0) {
			next.currentBalance = 'Please enter a valid non-negative current balance'
		} else if (exceedsMoneyLimit(balanceInCents)) {
			// Above the int32 sync limit the row would save here but be refused at enqueue.
			next.currentBalance = moneyLimitMessage({ mode, currency, locale })
		}
		// Contribution is hidden for assets and debts, so only an investment validates it.
		if (type === 'investment') {
			const monthlyInCents = parseFromInput(monthlyContribution, locale)
			if (monthlyInCents < 0) {
				next.monthlyContribution = 'Please enter a valid non-negative monthly contribution'
			} else if (exceedsMoneyLimit(monthlyInCents)) {
				next.monthlyContribution = moneyLimitMessage({ mode, currency, locale })
			}
		}
		return next
	}, [type, name, currentBalance, monthlyContribution, mode, currency, locale])

	const clearErrors = () => {
		setErrors({})
		setSubmitAttempted(false)
	}

	useEffect(() => {
		if (isModalOpen && editingId === null) {
			setType('investment')
			setName('')
			setCurrentBalance('')
			setMonthlyContribution('')
			setContributionRecordedAsExpense(false)
			setPaymentExpenseId(null)
			setStoredPaymentExpenseId(null)
		}
	}, [isModalOpen, editingId])

	useEffect(() => {
		if (submitAttempted) {
			setErrors(computeErrors())
		}
	}, [submitAttempted, computeErrors])

	const addButtonRef = useRef<HTMLButtonElement>(null)

	const openAddModal = () => {
		setEditingId(null)
		clearErrors()
		setIsModalOpen(true)
	}

	const openEditModal = (
		entry: Pick<
			ClientBalanceTracking,
			| 'id'
			| 'type'
			| 'name'
			| 'currentBalance'
			| 'monthlyContribution'
			| 'frequency'
			| 'contributionRecordedAsExpense'
			| 'paymentExpenseId'
		>
	) => {
		setEditingId(entry.id)
		setType(entry.type)
		setName(entry.name)
		// A legacy negative debt opens as the amount owed, or the validator would leave it unsaveable.
		setCurrentBalance(
			formatForInputDisplay(
				entry.type === 'debt' ? debtOwedCents(entry.currentBalance) : entry.currentBalance,
				locale
			)
		)
		setMonthlyContribution(formatForInputDisplay(entry.monthlyContribution, locale))
		setFrequency(entry.frequency ?? 'monthly')
		// Absent ⇒ unticked ⇒ deducted, matching the pool's own default.
		setContributionRecordedAsExpense(entry.contributionRecordedAsExpense === true)
		// localStorage is user-editable: a non-string is "not linked"; an unresolved string is kept.
		const storedLink =
			entry.type === 'debt' && typeof entry.paymentExpenseId === 'string' && entry.paymentExpenseId
				? entry.paymentExpenseId
				: null
		setPaymentExpenseId(storedLink)
		setStoredPaymentExpenseId(storedLink)
		clearErrors()
		setIsModalOpen(true)
	}

	const closeModal = () => {
		setIsModalOpen(false)
		setEditingId(null)
		setType('investment')
		setName('')
		setCurrentBalance('')
		setMonthlyContribution('')
		setFrequency('monthly')
		setContributionRecordedAsExpense(false)
		setPaymentExpenseId(null)
		setStoredPaymentExpenseId(null)
		clearErrors()
	}

	const [isSubmitting, setIsSubmitting] = useState(false)

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
	const listHeadingRef = useRef<HTMLHeadingElement>(null)
	const pendingDeleteName = balanceEntries.find((e) => e.id === pendingDeleteId)?.name ?? ''

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

			// Assets and debts carry no contribution, but the columns are NOT NULL, so zeros are
			// written. SavingsPage sums investment contributions into its pool, so this keeps it right.
			const hasContribution = type === 'investment'
			const newEntry = {
				type,
				name: name.trim(),
				currentBalance: parseFromInput(currentBalance, locale),
				monthlyContribution: hasContribution ? parseFromInput(monthlyContribution, locale) : 0,
				frequency: hasContribution ? frequency : ('monthly' as const),
				// Persistence gate: a stale `true` from a type switch would make the validator reject the write.
				contributionRecordedAsExpense: type === 'investment' && contributionRecordedAsExpense,
				paymentExpenseId: type === 'debt' ? paymentExpenseId : null,
			}

			if (editingId !== null) {
				updateBalanceEntry(editingId, newEntry)
			} else {
				addBalanceEntry(newEntry)
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
			deleteBalanceEntry(pendingDeleteId)
			setPendingDeleteId(null)
		}
	}

	const getTypeDisplay = (type: FinanceType) => {
		const option = TYPE_OPTIONS.find((o) => o.value === type)
		return option
			? option
			: { label: type, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' }
	}

	const storesHydrated = useStoresHydrated()
	// A paid session's first-ever pull on this device can still be in flight after hydration.
	const isInitialSyncPending = useIsInitialSyncPending(balanceEntries.length === 0)
	const hydrated = storesHydrated && !isInitialSyncPending

	return (
		<Page>
			<PageContent>
				{/* One announced region per page: every skeleton is aria-hidden. */}
				{!hydrated && <LoadingStatus />}
				<PageHeader>
					<div>
						<PageTitle>Balance Tracking</PageTitle>
						<PageDescription>
							Monitor your investments, debts and what you own outright, and see your net worth
							including savings
						</PageDescription>
					</div>
				</PageHeader>

				<main className="space-y-6">
					<Card as="section">
						<CardHeader className="mb-4 flex-wrap gap-4">
							<CardTitle className="text-xl">Financial Overview</CardTitle>
							<button
								ref={addButtonRef}
								type="button"
								onClick={openAddModal}
								data-testid="balance-add-button"
								className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md text-white transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
							>
								+ Add Balance Entry
							</button>
						</CardHeader>
						{/* 4-up only from lg: grid columns are minmax(0,1fr), which clip rather than overflow.
               Figures wrap between digit groups (GroupedAmount). */}
						<div className="gap-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
							<Card variant="inset" className="p-4 lg:px-3">
								<p className="text-muted text-sm">Total Investments</p>
								<p
									className="mt-1 font-bold text-green-600 dark:text-green-400 text-2xl"
									data-testid="stat-total-investments"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(totalInvestments)} />
									) : (
										<PendingFigure testId="stat-total-investments-skeleton" />
									)}
								</p>
							</Card>
							{/* Read-only: savings are entered on /savings, so this card shows the
                 figure and points there rather than offering a second entry path. */}
							<Card variant="inset" className="p-4 lg:px-3">
								<p className="text-muted text-sm">
									Total Savings{' '}
									<a
										href="/savings"
										className="text-blue-600 text-xs underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Savings page
									</a>
								</p>
								<p
									className="mt-1 font-bold text-blue-600 dark:text-blue-400 text-2xl"
									data-testid="stat-total-savings"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(totalSavings)} />
									) : (
										<PendingFigure testId="stat-total-savings-skeleton" />
									)}
								</p>
							</Card>
							<Card variant="inset" className="p-4 lg:px-3">
								{/* "Other", since investments and savings beside it are assets too. */}
								<p className="text-muted text-sm">Other Assets</p>
								<p
									className="mt-1 font-bold text-amber-600 dark:text-amber-400 text-2xl"
									data-testid="stat-total-assets"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(totalAssets)} />
									) : (
										<PendingFigure testId="stat-total-assets-skeleton" />
									)}
								</p>
							</Card>
							<Card variant="inset" className="p-4 lg:px-3">
								<p className="text-muted text-sm">Total Debts</p>
								<p
									className="mt-1 font-bold text-red-600 dark:text-red-400 text-2xl"
									data-testid="stat-total-debts"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(totalDebts)} />
									) : (
										<PendingFigure testId="stat-total-debts-skeleton" />
									)}
								</p>
							</Card>
							{/* Spans the row rather than a fifth card: five peers at max-w-4xl would clip the figure. */}
							<Card variant="inset" className="sm:col-span-2 lg:col-span-4 p-4 lg:px-3">
								<p className="text-muted text-sm">Net Worth</p>
								<p
									data-testid="stat-net-worth"
									className={cn(
										'text-2xl font-bold mt-1',
										netWorth >= 0
											? 'text-green-600 dark:text-green-400'
											: 'text-red-600 dark:text-red-400'
									)}
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(netWorth)} />
									) : (
										<PendingFigure testId="stat-net-worth-skeleton" />
									)}
								</p>
							</Card>
						</div>
					</Card>

					<Card as="section">
						<CardTitle
							ref={listHeadingRef}
							tabIndex={-1}
							className="mb-6 text-xl rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
							Your Balance Entries
						</CardTitle>

						{/* Pending is a third state: before rehydration the list is empty but not known empty. */}
						{!hydrated ? (
							<EmptyStateSkeleton testId="balance-entries-skeleton" />
						) : balanceEntries.length === 0 ? (
							<Card variant="inset" className="p-8 text-center">
								<p className="mb-4 text-muted">No balance entries recorded yet</p>
								<p className="text-faint text-sm">Click "Add Balance Entry" to get started</p>
							</Card>
						) : (
							<>
								<TableSortControl
									label="Sort balance entries"
									columns={BALANCE_SORT_COLUMNS}
									state={sort.state}
									onSelect={sort.select}
								/>
								<TableScrollRegion
									label="Balance entries table"
									className={cn(RESPONSIVE_WRAPPER_CLASS, RESPONSIVE_SCROLL_SHADOW_CLASS)}
								>
									<table className={RESPONSIVE_TABLE_CLASS}>
										<thead className={RESPONSIVE_THEAD_CLASS}>
											<tr>
												{/* Each <th>'s text stays exactly the column label; the indicator is an aria-hidden svg. */}
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.type}
													ariaSort={sort.ariaSort('type')}
													describedBy={sortA11y.describedBy(sort.ariaSort('type'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('type')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.name}
													ariaSort={sort.ariaSort('name')}
													describedBy={sortA11y.describedBy(sort.ariaSort('name'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('name')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.currentBalance}
													ariaSort={sort.ariaSort('currentBalance')}
													describedBy={sortA11y.describedBy(sort.ariaSort('currentBalance'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('currentBalance')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.contribution}
													ariaSort={sort.ariaSort('contribution')}
													describedBy={sortA11y.describedBy(sort.ariaSort('contribution'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('contribution')}
												/>
												<th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
											</tr>
										</thead>
										<tbody className={RESPONSIVE_TBODY_CLASS}>
											{sortedRows.map((entry) => {
												const typeDisplay = getTypeDisplay(entry.type)
												return (
													<tr key={entry.id} className={RESPONSIVE_ROW_CLASS}>
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Type</FieldLabel>
															<span
																className={cn(
																	'px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full',
																	typeDisplay.color
																)}
															>
																{typeDisplay.label}
															</span>
														</td>
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Name</FieldLabel>
															<div className="font-medium text-heading text-sm">{entry.name}</div>
														</td>
														<td className={RESPONSIVE_CELL_CLASS}>
															{/* `<wbr>` lets the widest label break after the slash at 320px without adding text. */}
															<FieldLabel>
																Current Balance/
																<wbr />
																Value
															</FieldLabel>
															<div className={cn('text-muted text-sm', RESPONSIVE_AMOUNT_CLASS)}>
																<GroupedAmount
																	text={formatAmount(
																		entry.type === 'debt'
																			? debtOwedCents(entry.currentBalance)
																			: entry.currentBalance
																	)}
																/>
															</div>
														</td>
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Contribution</FieldLabel>
															{/* Amount and cadence are one flex child, or justify-between would fling the cadence
                                 to the far edge. */}
															{/* An em-dash, not "$0.00 / Monthly", for assets; their sort key is nulled to match. */}
															{entry.type === 'asset' ? (
																<div className="text-muted text-sm">—</div>
															) : entry.type === 'debt' ? (
																<DebtPaymentCell
																	expense={resolveDebtPaymentExpense(entry, expenses)}
																/>
															) : (
																<div>
																	<div
																		className={cn('text-muted text-sm', RESPONSIVE_AMOUNT_CLASS)}
																	>
																		<GroupedAmount text={formatAmount(entry.monthlyContribution)} />
																	</div>
																	<div className="text-faint text-xs">
																		{frequencyLabel(entry.frequency)}
																	</div>
																</div>
															)}
														</td>
														<td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
															<FieldLabel>Actions</FieldLabel>
															<div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
																<button
																	type="button"
																	onClick={() => openEditModal(entry)}
																	aria-label={`Edit ${entry.name}`}
																	className={cn(
																		'mr-4 p-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
																		RESPONSIVE_ACTION_BUTTON_CLASS
																	)}
																>
																	<PencilIcon className="h-5 w-5" />
																</button>
																<button
																	type="button"
																	onClick={() => handleDelete(entry.id)}
																	aria-label={`Delete ${entry.name}`}
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
												)
											})}
										</tbody>
									</table>
								</TableScrollRegion>
								{sortA11y.nodes}
							</>
						)}
					</Card>
				</main>

				<Modal
					isOpen={isModalOpen}
					onClose={closeModal}
					labelledBy="balance-modal-title"
					finalFocusRef={addButtonRef}
					className="bg-white dark:bg-gray-800 dark:text-gray-100 shadow-xl p-6 rounded-lg w-full max-w-md"
				>
					<ModalHeader>
						<ModalTitle id="balance-modal-title">
							{editingId !== null ? 'Edit Balance Entry' : 'Add Balance Entry'}
						</ModalTitle>
						<button
							type="button"
							onClick={closeModal}
							className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
							aria-label="Close"
						>
							<svg
								aria-hidden="true"
								className="w-6 h-6"
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
							<FormLabel htmlFor="type">Type *</FormLabel>
							<select
								id="type"
								value={type}
								onChange={(e) => setType(e.target.value as FinanceType)}
								className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
								required
							>
								{TYPE_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>

						<FormField>
							<FormLabel htmlFor="name">Name *</FormLabel>
							<input
								type="text"
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								// Not dead: persist migrate and sync pull write `type` unvalidated, so an unknown value
								// would otherwise leave the field with no example.
								placeholder={NAME_PLACEHOLDERS[type] ?? NAME_PLACEHOLDERS.investment}
								className={cn(
									'shadow-sm px-3 py-2 border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
									hasFieldError('name')
										? 'border-red-500 focus:border-red-500 focus:ring-red-500'
										: 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
								)}
								aria-invalid={hasFieldError('name')}
								aria-required
								aria-describedby={hasFieldError('name') ? 'balance-name-error' : undefined}
								data-testid="balance-name-input"
							/>
							{hasFieldError('name') && (
								<FormError id="balance-name-error" data-testid="balance-name-error">
									{getFieldError('name')}
								</FormError>
							)}
						</FormField>

						<FormField>
							<FormLabel htmlFor="currentBalance">Current Balance/Value *</FormLabel>
							<div className="relative shadow-sm rounded-md">
								{mode === 'symbol' && (
									<div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
										<span className="text-muted text-sm">{currencySymbol(currency)}</span>
									</div>
								)}
								<input
									type="text"
									inputMode="decimal"
									id="currentBalance"
									value={currentBalance}
									onChange={(e) => setCurrentBalance(sanitizeMoneyChange(e.target, locale))}
									onBlur={(e) => reformatAmountOnBlur(e.target.value, locale, setCurrentBalance)}
									placeholder="0.00"
									className={cn(
										'shadow-sm px-3 py-2',
										mode === 'symbol' && 'pl-7',
										'border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
										hasFieldError('currentBalance')
											? 'border-red-500 focus:border-red-500 focus:ring-red-500'
											: 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
									)}
									aria-invalid={hasFieldError('currentBalance')}
									aria-required
									aria-describedby={
										hasFieldError('currentBalance') ? 'balance-current-balance-error' : undefined
									}
									data-testid="balance-current-balance-input"
								/>
							</div>
							{hasFieldError('currentBalance') && (
								<FormError
									id="balance-current-balance-error"
									data-testid="balance-current-balance-error"
								>
									{getFieldError('currentBalance')}
								</FormError>
							)}
							{/* Plain <a>, not <Link>: this file has no router and its tests provide none. Debt/asset
                 scoped: it must never read as "entering the same money twice is fine". */}
							{type === 'debt' && (
								<p className="mt-1 text-xs text-muted" data-testid="balance-debt-hint">
									Enter what you still owe today. Record the recurring payment on the Expenses page
									— that's where it counts against your cash flow — then pick it under Paid by. If
									the loan bought something you still have, record that as an Asset entry too, so
									your net worth reflects both sides.{' '}
									<a
										href="/docs/where-a-mortgage-belongs"
										className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Where a mortgage belongs
									</a>{' '}
									works through a full example.
								</p>
							)}
							{type === 'asset' && (
								<p className="mt-1 text-xs text-muted" data-testid="balance-asset-hint">
									Enter what it's worth today. Money you put aside toward it belongs on the Savings
									page — an asset's value here changes as it appreciates, not as you contribute. A
									loan against it is recorded separately as a Debt entry, and your down payment is
									not entered anywhere.{' '}
									<a
										href="/docs/where-a-mortgage-belongs"
										className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Where a mortgage belongs
									</a>{' '}
									works through a full example.
								</p>
							)}
						</FormField>

						{type === 'debt' && (
							<FormField>
								<FormLabel htmlFor="paymentExpenseId">Paid by</FormLabel>
								<select
									id="paymentExpenseId"
									value={
										paymentExpenseId === null
											? ''
											: storedLinkUnavailable && paymentExpenseId === storedPaymentExpenseId
												? PAYMENT_LINK_UNAVAILABLE
												: paymentExpenseId
									}
									onChange={(e) => {
										const value = e.target.value
										setPaymentExpenseId(
											value === ''
												? null
												: value === PAYMENT_LINK_UNAVAILABLE
													? storedPaymentExpenseId
													: value
										)
									}}
									className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
									data-testid="balance-payment-expense-select"
								>
									<option value="">Not linked</option>
									{storedLinkUnavailable && (
										<option value={PAYMENT_LINK_UNAVAILABLE}>
											Linked expense not on this device
										</option>
									)}
									{paymentOptions.map((expense) => (
										<option key={expense.id} value={expense.id}>
											{paymentOptionLabel(expense, formatAmount)}
										</option>
									))}
								</select>
							</FormField>
						)}

						{type === 'investment' && (
							<>
								<FormField>
									<FormLabel htmlFor="monthlyContribution">Contribution *</FormLabel>
									<div className="relative shadow-sm rounded-md">
										{mode === 'symbol' && (
											<div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
												<span className="text-muted text-sm">{currencySymbol(currency)}</span>
											</div>
										)}
										<input
											type="text"
											inputMode="decimal"
											id="monthlyContribution"
											value={monthlyContribution}
											onChange={(e) =>
												setMonthlyContribution(sanitizeMoneyChange(e.target, locale))
											}
											onBlur={(e) =>
												reformatAmountOnBlur(e.target.value, locale, setMonthlyContribution)
											}
											placeholder="0.00"
											className={cn(
												'shadow-sm px-3 py-2',
												mode === 'symbol' && 'pl-7',
												'border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
												hasFieldError('monthlyContribution')
													? 'border-red-500 focus:border-red-500 focus:ring-red-500'
													: 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
											)}
											aria-invalid={hasFieldError('monthlyContribution')}
											aria-required
											aria-describedby={
												hasFieldError('monthlyContribution')
													? 'balance-monthly-contribution-error'
													: undefined
											}
											data-testid="balance-monthly-contribution-input"
										/>
									</div>
									{hasFieldError('monthlyContribution') && (
										<FormError
											id="balance-monthly-contribution-error"
											data-testid="balance-monthly-contribution-error"
										>
											{getFieldError('monthlyContribution')}
										</FormError>
									)}
								</FormField>

								<FormField>
									<FormLabel htmlFor="frequency">Contribution Frequency *</FormLabel>
									<select
										id="frequency"
										value={frequency}
										onChange={(e) => setFrequency(e.target.value as Frequency)}
										className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
										required
										data-testid="balance-frequency-select"
									>
										{FREQUENCY_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</FormField>

								{/* Investment-only: a debt's contribution never reaches the distributable pool. */}
								{type === 'investment' && (
									<FormField>
										{/* The field name deliberately doesn't match the label: renaming it is a sync schema change. */}
										<div className="flex items-start gap-2">
											<input
												type="checkbox"
												id="contributionRecordedAsExpense"
												checked={contributionRecordedAsExpense}
												onChange={(e) => setContributionRecordedAsExpense(e.target.checked)}
												className="mt-0.5 border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-purple-500 w-4 h-4 text-purple-600"
												aria-describedby="contribution-recorded-as-expense-help"
												data-testid="balance-contribution-recorded-as-expense"
											/>
											<label
												htmlFor="contributionRecordedAsExpense"
												className="font-medium text-label text-sm"
											>
												Not taken from the money left over
											</label>
										</div>
										<p
											id="contribution-recorded-as-expense-help"
											className="mt-1 text-muted text-xs"
										>
											Tick this if the contribution is already counted — it comes out of your pay
											and the income you entered is your take-home pay, or it's listed on your
											Expenses page — so the Savings page doesn't subtract it twice. If it's both,
											delete the Expenses line.
										</p>
									</FormField>
								)}
							</>
						)}

						<ModalFooter>
							<Button type="button" variant="secondary" onClick={closeModal}>
								Cancel
							</Button>
							<button
								type="submit"
								disabled={isSubmitting}
								className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-md text-white disabled:cursor-not-allowed"
							>
								{isSubmitting
									? 'Saving...'
									: editingId !== null
										? 'Save Changes'
										: 'Add Balance Entry'}
							</button>
						</ModalFooter>
					</form>
				</Modal>

				<ConfirmDialog
					isOpen={pendingDeleteId !== null}
					onConfirm={confirmDelete}
					onCancel={() => setPendingDeleteId(null)}
					finalFocusRef={listHeadingRef}
					message={
						<>
							Are you sure you want to delete
							{pendingDeleteName ? ` "${pendingDeleteName}"` : ' this balance entry'}? This cannot
							be undone.
						</>
					}
				/>
			</PageContent>
		</Page>
	)
}
