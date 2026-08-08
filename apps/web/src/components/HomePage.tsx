import {
  calculateNetIncomeResult,
  denormalizeFromMonthly,
  normalizeToMonthly,
} from '@budget-planner/core/finance'
import {
  CATEGORY_COLORS,
  aggregateByCategoryAndType,
  generateColorMap,
  toPieChartData,
} from '@budget-planner/core/finance/visualization'
import type {
  FinancialDataPoint,
  RechartsDataItem,
} from '@budget-planner/core/finance/visualization'
import React, { useState, useMemo, useId, useRef, useEffect } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { barDomainTicks, categoryChartHeight, formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { useBalanceEntries, useExpenses, useIncomeSources, useSavingsGoals } from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import {
  type OverviewDuration,
  useOverviewDuration,
  useSetOverviewDuration,
} from '../stores/overviewDurationStore'
import { ErrorBoundary } from './ErrorBoundary'
import { PremiumFeatureGate } from './premium'

// Card-label suffix for the selected overview duration (story 12-2). "monthly"
// keeps the original "(per month)" copy so the surviving cards read naturally at
// every duration.
const DURATION_LABEL: Record<OverviewDuration, string> = {
  weekly: '(per week)',
  monthly: '(per month)',
  annually: '(per year)',
}

// Colors for the charts
const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'

export function HomePage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  const savingsGoals = useSavingsGoals()
  const balanceEntries = useBalanceEntries()

  // Use currency formatting from store (respects user preferences)
  const formatAmount = useFormattedAmount()
  // Currency mode/symbol for the compact bar-chart axis ticks (formatAmount
  // always carries cents, which the narrow value axis has no room for).
  const { mode, currency } = useCurrencyPreferences()

  // Below Tailwind `sm` (≤639px) charts must drop their desktop-width chrome
  // (vertical right legend, wide Y-axis) so the plot area stays usable at 320px.
  const isNarrowViewport = useIsNarrowViewport()

  // Theme-aware Recharts chrome (axis/grid/tooltip) for the summary bar chart so
  // it stays legible on the dark `.surface` card (story 11-2 / 12-4 AC-2).
  const chartColors = useChartColors()

  // Calculate normalized totals for consistent monthly comparison
  // This ensures income and expenses with different frequencies are comparable
  const netIncomeResult = calculateNetIncomeResult(
    incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
    expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
  )

  const totalNormalizedIncome = netIncomeResult.grossIncome
  const totalNormalizedExpenses = netIncomeResult.totalExpenses

  // Global duration selector (story 12-2, FR31). One control, persisted in its
  // own store, drives BOTH the Total Income and Total Expenses cards — no
  // per-card duplication. Values are stored monthly-normalized; we re-express
  // them at the chosen duration via the core denormalizer (annually ×12, weekly
  // ÷(52/12)), reusing the frequency engine rather than re-deriving factors.
  // Amounts stay in cents, so `formatAmount` (currency mode/locale) is unchanged.
  const duration = useOverviewDuration()
  const setDuration = useSetOverviewDuration()
  const incomeForDuration = denormalizeFromMonthly(totalNormalizedIncome, duration)
  const expensesForDuration = denormalizeFromMonthly(totalNormalizedExpenses, duration)

  // Calculate totals for non-normalized display (raw amounts)
  const totalIncomeRaw = incomeSources.reduce((sum, source) => sum + source.amount, 0)
  const totalExpensesRaw = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const totalSavings = savingsGoals.reduce((sum, goal) => sum + goal.currentBalance, 0)
  const totalInvestments = balanceEntries
    .filter((entry) => entry.type === 'investment')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const totalDebts = balanceEntries
    .filter((entry) => entry.type === 'debt')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const netWorth = totalInvestments - totalDebts

  // Check if we have any data worth showing the dashboard for. Includes balances
  // (savings/investments/debts), not just income/expense flows (story UX-2): a
  // user who tracks only balances should reach the "Balances" sub-chart of the
  // Financial Category Summary rather than the onboarding screen. The two
  // Income/Expense breakdown pies handle their own empty state (`emptyLabel`), so
  // a flows-less user sees empty-pie placeholders + the balances chart.
  const hasData =
    incomeSources.length > 0 ||
    expenses.length > 0 ||
    savingsGoals.length > 0 ||
    balanceEntries.length > 0

  // ============================================================================
  // Enhanced Visualization State (Story 3-3, simplified in 12-3)
  // ============================================================================

  // Income vs Expense Breakdown cadence (story 12-3). Replaces the old six
  // date-range presets with a plain Monthly/Annually toggle, defaulting to
  // Annually (UX-DR20). Unlike the overview duration selector (12-2) this control
  // has NO persistence AC and is independent of it, so component-local state is
  // correct and simplest — do not reuse overviewDurationStore.
  const [chartPeriod, setChartPeriod] = useState<'monthly' | 'annually'>('annually')

  // Convert stores data to FinancialDataPoint format for visualization utilities
  const financialData = useMemo<FinancialDataPoint[]>(() => {
    const data: FinancialDataPoint[] = []

    // Add income sources
    for (const source of incomeSources) {
      // Validate required fields per project context (zero tolerance for invalid financial data)
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
      // Parse createdAt date if available
      const sourceDate = source.createdAt ? new Date(source.createdAt) : undefined

      data.push({
        id: source.id,
        name: source.name,
        amount: source.amount,
        frequency: source.frequency,
        category: source.category ?? source.name, // Use explicit category if available, fallback to name
        type: 'income' as const,
        date: sourceDate,
      })
    }

    // Add expenses
    for (const expense of expenses) {
      // Validate required fields per project context (zero tolerance for invalid financial data)
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
      // Parse createdAt date if available
      const expenseDate = expense.createdAt ? new Date(expense.createdAt) : undefined

      data.push({
        id: expense.id,
        name: expense.name,
        amount: expense.amount,
        frequency: expense.frequency,
        category: expense.category ?? expense.name, // Use explicit category if available, fallback to name
        type: 'expense' as const,
        date: expenseDate,
      })
    }

    return data
  }, [incomeSources, expenses])

  // Re-express each entry at the chosen cadence BEFORE aggregation (story 12-3,
  // AC-2). The breakdown previously summed raw entered amounts and ignored
  // frequency entirely, so a weekly $100 and an annual $100 rendered as equal
  // slices. We normalize every entry to monthly then denormalize to the target
  // cadence, reusing the core frequency engine (annually ⇒ monthly ×12) rather
  // than re-deriving any factors. Values stay integer cents, so formatAmount and
  // the currency mode are unaffected.
  const periodScaledData = useMemo<FinancialDataPoint[]>(
    () =>
      financialData.map((point) => {
        const monthly = normalizeToMonthly(point.amount, point.frequency)
        const scaled =
          chartPeriod === 'annually'
            ? denormalizeFromMonthly(monthly, 'annually') // monthly ×12
            : monthly
        return { ...point, amount: scaled }
      }),
    [financialData, chartPeriod]
  )

  // Aggregate the period-scaled data into income and expense category buckets.
  const aggregatedData = useMemo(() => {
    return aggregateByCategoryAndType(periodScaledData)
  }, [periodScaledData])

  // Stable color per category, shared across both breakdown pies.
  const categoryColors = useMemo(() => {
    const allCategories = [
      ...(aggregatedData.get('income') || []).map((d) => d.category),
      ...(aggregatedData.get('expense') || []).map((d) => d.category),
    ]
    return generateColorMap(allCategories)
  }, [aggregatedData])

  // One pie dataset per type (UX review #4). Income and expenses are separate
  // wholes, so each pie carries only its own type and its slices sum to that
  // type's total — a category's percentage is measured against the right
  // denominator instead of income + expenses combined.
  const incomeData = useMemo(() => {
    return toPieChartData(aggregatedData.get('income') || [], categoryColors)
  }, [aggregatedData, categoryColors])

  const expenseData = useMemo(() => {
    return toPieChartData(aggregatedData.get('expense') || [], categoryColors)
  }, [aggregatedData, categoryColors])

  // Each pie's own 100% denominator (also shown as the pie's total figure).
  const totalIncomeChart = useMemo(
    () => incomeData.reduce((sum, item) => sum + item.value, 0),
    [incomeData]
  )
  const totalExpenseChart = useMemo(
    () => expenseData.reduce((sum, item) => sum + item.value, 0),
    [expenseData]
  )

  // Financial Category Summary. Flows and balances are two different kinds of
  // number — a per-period FLOW (Income/Expenses, re-expressed at the overview
  // duration) vs a point-in-time BALANCE (Savings/Investments/Debts) — so
  // plotting them on one shared value axis let a large annual flow (~$93.6k)
  // crush the balance bars into an unreadable sliver (story UX-2). Split into two
  // datasets, each rendered in its own sub-chart with its own axis so neither can
  // dominate the other.
  //
  // Flows keep the story-12-2 duration alignment: same cadence as the cards, same
  // `(per week/month/year)` suffix. The chart uses Recharts' vertical layout, so
  // bars run horizontally and Expenses (negative) extends leftward of the 0 line.
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

  // Balances are absolute, point-in-time amounts — no period suffix — with debts
  // shown as a reduction (negative), consistent with the Net Worth definition.
  const balancesBarData = [
    {
      category: 'Savings',
      amount: totalSavings,
      fill: SAVINGS_COLOR,
    },
    {
      category: 'Investments',
      amount: totalInvestments,
      fill: INVESTMENT_COLOR,
    },
    {
      category: 'Debts',
      amount: -totalDebts,
      fill: DEBT_COLOR,
    },
  ].filter((item) => item.amount !== 0)

  // Round, evenly-spaced axis ticks (cents) PER chart via the shared
  // `barDomainTicks` helper (each domain clamped to include a 0 baseline for its
  // diverging bars). Independent domains are the whole point — the flows axis
  // scales to ~$90k while the balances axis scales to ~$5k, so a $5k savings
  // balance is legible instead of a hair-line against a $90k income. The helper
  // is unit-tested to prove the two domains come out independent.
  const flowsBarTicks = barDomainTicks(flowsBarData.map((d) => d.amount))
  const balancesBarTicks = barDomainTicks(balancesBarData.map((d) => d.amount))

  return (
    <div className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-heading">Longhand Budget</h1>
            {/* Primary tagline (story 27-4, FR44 — amends story 25-4 / CONTENT-F):
                the privacy-stance tagline is the single subtitle beneath the
                wordmark. Supersedes the old "never sees your money" tagline and
                the 19-4 "bird's-eye" secondary subtitle (both removed). */}
            <p className="text-lg text-body mt-2">The budget app that minds its own business.</p>
            {/* Privacy positioning (story 27-5, FR45 as amended by brand-1): the
                three privacy pillars + the "intentional budgeting without bank
                sync or AI integrations" framing, shown compactly beneath the
                tagline. Every claim is true — the Free tier is client-only (no
                account; data stays in the browser), the OPTIONAL Premium sync is
                EU-hosted (DanubeData, Germany), the app has no bank/financial-
                institution integration, and there is no AI/LLM dependency in any
                package manifest or source tree (re-verified at brand-1 merge).
                The no-AI claim lives on the FRAMING line only, never on the
                pillars line — stating it twice inside this two-line block reads
                as padding (brand-1 AC-6, pinned in HomePage.test.tsx). Styled with
                theme-aware semantic tokens (surface-inset / text-body / text-muted)
                so it stays legible in dark mode, and it wraps rather than
                overflowing at 320px. */}
            <div className="surface-inset mt-4 rounded-lg p-3 text-sm">
              <p className="text-body">
                No account needed · Optional sync is EU-hosted · No bank connection.
              </p>
              <p className="text-muted mt-1">
                Intentional budgeting without bank sync or AI integrations.
              </p>
            </div>
          </div>
        </header>

        <main className="space-y-6">
          {/* Quick Stats */}
          <section className="surface rounded-lg shadow-md p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold text-subheading">Financial Overview</h2>
              {/* One global duration selector (story 12-2). Drives both the Total
                  Income and Total Expenses cards from a single source of truth. */}
              <label className="flex items-center gap-1 text-sm text-label">
                <span className="sr-only">Show income and expenses per</span>
                <select
                  aria-label="Show income and expenses per"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as OverviewDuration)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="surface-inset rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-muted">
                  {`Total Income ${DURATION_LABEL[duration]}`}
                  {totalNormalizedIncome !== totalIncomeRaw && (
                    <InfoTooltip
                      label="More information about the income figure"
                      text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
                        totalIncomeRaw
                      )}.`}
                    />
                  )}
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {formatAmount(incomeForDuration)}
                </p>
              </div>
              <div className="surface-inset rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-muted">
                  {`Total Expenses ${DURATION_LABEL[duration]}`}
                  {totalNormalizedExpenses !== totalExpensesRaw && (
                    <InfoTooltip
                      label="More information about the expenses figure"
                      text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
                        totalExpensesRaw
                      )}.`}
                    />
                  )}
                </p>
                <p className="text-2xl font-bold text-red-600">
                  {formatAmount(expensesForDuration)}
                </p>
              </div>
              <div className="surface-inset rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-muted">
                  Net Worth
                  <InfoTooltip
                    label="More information about net worth"
                    text="Net worth is what you own minus what you owe: your investments minus your debts, tracked on the Balance page. Income and expenses aren't counted here."
                  />
                </p>
                <p
                  className={`text-2xl font-bold ${
                    netWorth >= 0 ? 'text-purple-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
                {/* Explain a $0 net worth next to real income/expenses: it is $0
                    because no investments or debts have been added yet, not
                    because something is broken. Self-removes once any balance
                    exists. */}
                {hasData && balanceEntries.length === 0 && (
                  <p className="mt-1 text-xs text-faint">
                    Add investments or debts on the{' '}
                    <a
                      href="/balance"
                      className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Balance
                    </a>{' '}
                    page to track this.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Enhanced Visualizations */}
          {hasData ? (
            <>
              {/* Income and expense category breakdowns as TWO separate pies
                  (UX review #4). Summing income and expense slices into one 100%
                  pie made every percentage meaningless — a category's share was
                  measured against income + expenses combined, two different
                  wholes. Each pie now sums to its own type's total. The former
                  click-to-drill-down was removed with the single pie: the entry
                  forms capture no category distinct from the item name
                  (category ?? name === name), so a drill only ever re-showed the
                  clicked item itself, and one shared drill cannot span two
                  independent pies. */}
              <section className="surface rounded-lg shadow-md p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold text-subheading">
                    Income vs Expense Breakdown
                  </h2>
                  {/* Monthly/Annually cadence toggle (story 12-3, UX-DR20). The
                      native select matches the dark-mode + a11y idiom of the
                      overview selector (12-2). */}
                  <label className="flex items-center gap-1 text-sm text-label">
                    <span className="sr-only">Show breakdown per</span>
                    <select
                      aria-label="Show breakdown per"
                      value={chartPeriod}
                      onChange={(e) => setChartPeriod(e.target.value as 'monthly' | 'annually')}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="annually">Annually</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <BreakdownPie
                    title="Income by source"
                    data={incomeData}
                    total={totalIncomeChart}
                    emptyLabel="No income to break down yet"
                    accentClass="text-green-600 dark:text-green-400"
                    isNarrow={isNarrowViewport}
                    formatAmount={formatAmount}
                  />
                  <BreakdownPie
                    title="Expenses by category"
                    data={expenseData}
                    total={totalExpenseChart}
                    emptyLabel="No expenses to break down yet"
                    accentClass="text-red-600 dark:text-red-400"
                    isNarrow={isNarrowViewport}
                    formatAmount={formatAmount}
                  />
                </div>
              </section>

              {/* Financial Category Summary. After the redundant "Asset &
                  Liability Breakdown" pie was removed (story 12-4), this section
                  is the sole carrier of the current Savings / Investments / Debts
                  figures (alongside Income / Expenses). Story UX-2 splits the old
                  single bar chart into two sub-charts — per-period flows and
                  point-in-time balances — each on its own axis so a large annual
                  flow can no longer flatten the balance bars. The section heading
                  stays the carrier the story-12-4 tests assert. */}
              <section className="surface rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold text-subheading mb-4">
                  Financial Category Summary
                </h2>
                {flowsBarData.length > 0 || balancesBarData.length > 0 ? (
                  <div className="space-y-8">
                    {/* Per-period flows (Income / Expenses). Only rendered when
                        present so a balances-only dashboard shows no empty axis
                        (AC-5). */}
                    {flowsBarData.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-label mb-2">
                          Income &amp; expenses {DURATION_LABEL[duration]}
                        </h3>
                        <CategoryBarChart
                          data={flowsBarData}
                          ticks={flowsBarTicks}
                          isNarrow={isNarrowViewport}
                          chartColors={chartColors}
                          formatAmount={formatAmount}
                          mode={mode}
                          currency={currency}
                        />
                      </div>
                    )}
                    {/* Point-in-time balances (Savings / Investments / Debts).
                        Hidden when the user tracks no balances yet (AC-5). */}
                    {balancesBarData.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-label mb-2">Balances</h3>
                        <CategoryBarChart
                          data={balancesBarData}
                          ticks={balancesBarTicks}
                          isNarrow={isNarrowViewport}
                          chartColors={chartColors}
                          formatAmount={formatAmount}
                          mode={mode}
                          currency={currency}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="surface-inset rounded-lg p-8 text-center">
                    <p className="text-muted">No financial data to display</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="surface rounded-lg shadow-md p-4 sm:p-6">
              <div className="surface-inset rounded-lg p-6 sm:p-8 text-center">
                <p className="mb-1 text-lg font-medium text-subheading">Let's set up your budget</p>
                <p className="mb-6 text-sm text-muted">
                  Add your income and expenses and your financial overview will appear here.
                </p>
                {/* Primary onboarding action. The empty dashboard is the first
                    screen a new user sees; without a direct call to action they
                    had to discover the nav or the (hidden-on-mobile) section
                    tiles on their own. Green matches the app's primary-action
                    color used on the "Add" buttons across the CRUD pages. */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <a
                    href="/income"
                    className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
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
              </div>
            </section>
          )}

          {/* The "Manage Your Finances" tile grid was removed here (story 19-1,
              UX-DR26): it linked Income/Expenses/Savings/Balance/Projections —
              the exact destinations the persistent GlobalNav already carries — so
              on the overview it was a second copy of the primary menu. Story 18-3
              had hidden it below 640px; 19-1 removes it on desktop too, so it is
              gone at every width. Nothing is orphaned — every destination stays
              reachable via GlobalNav (top bar ≥640px, fixed bottom bar <640px).
              Its SECTION_TILES data + five category icons were deleted with it;
              `InfoIcon` (used by the stat-card tooltips) is kept. */}

          {/* Premium features — discoverable but locked for free users (story
              7-2, FR24). Paid users get the working link; everyone else sees the
              feature with a lock badge and an upgrade prompt. Enforcement stays
              server-side (the /forecasting loader + session gate). */}
          {/* Padding tightened on mobile (story 19-4, UX-DR32): p-4 sm:p-6 keeps
              the desktop (≥640px) spacing while reclaiming vertical space on
              phones. Only this <section>'s padding changes here — its contents
              are Epic 20's surface, kept untouched to avoid a merge collision. */}
          <section className="surface rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-semibold text-subheading mb-4">Premium Features</h2>

            {/* One chassis, three benefits (story 30-1, FR51). Every box below
                shares PREMIUM_BOX_BASE so the section reads as a single set;
                only the two route-backed tiles add the interactive extras.

                Multi-device sync is still an account-wide benefit and NOT an
                openable page — there is no /sync route — so it stays LISTED as
                static copy: never wrapped in a PremiumFeatureGate, never given a
                lock badge, link, or "Open →" (story 20-2, CONTENT-G, still
                binding). 30-1 changes only how it is PAINTED, not what it is.
                It leads the section so the canonical benefit set reads first.

                Each gate gets its own wrapper <div> inside the space-y-3 stack:
                in the locked state PremiumFeatureGate returns a fragment of the
                <button> PLUS a <PremiumPrompt asDialog>, and Modal renders in
                normal flow (no portal), so an unwrapped overlay would become a
                spaced sibling and pick up a 12px margin — leaving an undimmed
                strip across the top of the open dialog. */}
            <div className="space-y-3">
              <div
                className={`${PREMIUM_BOX_BASE} surface-inset`}
                data-testid="premium-benefit-sync"
              >
                <MultiDeviceSyncLabel />
              </div>

              <div>
                <PremiumFeatureGate
                  featureName="Advanced Forecasting"
                  className={PREMIUM_BOX_INTERACTIVE}
                  locked={<LockedTileContent label={<PremiumFeatureLabel />} />}
                >
                  <a href="/forecasting" className={PREMIUM_BOX_INTERACTIVE}>
                    <PremiumFeatureLabel />
                    <span className="text-sm font-medium text-accent whitespace-nowrap">
                      Open →
                    </span>
                  </a>
                </PremiumFeatureGate>
              </div>

              {/* Custom Profiles — surfaced-but-locked next to Advanced Forecasting
                  (story 13-3, AC-1/AC-4). Resolves the /profiles nav-orphan;
                  enforcement stays server-side (the profile server functions' tier
                  guard) + the /profiles route gate. */}
              <div>
                <PremiumFeatureGate
                  featureName="Custom Profiles"
                  className={PREMIUM_BOX_INTERACTIVE}
                  locked={<LockedTileContent label={<CustomProfilesFeatureLabel />} />}
                >
                  <a href="/profiles" className={PREMIUM_BOX_INTERACTIVE}>
                    <CustomProfilesFeatureLabel />
                    <span className="text-sm font-medium text-accent whitespace-nowrap">
                      Open →
                    </span>
                  </a>
                </PremiumFeatureGate>
              </div>
            </div>
          </section>
        </main>

        {/* The version and the in-app "Contact" link now live in the global
            <Footer> (story 4-8; story 9-1 replaced the old GitHub feedback link
            from story 4-9), so the page no longer renders its own stopgap
            footer block. */}
      </div>
    </div>
  )
}

interface BreakdownPieProps {
  /** Sub-heading shown above the pie (e.g. "Income by source"). */
  title: string
  /** Pie slices for a SINGLE type, already period-scaled. */
  data: RechartsDataItem[]
  /** Sum of `data` values — the pie's own 100% denominator, also shown as its total. */
  total: number
  /** Message shown when this type has no entries. */
  emptyLabel: string
  /** Tailwind text-color classes for the total figure (income green / expense red). */
  accentClass: string
  /** Narrow viewport: drop in-plot slice labels so they cannot overflow at 320px. */
  isNarrow: boolean
  formatAmount: (cents: number) => string
}

type CategoryBarDatum = { category: string; amount: number; fill: string }

interface CategoryBarChartProps {
  /** Bars to plot (amounts in cents), rendered in Recharts' vertical layout. */
  data: CategoryBarDatum[]
  /** Round tick values (cents) spanning this chart's OWN diverging domain. */
  ticks: number[]
  /** Narrow viewport: shrink the Y-axis label gutter and tick size for 320px. */
  isNarrow: boolean
  chartColors: ReturnType<typeof useChartColors>
  formatAmount: (cents: number) => string
  mode: ReturnType<typeof useCurrencyPreferences>['mode']
  currency: ReturnType<typeof useCurrencyPreferences>['currency']
}

/**
 * One vertical bar chart for a Financial Category Summary sub-section — flows OR
 * balances (story UX-2). Each instance owns its axis domain (`ticks`) and its
 * height (scaled to the bar count via `categoryChartHeight`) so the two
 * sub-charts stay legible independently instead of sharing one axis a large
 * annual flow can dominate. Axis/grid/tooltip strokes are routed through the
 * shared chartTheme so the chart reads on the dark `.surface` card too (story
 * 11-2 / 12-4 AC-2 dark-mode constraint).
 */
function CategoryBarChart({
  data,
  ticks,
  isNarrow,
  chartColors,
  formatAmount,
  mode,
  currency,
}: CategoryBarChartProps): React.ReactElement {
  return (
    <div style={{ height: categoryChartHeight(data.length) }}>
      <ErrorBoundary
        fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            {/* Round ticks (amounts are cents) with a compact, cents-dropping
                label — the full formatAmount value carries ".00" the narrow axis
                has no room for. */}
            <XAxis
              type="number"
              domain={[ticks[0], ticks[ticks.length - 1]]}
              ticks={ticks}
              tickFormatter={(value) => formatCompactAxisTick(value / 100, mode, currency)}
              tick={{ fontSize: 12, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            <YAxis
              dataKey="category"
              type="category"
              width={isNarrow ? 76 : 132}
              tick={{ fontSize: isNarrow ? 11 : 12, fill: chartColors.axis }}
              stroke={chartColors.axis}
            />
            <Tooltip
              formatter={(value: number, name: string) => [formatAmount(value), name]}
              contentStyle={{
                backgroundColor: chartColors.tooltipBg,
                border: `1px solid ${chartColors.tooltipBorder}`,
                color: chartColors.tooltipText,
              }}
              labelStyle={{ color: chartColors.tooltipText }}
              itemStyle={{ color: chartColors.tooltipText }}
            />
            <Bar dataKey="amount" name="Amount">
              {data.map((entry) => (
                <Cell key={entry.category} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ErrorBoundary>
    </div>
  )
}

/**
 * One category-breakdown pie for a single financial type (income OR expense),
 * with its own correct 100% denominator (UX review #4). The color-keyed list
 * below the plot doubles as the legend and carries the per-category amounts, so
 * those figures render as plain text — which the period-control test asserts,
 * since Recharts' SVG is not laid out under jsdom.
 */
function BreakdownPie({
  title,
  data,
  total,
  emptyLabel,
  accentClass,
  isNarrow,
  formatAmount,
}: BreakdownPieProps): React.ReactElement {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-subheading">{title}</h3>
        {data.length > 0 && (
          <span className={`text-sm font-semibold ${accentClass}`}>{formatAmount(total)}</span>
        )}
      </div>
      {data.length === 0 ? (
        <div className="surface-inset flex h-[240px] items-center justify-center rounded-lg p-6 text-center">
          <p className="text-sm text-muted">{emptyLabel}</p>
        </div>
      ) : (
        <>
          <div className="h-[240px]">
            <ErrorBoundary
              fallback={
                <div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart aria-label={`${title} breakdown chart`} role="img">
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    innerRadius={isNarrow ? 42 : 55}
                    outerRadius={isNarrow ? 70 : 85}
                    fill="#8884d8"
                    dataKey="value"
                    nameKey="name"
                    // Drop in-plot labels on narrow so they cannot push past the
                    // container at 320px; the list below still names every slice.
                    label={
                      isNarrow
                        ? false
                        : ({ name, percent }) => {
                            const short = name.length > 14 ? `${name.substring(0, 11)}...` : name
                            return `${short}: ${(percent * 100).toFixed(1)}%`
                          }
                    }
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={`${entry.type}-${entry.name}`}
                        fill={
                          entry.fill ||
                          entry.color ||
                          CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                        }
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${formatAmount(value)}${
                        total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : ''
                      }`,
                      name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ErrorBoundary>
          </div>
          <ul className="mt-3 space-y-1">
            {sorted.map((item, index) => (
              <li
                key={`${item.type}-${item.name}`}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        item.fill || item.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                    }}
                  />
                  <span className="truncate text-body">{item.name}</span>
                </span>
                <span className="shrink-0 text-muted">{formatAmount(item.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Small accessible info affordance (story 11-4). Reveals a plain-language
 * explanation on hover or keyboard focus — progressive disclosure — instead of
 * leading the card with a bare, jargon-y sub-line.
 *
 * Accessibility (hardened in code review):
 * - Hover and focus are tracked independently (`open = hovered || focused`) so a
 *   mouse-leave never hides a tooltip the keyboard user still has focused, and a
 *   blur never hides one the mouse is still over. Escape dismisses without moving
 *   focus.
 * - A short close delay plus hover handlers on the bubble let the pointer travel
 *   from the trigger onto the bubble without it vanishing, so the content stays
 *   hoverable (WCAG 1.4.13).
 * - The bubble is rendered only while open and positioned `fixed` with its left
 *   clamped to the viewport, so it can neither contribute to horizontal overflow
 *   nor clip off-screen at 320px regardless of which card edge the icon sits near.
 * - `aria-describedby` is wired only while the bubble exists.
 */
function InfoTooltip({ label, text }: { label: string; text: string }): React.ReactElement {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()
  const open = hovered || focused

  const openHover = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setHovered(true)
  }
  // Delay the close so the pointer can cross the small gap onto the bubble
  // (which re-opens via its own onMouseEnter) before it unmounts.
  const closeHoverSoon = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHovered(false), 120)
  }

  // Position the bubble in viewport space, clamped so it never overflows either
  // edge. Runs after the trigger is laid out and whenever the tooltip opens.
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(224, window.innerWidth - margin * 2)
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.max(margin, Math.min(centered, window.innerWidth - width - margin))
    setCoords({ top: rect.bottom + 4, left, width })
  }, [open])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  return (
    <span
      className="inline-flex align-middle"
      onMouseEnter={openHover}
      onMouseLeave={closeHoverSoon}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-gray-200"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (closeTimer.current) clearTimeout(closeTimer.current)
            setHovered(false)
            setFocused(false)
          }
        }}
      >
        <InfoIcon className="h-4 w-4" />
      </button>
      {open && coords && (
        <span
          role="tooltip"
          id={tooltipId}
          onMouseEnter={openHover}
          onMouseLeave={closeHoverSoon}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
          className="z-20 rounded-md bg-gray-900 px-3 py-2 text-left text-xs font-normal text-gray-100 shadow-lg dark:bg-gray-700"
        >
          {text}
        </span>
      )}
    </span>
  )
}

function InfoIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.25 11.25h.75v3.75m-.75 0h1.5M12 8.25h.008v.008H12V8.25zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

/**
 * The one box chassis every Premium benefit shares (story 30-1, FR51).
 *
 * Colour-free on purpose: exactly ONE background token is added on top of it —
 * `surface-inset` at the sync call site, and `surface-interactive` baked into
 * {@link PREMIUM_BOX_INTERACTIVE} for the two route-backed tiles. Both tokens
 * set `background-color` and both live in @layer components, where the winner
 * is decided by declaration order in global.css rather than by className order,
 * so putting both on one element would be a silent, hard-to-debug bug.
 *
 * `justify-between` lives here rather than in the interactive variant: the sync
 * box has a single child, so it is a visual no-op there, and keeping it shared
 * means all three boxes carry a genuinely identical base string.
 */
const PREMIUM_BOX_BASE =
  'flex w-full items-center justify-between gap-3 rounded-md border border-default px-4 py-3'

/**
 * The chassis plus the affordances that mark a box as openable (story 30-1).
 * Applied to BOTH the gate's `className` (which styles the locked <button> and
 * the loading skeleton) and the unlocked <a> — that duplication is the gate's
 * contract, not an oversight: `PremiumFeatureGate` renders bare `{children}`
 * when unlocked and emits no classes of its own.
 *
 * `focus-visible:ring-2` (not `focus:ring-2`) matches this page's own convention
 * for links and buttons, so a mouse click on a large tile does not light a ring.
 * The `forced-colors:` outline is not redundant with it: Tailwind implements
 * `ring-*` as a `box-shadow`, which Windows High Contrast discards entirely —
 * without the outline these two tiles, the only interactive elements in the
 * section, would have no visible focus indicator at all (WCAG 2.4.7).
 */
const PREMIUM_BOX_INTERACTIVE = `${PREMIUM_BOX_BASE} surface-interactive text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2`

/**
 * Locked-tile body: the feature label plus a persistent chevron (story 30-1).
 *
 * The chevron is the touch affordance. Once 30-1 removed the blue fill, hover
 * became the only thing separating a tappable tile from the listed sync
 * benefit — and hover does not exist on touch, while the locked state has no
 * "Open →". Without this a free visitor on a phone sees three identical boxes,
 * two of which do something. The lock badge does not fill that role: sync is a
 * premium benefit too, so a lock reads as "premium", not "tap me".
 *
 * Layout: `PremiumFeatureGate` renders `{locked}` and then its own
 * `<PremiumLockBadge />`, so the chevron uses `order-last` to sit AFTER the
 * badge, and the label takes `mr-auto` to absorb the free space so the badge
 * and chevron stay packed together on the right.
 *
 * `aria-hidden` because the gate's `<button>` already carries an accessible
 * name ("<feature> — premium, locked"); the glyph would only add noise.
 */
function LockedTileContent({ label }: { label: React.ReactNode }): React.ReactElement {
  return (
    <>
      <span className="mr-auto">{label}</span>
      <span aria-hidden="true" className="order-last pl-2 text-lg leading-none text-accent">
        ›
      </span>
    </>
  )
}

/**
 * Shared label for the Advanced Forecasting premium entry, rendered identically
 * in both the unlocked (link) and locked (gate button) states so the two look
 * the same apart from the lock badge the gate adds.
 */
function PremiumFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Advanced Forecasting</span>
      <span className="text-sm text-muted">
        What-if scenario modeling with saved, searchable forecasts
      </span>
    </span>
  )
}

/**
 * Label for the Multi-device sync premium benefit (story 20-2, CONTENT-G).
 * Unlike Advanced Forecasting / Custom Profiles, sync is an account-wide benefit
 * with no route to open, so it is presented as a static listed benefit — never
 * wrapped in a PremiumFeatureGate and never given a link or lock badge. Copy is
 * kept consistent with the Features/Pricing "securely stored and synced" wording
 * and claims nothing sync does not do.
 *
 * Since story 30-1 (FR51) its box shares PREMIUM_BOX_BASE with the two gated
 * tiles, so the section reads as one set. That is a purely visual change: the
 * 20-2 rule above is unchanged, and the difference that carries meaning is now
 * the affordance (hover + "Open →" on the openable tiles only), not the colour.
 */
function MultiDeviceSyncLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Multi-device sync</span>
      <span className="text-sm text-muted">
        Your data securely stored and synced across all your devices
      </span>
    </span>
  )
}

/**
 * Shared label for the Custom Profiles premium entry (story 13-3), rendered
 * identically in both the unlocked (link) and locked (gate button) states so the
 * two look the same apart from the lock badge the gate adds.
 */
function CustomProfilesFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Custom Profiles</span>
      <span className="text-sm text-muted">
        Keep separate finances — e.g. personal vs. household — and switch without mixing the numbers
      </span>
    </span>
  )
}
