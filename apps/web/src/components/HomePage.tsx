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
import React, { Suspense, useMemo } from 'react'
import { resolveCategoryLabel, useCategoryNameMap } from '../hooks/useCategoryLabels'
import { useIsNarrowViewport } from '../hooks/useIsNarrowViewport'
import { useNetWorth } from '../hooks/useNetWorth'
import { type PremiumAccessStatus, usePremiumAccess } from '../hooks/usePremiumAccess'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { barDomainTicks, categoryChartHeight } from '../lib/chart-axis'
import { useChartColors } from '../lib/chartTheme'
import { lazyWithRetry } from '../lib/lazy-with-retry'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../lib/premium/benefits'
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
import { PremiumFeatureGate, PremiumLockBadge } from './premium'
import { InfoTooltip } from './ui/InfoTooltip'
import { LoadingStatus, PendingFigure, SKELETON_BAR, SkeletonBlock } from './ui/Skeleton'

/**
 * Recharts is pulled in ONLY when a chart is about to render (story 38.3, AC-6).
 *
 * Both handles resolve the SAME module, so the two together cost one fetch. The
 * import is dynamic on purpose: `hydrateStart.js:28` awaits every route chunk's
 * STATIC import graph before hydration begins, so a top-level `from 'recharts'`
 * here put 104.0 KB gzipped — 36.1% of the measured critical path — in front of a
 * user waiting to see their net worth. See `HomeChartCanvases.tsx` for the fence.
 *
 * ⚠️ Every call site below sits inside the `hydrated` branch, so neither canvas
 * can render on the server. Hoisting one out re-creates BUG-F.
 */
let chartChunkResolved = false

/**
 * Whether the lazily-imported chart chunk has landed.
 *
 * ⚠️ Used ONLY to set `aria-busy` on the two chart sections. It deliberately does not
 * add a `role="status"` region: `ui/Skeleton.tsx:198-202` records that a third live
 * region per page is exactly what `loading-state.dom.test.tsx`'s count assertion
 * exists to prevent, and three simultaneous "loading" announcements (one bar chart,
 * two pies) would be worse than the silence this fixes. `aria-busy` says "this region
 * is updating" without competing for the announcement queue.
 *
 * Calling `import()` here costs nothing extra: the same module is being fetched by the
 * `Suspense` boundaries below at the same moment, and a module request is deduped.
 */
function useChartsChunkReady(): boolean {
  const [ready, setReady] = React.useState(chartChunkResolved)

  // The module flag is read once on mount and is deliberately NOT reactive — it only
  // ever transitions false -> true, and the state setter below is what re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  React.useEffect(() => {
    if (chartChunkResolved) {
      return
    }
    let active = true
    void import('./HomeChartCanvases')
      .then(() => {
        chartChunkResolved = true
        if (active) {
          setReady(true)
        }
      })
      .catch(() => {
        // The ErrorBoundary around each canvas owns the failure path; this hook only
        // drives an aria attribute, so a rejection must not surface here.
      })
    return () => {
      active = false
    }
  }, [])

  return ready
}

/**
 * What fills a chart's box while its chunk is in flight (story 38.3, code review).
 *
 * ⚠️ This replaced `fallback={null}`, which was a real gap: by the time a chart
 * suspends, `hydrated` is already true, so `LoadingStatus` — the page's single
 * `role="status"` announcer — has unmounted. The user was left looking at blank
 * rectangles with no indication anything was coming, on exactly the connection
 * classes this story set out to measure, and a screen-reader user got a heading
 * followed by silence.
 *
 * It follows the contract `ui/Skeleton.tsx` already sets rather than inventing a
 * fourth convention: `SKELETON_BAR` tokens, `motion-safe:` so an indefinite pulse
 * never runs for someone who asked for less motion (WCAG 2.2.2), and `aria-hidden`
 * so the placeholder itself is out of the accessibility tree. The `aria-busy` that
 * marks the wait lives on the two chart SECTIONS (driven by {@link useChartsChunkReady})
 * — one attribute per region, and no second live region competing with `LoadingStatus`.
 *
 * ⚠️ `h-full w-full` and nothing else: the CALLER owns the box. Giving this element
 * its own dimensions would reintroduce exactly the guess that AC-11 removed.
 */
function ChartPending(): React.ReactElement {
  return (
    <div aria-hidden="true" className={`${SKELETON_BAR} h-full w-full motion-safe:animate-pulse`} />
  )
}

const CategoryBarCanvas = lazyWithRetry(() =>
  import('./HomeChartCanvases').then((m) => ({ default: m.CategoryBarCanvas }))
)
const BreakdownPieCanvas = lazyWithRetry(() =>
  import('./HomeChartCanvases').then((m) => ({ default: m.BreakdownPieCanvas }))
)

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
  // the RESOLVED name, so a raw `categoryId` must never reach a data point — it
  // would surface as a uuid in the hover tooltip and in the slice list beneath
  // the plot (which the tests call the pie's "legend"; the Recharts `<Legend>`
  // itself went in story 12-4). Story 36.2 removed the third surface, the
  // in-plot slice label.
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

  // The Premium Features section's sync box needs the tier to decide whether to
  // show its lock badge (story 33.1, UX-DR39).
  //
  // ⚠️ This IS a third subscription — the two gated tiles each call
  // `usePremiumAccess` internally (`PremiumFeatureGate.tsx:70`), and sync needs a
  // tier signal it previously had none of, so the count goes 2 → 3 wherever the
  // read is placed. Reading it here rather than inside the box saves nothing on
  // that count; it keeps the section to ONE read per box instead of inviting a
  // fourth if the box is later split. Each subscription is an independent,
  // uncached check when the session seed is null (deferred-work.md:479) — see the
  // divergence note on `SyncLockBadge`.
  const { status: premiumStatus } = usePremiumAccess()

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

  /**
   * Story 38.2 (UX-DR43): `hasData` above is computed from four stores that have
   * NOT rehydrated yet on the server and during hydration, so it is `false` for
   * a returning user with five years of data. Before this gate, that served them
   * three `$0.00` cards and — via the ternary below — "Let's set up your budget".
   * MEASURED in the server response at `d66c821`, seeded with a savings goal.
   *
   * So the page has THREE states, not two: pending, resolved-with-data, and
   * resolved-empty. `hasData` distinguishes only the last two.
   */
  const hydrated = useStoresHydrated()
  const chartsReady = useChartsChunkReady()

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
        {/* Story 38.2, AC-8: ONE announced region for the whole page, not one
            per skeleton. Every skeleton below is `aria-hidden`, which without
            this would hand a screen reader a heading followed by nothing; N
            regions would instead announce N times. `sr-only` — the visible
            signal is the pulsing placeholders. */}
        {!hydrated && <LoadingStatus />}
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-bold text-heading">Longhand Budget</h1>
            {/* Primary subtitle (story 36-1, CONTENT-N — supersedes story 27-4 /
                FR44): a single line beneath the wordmark saying what the app
                does for the reader. Retires the 27-4 privacy-stance tagline,
                which had itself replaced the 25-4 tagline and the 19-4
                "bird's-eye" secondary subtitle. No trailing period
                — byte-identical to the subtitle on routes/login.tsx, so the two
                first-contact surfaces read the same. */}
            <p className="text-lg text-body mt-2">Track your finances with privacy and control</p>
            {/* Privacy positioning (story 27-5, FR45 as amended by brand-1): the
                three privacy pillars + the "intentional budgeting without bank
                sync or AI integrations" framing, shown compactly beneath the
                subtitle. Every claim is true — the Free tier is client-only (no
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
                  {hydrated ? (
                    formatAmount(incomeForDuration)
                  ) : (
                    <PendingFigure testId="overview-total-income-skeleton" />
                  )}
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
                  {hydrated ? (
                    formatAmount(expensesForDuration)
                  ) : (
                    <PendingFigure testId="overview-total-expenses-skeleton" />
                  )}
                </p>
              </div>
              <div className="surface-inset rounded-lg p-4">
                <p className="flex items-center gap-1 text-sm text-muted">
                  Net Worth
                  <InfoTooltip
                    label="More information about net worth"
                    text="Net worth is what you own minus what you owe: your investments and savings, minus your debts. Investments and debts are tracked on the Balance Tracking page, savings on the Savings page. Income and expenses aren't counted here."
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
                  {hydrated ? (
                    formatAmount(netWorth)
                  ) : (
                    <PendingFigure testId="overview-net-worth-skeleton" />
                  )}
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
              </div>
            </div>
          </section>

          {/* Enhanced Visualizations */}
          {/* Story 38.2: THREE states. The pending branch mirrors the
              resolved-EMPTY card's box model exactly — same section padding,
              same inset card, same type scale, same button row — so a user who
              genuinely has nothing sees zero layout shift when it resolves. A
              user WITH data sees this block grow into the charts, which no fixed
              height could avoid (the two resolved states differ by ~1000px); the
              residual shift is measured and recorded in the story rather than
              claimed to be zero.
              ⚠️ The bars carry no `animate-pulse` of their own — the wrapping
              `SkeletonBlock` already pulses, and nesting the animation makes the
              two tick out of phase. */}
          {!hydrated ? (
            <SkeletonBlock
              className="surface rounded-lg shadow-md p-4 sm:p-6"
              testId="overview-sections-skeleton"
            >
              <div className="surface-inset rounded-lg p-6 sm:p-8 text-center">
                <p className="mb-1 text-lg font-medium">
                  <span
                    className={`${SKELETON_BAR} inline-block h-[1em] w-56 max-w-full align-middle`}
                  />
                </p>
                <p className="mb-6 text-sm">
                  <span
                    className={`${SKELETON_BAR} inline-block h-[1em] w-80 max-w-full align-middle`}
                  />
                </p>
                {/* ⚠️ `h-6`, not `h-[1em]`, and the difference is 8px — MEASURED.
                    Inside a `<p>` an `h-[1em]` bar is invisible to the box height
                    because the paragraph's own line-box strut is taller and wins.
                    An `inline-flex … items-center` button has NO strut: the flex
                    item's height IS the content height, so `h-[1em]` (16px) gave
                    a 34px button against the resolved link's 42px. `h-6` is the
                    `text-base` line-height, which Tailwind sets in `rem` — a
                    font-independent constant, not a measured width, so the CI
                    font cannot falsify it.

                    `border-transparent`, not no border: the resolved "+ Add
                    expense" link is bordered, and in an `items-center` row the
                    tallest child sets the height. Two invisible pixels are the
                    difference between a matching footprint and a 2px jump. */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <span className="inline-flex items-center rounded-md px-4 py-2 font-medium">
                    <span className={`${SKELETON_BAR} inline-block h-6 w-24 align-middle`} />
                  </span>
                  <span className="inline-flex items-center rounded-md border border-transparent px-4 py-2 font-medium">
                    <span className={`${SKELETON_BAR} inline-block h-6 w-28 align-middle`} />
                  </span>
                </div>
              </div>
            </SkeletonBlock>
          ) : hasData ? (
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
              <section className="surface rounded-lg shadow-md p-6" aria-busy={!chartsReady}>
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
              <section className="surface rounded-lg shadow-md p-6" aria-busy={!chartsReady}>
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
                          testId="category-bar-flows"
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
                          testId="category-bar-balances"
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
            <section
              className="surface rounded-lg shadow-md p-4 sm:p-6"
              data-testid="overview-onboarding"
            >
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

            {/* One chassis, one benefit set (story 30-1, FR51). Every box below
                shares PREMIUM_BOX_BASE so the section reads as a single set;
                only the route-backed tiles add the interactive extras.

                The rule since story 33.1 (UX-DR39) is BADGE ON EVERY BENEFIT,
                ARROW ON THE OPENABLE ONES ONLY. Multi-device sync is a premium
                benefit like the rest, so it carries the same lock badge — but
                there is still no /sync route, so it gains no link, no "Open →" and
                no visible chevron, and it is never wrapped in a PremiumFeatureGate
                (that would make it a button that opens an upgrade dialog). This
                AMENDS story 20-2 / CONTENT-G, which withheld the badge from sync
                on the grounds that a lock affordance implies an openable page;
                UX-DR39 splits "is premium" from "is openable" instead. The badge
                comes from `premiumStatus` above, not from a gate.
                Sync leads the section so the canonical benefit set reads first.

                The boxes are RENDERED FROM `OVERVIEW_BENEFITS`, keyed by
                `PremiumBenefitId`, rather than written out by hand (story 33.2,
                FR56). That is what makes it impossible for this surface to list a
                different set from /pricing, the upgrade prompt or /docs: omitting a
                benefit here is a compile error. Before 33.2 all four surfaces were
                hand-written and three of them disagreed.

                Each gate gets its own wrapper <div> inside the space-y-3 stack:
                in the locked state PremiumFeatureGate returns a fragment of the
                <button> PLUS a <PremiumPrompt asDialog>, and Modal renders in
                normal flow (no portal), so an unwrapped overlay would become a
                spaced sibling and pick up a 12px margin — leaving an undimmed
                strip across the top of the open dialog. ⚠️ Measured for EVERY gate
                during story 33.2, not just the first: with the wrapper the overlay
                is y=0/full-height from all four, and `e2e/premium-locked.spec.ts`
                now opens the prompt from each one rather than only from the
                first — until 33.2 it opened gate 0 only, so a missing wrapper on a
                later box would have shipped undetected. */}
            <div className="space-y-3">
              {PREMIUM_BENEFIT_IDS.map((id) => {
                const benefit = OVERVIEW_BENEFITS[id]
                const Label = benefit.label

                // The listed, unopenable benefit: a static <div>, never a gate.
                if (!benefit.openable) {
                  return (
                    <div
                      key={id}
                      className={`${PREMIUM_BOX_BASE} surface-inset`}
                      data-testid={`premium-benefit-${id}`}
                    >
                      <LockedTileContent label={<Label />} chevronHidden />
                      <SyncLockBadge status={premiumStatus} />
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
  /**
   * Narrow viewport: shrink the donut's radii so the plot stays inside its box
   * at 320px. Since story 36.2 the in-plot slice labels are gone at every
   * width, so the radii are all this flag drives here.
   */
  isNarrow: boolean
  formatAmount: (cents: number) => string
}

type CategoryBarDatum = { category: string; amount: number; fill: string }

interface CategoryBarChartProps {
  /**
   * Stable handle for the footprint measurement (story 38.3, AC-11). The box is
   * sized by a COMPUTED inline style rather than a fixed class, which makes it the
   * chart surface most able to drift — and it was the one AC-11 originally left
   * unmeasured.
   */
  testId: string
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
  testId,
  data,
  ticks,
  isNarrow,
  chartColors,
  formatAmount,
  mode,
  currency,
}: CategoryBarChartProps): React.ReactElement {
  return (
    <div style={{ height: categoryChartHeight(data.length) }} data-testid={testId}>
      <ErrorBoundary
        fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
      >
        {/* The sized wrapper above owns the box, so the footprint is identical
            whether or not the chunk has landed — nothing to guess, nothing to
            drift. The fallback fills that box rather than leaving it blank. */}
        <Suspense fallback={<ChartPending />}>
          <CategoryBarCanvas
            data={data}
            ticks={ticks}
            isNarrow={isNarrow}
            chartColors={chartColors}
            formatAmount={formatAmount}
            mode={mode}
            currency={currency}
          />
        </Suspense>
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
              {/* Exact footprint by construction — the `h-[240px]` wrapper above
                  owns the box, so there is nothing for a placeholder to get
                  wrong. Story 38.2 shipped an 8px error by guessing a
                  placeholder height; this avoids the guess. */}
              <Suspense fallback={<ChartPending />}>
                <BreakdownPieCanvas
                  title={title}
                  data={data}
                  total={total}
                  isNarrow={isNarrow}
                  formatAmount={formatAmount}
                />
              </Suspense>
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
                      backgroundColor: item.fill || CATEGORY_COLORS[index % CATEGORY_COLORS.length],
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
 * Benefit-box body: the feature label plus a chevron (story 30-1). Used by both
 * gated tiles (chevron visible) and, since story 33.1, the sync box (chevron
 * `invisible`, reserving width only).
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
 * `aria-hidden` on the chevron for two different reasons depending on call site:
 * in a gated tile the `<button>` already carries an accessible name
 * ("<feature> — premium, locked") and the glyph would only add noise; in the sync
 * box (story 33.1) the glyph is `invisible` and exists purely to reserve width,
 * so announcing it would be announcing a spacer.
 *
 * ⚠️ `chevronHidden` is what keeps the three badges ALIGNED (story 33.1,
 * UX-DR39). Whichever item is last in visual order sits flush against the
 * content edge, so a badge with no chevron beside it lands ~26px right of one
 * that has a chevron — measured at +25.06…+27.20px depending on font, which is
 * exactly `chevron box width + gap-3`. The sync box therefore renders THIS
 * component with the glyph made `invisible`: same element, same classes, same
 * text, so the reserved width tracks the real glyph. Three things this must not
 * become:
 *   - `hidden` / `display:none` — collapses the box and reinstates the ~26px gap.
 *   - a `w-[26px]`/`ch`/`em` literal — `›` is TEXT, 5.06–7.20px wide by font, so
 *     a literal drifts (+1.20px under DejaVu Sans).
 *   - a copied span in the sync box — a parity guarantee that re-implements
 *     instead of importing guarantees nothing (story 32.2).
 * And the `mr-auto` above is load-bearing for the same reason: without it the
 * sync box has three flex children and no auto margin, so `justify-between`
 * spreads them — measured at 0.00px at 320/375 but −259.45px at 1280 under the
 * DejaVu Sans stack the alignment e2e pins (−276.93px in the default stack). The
 * shape is what matters: invisible at narrow widths, enormous at wide ones.
 */
function LockedTileContent({
  label,
  chevronHidden = false,
}: {
  label: React.ReactNode
  chevronHidden?: boolean
}): React.ReactElement {
  return (
    <>
      <span className="mr-auto">{label}</span>
      <span
        aria-hidden="true"
        className={`order-last pl-2 text-lg leading-none text-accent${
          chevronHidden ? ' invisible' : ''
        }`}
      >
        ›
      </span>
    </>
  )
}

/**
 * The Multi-device sync box's lock badge (story 33.1, UX-DR39).
 *
 * Sync has no route, so it must not be a `PremiumFeatureGate` — that would make
 * it a `<button>` owning an upgrade dialog, turn a listed benefit into an
 * apparent link, and add a third non-portalled `Modal` to a page that already
 * has two (deferred-work.md:477). This mirrors `CategoryPicker`, which
 * implements the gate's three-state contract "without USING it" for the same
 * reason: badge rendered directly on inert markup.
 *
 * The three states match `PremiumFeatureGate` exactly, in the same order:
 *   - `isLoading` → an inert, aria-hidden placeholder. Reached when the session
 *     seed is `null`, i.e. the resolver ERRORED (`session-seed.ts:44-50,73-79`
 *     returns null = UNVERIFIED, never "signed out"). With a seed present — the
 *     ordinary case — the tier is already resolved at SSR and at first client
 *     paint, so this branch is NOT the normal server render.
 *   - `hasAccess` → nothing.
 *   - everything else (free / lapsed / unauthenticated / errored check) → the badge.
 *
 * ⚠️ Scope of the `hasAccess` branch: it guarantees THIS box shows no lock when
 * THIS status says the user is entitled. It does not guarantee the section as a
 * whole is lock-free for a paying user, because the two gates each own a separate
 * `usePremiumAccess` subscription. With a seed all three read the same hydrated
 * value and agree by construction; with a null seed all three fire independent,
 * uncached checks (`usePremiumAccess.ts:193-198`, deferred-work.md:479), so they
 * can resolve at different moments and, if one fails while the others succeed,
 * can disagree for the rest of the session. Pre-existing between the two gates;
 * this box joins that set rather than creating it. The real fix is the shared
 * tier context already tracked in deferred-work, not a local workaround here.
 *
 * ⚠️ The placeholder wraps the REAL `<PremiumLockBadge />` in a
 * `visibility:hidden` span so its width is the badge's own rather than a literal.
 * That makes the reserved footprint correct BY CONSTRUCTION — it is not measured
 * anywhere: jsdom computes no layout, and the alignment e2e deliberately waits
 * the pending state out before measuring. Treat "no row shift on resolve" as a
 * structural argument, not a tested claim.
 *
 * Fail-closed WITHOUT reading `status.error`, deliberately: no gate in this repo
 * reads it, and an errored check already resolves to `hasAccess: false`, so it
 * falls through to the badge on its own. An `error` branch here would be a
 * divergence dressed up as caution.
 */
function SyncLockBadge({ status }: { status: PremiumAccessStatus }): React.ReactElement | null {
  if (status.isLoading) {
    return (
      <span
        aria-hidden="true"
        className="invisible"
        data-testid="premium-benefit-sync-badge-pending"
      >
        <PremiumLockBadge />
      </span>
    )
  }

  if (status.hasAccess) {
    return null
  }

  return <PremiumLockBadge />
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
 * Label for the Multi-device sync premium benefit (story 20-2, CONTENT-G;
 * amended by story 33.1 / UX-DR39). Unlike Advanced Forecasting / Custom
 * Profiles, sync is an account-wide benefit with no route to open, so it is
 * presented as a static listed benefit — never wrapped in a PremiumFeatureGate
 * and never given a link or an "Open →". Copy is kept consistent with the
 * Features/Pricing "securely stored and synced" wording and claims nothing sync
 * does not do.
 *
 * Since story 30-1 (FR51) its box shares PREMIUM_BOX_BASE with the two gated
 * tiles, so the section reads as one set. Story 33.1 completed that: sync now
 * carries the same lock badge, because it is a premium benefit and the badge
 * says "premium", not "tap me". The difference that carries meaning is the
 * AFFORDANCE — hover, a visible chevron and "Open →" on the openable tiles only
 * — not the colour and no longer the badge.
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

/**
 * Shared label for the Financial summary report premium entry (story 33.2, FR56 /
 * FR53), rendered identically in the locked and unlocked states.
 *
 * ⚠️ The subtitle is bounded by what `/report` actually does, which is LESS than
 * FR53's own wording promises. FR53 says "budget, net worth, and retirement
 * outlook"; story 30-3 formally narrowed it, and the shipped report covers budget,
 * CURRENT net worth and savings only — the retirement and forward-projection inputs
 * are ephemeral `useState` with no persistence, so there is nothing to report on.
 * There are no charts either. And "as a PDF" is deliberately absent from this
 * subtitle: the button calls `window.print()`, so any PDF comes from the user's own
 * browser dialog and the app generates no file. "Built in your browser" carries
 * both the privacy claim and that limit honestly.
 *
 * The name matches the shipped `/settings` tile and the route's `featureName`
 * ("Financial summary report" / "Financial Summary Report") rather than
 * `features.md`'s former "Printable summary report" — one feature must not have two
 * names, which is the drift this whole story exists to remove.
 */
function ReportFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Financial summary report</span>
      <span className="text-sm text-muted">
        A print-ready summary of your budget, net worth and savings, built in your browser
      </span>
    </span>
  )
}

/**
 * Shared label for the Custom categories premium entry (story 33.2, FR56 / FR54),
 * rendered identically in the locked and unlocked states.
 *
 * ⚠️ Two hard limits, both load-bearing:
 *   - Categories apply to INCOME AND EXPENSES ONLY. Savings goals and balance
 *     entries carry no `categoryId`, so "categorize your finances" would be false.
 *   - Categories and their breakdown DO NOT SYNC across devices.
 *     `lib/sync/syncBridge.ts` hard-pins `categoryId: null` on every outgoing row,
 *     and story 30-5 states the copy rule as an absolute: no surface may claim they
 *     do. That is why this subtitle says "your way" rather than anything about
 *     devices, and `docs-content.test.ts` bans sync-adjacent wording from the
 *     equivalent `features.md` bullet.
 *
 * The subtitle NAMES the breakdown ("what each category totals") on purpose. The
 * manager and the breakdown share one route, so they are one benefit entry — which
 * means this copy is the only thing carrying FR54's second half on this surface.
 * Drop those words and half the requirement disappears silently.
 */
function CategoriesFeatureLabel(): React.ReactElement {
  return (
    <span className="flex flex-col">
      <span className="font-medium text-subheading">Custom categories</span>
      <span className="text-sm text-muted">
        Group your income and expenses your way, and see what each category totals
      </span>
    </span>
  )
}

/**
 * One Overview benefit box, discriminated on whether it has a page to open.
 *
 * `openable` is a NEW name for something that already existed only as three
 * co-varying JSX facts — gate-wrapped, `PREMIUM_BOX_INTERACTIVE` vs
 * `surface-inset`, and an `<a href>` with "Open →". Story 33.1 split "is premium"
 * from "is openable" behaviourally; story 33.2 needed the distinction as DATA in
 * order to render the section from the canonical set. It is deliberately not a
 * general capability registry — it describes this section's boxes and nothing else.
 */
type OverviewBenefit =
  | { openable: false; label: () => React.ReactElement }
  | {
      openable: true
      label: () => React.ReactElement
      /** Route the box links to for an entitled user. */
      href: string
      /** Drives `PremiumFeatureGate`'s "<featureName> — premium, locked" name. */
      featureName: string
    }

/**
 * The Overview's copy for the canonical Premium benefit set (story 33.2, FR56).
 *
 * ⚠️ The set — which benefits, in what order — lives in `lib/premium/benefits.ts`.
 * Because this is a `Record<PremiumBenefitId, …>`, forgetting a benefit here is a
 * **compile error** and inventing one is an excess-property error. That is the
 * structural fix for the drift FR56 describes: before story 33.2 this section
 * hand-wrote three boxes while `/docs` listed five and two other surfaces listed a
 * third and fourth variant of "three".
 *
 * Exported for `components/premium/__tests__/benefit-set-parity.test.tsx`, which
 * asserts key-for-key agreement across every surface, and for `HomePage.test.tsx`,
 * which derives its box and tile counts from it rather than hard-coding numbers —
 * six stale literals across four files had to be hunted down to land this story.
 *
 * `featureName` values match the shipped `/settings` tiles exactly
 * ("Financial Summary Report", "Custom Categories") so one feature does not gain a
 * second accessible name.
 */
export const OVERVIEW_BENEFITS: Record<PremiumBenefitId, OverviewBenefit> = {
  sync: { openable: false, label: MultiDeviceSyncLabel },
  forecasting: {
    openable: true,
    label: PremiumFeatureLabel,
    href: '/forecasting',
    featureName: 'Advanced Forecasting',
  },
  // Custom Profiles resolved the /profiles nav-orphan (story 13-3, AC-1/AC-4);
  // enforcement stays server-side (the profile server functions' tier guard) plus
  // the /profiles route gate.
  profiles: {
    openable: true,
    label: CustomProfilesFeatureLabel,
    href: '/profiles',
    featureName: 'Custom Profiles',
  },
  report: {
    openable: true,
    label: ReportFeatureLabel,
    href: '/report',
    featureName: 'Financial Summary Report',
  },
  categories: {
    openable: true,
    label: CategoriesFeatureLabel,
    href: '/categories',
    featureName: 'Custom Categories',
  },
}
