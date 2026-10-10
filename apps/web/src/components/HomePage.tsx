import { calculateNetIncomeResult } from '@budget-planner/core/finance/netIncome'
import {
	denormalizeFromMonthly,
	normalizeToMonthly,
} from '@budget-planner/core/finance/normalization'
import type {
	FinancialDataPoint,
	RechartsDataItem,
} from '@budget-planner/core/finance/visualization'
import {
	aggregateByCategoryAndType,
	generateColorMap,
	toPieChartData,
} from '@budget-planner/core/finance/visualization'
import { debtOwedCents } from '@budget-planner/core/services/balanceTracking'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { resolveCategoryLabel, useCategoryNameMap } from '../hooks/useCategoryLabels'
import { useIsInitialSyncPending } from '../hooks/useIsInitialSyncPending'
import { useNetWorth } from '../hooks/useNetWorth'
import { useSessionSeed } from '../hooks/useSessionSeed'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { buildBalancesBarData } from '../lib/balances-bar-data'
import { barDomainTicks } from '../lib/chart-axis'
import { OVERVIEW_SECTIONS_PENDING_HOOK } from '../lib/overview/no-flash-overview-data-script'
import { formatSharePercent } from '../lib/percent-text'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../lib/premium/benefits'
import { isEntitledSeed } from '../lib/premium/entitlement'
import { useVerifiedSession } from '../lib/session/verifiedSession'
import { useBalanceEntries } from '../stores/balanceStore'
import { useFormattedAmount } from '../stores/currencyStore'
import { useExpenses } from '../stores/expenseStore'
import { useIncomeSources } from '../stores/incomeStore'
import {
	DURATION_LABEL,
	DURATION_OPTION_LABEL,
	IS_NON_INTEGRAL_CADENCE,
	type OverviewDuration,
	useOverviewDuration,
	useSetOverviewDuration,
	VALID_DURATIONS,
} from '../stores/overviewDurationStore'
import { useSavingsGoals } from '../stores/savingsStore'
import { BreakdownPie } from './home-page/BreakdownPie'
import { CategoriesFeatureLabel } from './home-page/CategoriesFeatureLabel'
import { CategoryBarChart } from './home-page/CategoryBarChart'
import { CustomProfilesFeatureLabel } from './home-page/CustomProfilesFeatureLabel'
import { LockedTileContent } from './home-page/LockedTileContent'
import { MultiDeviceSyncLabel } from './home-page/MultiDeviceSyncLabel'
import { PremiumFeatureLabel } from './home-page/PremiumFeatureLabel'
import { ReportFeatureLabel } from './home-page/ReportFeatureLabel'
import { useChartsChunkReady } from './home-page/useChartsChunkReady'
import { AccountNoticeBox } from './overview/AccountNoticeBox'
import { PremiumFeatureGate } from './premium/PremiumFeatureGate'
import { Card } from './ui/Card'
import { CardHeader } from './ui/CardHeader'
import { CardTitle } from './ui/CardTitle'
import { GroupedAmount } from './ui/GroupedAmount'
import { InfoTooltip } from './ui/InfoTooltip'
import { LoadingStatus } from './ui/LoadingStatus'
import { Page } from './ui/Page'
import { PageContent } from './ui/PageContent'
import { PageHeader } from './ui/PageHeader'
import { PageTitle } from './ui/PageTitle'
import { PendingFigure } from './ui/PendingFigure'
import { SkeletonBlock } from './ui/SkeletonBlock'
import { SKELETON_BAR } from './ui/skeleton-classes'

const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'
// Amber stays distinguishable from the blue and violet asset bars under common colour-blindness.
const ASSET_COLOR = '#D97706'
// Not DEFAULT_COLORS.income: it equals CATEGORY_COLORS[1] and collided with the first expense slice.
const REMAINING_INCOME_COLOR = '#9CA3AF'

export function HomePage() {
	// Seed read once as an initializer, then follows the last definitive /api/auth/me answer. Fails OPEN, unlike
	// GlobalNav, on purpose: failing closed would leave a paid user with neither nav entries nor these cards.
	const sessionSeed = useSessionSeed()
	const [seedReachesPremium] = useState(() => isEntitledSeed(sessionSeed))
	const verifiedSession = useVerifiedSession()
	const reachesPremiumFromNav =
		verifiedSession === undefined ? seedReachesPremium : isEntitledSeed(verifiedSession)
	// Any signed-in session skips the visitor notice, free tier included.
	const [isSignedIn] = useState(() => sessionSeed?.isAuthenticated === true)

	const incomeSources = useIncomeSources()
	const expenses = useExpenses()
	// Both pies group by resolved category name; a raw categoryId would leak a uuid into the tooltip and list.
	const categoryNames = useCategoryNameMap()
	const savingsGoals = useSavingsGoals()
	const balanceEntries = useBalanceEntries()

	const formatAmount = useFormattedAmount()

	const netIncomeResult = calculateNetIncomeResult(
		incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
		expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
	)

	const totalNormalizedIncome = netIncomeResult.grossIncome
	const totalNormalizedExpenses = netIncomeResult.totalExpenses

	const duration = useOverviewDuration()
	const setDuration = useSetOverviewDuration()
	const incomeForDuration = denormalizeFromMonthly(totalNormalizedIncome, duration)
	const expensesForDuration = denormalizeFromMonthly(totalNormalizedExpenses, duration)

	const totalIncomeRaw = incomeSources.reduce((sum, source) => sum + source.amount, 0)
	const totalExpensesRaw = expenses.reduce((sum, expense) => sum + expense.amount, 0)
	// Gate on whether conversion happened, not on normalized !== raw: mixed cadences can normalize to the raw sum.
	const incomeConversionApplied = incomeSources.some((source) => source.frequency !== 'monthly')
	const expensesConversionApplied = expenses.some((expense) => expense.frequency !== 'monthly')
	const totalSavings = savingsGoals.reduce((sum, goal) => sum + goal.currentBalance, 0)
	const totalInvestments = balanceEntries
		.filter((entry) => entry.type === 'investment')
		.reduce((sum, entry) => sum + entry.currentBalance, 0)
	// A debt reads as the amount owed, as useTotalDebtBalance does, so legacy negative rows agree with Net Worth.
	const totalDebts = balanceEntries
		.filter((entry) => entry.type === 'debt')
		.reduce((sum, entry) => sum + debtOwedCents(entry.currentBalance), 0)
	// A second copy of the balance store's selectors (the chart needs components, not the net): a new balance type
	// must be added here too, or Net Worth and this chart disagree.
	const totalAssets = balanceEntries
		.filter((entry) => entry.type === 'asset')
		.reduce((sum, entry) => sum + entry.currentBalance, 0)
	const netWorth = useNetWorth()

	const hasData =
		incomeSources.length > 0 ||
		expenses.length > 0 ||
		savingsGoals.length > 0 ||
		balanceEntries.length > 0

	// The stores have not rehydrated on the server or during hydration, so hasData is false for everyone:
	// three states (pending, with data, empty), not two.
	const storesHydrated = useStoresHydrated()
	const isInitialSyncPending = useIsInitialSyncPending(!hasData)
	const hydrated = storesHydrated && !isInitialSyncPending
	const chartsReady = useChartsChunkReady()

	// The shared overview duration store, on purpose: separate state showed the same expenses 12x apart on one screen.

	const financialData = useMemo<FinancialDataPoint[]>(() => {
		const data: FinancialDataPoint[] = []

		for (const source of incomeSources) {
			if (
				!source?.id ||
				!source?.name ||
				typeof source?.amount !== 'number' ||
				!Number.isFinite(source?.amount) ||
				!source?.frequency
			) {
				console.warn('Invalid income source, skipping:', source)
				continue
			}
			const sourceDate = source.createdAt ? new Date(source.createdAt) : undefined

			data.push({
				id: source.id,
				name: source.name,
				amount: source.amount,
				frequency: source.frequency,
				category: resolveCategoryLabel(source.categoryId, source.name, categoryNames),
				type: 'income' as const,
				date: sourceDate,
			})
		}

		for (const expense of expenses) {
			if (
				!expense?.id ||
				!expense?.name ||
				typeof expense?.amount !== 'number' ||
				!Number.isFinite(expense?.amount) ||
				!expense?.frequency
			) {
				console.warn('Invalid expense, skipping:', expense)
				continue
			}
			const expenseDate = expense.createdAt ? new Date(expense.createdAt) : undefined

			data.push({
				id: expense.id,
				name: expense.name,
				amount: expense.amount,
				frequency: expense.frequency,
				category: resolveCategoryLabel(expense.categoryId, expense.name, categoryNames),
				type: 'expense' as const,
				date: expenseDate,
			})
		}

		return data
		// `categoryNames` is needed here, or a rename leaves both pies on the stale label.
	}, [incomeSources, expenses, categoryNames])

	// Scale each entry to the period before aggregating, unconditionally (monthly is ×1).
	const periodScaledData = useMemo<FinancialDataPoint[]>(
		() =>
			financialData.map((point) => {
				const monthly = normalizeToMonthly(point.amount, point.frequency)
				return { ...point, amount: denormalizeFromMonthly(monthly, duration) }
			}),
		[financialData, duration]
	)

	const aggregatedData = useMemo(() => {
		return aggregateByCategoryAndType(periodScaledData)
	}, [periodScaledData])

	const categoryColors = useMemo(() => {
		const allCategories = [
			...(aggregatedData.get('income') || []).map((d) => d.category),
			...(aggregatedData.get('expense') || []).map((d) => d.category),
		]
		return generateColorMap(allCategories)
	}, [aggregatedData])

	const incomeData = useMemo(() => {
		return toPieChartData(aggregatedData.get('income') || [], categoryColors)
	}, [aggregatedData, categoryColors])

	const expenseData = useMemo(() => {
		return toPieChartData(aggregatedData.get('expense') || [], categoryColors)
	}, [aggregatedData, categoryColors])

	const totalIncomeChart = useMemo(
		() => incomeData.reduce((sum, item) => sum + item.value, 0),
		[incomeData]
	)
	const totalExpenseChart = useMemo(
		() => expenseData.reduce((sum, item) => sum + item.value, 0),
		[expenseData]
	)

	// Same expense slices as the right pie, but against INCOME: a "Remaining income" filler completes the circle,
	// omitted once expenses reach income.
	const expenseRatioData = useMemo<RechartsDataItem[]>(() => {
		if (incomeData.length === 0) {
			return []
		}
		const remaining = totalIncomeChart - totalExpenseChart
		if (remaining <= 0) {
			return expenseData
		}
		return [
			...expenseData,
			{
				name: 'Remaining income',
				value: remaining,
				type: 'income',
				fill: REMAINING_INCOME_COLOR,
			},
		]
	}, [incomeData, expenseData, totalIncomeChart, totalExpenseChart])

	// Not capped at 100: an overspend should read e.g. 132%.
	const expenseRatioHeadline = useMemo(() => {
		if (totalIncomeChart <= 0) {
			return '—'
		}
		return formatSharePercent(totalExpenseChart, totalIncomeChart)
	}, [totalIncomeChart, totalExpenseChart])

	const formatExpenseRatioLegendValue = useCallback(
		(cents: number) => {
			if (totalIncomeChart <= 0) {
				return '—'
			}
			return formatSharePercent(cents, totalIncomeChart)
		},
		[totalIncomeChart]
	)

	// Recharts sizes wedges against sum(data), not `total`: during an overspend the wedges show share of expenses
	// while the legend shows share of income, which the note discloses.
	const expenseRatioIsOverspend = totalIncomeChart > 0 && totalExpenseChart > totalIncomeChart
	const expenseRatioOverspendNote = expenseRatioIsOverspend
		? "Expenses exceed income this period, so the wedges below show each category's share of total spending (not of income) — the percentages next to each category are still its true share of income."
		: undefined

	// Per-entry rounding can only diverge on a side with 2+ entries: it happens per entry, before the category
	// merge, so a single entry rounds identically on both surfaces.
	const breakdownCanDiverge = useMemo(() => {
		let incomeEntries = 0
		let expenseEntries = 0
		for (const point of financialData) {
			if (point.type === 'income') incomeEntries++
			else expenseEntries++
		}
		return incomeEntries >= 2 || expenseEntries >= 2
	}, [financialData])

	// Flows and balances get separate charts and axes so a large annual flow cannot crush the balance bars.
	const flowsBarData = [
		{
			category: `Income ${DURATION_LABEL[duration]}`,
			amount: incomeForDuration,
			fill: INCOME_COLOR,
		},
		{
			category: `Expenses ${DURATION_LABEL[duration]}`,
			amount: -expensesForDuration,
			fill: EXPENSE_COLOR,
		},
	].filter((item) => item.amount !== 0)

	const balancesBarData = buildBalancesBarData(
		{
			savingsCents: totalSavings,
			investmentsCents: totalInvestments,
			assetsCents: totalAssets,
			debtsCents: totalDebts,
		},
		{
			savings: SAVINGS_COLOR,
			investment: INVESTMENT_COLOR,
			asset: ASSET_COLOR,
			debt: DEBT_COLOR,
		}
	)

	const flowsBarTicks = barDomainTicks(flowsBarData.map((d) => d.amount))
	const balancesBarTicks = barDomainTicks(balancesBarData.map((d) => d.amount))

	return (
		<Page>
			<PageContent className="max-w-6xl">
				{/* One announced region for the whole page; every skeleton below is aria-hidden. */}
				{!hydrated && <LoadingStatus />}
				<PageHeader>
					<div>
						<PageTitle>Longhand Budget</PageTitle>
						{/* No trailing period: byte-identical to the login page subtitle. */}
						<p className="text-lg text-body mt-2">Track your finances with privacy and control</p>
						{/* Visitors only; the gate lives here so AccountNoticeBox stays auth-blind. */}
						{!isSignedIn && <AccountNoticeBox />}
					</div>
				</PageHeader>

				<main className="space-y-6">
					<Card as="section">
						<CardHeader className="mb-4 flex-wrap gap-2">
							<CardTitle className="text-xl">Financial Overview</CardTitle>
							<label className="flex items-center gap-1 text-sm text-label">
								<span className="sr-only">Show income and expenses per</span>
								<select
									aria-label="Show income and expenses per"
									value={duration}
									onChange={(e) => setDuration(e.target.value as OverviewDuration)}
									className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
								>
									{VALID_DURATIONS.map((value) => (
										<option key={value} value={value}>
											{DURATION_OPTION_LABEL[value]}
										</option>
									))}
								</select>
							</label>
						</CardHeader>
						<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
							<Card variant="inset" className="p-4">
								<p className="flex items-center gap-1 text-sm text-muted">
									{`Total Income ${DURATION_LABEL[duration]}`}
									{incomeConversionApplied && (
										<InfoTooltip
											label="More information about the income figure"
											text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
												totalIncomeRaw
											)}.`}
										/>
									)}
								</p>
								{/* testid, not accessible name: a label wrapping InfoTooltip resolves differently in jsdom and Chromium. */}
								<p
									data-testid="overview-total-income"
									className="text-2xl font-bold text-green-600 dark:text-green-400"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(incomeForDuration)} />
									) : (
										<PendingFigure testId="overview-total-income-skeleton" />
									)}
								</p>
							</Card>
							<Card variant="inset" className="p-4">
								<p className="flex items-center gap-1 text-sm text-muted">
									{`Total Expenses ${DURATION_LABEL[duration]}`}
									{expensesConversionApplied && (
										<InfoTooltip
											label="More information about the expenses figure"
											text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
												totalExpensesRaw
											)}.`}
										/>
									)}
								</p>
								<p
									data-testid="overview-total-expenses"
									className="text-2xl font-bold text-red-600 dark:text-red-400"
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(expensesForDuration)} />
									) : (
										<PendingFigure testId="overview-total-expenses-skeleton" />
									)}
								</p>
							</Card>
							<Card variant="inset" className="p-4">
								<p className="flex items-center gap-1 text-sm text-muted">
									Net Worth
									<InfoTooltip
										label="More information about net worth"
										text="Net worth is what you own minus what you owe: your investments, savings, and anything you own outright, minus your debts. Investments, assets and debts are tracked on the Balance Tracking page, savings on the Savings page. Income and expenses aren't counted here."
									/>
								</p>
								<p
									data-testid="overview-net-worth"
									className={cn(
										'text-2xl font-bold',
										netWorth >= 0
											? 'text-purple-600 dark:text-purple-400'
											: 'text-red-600 dark:text-red-400'
									)}
								>
									{hydrated ? (
										<GroupedAmount text={formatAmount(netWorth)} />
									) : (
										<PendingFigure testId="overview-net-worth-skeleton" />
									)}
								</p>
								{/* Savings count toward net worth, so both lists must be empty for this hint. */}
								{hasData && balanceEntries.length === 0 && savingsGoals.length === 0 && (
									<p className="mt-1 text-xs text-faint" data-testid="net-worth-empty-hint">
										Add investments or debts on the{' '}
										<a
											href="/balance"
											className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
										>
											Balance Tracking
										</a>{' '}
										page, or savings on the{' '}
										<a
											href="/savings"
											className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
										>
											Savings
										</a>{' '}
										page, to track this.
									</p>
								)}
							</Card>
						</div>
					</Card>

					{/* The pending branch mirrors the resolved-empty card's box model so an empty user sees no shift. No animate-pulse
             on the bars: the wrapping SkeletonBlock pulses, and nesting puts the two out of phase. */}
					{!hydrated ? (
						<SkeletonBlock
							className="surface rounded-lg shadow-md p-4 sm:p-6"
							testId="overview-sections-skeleton"
							hook={OVERVIEW_SECTIONS_PENDING_HOOK}
						>
							<Card variant="inset" className="p-6 sm:p-8 text-center">
								<p className="mb-1 text-lg font-medium">
									<span
										className={cn(
											SKELETON_BAR,
											'inline-block h-[1em] w-56 max-w-full align-middle'
										)}
									/>
								</p>
								<p className="mb-6 text-sm">
									<span
										className={cn(
											SKELETON_BAR,
											'inline-block h-[1em] w-80 max-w-full align-middle'
										)}
									/>
								</p>
								{/* `h-6`, not `h-[1em]`: an inline-flex button has no line-box strut, so 1em made it 8px short.
                   Transparent border because the resolved link is bordered. */}
								<div className="flex flex-wrap items-center justify-center gap-3">
									<span className="inline-flex items-center rounded-md px-4 py-2 font-medium">
										<span className={cn(SKELETON_BAR, 'inline-block h-6 w-24 align-middle')} />
									</span>
									<span className="inline-flex items-center rounded-md border border-transparent px-4 py-2 font-medium">
										<span className={cn(SKELETON_BAR, 'inline-block h-6 w-28 align-middle')} />
									</span>
								</div>
							</Card>
						</SkeletonBlock>
					) : hasData ? (
						<>
							<Card as="section" aria-busy={!chartsReady}>
								<CardHeader className="mb-4 flex-wrap gap-2">
									<CardTitle className="text-xl">Income vs Expense Breakdown</CardTitle>
									<label className="flex items-center gap-1 text-sm text-label">
										<span className="sr-only">Show breakdown per</span>
										<select
											aria-label="Show breakdown per"
											value={duration}
											onChange={(e) => setDuration(e.target.value as OverviewDuration)}
											className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
										>
											{VALID_DURATIONS.map((value) => (
												<option key={value} value={value}>
													{DURATION_OPTION_LABEL[value]}
												</option>
											))}
										</select>
									</label>
								</CardHeader>

								{/* Only non-integral periods (weekly, biweekly) can make per-entry scaling differ from the cards by a cent.
                   The copy says ENTRY, not category: these pies round per entry, unlike /categories. */}
								{IS_NON_INTEGRAL_CADENCE[duration] && breakdownCanDiverge ? (
									<p className="mb-4 text-xs text-muted" data-testid="breakdown-pies-rounding-note">
										Each entry is rounded on its own as it is converted, so at this view these
										figures can differ from the totals above by about half a cent per entry.
									</p>
								) : null}

								<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
									<BreakdownPie
										testId="expense-ratio"
										title={`Expenses as % of income ${DURATION_LABEL[duration]}`}
										data={expenseRatioData}
										total={totalIncomeChart}
										totalDisplay={expenseRatioHeadline}
										note={expenseRatioOverspendNote}
										emptyLabel="No income to compare against yet"
										accentClass="text-red-600 dark:text-red-400"
										legendValue={formatExpenseRatioLegendValue}
									/>
									<BreakdownPie
										testId="expense"
										title={`Expenses by category ${DURATION_LABEL[duration]}`}
										data={expenseData}
										total={totalExpenseChart}
										emptyLabel="No expenses to break down yet"
										accentClass="text-red-600 dark:text-red-400"
									/>
								</div>
							</Card>

							<Card as="section" aria-busy={!chartsReady}>
								<CardTitle className="text-xl mb-4">Financial Category Summary</CardTitle>
								{flowsBarData.length > 0 || balancesBarData.length > 0 ? (
									<div className="space-y-8">
										{flowsBarData.length > 0 && (
											<div>
												<CardTitle as="h3" className="text-sm text-label mb-2">
													Income &amp; expenses {DURATION_LABEL[duration]}
												</CardTitle>
												<CategoryBarChart
													testId="category-bar-flows"
													data={flowsBarData}
													ticks={flowsBarTicks}
													hiddenFromScreenReaders
												/>
											</div>
										)}
										{balancesBarData.length > 0 && (
											<div>
												<CardTitle as="h3" className="text-sm text-label mb-2">
													Balances
												</CardTitle>
												<CategoryBarChart
													testId="category-bar-balances"
													data={balancesBarData}
													ticks={balancesBarTicks}
												/>
											</div>
										)}
									</div>
								) : (
									<Card variant="inset" className="p-8 text-center">
										<p className="text-muted">No financial data to display</p>
									</Card>
								)}
							</Card>
						</>
					) : (
						<Card as="section" className="p-4 sm:p-6" data-testid="overview-onboarding">
							<Card variant="inset" className="p-6 sm:p-8 text-center">
								<p className="mb-1 text-lg font-medium text-subheading">Let's set up your budget</p>
								<p className="mb-6 text-sm text-muted">
									Add your income and expenses and your financial overview will appear here.
								</p>
								<div className="flex flex-wrap items-center justify-center gap-3">
									<a
										href="/income"
										className="inline-flex items-center fill-green rounded-md px-4 py-2 font-medium transition-colors hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
									>
										+ Add income
									</a>
									<a
										href="/expenses"
										className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
									>
										+ Add expense
									</a>
								</div>
							</Card>
						</Card>
					)}

					{!reachesPremiumFromNav && (
						<Card as="section" className="p-4 sm:p-6">
							<CardTitle className="text-xl mb-4">Premium Features</CardTitle>

							{/* Sync has no route, so it opens the upgrade dialog without an href.
                 Each gate needs its own wrapper div: Modal renders without a portal. */}
							<div className="space-y-3">
								{PREMIUM_BENEFIT_IDS.map((id) => {
									const benefit = OVERVIEW_BENEFITS[id]
									const Label = benefit.label

									// Renders no lock badge, unlike every other benefit: whoever adds the first 'none' benefit must decide
									// where its tier signal comes from.
									if (benefit.activation === 'none') {
										return (
											<div
												key={id}
												className={cn(PREMIUM_BOX_BASE, 'surface-inset')}
												data-testid={`premium-benefit-${id}`}
											>
												<LockedTileContent label={<Label />} chevronHidden />
											</div>
										)
									}

									if (benefit.activation === 'prompt') {
										return (
											<div key={id} data-testid={`premium-benefit-${id}`}>
												<PremiumFeatureGate
													featureName={benefit.featureName}
													className={PREMIUM_BOX_INTERACTIVE}
													locked={<LockedTileContent label={<Label />} />}
												>
													<div className={cn(PREMIUM_BOX_BASE, 'surface-inset')}>
														<LockedTileContent label={<Label />} chevronHidden />
													</div>
												</PremiumFeatureGate>
											</div>
										)
									}

									return (
										<div key={id}>
											<PremiumFeatureGate
												featureName={benefit.featureName}
												className={PREMIUM_BOX_INTERACTIVE}
												locked={<LockedTileContent label={<Label />} />}
											>
												<a href={benefit.href} className={PREMIUM_BOX_INTERACTIVE}>
													<Label />
													<span className="text-sm font-medium text-accent whitespace-nowrap">
														Open →
													</span>
												</a>
											</PremiumFeatureGate>
										</div>
									)
								})}
							</div>
						</Card>
					)}
				</main>
			</PageContent>
		</Page>
	)
}

// Colour-free: add exactly one background token. surface-inset and surface-interactive both live in
// @layer components, so declaration order in global.css, not className order, decides the winner.
const PREMIUM_BOX_BASE =
	'flex w-full items-center justify-between gap-3 rounded-md border border-default px-4 py-3'

// The forced-colors outline is needed because ring-* is a box-shadow, which Windows High Contrast discards.
const PREMIUM_BOX_INTERACTIVE = `${PREMIUM_BOX_BASE} surface-interactive text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2`

// 'none' has no members but is kept so a new benefit must answer premium, activatable and opens-a-page separately.
type OverviewBenefit =
	| { activation: 'none'; label: () => React.ReactElement }
	| {
			activation: 'prompt'
			label: () => React.ReactElement
			featureName: string
	  }
	| {
			activation: 'route'
			label: () => React.ReactElement
			href: string
			featureName: string
	  }

// A Record, so a missing or invented benefit is a compile error.
export const OVERVIEW_BENEFITS: Record<PremiumBenefitId, OverviewBenefit> = {
	sync: { activation: 'prompt', label: MultiDeviceSyncLabel, featureName: 'Multi-device sync' },
	forecasting: {
		activation: 'route',
		label: PremiumFeatureLabel,
		href: '/forecasting',
		featureName: 'Advanced Forecasting',
	},
	profiles: {
		activation: 'route',
		label: CustomProfilesFeatureLabel,
		href: '/profiles',
		featureName: 'Custom Profiles',
	},
	report: {
		activation: 'route',
		label: ReportFeatureLabel,
		href: '/financial-summary',
		featureName: 'Financial Summary Report',
	},
	categories: {
		activation: 'route',
		label: CategoriesFeatureLabel,
		href: '/categories',
		featureName: 'Custom Categories',
	},
}
