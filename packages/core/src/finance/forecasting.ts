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
import { validateAmount } from './normalization'

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
 * light, where a raw sum reported it exactly.
 *
 * The round-trip error is bounded by **-5..+6 cents per item per year**, and it
 * can go EITHER WAY. Writing `x = 12k + r` with `r` in 0..11, `round(x/12)` is
 * `k` for `r <= 5` (short by `r`) and `k+1` for `r >= 6` (OVER by `12 - r`).
 * MEASURED over x = 1..2_000_000: the error range is exactly -5..+6.
 * Counterexample to the "always light" reading: 1200018 -> 1200024, six cents
 * HEAVY. (An earlier version of this docblock said "up to 11 cents" and framed
 * the error as always light. 11 is the bound for TRUNCATION; `normalization.ts`
 * uses `Math.round`, so that figure was wrong in both magnitude and sign.)
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
 * period and reconcile: `income - expenses === netIncome` **for the RECURRING
 * terms only**.
 *
 * ⚠️ In any year matching a `oneTimeEvents` entry the row does NOT reconcile:
 * `netIncome` carries `netIncome * 12 + oneTimeForYear` while `income` and
 * `expenses` carry only the recurring annualized terms, so
 * `income - expenses === netIncome - oneTimeForYear`. The annualization WIDENED
 * this gap, because the recurring half is now 12x and the event half is not.
 * Anything deriving a surplus or savings-rate from `row.income - row.expenses`
 * gets a different number than `row.netIncome` in exactly the years a user cares
 * about most. Pinned by the one-time-event test, which asserts the discrepancy.
 *
 * The row is in whole cents for the one-time term too (story 77.1): every event
 * dated INSIDE the projection window passes `validateAmount` and is then
 * rounded, exactly as `normalizeToMonthly` treats every recurring amount — see
 * `eventAmountInCents`. (An event dated outside the window is never summed, so
 * it is never validated either; it contributes nothing.) Until 77.1 it was the
 * one money term that skipped both, so `0.5` left fractional savings and
 * `Infinity` poisoned every figure.
 *
 * ⚠️ Validating each amount is not enough on its own: several individually
 * finite events can SUM past `Number.MAX_VALUE` (two of 1.7e308 cents → Infinity,
 * and a later pair of negatives → NaN; measured by 77.1's code review). The
 * projection loop therefore also refuses a non-finite running balance — see
 * `FORECAST_OUT_OF_RANGE`.
 */
const MONTHS_PER_YEAR = 12

/**
 * The projection period the engine accepts: a WHOLE number of years, 1 to 30
 * inclusive (story 77.1, FR124). Defined here, once, and imported by the
 * Scenario Builder's field and by the saved-forecast filter in
 * `routes/forecasting.tsx`, so the three can never disagree.
 *
 * ⚠️ Why the engine enforces it and does not trust its callers: both loops run
 * `for (year = 1; year <= years; …)`. `Infinity` never terminates, and
 * `Number.MAX_VALUE` and a plain finite `1e9` do not finish in any usable time
 * (1e9 would also push a billion rows into two arrays). MEASURED in the bounded
 * harness (`__tests__/forecasting-bounds.test.ts`): all three were killed by its
 * 5 s timeout before this guard existed. (That is what was measured — a child
 * process timing out — not a browser tab observed freezing.) `years = 0` made `averageAnnualGrowth` 0/0 = NaN, and
 * a fractional `2.5` produced 2 rows but divided growth by 2.5.
 */
export const MIN_FORECAST_YEARS = 1
export const MAX_FORECAST_YEARS = 30
/**
 * The period a forecast opens with, and the one a saved row falls back to when
 * its own `years` is out of range (`routes/forecasting.tsx`). Also the engine's
 * default parameter.
 */
export const DEFAULT_FORECAST_YEARS = 10

/**
 * True for an integer `years` in `MIN_FORECAST_YEARS..MAX_FORECAST_YEARS`.
 * `Number.isInteger` already rejects `NaN` and `±Infinity`; `unknown` because the
 * value may come from a parsed saved row.
 */
export function isValidForecastYears(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FORECAST_YEARS &&
    value <= MAX_FORECAST_YEARS
  )
}

/**
 * The growth rates the engine accepts, as decimals: −100% to +100% inclusive
 * (story 81.1, FR132). Defined here, once, and imported by the Scenario Builder's
 * two growth-rate fields, so the field and the engine cannot disagree.
 *
 * ⚠️ Why −100% is the floor: growth is applied as `amount * (1 + rate) ** year`.
 * Below −1 the base is negative, so a row's amount ALTERNATES SIGN every year
 * (MEASURED before 81.1: −150% gave year-1 income −3,000,000 and year-10 income
 * +5,856). −1 itself is meaningful: the income or expense stops from year 1.
 *
 * ⚠️ Why +100% is the ceiling: doubling every year is already far beyond any
 * real wage or price growth. Above it figures run to 1e24-1e38 cents over 30
 * years (MEASURED: +1000% gave an ending net worth of 1.15e38) long before
 * anything overflows, and render as nonsense.
 */
export const MIN_GROWTH_RATE = -1
export const MAX_GROWTH_RATE = 1

/**
 * The refusal for a growth rate outside `MIN_GROWTH_RATE..MAX_GROWTH_RATE`, or not
 * a finite number. Exported so the tests pin the exact text.
 */
export const GROWTH_RATE_OUT_OF_RANGE = `Growth rates must be from ${MIN_GROWTH_RATE * 100}% to ${
  MAX_GROWTH_RATE * 100
}%`

/**
 * True for a finite number in `MIN_GROWTH_RATE..MAX_GROWTH_RATE`. `unknown`
 * because the value may come from a parsed saved row (a JSON-flattened NaN is
 * `null`).
 */
export function isValidGrowthRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_GROWTH_RATE &&
    value <= MAX_GROWTH_RATE
  )
}

/**
 * The refusal when a projection's running balance stops being a finite number
 * (story 77.1 code review, P2). Exported so the tests pin the exact text.
 */
export const FORECAST_OUT_OF_RANGE = 'Forecast amounts are too large to project'

/**
 * A one-time event's amount as whole cents, validated exactly as every recurring
 * amount is: `validateAmount` (throws on `NaN`, `±Infinity`, `null`, a
 * non-number), then `Math.round` — the same two steps `normalizeToMonthly`
 * applies. ⚠️ `validateAmount` ACCEPTS a fraction; recurring amounts reach whole
 * cents only because of the `Math.round` that follows it, so rounding here is
 * parity, and throwing on a fraction would be a stricter rule than any other
 * money term follows.
 */
function eventAmountInCents(amount: unknown): number {
  validateAmount(amount)
  return Math.round(amount)
}

/**
 * Forecasting scenario input
 */
export interface ForecastingScenario {
  name: string
  description?: string
  // Income adjustments (percentage changes)
  // Annual growth rate as a decimal (e.g., 0.05 for 5%), from -1 to 1 inclusive:
  // the engine refuses anything else (`isValidGrowthRate`, story 81.1).
  incomeGrowthRate: number
  // Expense adjustments (percentage changes); same decimal form and bounds.
  expenseGrowthRate: number
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
   * engine sums them (each validated and rounded to whole cents since story
   * 77.1 — see `eventAmountInCents`) into that year's net income, so both directions
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
 * @param years - Number of years to project; must satisfy `isValidForecastYears`
 * @returns Complete forecasting result
 * @throws Error if `years` is not a whole number of years in 1-30; if either
 *   growth rate is not a finite number from −1 to 1 (`GROWTH_RATE_OUT_OF_RANGE`);
 *   if the starting `savings` or `investments`, or a one-time event dated inside
 *   the window, is not a finite number (`validateAmount`); or if the projection's
 *   balance overflows (`FORECAST_OUT_OF_RANGE`)
 */
export function calculateFinancialForecast(
  currentData: {
    income: NormalizableFinancialItem[]
    expenses: NormalizableFinancialItem[]
    savings: number // Current savings in cents
    investments: number // Current investments in cents
  },
  scenario: ForecastingScenario,
  years = DEFAULT_FORECAST_YEARS
): ForecastingResult {
  // REFUSE rather than clamp (story 77.1, D1): a clamp would silently project a
  // period the caller never asked for. Both callers already surface a throw — the
  // builder as its calculation banner, the server as `{ success: false }`. This
  // must stay BEFORE the first loop; see `MIN_FORECAST_YEARS`.
  if (!isValidForecastYears(years)) {
    throw new Error(
      `Projection period must be a whole number of years from ${MIN_FORECAST_YEARS} to ${MAX_FORECAST_YEARS}`
    )
  }
  // Refuse, not clamp, a growth rate outside −100%..+100% (story 81.1, D2). Both
  // are checked EVEN WHEN no rows of that kind exist: `[].map(...)` never
  // evaluates the rate, so before 81.1 a NaN rate with no rows passed silently and
  // a Save would persist `null` (TRACED: JSON has no NaN). With rows, a NaN rate surfaced only as
  // `validateAmount`'s "Amount must be a finite number", which names the wrong input.
  if (
    !isValidGrowthRate(scenario.incomeGrowthRate) ||
    !isValidGrowthRate(scenario.expenseGrowthRate)
  ) {
    throw new Error(GROWTH_RATE_OUT_OF_RANGE)
  }
  // The starting balances are money terms like every other (story 81.1, the 77.1
  // review rider). Unvalidated, a NaN/Infinity here was caught only by the
  // running-balance check below and reported as FORECAST_OUT_OF_RANGE ("too large
  // to project"), which misdescribes a missing or corrupt starting figure.
  validateAmount(currentData.savings)
  validateAmount(currentData.investments)

  const baseline: YearlyForecast[] = []
  const projection: YearlyForecast[] = []

  // Calculate baseline (current trends without scenario adjustments)
  let currentSavings = currentData.savings
  let currentInvestments = currentData.investments
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
    // ⚠️ They now also agree on WHAT they model (story 67.1, FR106). Until
    // 2026-09-24 this loop never grew investments while the projection compounded
    // them at 7%, so an EMPTY scenario split the two series from the first plotted
    // point by `investments_0 * (1.07^n - 1)` — the investment term alone. Both
    // loops now apply the same 7%, so a scenario with no adjustments produces two
    // identical series and the "if nothing changes" line means what it says.
    //
    // ⚠️ That equality is PINNED by the `investment compounding, both loops` block
    // in `__tests__/forecasting.test.ts` (four tests: a whole-result `toEqual` on
    // a flat scenario, the hand-derived 7% chain on the baseline rows, a rounding
    // probe, and the cross-scenario invariant that the two investment series match
    // for EVERY scenario, since no scenario lever touches investments).
    //
    // ⚠️ Three things about this statement are load-bearing and must stay in step
    // with the projection's `Math.round(projInvestments * 1.07)` — search that
    // identifier; every line number this comment has carried has rotted within
    // days, twice inside story 67.1's own review: the RATE, the per-year
    // `Math.round`, and the POSITION (after the flow, before the row is taken,
    // because rows report CLOSING balances).
    //
    // ⚠️⚠️ THE FOUR TESTS ARE NOT EQUALLY SENSITIVE, and an earlier version of this
    // comment claimed they were ("changing one loop without the other fails all
    // four"). MEASURED, per lever:
    //   · RATE (baseline 1.07 -> 1.06)          -> 4 of 4 red
    //   · POSITION (move after `baseline.push`) -> 4 of 4 red, series shifted a year
    //   · REMOVE the statement entirely          -> 4 of 4 red
    //   · DROP the `Math.round` here             -> 1 of 4 red (the rounding probe ONLY)
    //   · CARRY a fraction, round at the row     -> 1 of 4 red (the rounding probe ONLY)
    //   · change the PROJECTION's rate alone     -> 3 of 4 red (the baseline-only
    //     test reads `r.baseline` and cannot see it)
    // The rounding lever is weak because the `toEqual` test's fixture is
    // 1_000_000, and `1.07 x 1000000` (and the next two steps) are EXACT in
    // IEEE-754 — so an unrounded baseline produces byte-identical output there.
    // Only the rounding probe's own fixture can see it. The carry-a-fraction
    // variant is worse still: it is INVISIBLE to 1_000_000 and to 333_333 alike,
    // and diverges from per-year rounding for 44% of the first 2,000,000 starting
    // balances — which is why that probe now runs on 100_007 and asserts the
    // wrong chain explicitly. Do not infer suite sensitivity; the probe is the
    // guard, and its fixture is load-bearing.
    //
    // ⚠️ The recurring flow was never a term in that old gap and is not one now.
    // With a flat scenario this loop adds `baselineAnnualNetIncome` and the
    // projection adds `netIncome * MONTHS_PER_YEAR` — identical values, so it
    // cancels exactly at any scale. (An earlier version of this comment claimed
    // the 2026-09-24 annualization made the divergence "numerically LARGER, since
    // the flow driving it is now 12x". It did not, in either direction. Twelve
    // times zero is still zero. `deferred-work.md` carried the same false claim
    // and is corrected by this story.)
    //
    // ⚠️ STILL OPEN, and this line makes it load-bearing in one more place: the 7%
    // is hard-coded with no parameter and no user control. `deferred-work.md`
    // records it as a FOURTH logging (three before this story, re-anchored by it).
    // Fixing it means deciding whether forecasting exposes its own rate control —
    // its own story, not this one.
    currentSavings += baselineAnnualNetIncome
    // Compound investments at the SAME 7% the projection uses, in the SAME
    // position (after the flow, before the row is taken) and with the SAME
    // per-year `Math.round` as the projection's `projInvestments` statement
    // (search that identifier — deliberately not cited by line).
    // Any of the three drifting apart reopens the divergence this story closed.
    currentInvestments = Math.round(currentInvestments * 1.07)

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

    // Add one-time events for this year. Each amount is validated and rounded
    // (story 77.1). ⚠️ Do not reintroduce a `|| 0` on this sum to "absorb" a bad
    // amount: it replaced the WHOLE YEAR'S sum, so one `NaN` event silently erased
    // every valid event dated the same year (measured before 77.1).
    const oneTimeForYear = (scenario.oneTimeEvents ?? [])
      .filter((e) => e.year === year)
      .reduce((sum, e) => sum + eventAmountInCents(e.amount), 0)

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
    // Refuse, not clamp (D1), once the balance leaves finite numbers — several
    // individually valid events can sum past MAX_VALUE. Checked on the SUM, so an
    // overflow in either term (Infinity, or Infinity + -Infinity = NaN) is caught.
    if (!Number.isFinite(projSavings + projInvestments)) {
      throw new Error(FORECAST_OUT_OF_RANGE)
    }

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
  // `projection` has one entry per year and the guard at the top makes `years`
  // at least 1, so it is never empty here. The fallback is kept only as a
  // defensive default; it is no longer reachable (it was, for `years = 0`,
  // until story 77.1).
  const lastProjection = projection[projection.length - 1]
  const endingNetWorth = lastProjection ? lastProjection.netWorth : startingNetWorth
  const totalGrowth = endingNetWorth - startingNetWorth
  // `years >= 1` by the guard, so this can no longer be 0/0 = NaN.
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
