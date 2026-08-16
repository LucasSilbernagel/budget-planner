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
import React, { useMemo } from 'react'
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
import { resolveCategoryLabel, useCategoryNameMap } from '../hooks/useCategoryLabels'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useNetWorth } from '../hooks/useNetWorth'
import { barDomainTicks, categoryChartHeight, formatCompactAxisTick } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { useBalanceEntries, useExpenses, useIncomeSources, useSavingsGoals } from '../stores'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import {
  DURATION_LABEL,
  DURATION_OPTION_LABEL,
  IS_NON_INTEGRAL_CADENCE,
  type OverviewDuration,
  VALID_DURATIONS,
  useOverviewDuration,
  useSetOverviewDuration,
} from '../stores/overviewDurationStore'
import { ErrorBoundary } from './ErrorBoundary'
import { PremiumFeatureGate } from './premium'
import { InfoTooltip } from './ui/InfoTooltip'

// Colors for the charts
const INCOME_COLOR = '#10B981'
const EXPENSE_COLOR = '#EF4444'
const SAVINGS_COLOR = '#8B5CF6'
const INVESTMENT_COLOR = '#3B82F6'
const DEBT_COLOR = '#DC2626'

export function HomePage() {
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()
  // Rows carry a category uuid, never a name (story 30.4b). Both pies group by
  // the RESOLVED name, so a raw `categoryId` must never reach a data point —
  // it would surface as a truncated uuid in the slice label, the legend and
  // the tooltip.
  const categoryNames = useCategoryNameMap()
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

  // Raw (unconverted) entered totals, quoted inside the conversion disclosure.
  // Deliberately NOT normalized — this is the "before conversion" figure.
  const totalIncomeRaw = incomeSources.reduce((sum, source) => sum + source.amount, 0)
  const totalExpensesRaw = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  // ⚠️ Gate the disclosure on whether conversion HAPPENED, not on whether the
  // normalized and raw totals differ. Code review 32.1 showed the equality proxy
  // has a false-negative: $330 weekly + $1,200 annually normalizes to exactly the
  // raw sum (143000 + 10000 == 33000 + 120000 == 153000c), so a genuine
  // conversion rendered no explanation at all. `PeriodTotal` on the Income and
  // Expenses pages uses the same predicate, so all three surfaces now explain the
  // same data the same way.
  const incomeConversionApplied = incomeSources.some((source) => source.frequency !== 'monthly')
  const expensesConversionApplied = expenses.some((expense) => expense.frequency !== 'monthly')
  const totalSavings = savingsGoals.reduce((sum, goal) => sum + goal.currentBalance, 0)
  const totalInvestments = balanceEntries
    .filter((entry) => entry.type === 'investment')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  const totalDebts = balanceEntries
    .filter((entry) => entry.type === 'debt')
    .reduce((sum, entry) => sum + entry.currentBalance, 0)
  // Story 32.2 (FR59): net worth is investments + savings − debts, read through
  // the one shared hook so this card, the Balance page and the projection page
  // cannot drift apart. Note the balances bar chart below (`balancesBarData`) has
  // always plotted Savings + Investments − Debts under a comment claiming
  // consistency "with the Net Worth definition" — until now that comment was
  // describing a definition this card did not use.
  const netWorth = useNetWorth()

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
  // date-range presets with a period toggle defaulting to Annually (UX-DR20).
  //
  // ⚠️ Story 12-3 gave this control its OWN component-local state, deliberately
  // independent of the overview duration selector (12-2). Story 32.3 reversed
  // that: the two controls could show the SAME expenses twelve times apart on one
  // screen (card on Monthly = $2,441.67, pies still on Annually = $29,300.04 —
  // reproduced before the fix), which is the strongest candidate for the "total
  // expenses way off" report. There is now exactly ONE period value on this page,
  // read from the shared store, so that divergence is structurally impossible.
  // The breakdown keeps its own <select> (it sits far below the fold, and
  // removing the affordance would be a discoverability regression) — it is simply
  // a second WRITER to the one store.

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
        category: resolveCategoryLabel(source.categoryId, source.name, categoryNames),
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
        category: resolveCategoryLabel(expense.categoryId, expense.name, categoryNames),
        type: 'expense' as const,
        date: expenseDate,
      })
    }

    return data
    // ⚠️ `categoryNames` is load-bearing in this dependency list. Without it a
    // RENAME leaves both pies showing the old label until some unrelated income
    // or expense edit invalidates the memo — a silently stale chart.
  }, [incomeSources, expenses, categoryNames])

  // Re-express each entry at the chosen period BEFORE aggregation (story 12-3,
  // AC-2). The breakdown previously summed raw entered amounts and ignored
  // frequency entirely, so a weekly $100 and an annual $100 rendered as equal
  // slices. We normalize every entry to monthly then denormalize to the target
  // period, reusing the core frequency engine rather than re-deriving any
  // factors. Values stay integer cents, so formatAmount and the currency mode are
  // unaffected.
  //
  // ⚠️ UNCONDITIONAL — do not reintroduce a per-value branch. This read
  // `chartPeriod === 'annually' ? denormalizeFromMonthly(monthly, 'annually') :
  // monthly`, a special case that existed only because the control had two
  // values. `monthly` is ×1, so `round(m / 1) === m` exactly and the old branch
  // was a no-op. Hand-classifying four values here would be the same rot
  // `IS_NON_INTEGRAL_CADENCE` exists to prevent (story 32.1's `duration ===
  // 'weekly'`).
  const periodScaledData = useMemo<FinancialDataPoint[]>(
    () =>
      financialData.map((point) => {
        const monthly = normalizeToMonthly(point.amount, point.frequency)
        return { ...point, amount: denormalizeFromMonthly(monthly, duration) }
      }),
    [financialData, duration]
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

  // Whether the per-entry rounding disclosure below can actually be TRUE.
  //
  // ⚠️ The note is about per-entry rounding ACCUMULATING, so it needs a side with
  // more than one entry to accumulate across: with a single entry the pie total is
  // `round(m / k)` and the card is `round(m / k)` — the same expression, so they
  // cannot differ. Counting ENTRIES, not slices, is the load-bearing part: the
  // rounding happens per entry BEFORE `aggregateByCategoryAndType` merges entries
  // into category slices, so one two-entry category diverges while two
  // one-entry categories do not.
  //
  // ⚠️ Gating on the period ALONE (the first version of this) rendered "these
  // figures can differ from the totals above" above two EMPTY pies for a
  // balances-only user — a note contradicting the screen it sits on. Same defect
  // class as the 32.2 gate that delegated to another section's `isEmpty`. Found in
  // code review, verified by test.
  const breakdownCanDiverge = useMemo(() => {
    let incomeEntries = 0
    let expenseEntries = 0
    for (const point of financialData) {
      if (point.type === 'income') incomeEntries++
      else expenseEntries++
    }
    return incomeEntries >= 2 || expenseEntries >= 2
  }, [financialData])

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
              {/* One global duration selector (story 12-2, widened to four values
                  by 32.1). Drives the Total Income and Total Expenses cards here,
                  and the same store drives the Income and Expenses pages — one
                  source of truth, no per-surface duplication.
                  Options are derived from VALID_DURATIONS so a selectable option
                  can never be one `coerceDuration` would reject on reload. */}
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
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="surface-inset rounded-lg p-4">
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
                {/* data-testid rather than an accessible-name matcher: story 32.1
                    measured that a label wrapping the InfoTooltip button resolves to
                    a different accessible name under jsdom than under Chromium, so
                    an anchored `^…$` matcher passes every unit test and finds
                    nothing in a browser. Added by 32.3 so the reconciliation suite
                    can assert this figure directly. */}
                <p
                  data-testid="overview-total-income"
                  className="text-2xl font-bold text-green-600"
                >
                  {formatAmount(incomeForDuration)}
                </p>
              </div>
              <div className="surface-inset rounded-lg p-4">
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
                {/* See the income card above — same jsdom-vs-Chromium
                    accessible-name reason for keying on a testid. */}
                <p
                  data-testid="overview-total-expenses"
                  className="text-2xl font-bold text-red-600"
                >
                  {formatAmount(expensesForDuration)}
                </p>
              </div>
              <div className="surface-inset rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-muted">
                  Net Worth
                  <InfoTooltip
                    label="More information about net worth"
                    text="Net worth is what you own minus what you owe: your investments and savings, minus your debts. Investments and debts are tracked on the Balance page, savings on the Savings page. Income and expenses aren't counted here."
                  />
                </p>
                {/* data-testid rather than an accessible-name matcher: story 32.1
                    measured that a label wrapping the InfoTooltip button resolves to
                    a different accessible name under jsdom than under Chromium. */}
                <p
                  data-testid="overview-net-worth"
                  className={`text-2xl font-bold ${
                    netWorth >= 0 ? 'text-purple-600' : 'text-red-600'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
                {/* Explain a $0 net worth next to real income/expenses: it is $0
                    because nothing it is made of has been added yet, not because
                    something is broken. Self-removes once any balance exists.
                    ⚠️ The gate must cover savings as well as balances (story 32.2):
                    savings now COUNT toward net worth, so keying this on balance
                    rows alone put "add something to track this" underneath a real,
                    positive figure for a savings-only user — the card contradicting
                    itself. Both lists must be empty for there to be nothing to
                    show. */}
                {hasData && balanceEntries.length === 0 && savingsGoals.length === 0 && (
                  <p className="mt-1 text-xs text-faint" data-testid="net-worth-empty-hint">
                    Add investments or debts on the{' '}
                    <a
                      href="/balance"
                      className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Balance
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
                  wholes. Each pie now sums to its own type's total.

                  ⚠️ Since story 30.4b these group by the user's own CATEGORY,
                  not by item name: `aggregateByCategoryAndType` merges rows that
                  share a category, so four expenses in "Groceries" are one
                  slice. A row with no category (or one this device cannot
                  resolve — see `useCategoryLabels`) still falls back to its own
                  name (Decision 10), so a merged category and a single
                  uncategorized item render alike; distinguishing them is 30.5's
                  concern. The former click-to-drill-down stays removed: one
                  shared drill cannot span two independent pies. */}
              <section className="surface rounded-lg shadow-md p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold text-subheading">
                    Income vs Expense Breakdown
                  </h2>
                  {/* Period toggle (story 12-3, UX-DR20), rebound to the SHARED
                      store by story 32.3 and widened from two options to all
                      four. A second writer to one store is deliberate: this
                      section sits far below the fold, so removing its affordance
                      would be a discoverability regression. Changing either
                      selector now moves both — that is the point.
                      Options derive from VALID_DURATIONS so a selectable option
                      can never be one `coerceDuration` would reject on reload. */}
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
                </div>

                {/* ⚠️ Only a NON-INTEGRAL period can diverge, and story 32.3 is
                    what made this reachable. These pies scale EACH ENTRY to the
                    period and then sum; the Total Income / Total Expenses cards
                    above sum monthly first and denormalize ONCE. At ×12/52
                    (weekly) and ×12/26 (biweekly) those two disagree by a cent or
                    two — measured 112,692c (card) vs 112,693c (pies) at biweekly
                    on the story's own fixture. `monthly` (×1) and `annually`
                    (×12) are integral and agree exactly, so an unconditional note
                    would be false half the time. Before 32.3 this was unreachable
                    only because the toggle offered just monthly and annually.

                    Its own testid — the /categories page's
                    `breakdown-rounding-note` is queried by that section's tests.
                    The predicate is IMPORTED, never re-declared.

                    ⚠️ THE COPY SAYS "ENTRY", NOT "CATEGORY", AND THAT DISTINCTION
                    IS LOAD-BEARING. It first read "Each category is rounded on its
                    own" — which describes the /categories page's model, not this
                    one. THESE pies round each ENTRY and then aggregate, so a
                    multi-entry category's figure here is NOT that category rounded
                    on its own. The two models genuinely disagree: one category
                    holding two 28c-monthly entries renders 12c here and 13c on
                    /categories at weekly. That CROSS-SURFACE divergence is real,
                    is NOT what this note discloses (it compares against the cards
                    above), and is recorded in deferred-work.md pending a decision
                    on which rounding model is canonical for a category figure.
                    Found in code review 32.3 by two independent layers. */}
                {IS_NON_INTEGRAL_CADENCE[duration] && breakdownCanDiverge ? (
                  <p className="mb-4 text-xs text-muted" data-testid="breakdown-pies-rounding-note">
                    Each entry is rounded on its own as it is converted, so at this view these
                    figures can differ from the totals above by about half a cent per entry.
                  </p>
                ) : null}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <BreakdownPie
                    testId="income"
                    title={`Income by category ${DURATION_LABEL[duration]}`}
                    data={incomeData}
                    total={totalIncomeChart}
                    emptyLabel="No income to break down yet"
                    accentClass="text-green-600 dark:text-green-400"
                    isNarrow={isNarrowViewport}
                    formatAmount={formatAmount}
                  />
                  <BreakdownPie
                    testId="expense"
                    title={`Expenses by category ${DURATION_LABEL[duration]}`}
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
              `InfoIcon` (used by the stat-card tooltips) is kept — story 32.1
              moved it into `ui/InfoTooltip` so Income and Expenses share it. */}

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

/**
 * The in-plot text for one pie slice (desktop only — narrow drops labels).
 *
 * ⚠️ EXPORTED AND PURE ON PURPOSE. Recharts does not lay out its SVG under
 * jsdom, so a label rendered inside `<Pie label={...}>` is invisible to every
 * unit test — code review 32.3 removed the `total > 0` guard below and the whole
 * suite stayed green. Extracting the formatter is the repo's established answer
 * to exactly this (epic 24's `get*Chrome()` helpers), and it lets both branches
 * be tested against concrete values.
 *
 * ⚠️ `total > 0` mirrors the Tooltip's guard, which has always had it — the
 * boundary was seen once and missed once. Recharts derives `percent` as
 * value/sum, so an all-zero dataset gives 0/0 = NaN and every label reads
 * "NaN%". Story 32.3 WIDENED the trigger: a 2c monthly expense rounds to 0c at
 * the newly-selectable weekly view, where previously only a sub-5c ANNUAL entry
 * could do it. Falling back to the bare name keeps the slice labelled rather
 * than blanking it.
 */
export function pieSliceLabel(name: string, percent: number, total: number): string {
  const short = name.length > 14 ? `${name.substring(0, 11)}...` : name
  return total > 0 ? `${short}: ${(percent * 100).toFixed(1)}%` : short
}

interface BreakdownPieProps {
  /**
   * Stable identity for test queries — `breakdown-pie-<testId>` on the wrapper
   * and `breakdown-pie-total-<testId>` on the total figure.
   *
   * ⚠️ `data-testid`, not the title, because the title now carries the period
   * suffix (`Income by category (per week)`) and so changes with the selector —
   * a title-anchored query would silently match nothing at three of the four
   * periods. Same jsdom-vs-Chromium accessible-name reasoning the cards use.
   */
  testId: string
  /** Sub-heading shown above the pie (e.g. "Income by category (per week)"). */
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
  testId,
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
    <div data-testid={`breakdown-pie-${testId}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-subheading">{title}</h3>
        {data.length > 0 && (
          <span
            data-testid={`breakdown-pie-total-${testId}`}
            className={`text-sm font-semibold ${accentClass}`}
          >
            {formatAmount(total)}
          </span>
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
                      isNarrow ? false : ({ name, percent }) => pieSliceLabel(name, percent, total)
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
 *
 * The subtitle states only what ships (story 30-2): a what-if scenario you build
 * yourself, saved to a searchable list, and reloadable back into the builder.
 * It must not claim a side-by-side comparison of two saved forecasts — no such
 * view exists.
 *
 * ⚠️ The two states derive their accessible name by DIFFERENT routes, and
 * neither is a backstop for the other:
 *   - LOCKED: `PremiumFeatureGate` puts `aria-label={`${featureName} — premium,
 *     locked`}` on the button (`PremiumFeatureGate.tsx:104`). Per accname an
 *     `aria-label` REPLACES the content, so this subtree contributes nothing.
 *     `HomePage.test.tsx:59`, `PremiumFeatureGate.test.tsx:94` and
 *     `e2e/premium-locked.spec.ts:23` ride on the `featureName` prop alone.
 *   - UNLOCKED: the `<a>` carries no `aria-label`, so its name comes from its
 *     contents and `featureName` is not involved at all. `HomePage.test.tsx:63`,
 *     `:70` and `:197` match "Advanced Forecasting" from the title span below.
 * So: renaming the title breaks the unlocked queries; changing `featureName`
 * breaks the locked ones. (Story 30-2 §6 described the name as a concatenation
 * of the two — it is neither state's actual mechanism. Corrected in 30-2 review.)
 */
function PremiumFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Advanced Forecasting</span>
      <span className="text-sm text-muted">
        What-if scenario modeling with saved, searchable, reloadable forecasts
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
