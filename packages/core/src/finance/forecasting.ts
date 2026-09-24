/**
 * Premium Forecasting Features
 *
 * Advanced financial forecasting calculations for paid tier users.
 * Provides scenario modeling, goal tracking, and financial projections.
 *
 * Architecture Requirement: FR5 - Core calculations (premium features)
 */

import {
  type NormalizableFinancialItem,
  calculateGrossPeriodIncome,
  calculateNetPeriodIncome,
  calculateTotalPeriodExpenses,
} from './netIncome'

/**
 * ⚠️ THE UNIT BRIDGE OF THIS WHOLE MODULE. Read before touching either loop.
 *
 * Everything in `./netIncome` and `./normalization` speaks MONTHLY — a row's
 * frequency is folded into a monthly-normalized figure (`normalization.ts:27-30`:
 * `weekly: 52/12`, `annually: 1/12`), rounded per item. But an iteration of the
 * loops below is a YEAR. Multiplying by this constant is what reconciles the two.
 *
 * ⚠️ Apply it to the RECURRING FLOW ONLY. `oneTimeEvents` amounts are already
 * absolute for the year they name, so scaling them is a 12x overstatement of
 * every windfall and every planned cost — see the projection loop.
 *
 * ⚠️ Apply it AFTER normalization, never instead of it — and understand that this
 * is a deliberate TRADE-OFF, not a free win. `weekly * 52` is arithmetically the
 * more exact annual figure; `round(amount * 52/12) * 12` is off by 4 cents on a
 * 100000/wk row (5199996 against 5200000). We take the 4 cents to keep the
 * forecast agreeing with every other surface in the app, all of which round in
 * MONTHLY space. Consistency beats per-surface precision here, because a user
 * comparing the Overview to a forecast must not see two different numbers.
 *
 * ⚠️ The same trade costs the `annually` frequency more than it costs `weekly`,
 * and it is a REGRESSION against the raw-sum helpers this replaced: an `annually`
 * row of 1200013 cents round-trips as `round(1200013/12) * 12` = 1200012, one cent
 * light, where a raw sum reported it exactly. Up to 11 cents per item per year.
 * This matches the app-wide monthly-canonical convention already recorded in
 * `deferred-work.md` ("annual entries display a few cents below the entered
 * amount"), so forecasting is now consistent with the rest of the app rather than
 * exact. Pinned by a test so the figure cannot drift unnoticed.
 *
 * ## ⚠️ `calculateTotalIncome` / `calculateTotalExpenses` were DELETED 2026-09-24
 *
 * Do not reintroduce them. Both were a bare
 * `reduce((sum, item) => sum + item.amount, 0)` — a RAW sum that ignored each
 * row's frequency entirely, so a row's `income` field carried an un-normalized
 * number beside a frequency-normalized `netIncome`. Their DIFFERENCE happened to
 * equal the pre-fix `netIncome` when every row was `monthly` (500000 − 400000 =
 * 100000), which is why nothing noticed; for a `weekly` row they disagreed by the
 * 52/12 factor, silently.
 *
 * Rows now use `calculateGrossPeriodIncome` / `calculateTotalPeriodExpenses`
 * (`./netIncome`) lifted by `MONTHS_PER_YEAR`, so the money fields share one
 * period and reconcile: `income - expenses === netIncome` minus that year's
 * one-time events.
 *
 * ⚠️ That reconciliation holds for the RECURRING terms in whole cents, but it is
 * NOT an unconditional integer-cents guarantee for the row: `oneTimeForYear` is
 * the one money term that never passes `validateAmount`, so a persisted event
 * amount of `0.5` yields fractional savings and one of `Infinity` poisons every
 * figure. Both are pre-existing and recorded in `deferred-work.md`; do not read
 * the sentence above as a claim that they cannot happen.
 */
const MONTHS_PER_YEAR = 12

/**
 * Forecasting scenario input
 */
export interface ForecastingScenario {
  name: string
  description?: string
  // Income adjustments (percentage changes)
  incomeGrowthRate: number // Annual growth rate as decimal (e.g., 0.05 for 5%)
  // Expense adjustments (percentage changes)
  expenseGrowthRate: number // Annual growth rate as decimal
  /**
   * ⚠️⚠️ THESE TWO ARE A PERSISTENCE CARRIER, NOT AN ENGINE INPUT.
   *
   * `calculateFinancialForecast` never reads them — it projects from the
   * `currentData` argument. What they actually do is carry the Scenario
   * Builder's income/expense rows into the saved `scenarioData` JSON so a
   * forecast can be reopened: written in `scenario-builder.tsx` on save, read
   * back by its `itemsFromSaved` on reload.
   *
   * So: **do not cite them as scenario-expressive** (story 57.1 did, in three
   * comments, and shipped copy promising situations the engine cannot model),
   * and **do not delete them as dead** (the follow-up nearly did; deleting them
   * breaks saved-forecast reload). The same items travel under two names for
   * two different purposes. If that is ever unified, the save format and the
   * `version` column both need a plan.
   */
  newIncome?: NormalizableFinancialItem[]
  newExpenses?: NormalizableFinancialItem[]
  /**
   * One-time events, keyed to a projection year. **`amount` is SIGNED**:
   * positive is money in, negative is money out (story `forecast-1`). The
   * engine simply sums them into that year's net income, so both directions
   * work and always have; it was the Scenario Builder's input that clamped
   * everything to >= 0 until `forecast-1` added an explicit direction control.
   * Pinned both ways in `__tests__/forecasting.test.ts`.
   */
  oneTimeEvents?: Array<{ year: number; amount: number }>
}

/**
 * Yearly forecast result
 */
export interface YearlyForecast {
  year: number
  income: number // Total income in cents
  expenses: number // Total expenses in cents
  netIncome: number // Net income in cents
  savings: number // Savings in cents
  investments: number // Investments in cents
  netWorth: number // Net worth in cents
}

/**
 * Complete forecasting result
 */
export interface ForecastingResult {
  scenario: ForecastingScenario
  baseline: YearlyForecast[] // Projection without scenario
  projection: YearlyForecast[] // Projection with scenario
  summary: {
    startingNetWorth: number
    endingNetWorth: number
    totalGrowth: number
    averageAnnualGrowth: number
  }
}

/**
 * Calculates financial forecast based on current data and scenario
 *
 * @param currentData - Current financial data (income, expenses, savings, investments)
 * @param scenario - Forecasting scenario with assumptions
 * @param years - Number of years to project
 * @returns Complete forecasting result
 */
export function calculateFinancialForecast(
  currentData: {
    income: NormalizableFinancialItem[]
    expenses: NormalizableFinancialItem[]
    savings: number // Current savings in cents
    investments: number // Current investments in cents
  },
  scenario: ForecastingScenario,
  years = 10
): ForecastingResult {
  const baseline: YearlyForecast[] = []
  const projection: YearlyForecast[] = []

  // Calculate baseline (current trends without scenario adjustments)
  let currentSavings = currentData.savings
  const currentInvestments = currentData.investments
  // Every figure a baseline row reports is ANNUAL: the monthly-normalized totals
  // are lifted to a year once, here, rather than per iteration.
  const baselineAnnualIncome = calculateGrossPeriodIncome(currentData.income) * MONTHS_PER_YEAR
  const baselineAnnualExpenses =
    calculateTotalPeriodExpenses(currentData.expenses) * MONTHS_PER_YEAR
  const baselineAnnualNetIncome =
    calculateNetPeriodIncome(currentData.income, currentData.expenses) * MONTHS_PER_YEAR

  for (let year = 1; year <= years; year++) {
    // Apply the year's net income BEFORE recording the row, so the row reports
    // a CLOSING balance (story `forecast-2`). See the projection loop below for
    // the full rationale — the two loops must agree on WHEN a row is taken, or
    // baseline and projection are not comparable at all.
    //
    // ⚠️ They still disagree on WHAT they model: this loop never grows
    // investments while the projection compounds them at 7%, so with an empty
    // scenario the two series diverge from the first plotted point. Pre-existing
    // and recorded in `deferred-work.md` — note the annualization below makes the
    // divergence numerically LARGER, since the flow driving it is now 12x.
    currentSavings += baselineAnnualNetIncome
    // Simple investment growth (no compounding in baseline)

    const baselineYear: YearlyForecast = {
      year,
      income: baselineAnnualIncome,
      expenses: baselineAnnualExpenses,
      netIncome: baselineAnnualNetIncome,
      savings: currentSavings,
      investments: currentInvestments,
      netWorth: currentSavings + currentInvestments,
    }
    baseline.push(baselineYear)
  }

  // Calculate projection with scenario adjustments
  let projSavings = currentData.savings
  let projInvestments = currentData.investments

  for (let year = 1; year <= years; year++) {
    // Adjust income and expenses by growth rates
    const adjustedIncome = currentData.income.map((item) => ({
      ...item,
      amount: Math.round(item.amount * (1 + scenario.incomeGrowthRate) ** year),
    }))
    const adjustedExpenses = currentData.expenses.map((item) => ({
      ...item,
      amount: Math.round(item.amount * (1 + scenario.expenseGrowthRate) ** year),
    }))

    // Calculate net income with adjustments
    const netIncome = calculateNetPeriodIncome(adjustedIncome, adjustedExpenses)

    // Add one-time events for this year
    const oneTimeForYear =
      scenario.oneTimeEvents
        ?.filter((e) => e.year === year)
        .reduce((sum, e) => sum + e.amount, 0) || 0

    // ⚠️ THE ONE-TIME EVENT IS NOT SCALED, AND MUST NOT BE.
    // `netIncome` is a monthly-normalized RECURRING flow, so it needs lifting to
    // a year. `oneTimeForYear` is already the absolute amount for THIS year — a
    // 50,000.00 house deposit is 50,000.00, not 600,000.00. Writing this as
    // `(netIncome + oneTimeForYear) * MONTHS_PER_YEAR` would overstate every
    // windfall and every planned cost twelvefold; the one-time-event tests above
    // fail on exactly that mutation, because their deltas are asserted as the
    // event's own amount.
    const totalNetIncome = netIncome * MONTHS_PER_YEAR + oneTimeForYear

    /**
     * ⚠️ APPLY THIS YEAR'S FLOW BEFORE RECORDING THE ROW (story `forecast-2`).
     *
     * These two statements used to come AFTER the push, which made every row
     * report an OPENING balance while its `netIncome` was that year's flow —
     * two different instants in one record. The visible consequences:
     *   - year 1's `netWorth` was identical to `summary.startingNetWorth`, so a
     *     forecast appeared to achieve nothing in its first year;
     *   - a one-time event seemed to land a year late in the balance series;
     *   - an event in the FINAL year never landed at all — `endingNetWorth` and
     *     `totalGrowth` were byte-identical to the baseline — so a cost dated to
     *     the last forecast year, the most natural place for a planned purchase,
     *     was invisible in both the chart and the summary;
     *   - N years of saving accumulated only N-1 times, and investments
     *     compounded only N-1 times.
     *
     * A row now reports the balance at the END of its year. `startingNetWorth`
     * is still the pre-projection figure, so `totalGrowth` spans the full term.
     *
     * ⚠️ "This year's flow" is now literally true of the arithmetic as well.
     * It was not until 2026-09-24: `calculateNetPeriodIncome` returns a MONTHLY
     * figure and this loop used to add one of them per YEARLY iteration, making
     * every savings and net-worth figure roughly a twelfth of the truth (a
     * 1000.00/mo surplus accumulated 1000.00 a year instead of 12,000.00). The
     * `* MONTHS_PER_YEAR` below is that fix. Do not remove it to "simplify" —
     * see the `MONTHS_PER_YEAR` docblock for which term it may and may not touch.
     */
    projSavings += totalNetIncome
    // Investment growth with compounding
    projInvestments = Math.round(projInvestments * 1.07) // Assume 7% return

    const yearProjection: YearlyForecast = {
      year,
      income: calculateGrossPeriodIncome(adjustedIncome) * MONTHS_PER_YEAR,
      expenses: calculateTotalPeriodExpenses(adjustedExpenses) * MONTHS_PER_YEAR,
      netIncome: totalNetIncome,
      savings: projSavings,
      investments: projInvestments,
      netWorth: projSavings + projInvestments,
    }
    projection.push(yearProjection)
  }

  // Calculate summary
  const startingNetWorth = currentData.savings + currentData.investments
  // `projection` has one entry per year, so a 0-year forecast leaves it empty.
  // Falling back to the starting figure keeps `totalGrowth` at 0 rather than NaN,
  // which is what an empty projection means.
  const lastProjection = projection[projection.length - 1]
  const endingNetWorth = lastProjection ? lastProjection.netWorth : startingNetWorth
  const totalGrowth = endingNetWorth - startingNetWorth
  const averageAnnualGrowth = totalGrowth / years

  return {
    scenario,
    baseline,
    projection,
    summary: {
      startingNetWorth,
      endingNetWorth,
      totalGrowth,
      averageAnnualGrowth,
    },
  }
}

/**
 * Calculates goal progress and timeline
 */
export interface GoalCalculation {
  targetAmount: number
  currentAmount: number
  monthlyContribution: number
  annualReturnRate: number
  yearsToGoal: number
  monthlyAmountNeeded: number
}

/**
 * Calculates how long it will take to reach a financial goal
 *
 * @param targetAmount - Target amount in cents
 * @param currentAmount - Current amount in cents
 * @param monthlyContribution - Monthly contribution in cents
 * @param annualReturnRate - Annual return rate as decimal
 * @returns Goal calculation with timeline
 */
export function calculateGoalTimeline(
  targetAmount: number,
  currentAmount: number,
  monthlyContribution: number,
  annualReturnRate: number
): GoalCalculation {
  if (currentAmount >= targetAmount) {
    return {
      targetAmount,
      currentAmount,
      monthlyContribution,
      annualReturnRate,
      yearsToGoal: 0,
      monthlyAmountNeeded: 0,
    }
  }

  let years = 0
  let amount = currentAmount
  const monthlyReturnRate = annualReturnRate / 12

  while (amount < targetAmount && years < 100) {
    years++
    // Compounding growth with monthly contributions
    amount = amount * (1 + monthlyReturnRate) + monthlyContribution * 12
  }

  // Calculate monthly amount needed to reach goal in a specific timeframe
  // Using future value of annuity formula
  const months = years * 12
  // FV = PMT * [((1 + r)^n - 1) / r] * (1 + r)
  // We need to solve for PMT, but for simplicity we'll use an approximation
  const monthlyAmountNeeded = Math.round((targetAmount - currentAmount) / months)

  return {
    targetAmount,
    currentAmount,
    monthlyContribution,
    annualReturnRate,
    yearsToGoal: Math.round(years * 10) / 10, // Round to 1 decimal
    monthlyAmountNeeded,
  }
}

/**
 * Saves a forecasting scenario for later retrieval
 * This would be used with database persistence for paid users
 */
export interface SavedScenario {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}

// Note: Actual save/load functionality would be implemented in Server Functions
// with database access for paid tier users
