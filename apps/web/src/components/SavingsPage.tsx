import {
	type AllocationMode,
	type ContributionDuplicateCandidate,
	findContributionDuplicateCandidates,
	normalizeToMonthly,
	solveAutomaticAllocations,
} from '@budget-planner/core'
import {
	currencySymbol,
	formatForInputDisplay,
	parseFromInput,
} from '@budget-planner/core/format/currency'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsInitialSyncPending } from '../hooks/useIsInitialSyncPending'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { reformatAmountOnBlur } from '../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../lib/money-limit'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { investmentContributionItems } from '../lib/savings/investment-contribution-items'
import { createSavingsSortExtractors, type SavingsSortKey } from '../lib/table-sort-keys'
import {
	useExpenses,
	useIncomeSources,
	useInvestmentEntries,
	useSavingsGoals,
	useSavingsStore,
	useTotalSavings,
} from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { GroupedAmount } from './ui/GroupedAmount'
import { Modal } from './ui/Modal'
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
	RESPONSIVE_STACKED_CELL_CLASS,
	RESPONSIVE_TABLE_CLASS,
	RESPONSIVE_TAG_CLASS,
	RESPONSIVE_TBODY_CLASS,
	RESPONSIVE_THEAD_CLASS,
	RESPONSIVE_VALUE_TAG_CLASS,
	RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { PencilIcon, TrashIcon } from './ui/RowActionIcons'
import { EmptyStateSkeleton, LoadingStatus, PendingFigure } from './ui/Skeleton'
import { SortableColumnHeader, useSortHeaderAnnouncements } from './ui/SortableColumnHeader'
import { TableScrollRegion } from './ui/TableScrollRegion'
import { TableSortControl } from './ui/TableSortControl'

// A persisted frequency can be a corrupt non-null string and the normalizer throws on it,
// so unknown values are coerced to 'monthly'.
const KNOWN_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'annually'])

const SORT_COLUMN_LABELS: Record<SavingsSortKey, string> = {
	name: 'Name',
	target: 'Target',
	currentBalance: 'Current Balance',
	monthlyAllocation: 'Monthly Allocation',
	progress: 'Progress',
}

// Module scope: TableSortControl memoises its options on this identity.
const SAVINGS_SORT_COLUMNS: readonly { key: SavingsSortKey; label: string }[] = [
	{ key: 'name', label: SORT_COLUMN_LABELS.name },
	{ key: 'target', label: SORT_COLUMN_LABELS.target },
	{ key: 'currentBalance', label: SORT_COLUMN_LABELS.currentBalance },
	{ key: 'monthlyAllocation', label: SORT_COLUMN_LABELS.monthlyAllocation },
	{ key: 'progress', label: SORT_COLUMN_LABELS.progress },
]

export function SavingsPage() {
	const savingsGoals = useSavingsGoals()
	const totalSavings = useTotalSavings()
	const { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, getSavingsProgress } =
		useSavingsStore()

	const incomeSources = useIncomeSources()
	const expenses = useExpenses()
	// No asset arm: the form gives assets no contribution, but a synced or hand-edited asset
	// row with one would be excluded here and overstate the pool.
	const investmentEntries = useInvestmentEntries()

	// The body is not rendered until opened: a collapsed <details> still puts its text (every entry
	// name) in the DOM. Controlled state keeps jsdom and browsers identical.
	const [breakdownOpen, setBreakdownOpen] = useState(false)

	// One mapping for both the solver and the breakdown, so the explanation matches the pool.
	const contributionItems = useMemo(
		() => investmentContributionItems(investmentEntries),
		[investmentEntries]
	)

	// `allocations` holds only automatic accounts, so membership discriminates the two modes.
	const { distributablePool, automaticAccountCount, allocations } = useMemo(
		() =>
			solveAutomaticAllocations({
				incomeSources,
				expenses,
				investmentContributions: contributionItems,
				savingsAccounts: savingsGoals,
			}),
		[incomeSources, expenses, contributionItems, savingsGoals]
	)

	const breakdown = useMemo(() => {
		const monthly = (amount: number, frequency: string) =>
			normalizeToMonthly(amount, KNOWN_FREQUENCIES.has(frequency) ? frequency : 'monthly')
		const incomeTotal = incomeSources.reduce((sum, i) => sum + monthly(i.amount, i.frequency), 0)
		const expenseTotal = expenses.reduce((sum, e) => sum + monthly(e.amount, e.frequency), 0)
		const lines = contributionItems.map((item) => ({
			id: item.id,
			name: item.name,
			monthlyCents: Math.max(0, monthly(item.amount, item.frequency)),
			excluded: item.recordedAsExpense,
			unreadable: item.unreadable,
		}))
		const contributionsCounted = lines
			.filter((line) => !line.excluded)
			.reduce((sum, line) => sum + line.monthlyCents, 0)
		const manualTotal = savingsGoals.reduce((sum, goal) => {
			// Mirrors core's sumManualAllocations: every manual row counts, target-less or not.
			if ((goal.allocationMode ?? 'automatic') !== 'manual') {
				return sum
			}
			// Number.isFinite, not ?? 0: ?? does not catch NaN, and this must match sumManualAllocations exactly.
			const amount = goal.monthlyAllocation
			return sum + (Number.isFinite(amount) ? Math.max(0, amount as number) : 0)
		}, 0)
		// Before the solver's floor at zero; shown when it differs so the breakdown reconciles.
		const rawLeftover = incomeTotal - expenseTotal - contributionsCounted - manualTotal
		return { incomeTotal, expenseTotal, lines, contributionsCounted, manualTotal, rawLeftover }
	}, [incomeSources, expenses, contributionItems, savingsGoals])

	// Detection only: highlight never reaches solveAutomaticAllocations.
	const duplicateCandidates = useMemo(
		() =>
			findContributionDuplicateCandidates({
				expenses: expenses.map((expense, index) => ({
					id: `expense-${index}`,
					name: expense.name ?? '',
					amount: expense.amount,
					frequency: KNOWN_FREQUENCIES.has(expense.frequency) ? expense.frequency : 'monthly',
				})),
				investmentContributions: contributionItems,
			}),
		[expenses, contributionItems]
	)

	// Re-run with every row unflagged: the detector skips flagged rows, so the excluded arm
	// could otherwise never see a matching expense line. Presentation only.
	const stillDuplicatedByContribution = useMemo(() => {
		const candidates = findContributionDuplicateCandidates({
			expenses: expenses.map((expense, index) => ({
				id: `expense-${index}`,
				name: expense.name ?? '',
				amount: expense.amount,
				frequency: KNOWN_FREQUENCIES.has(expense.frequency) ? expense.frequency : 'monthly',
			})),
			investmentContributions: contributionItems.map((item) => ({
				...item,
				recordedAsExpense: false,
			})),
		})
		const map = new Map<string, ContributionDuplicateCandidate>()
		for (const candidate of candidates) {
			if (candidate.highlight && !map.has(candidate.contributionId)) {
				map.set(candidate.contributionId, candidate)
			}
		}
		return map
	}, [expenses, contributionItems])

	const highlightedByContribution = useMemo(() => {
		const map = new Map<string, ContributionDuplicateCandidate>()
		for (const candidate of duplicateCandidates) {
			if (candidate.highlight && !map.has(candidate.contributionId)) {
				map.set(candidate.contributionId, candidate)
			}
		}
		return map
	}, [duplicateCandidates])

	// View-only projection: never writes sortOrder. Memoised on allocations and getSavingsProgress
	// too, because two sort keys read data the row does not carry.
	const sortExtractors = useMemo(
		() => createSavingsSortExtractors(allocations, getSavingsProgress),
		[allocations, getSavingsProgress]
	)
	const sort = useTableSort('savings', savingsGoals, sortExtractors)
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
	const [name, setName] = useState('')
	const [isAccount, setIsAccount] = useState(false)
	const [targetAmount, setTargetAmount] = useState('')
	const [currentBalance, setCurrentBalance] = useState('')
	const [allocationMode, setAllocationMode] = useState<AllocationMode>('automatic')
	const [monthlyAllocation, setMonthlyAllocation] = useState('')

	type FieldName = 'name' | 'targetAmount' | 'currentBalance' | 'monthlyAllocation'
	const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
	const [submitAttempted, setSubmitAttempted] = useState(false)

	const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
	const getFieldError = (field: FieldName): string | undefined => errors[field]

	const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
		const next: Partial<Record<FieldName, string>> = {}
		if (!name.trim()) {
			next.name = 'Please enter a name for the savings goal'
		}
		if (!isAccount) {
			const targetInCents = parseFromInput(targetAmount, locale)
			if (targetInCents <= 0) {
				next.targetAmount = 'Please enter a valid positive target amount'
			} else if (exceedsMoneyLimit(targetInCents)) {
				// Above the int32 sync limit the row would save here but be refused at enqueue.
				next.targetAmount = moneyLimitMessage({ mode, currency, locale })
			}
		}
		const balanceInCents = parseFromInput(currentBalance, locale)
		if (balanceInCents < 0) {
			next.currentBalance = 'Please enter a valid non-negative current balance'
		} else if (exceedsMoneyLimit(balanceInCents)) {
			next.currentBalance = moneyLimitMessage({ mode, currency, locale })
		}
		// Not gated on isAccount: the control renders for every entry, and '-' is typeable.
		if (allocationMode === 'manual') {
			const allocationInCents = parseFromInput(monthlyAllocation, locale)
			if (allocationInCents < 0) {
				next.monthlyAllocation = 'Please enter a valid non-negative monthly allocation'
			} else if (exceedsMoneyLimit(allocationInCents)) {
				next.monthlyAllocation = moneyLimitMessage({ mode, currency, locale })
			}
		}
		return next
	}, [
		name,
		isAccount,
		targetAmount,
		currentBalance,
		allocationMode,
		monthlyAllocation,
		mode,
		currency,
		locale,
	])

	const clearErrors = () => {
		setErrors({})
		setSubmitAttempted(false)
	}

	useEffect(() => {
		if (isModalOpen && editingId === null) {
			setName('')
			setIsAccount(false)
			setTargetAmount('')
			setCurrentBalance('')
			setAllocationMode('automatic')
			setMonthlyAllocation('')
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

	const openEditModal = (goal: {
		id: string
		name: string
		targetAmount: number | null
		currentBalance: number
		allocationMode?: AllocationMode
		monthlyAllocation?: number | null
	}) => {
		setEditingId(goal.id)
		setName(goal.name)
		const account = goal.targetAmount == null
		setIsAccount(account)
		setTargetAmount(account ? '' : formatForInputDisplay(goal.targetAmount as number, locale))
		setCurrentBalance(formatForInputDisplay(goal.currentBalance, locale))
		// An account prefills like a goal; resetting it would let an untouched Save convert Fixed to Automatic.
		const mode = goal.allocationMode ?? 'automatic'
		setAllocationMode(mode)
		setMonthlyAllocation(
			mode === 'manual' && goal.monthlyAllocation != null
				? formatForInputDisplay(goal.monthlyAllocation, locale)
				: ''
		)
		clearErrors()
		setIsModalOpen(true)
	}

	const closeModal = () => {
		setIsModalOpen(false)
		setEditingId(null)
		setName('')
		setIsAccount(false)
		setTargetAmount('')
		setCurrentBalance('')
		setAllocationMode('automatic')
		setMonthlyAllocation('')
		clearErrors()
	}

	const [isSubmitting, setIsSubmitting] = useState(false)

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
	const addButtonRef = useRef<HTMLButtonElement>(null)
	const pendingDeleteName = savingsGoals.find((g) => g.id === pendingDeleteId)?.name ?? ''

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

			const newGoal = {
				name: name.trim(),
				// An absent target persists as null, never 0.
				targetAmount: isAccount ? null : parseFromInput(targetAmount, locale),
				currentBalance: parseFromInput(currentBalance, locale),
				// Automatic rows persist null: the leftover share is computed, never stored.
				allocationMode,
				monthlyAllocation:
					allocationMode === 'manual' ? parseFromInput(monthlyAllocation, locale) : null,
			}

			if (editingId !== null) {
				updateSavingsGoal(editingId, newGoal)
			} else {
				addSavingsGoal(newGoal)
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
			deleteSavingsGoal(pendingDeleteId)
			setPendingDeleteId(null)
		}
	}

	const storesHydrated = useStoresHydrated()
	// A paid session's first-ever pull can still be in flight after stores hydrate.
	const isInitialSyncPending = useIsInitialSyncPending(savingsGoals.length === 0)
	const hydrated = storesHydrated && !isInitialSyncPending

	return (
		<div className="surface-sunken p-4 sm:p-8 min-h-screen">
			<div className="mx-auto max-w-4xl">
				{/* One announced region per page: every skeleton is aria-hidden. */}
				{!hydrated && <LoadingStatus />}
				<header className="mb-8">
					<div>
						<h1 className="font-bold text-heading text-3xl">Savings Goals</h1>
						<p className="mt-2 text-body">Track and manage your savings targets</p>
					</div>
				</header>

				<main className="space-y-6">
					<section className="surface shadow-md p-6 rounded-lg">
						<div className="flex md:flex-row flex-col md:justify-between md:items-center gap-4">
							{/* Not normalized: a savings balance is a stock, not a per-period flow. */}
							<div>
								<h2 className="font-semibold text-subheading text-xl">Total Savings</h2>
								{/* GroupedAmount: at 320px the figure can exceed the card, so it breaks only after a group separator. */}
								<p
									data-testid="savings-total"
									className="mt-2 font-bold text-purple-600 dark:text-purple-400 text-3xl"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(totalSavings)} />
									) : (
										<PendingFigure testId="savings-total-skeleton" widthClass="w-40" />
									)}
								</p>
								<p className="mt-1 text-muted text-xs">
									What you have saved right now — the sum of your current balances, not a per-period
									amount.
								</p>
							</div>
							<button
								ref={addButtonRef}
								type="button"
								onClick={openAddModal}
								className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md text-white whitespace-nowrap transition-colors"
							>
								+ Add Savings Goal
							</button>
						</div>

						{/* 'entry/entries', not 'account(s)': recipients include goals, and 'Account' is a badge label. */}
						<div className="mt-4 pt-4 border-gray-200 dark:border-gray-700 border-t">
							<p className="text-body text-sm" data-testid="savings-leftover-summary">
								{!hydrated ? (
									// Word-shaped inline bars wrap like the sentence does, so the placeholder tracks its line count.
									<>
										<PendingFigure testId="savings-leftover-summary-skeleton" widthClass="w-24" />{' '}
										<PendingFigure widthClass="w-20" /> <PendingFigure widthClass="w-28" />{' '}
										<PendingFigure widthClass="w-16" />
									</>
								) : automaticAccountCount === 0 ? (
									<>
										<span className="font-semibold">{formatAmount(distributablePool)}/mo</span> is
										left over — nothing is set to receive it.{' '}
										{savingsGoals.length > 0
											? 'Set an entry to “Automatic” to divide it up.'
											: 'Add a savings goal or account to divide it up.'}
									</>
								) : (
									<>
										<span className="font-semibold">{formatAmount(distributablePool)}/mo</span>{' '}
										split across {automaticAccountCount} automatic{' '}
										{automaticAccountCount === 1 ? 'entry' : 'entries'}
									</>
								)}
							</p>
							{distributablePool === 0 && automaticAccountCount > 0 && (
								<p className="mt-1 text-muted text-xs" data-testid="savings-overcommitted-note">
									There’s nothing left to distribute right now — automatic entries receive $0 until
									your income exceeds your expenses, contributions, and fixed allocations.
								</p>
							)}

							{/* Explanation only: nothing on this page writes to the balance store. No blocking prompt:
                 the detector matches equal amounts, and round numbers collide constantly. */}
							{hydrated && (
								<div className="mt-3" data-testid="savings-leftover-breakdown">
									{/* A <button>, not <details>: the body must be absent when closed, and an intercepted <summary>
                     loses its free keyboard behaviour. */}
									{/* Persistent underline (touch has no hover) and a currentColor glyph avoid a sub-3:1 border. Rings are
                     box-shadows, which High Contrast drops, hence forced-colors:focus:outline; p-1 makes 24px on desktop. */}
									<button
										type="button"
										className={`inline-flex items-center gap-1 p-1 text-accent underline text-xs cursor-pointer rounded hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 forced-colors:focus:outline forced-colors:focus:outline-2 dark:hover:text-blue-200 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
										aria-expanded={breakdownOpen}
										aria-controls="savings-leftover-breakdown-body"
										onClick={() => setBreakdownOpen((open) => !open)}
									>
										How is this worked out?
										{/* Geometry copied from SortableColumnHeader's chevron. */}
										<svg
											aria-hidden="true"
											className={`h-3 w-3 shrink-0 transition-transform${
												breakdownOpen ? ' rotate-180' : ''
											}`}
											fill="none"
											stroke="currentColor"
											strokeWidth={2.5}
											viewBox="0 0 24 24"
										>
											<path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</button>
									{breakdownOpen && (
										<div id="savings-leftover-breakdown-body" className="space-y-1 mt-2 text-xs">
											<div className="flex justify-between gap-4">
												<span className="text-muted">Income</span>
												<span className="text-body" data-testid="breakdown-income">
													{formatAmount(breakdown.incomeTotal)}
												</span>
											</div>
											<div className="flex justify-between gap-4">
												<span className="text-muted">Less expenses</span>
												<span className="text-body" data-testid="breakdown-expenses">
													−{formatAmount(breakdown.expenseTotal)}
												</span>
											</div>
											<div className="flex justify-between gap-4">
												<span className="text-muted">Less contributions counted</span>
												<span className="text-body" data-testid="breakdown-contributions">
													−{formatAmount(breakdown.contributionsCounted)}
												</span>
											</div>

											{/* Excluded rows stay visible (struck through) so the money reads as accounted for. */}
											{breakdown.lines.length > 0 && (
												<ul className="space-y-1 pl-4" data-testid="breakdown-contribution-lines">
													{breakdown.lines.map((line) => {
														const candidate = highlightedByContribution.get(line.id)
														const stillDuplicated = line.excluded
															? stillDuplicatedByContribution.get(line.id)
															: undefined
														return (
															<li
																key={line.id}
																data-testid={`breakdown-contribution-${line.id}`}
																className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${
																	candidate && !line.excluded
																		? 'bg-amber-50 dark:bg-amber-900/20 -mx-1 px-1 rounded'
																		: ''
																}`}
															>
																<span className="text-muted">{line.name}</span>
																<span
																	className={`ml-auto ${
																		line.excluded ? 'text-muted line-through' : 'text-body'
																	}`}
																	data-testid={`breakdown-contribution-amount-${line.id}`}
																>
																	{formatAmount(line.monthlyCents)}
																</span>
																{stillDuplicated ? (
																	// Flagged AND a same-amount expense line exists: ticking alone leaves this user wrong by the contribution.
																	<span
																		className="basis-full text-[11px] text-amber-700 dark:text-amber-300"
																		data-testid={`breakdown-still-duplicated-${line.id}`}
																	>
																		Not counted here — but your expense “
																		{stillDuplicated.expenseName}” still subtracts it. If it’s the
																		same money, remove that expense line.
																	</span>
																) : line.excluded ? (
																	<span className="basis-full text-muted text-[11px]">
																		Not counted — you marked it as already accounted for. Change
																		this on its Balance Tracking entry.
																	</span>
																) : candidate ? (
																	<span
																		className="basis-full text-[11px] text-amber-700 dark:text-amber-300"
																		data-testid={`breakdown-duplicate-hint-${line.id}`}
																	>
																		Your expense “{candidate.expenseName}” is the same amount. If
																		it’s the same money, tick “Not taken from the money left over”
																		on its Balance Tracking entry.
																	</span>
																) : null}
																{line.unreadable && (
																	// A non-numeric contribution counted as 0: say so, or the leftover is silently overstated.
																	<span
																		className="basis-full text-[11px] text-amber-700 dark:text-amber-300"
																		data-testid={`breakdown-unreadable-${line.id}`}
																	>
																		Couldn’t read this contribution, so it counts as{' '}
																		{formatAmount(0)}. Re-enter it on Balance Tracking.
																	</span>
																)}
															</li>
														)
													})}
												</ul>
											)}

											<div className="flex justify-between gap-4">
												<span className="text-muted">Less fixed allocations</span>
												<span className="text-body" data-testid="breakdown-manual">
													−{formatAmount(breakdown.manualTotal)}
												</span>
											</div>
											{/* The pool floors at zero but the lines above can go negative; show the clamp so it adds up. */}
											{breakdown.rawLeftover !== distributablePool && (
												<>
													<div className="flex justify-between gap-4 pt-1 border-gray-200 dark:border-gray-700 border-t">
														<span className="text-muted">Subtotal</span>
														<span className="text-body" data-testid="breakdown-raw">
															{formatAmount(breakdown.rawLeftover)}
														</span>
													</div>
													<div className="flex justify-between gap-4">
														<span className="text-muted">Nothing to share out below zero</span>
														<span className="text-body" data-testid="breakdown-clamp">
															+{formatAmount(distributablePool - breakdown.rawLeftover)}
														</span>
													</div>
												</>
											)}
											<div className="flex justify-between gap-4 pt-1 border-gray-200 dark:border-gray-700 border-t font-semibold">
												<span className="text-body">Left over</span>
												<span className="text-body" data-testid="breakdown-leftover">
													{formatAmount(distributablePool)}
												</span>
											</div>
										</div>
									)}
								</div>
							)}
						</div>
					</section>

					<section className="surface shadow-md p-6 rounded-lg">
						<h2 className="mb-6 font-semibold text-subheading text-xl">Your Savings Goals</h2>

						{/* Pending is a third state; the skeleton mirrors the card's box model to avoid a shift. */}
						{!hydrated ? (
							<EmptyStateSkeleton testId="savings-list-skeleton" />
						) : savingsGoals.length === 0 ? (
							<div className="surface-inset p-8 rounded-lg text-center">
								<p className="mb-4 text-muted">No savings goals recorded yet</p>
								<p className="text-faint text-sm">Click "Add Savings Goal" to get started</p>
							</div>
						) : (
							<>
								{/* Drives the same sort slice as the headers, so phone and desktop sorts agree. */}
								<TableSortControl
									label="Sort savings goals and accounts"
									columns={SAVINGS_SORT_COLUMNS}
									state={sort.state}
									onSelect={sort.select}
								/>
								<TableScrollRegion
									label="Savings goals and accounts table"
									className={`${RESPONSIVE_WRAPPER_CLASS} ${RESPONSIVE_SCROLL_SHADOW_CLASS}`}
								>
									<table className={RESPONSIVE_TABLE_CLASS}>
										<thead className={RESPONSIVE_THEAD_CLASS}>
											<tr>
												{/* Header text stays exactly the label; the direction indicator is an aria-hidden svg. */}
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.name}
													ariaSort={sort.ariaSort('name')}
													describedBy={sortA11y.describedBy(sort.ariaSort('name'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('name')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.target}
													ariaSort={sort.ariaSort('target')}
													describedBy={sortA11y.describedBy(sort.ariaSort('target'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('target')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.currentBalance}
													ariaSort={sort.ariaSort('currentBalance')}
													describedBy={sortA11y.describedBy(sort.ariaSort('currentBalance'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('currentBalance')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.monthlyAllocation}
													ariaSort={sort.ariaSort('monthlyAllocation')}
													describedBy={sortA11y.describedBy(sort.ariaSort('monthlyAllocation'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('monthlyAllocation')}
												/>
												<SortableColumnHeader
													label={SORT_COLUMN_LABELS.progress}
													ariaSort={sort.ariaSort('progress')}
													describedBy={sortA11y.describedBy(sort.ariaSort('progress'))}
													onActivate={sortA11y.markActivated}
													onToggle={() => sort.toggle('progress')}
												/>
												{/* No aria-sort at all: `none` would advertise a sortable column. */}
												<th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
											</tr>
										</thead>
										<tbody className={RESPONSIVE_TBODY_CLASS}>
											{sortedRows.map((goal) => {
												// null target means absent progress (not 0%).
												const isAccountRow = goal.targetAmount == null
												const progress = getSavingsProgress(goal.id)
												// Automatic iff the solver placed it in `allocations`; `in` rather than Object.hasOwn for the lib
												// target (uuid ids cannot collide with prototype keys).
												const isAutomatic = goal.id in allocations
												// Clamp a (corrupt-data) negative manual amount to 0 so the row
												// matches the solver, which floors manual allocations at 0.
												const effectiveAllocation = isAutomatic
													? (allocations[goal.id] ?? 0)
													: Math.max(0, goal.monthlyAllocation ?? 0)
												return (
													<tr key={goal.id} className={RESPONSIVE_ROW_CLASS}>
														<td className={RESPONSIVE_STACKED_CELL_CLASS}>
															<FieldLabel>Name</FieldLabel>
															{/* The name gets no RESPONSIVE_AMOUNT_CLASS: free text must keep `anywhere` and wrap. */}
															<div className={RESPONSIVE_VALUE_TAG_CLASS}>
																<span className="font-medium text-heading text-sm">
																	{goal.name}
																</span>
																<span
																	className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium text-xs ${RESPONSIVE_TAG_CLASS} ${
																		isAccountRow
																			? 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200'
																			: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
																	}`}
																	data-testid={`savings-badge-${goal.id}`}
																>
																	{isAccountRow ? 'Account' : 'Goal'}
																</span>
															</div>
														</td>
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Target</FieldLabel>
															<div className={`text-muted text-sm ${RESPONSIVE_AMOUNT_CLASS}`}>
																{goal.targetAmount == null ? (
																	'No target'
																) : (
																	<GroupedAmount text={formatAmount(goal.targetAmount)} />
																)}
															</div>
														</td>
														<td className={RESPONSIVE_CELL_CLASS}>
															<FieldLabel>Current Balance</FieldLabel>
															<div className={`text-muted text-sm ${RESPONSIVE_AMOUNT_CLASS}`}>
																<GroupedAmount text={formatAmount(goal.currentBalance)} />
															</div>
														</td>
														<td className={RESPONSIVE_STACKED_CELL_CLASS}>
															<FieldLabel>Monthly Allocation</FieldLabel>
															<div className={RESPONSIVE_VALUE_TAG_CLASS}>
																<span
																	className={`text-muted text-sm ${RESPONSIVE_AMOUNT_CLASS}`}
																	data-testid={`savings-allocation-${goal.id}`}
																>
																	<GroupedAmount text={formatAmount(effectiveAllocation)} />
																</span>
																<span
																	className={`inline-flex items-center bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full font-medium text-gray-600 dark:text-gray-300 text-xs ${RESPONSIVE_TAG_CLASS}`}
																	data-testid={`savings-allocation-mode-${goal.id}`}
																>
																	{isAutomatic ? 'Auto' : 'Fixed'}
																</span>
															</div>
														</td>
														<td className={RESPONSIVE_STACKED_CELL_CLASS}>
															{/* Stacked: beside its label at 320px the bar would get a ~150px track. */}
															<FieldLabel>Progress</FieldLabel>
															{progress == null ? (
																<div
																	className="text-muted text-sm text-center"
																	data-testid={`savings-progress-na-${goal.id}`}
																>
																	N/A
																</div>
															) : (
																<>
																	<div className="bg-gray-200 dark:bg-gray-700 rounded-full w-full h-2">
																		<div
																			className="bg-purple-600 rounded-full h-2"
																			style={{ width: `${progress}%` }}
																		/>
																	</div>
																	<div className="mt-1 text-muted text-xs text-center">
																		{progress}%
																	</div>
																</>
															)}
														</td>
														<td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
															<FieldLabel>Actions</FieldLabel>
															{/* p-1 is the desktop tap target (see RESPONSIVE_ACTION_BUTTON_CLASS). */}
															<div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
																<button
																	type="button"
																	onClick={() => openEditModal(goal)}
																	aria-label={`Edit ${goal.name}`}
																	className={`mr-4 p-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
																>
																	<PencilIcon className="h-5 w-5" />
																</button>
																<button
																	type="button"
																	onClick={() => handleDelete(goal.id)}
																	aria-label={`Delete ${goal.name}`}
																	className={`p-1 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
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
					</section>
				</main>

				<Modal isOpen={isModalOpen} onClose={closeModal} labelledBy="savings-modal-title">
					<div className="flex justify-between items-center mb-6">
						<h3 id="savings-modal-title" className="font-medium text-heading text-lg">
							{editingId !== null ? 'Edit Savings Goal' : 'Add Savings Goal'}
						</h3>
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
					</div>

					<form onSubmit={handleSubmit} className="space-y-4" noValidate>
						<div>
							<label htmlFor="name" className="block mb-1 font-medium text-label text-sm">
								Name *
							</label>
							<input
								type="text"
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g., Emergency Fund, Vacation, New Car"
								className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
									hasFieldError('name')
										? 'border-red-500 focus:ring-red-500 focus:border-red-500'
										: 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
								}`}
								aria-invalid={hasFieldError('name')}
								aria-required
								aria-describedby={hasFieldError('name') ? 'savings-name-error' : undefined}
								data-testid="savings-name-input"
							/>
							{hasFieldError('name') && (
								<p
									id="savings-name-error"
									className="mt-1 text-red-600 dark:text-red-400 text-sm"
									role="alert"
									data-testid="savings-name-error"
								>
									{getFieldError('name')}
								</p>
							)}
						</div>

						<div className="flex items-start gap-2">
							<input
								type="checkbox"
								id="isAccount"
								checked={isAccount}
								onChange={(e) => setIsAccount(e.target.checked)}
								className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-2 focus:ring-purple-500"
								data-testid="savings-is-account-toggle"
							/>
							<label htmlFor="isAccount" className="text-label text-sm">
								This is just an account balance (no target)
							</label>
						</div>

						{!isAccount && (
							<div>
								<label htmlFor="targetAmount" className="block mb-1 font-medium text-label text-sm">
									Target Amount *
								</label>
								<div className="relative shadow-sm rounded-md">
									{mode === 'symbol' && (
										<div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
											<span className="text-muted text-sm">{currencySymbol(currency)}</span>
										</div>
									)}
									<input
										type="text"
										inputMode="decimal"
										id="targetAmount"
										value={targetAmount}
										onChange={(e) => setTargetAmount(sanitizeMoneyChange(e.target, locale))}
										onBlur={(e) => reformatAmountOnBlur(e.target.value, locale, setTargetAmount)}
										placeholder="0.00"
										className={`w-full px-3 py-2 ${
											mode === 'symbol' ? 'pl-7' : ''
										} border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
											hasFieldError('targetAmount')
												? 'border-red-500 focus:ring-red-500 focus:border-red-500'
												: 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
										}`}
										aria-invalid={hasFieldError('targetAmount')}
										aria-required
										aria-describedby={
											hasFieldError('targetAmount') ? 'savings-target-amount-error' : undefined
										}
										data-testid="savings-target-amount-input"
									/>
								</div>
								{hasFieldError('targetAmount') && (
									<p
										id="savings-target-amount-error"
										className="mt-1 text-red-600 dark:text-red-400 text-sm"
										role="alert"
										data-testid="savings-target-amount-error"
									>
										{getFieldError('targetAmount')}
									</p>
								)}
							</div>
						)}

						<div>
							<label htmlFor="currentBalance" className="block mb-1 font-medium text-label text-sm">
								Current Balance
							</label>
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
									className={`w-full px-3 py-2 ${
										mode === 'symbol' ? 'pl-7' : ''
									} border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
										hasFieldError('currentBalance')
											? 'border-red-500 focus:ring-red-500 focus:border-red-500'
											: 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
									}`}
									aria-invalid={hasFieldError('currentBalance')}
									aria-describedby={
										hasFieldError('currentBalance') ? 'savings-current-balance-error' : undefined
									}
									data-testid="savings-current-balance-input"
								/>
							</div>
							{hasFieldError('currentBalance') && (
								<p
									id="savings-current-balance-error"
									className="mt-1 text-red-600 dark:text-red-400 text-sm"
									role="alert"
									data-testid="savings-current-balance-error"
								>
									{getFieldError('currentBalance')}
								</p>
							)}
						</div>

						{/* Rendered for every entry; the account tick affects only the Target field. */}
						<div>
							<label htmlFor="allocationMode" className="block mb-1 font-medium text-label text-sm">
								Monthly Allocation
							</label>
							<select
								id="allocationMode"
								value={allocationMode}
								onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
								className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-gray-100"
								data-testid="savings-allocation-mode-select"
							>
								<option value="automatic">Automatic (even share of leftover funds)</option>
								<option value="manual">Manual (a fixed amount each month)</option>
							</select>
							<p className="mt-1 text-faint text-xs">
								{allocationMode === 'automatic'
									? 'This entry receives an even share of whatever is left over each month.'
									: 'This entry gets the fixed amount you set below each month.'}
							</p>
						</div>

						{allocationMode === 'manual' && (
							<div>
								<label
									htmlFor="monthlyAllocation"
									className="block mb-1 font-medium text-label text-sm"
								>
									Monthly Allocation Amount
								</label>
								<div className="relative shadow-sm rounded-md">
									{mode === 'symbol' && (
										<div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
											<span className="text-muted text-sm">{currencySymbol(currency)}</span>
										</div>
									)}
									<input
										type="text"
										inputMode="decimal"
										id="monthlyAllocation"
										value={monthlyAllocation}
										onChange={(e) => setMonthlyAllocation(sanitizeMoneyChange(e.target, locale))}
										onBlur={(e) =>
											reformatAmountOnBlur(e.target.value, locale, setMonthlyAllocation)
										}
										placeholder="0.00"
										className={`w-full px-3 py-2 ${
											mode === 'symbol' ? 'pl-7' : ''
										} border rounded-md shadow-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
											hasFieldError('monthlyAllocation')
												? 'border-red-500 focus:ring-red-500 focus:border-red-500'
												: 'border-gray-300 dark:border-gray-600 focus:ring-purple-500 focus:border-purple-500'
										}`}
										aria-invalid={hasFieldError('monthlyAllocation')}
										aria-describedby={
											hasFieldError('monthlyAllocation')
												? 'savings-monthly-allocation-error'
												: undefined
										}
										data-testid="savings-monthly-allocation-input"
									/>
								</div>
								{hasFieldError('monthlyAllocation') && (
									<p
										id="savings-monthly-allocation-error"
										className="mt-1 text-red-600 dark:text-red-400 text-sm"
										role="alert"
										data-testid="savings-monthly-allocation-error"
									>
										{getFieldError('monthlyAllocation')}
									</p>
								)}
							</div>
						)}

						<div className="flex justify-end gap-3 pt-4">
							<button
								type="button"
								onClick={closeModal}
								className="hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={isSubmitting}
								className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-md text-white disabled:cursor-not-allowed"
							>
								{isSubmitting
									? 'Saving...'
									: editingId !== null
										? 'Save Changes'
										: 'Add Savings Goal'}
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
							{pendingDeleteName ? ` "${pendingDeleteName}"` : ' this savings goal'}? This cannot be
							undone.
						</>
					}
				/>
			</div>
		</div>
	)
}
