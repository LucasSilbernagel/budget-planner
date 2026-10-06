/**
 * Premium Forecasting Features
 *
 * Advanced financial forecasting calculations for paid tier users.
 * Provides scenario modeling, goal tracking, and financial projections.
 *
 * Architecture Requirement: FR5 - Core calculations (premium features)
 */

import { monthlyContributionCents } from '../services/balanceTracking'
import {
  type NormalizableFinancialItem,
  calculateGrossPeriodIncome,
  calculateNetPeriodIncome,
  calculateTotalPeriodExpenses,
} from './netIncome'
import { type Frequency, validateAmount } from './normalization'

/**
 * ⚠️ THE UNIT BRIDGE OF THIS WHOLE MODULE. Read before touching either loop.
 *
 * Everything in `./netIncome` and `./normalization` speaks MONTHLY — a row's
 * frequency is folded into a monthly-normalized figure (`normalizeToMonthly`:
 * `amount × periodsPerYear / 12`, story 105.1), rounded per item. But an iteration of the
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
 * The return a NEW investment row is given (story 100.3, D2): 6% a year, as a
 * decimal like the growth rates. The Scenario Builder seeds every investment row
 * with it, and a saved forecast whose row has no usable rate reloads at it (D3).
 * Defined here, once, so the builder, the saved-forecast mapper and the tests
 * share one constant. The ENGINE never applies it on its own: an investment row
 * without a rate is refused (`INVESTMENT_RETURN_OUT_OF_RANGE`, D4), so there is
 * no hidden second default.
 */
export const DEFAULT_INVESTMENT_RETURN = 0.06

/**
 * The refusal for an investment row whose `annualReturn` is missing, not a finite
 * number, or outside `MIN_GROWTH_RATE..MAX_GROWTH_RATE` (story 100.3, FR166).
 * Same bounds and the same check (`isValidGrowthRate`) as the growth rates: below
 * −100% a balance would alternate sign, above +100% the figures run away.
 */
export const INVESTMENT_RETURN_OUT_OF_RANGE = `Investment returns must be from ${
  MIN_GROWTH_RATE * 100
}% to ${MAX_GROWTH_RATE * 100}%`

/**
 * The refusal when a projection's running balance stops being a finite number
 * (story 77.1 code review, P2). Exported so the tests pin the exact text.
 */
export const FORECAST_OUT_OF_RANGE = 'Forecast amounts are too large to project'

/**
 * One savings row the projection tracks separately (story 100.1, FR164): its
 * starting `balance` and the `monthlyContribution` paid into it, both in cents.
 *
 * ⚠️ Rows SPLIT savings, they do not add to it. Every cent of a year's net income
 * already lands in `savings` (`projSavings += totalNetIncome`), so a contribution
 * only moves money from the unassigned remainder into a row. Totals, net worth,
 * the baseline and the summary are identical with or without SAVINGS rows (pinned
 * by the strip-and-`toEqual` tests in `__tests__/forecasting.test.ts`).
 *
 * ⚠️ Since story 100.2 that is no longer true of the totals as a whole: a counted
 * contribution to an INVESTMENT row (`BalanceAccountInput`) moves money out of
 * savings, so `savings` and the remainder both fall by it. The savings rows still
 * only split whatever `savings` is.
 */
export interface SavingsAccountInput {
  balance: number
  monthlyContribution: number
}

/**
 * The refusal when the savings rows' balances do not add up to
 * `currentData.savings` (story 100.1). The engine takes both and insists they
 * agree, so two callers can never disagree about the starting figure.
 */
export const SAVINGS_ROWS_MISMATCH = 'Savings account balances must add up to the starting savings'

/** The refusal for a negative savings row balance or contribution (story 100.1). */
export const SAVINGS_ROW_NEGATIVE = 'Savings account balances and contributions must be 0 or more'

/**
 * One investment or debt the projection tracks separately (story 100.2, FR165).
 * Money in cents. `balance` is a positive MAGNITUDE for both types (a debt of
 * 5,000.00 is `500000`, never `-500000`). `contribution` is the amount at
 * `frequency` cadence, as `/balance` stores it, and is normalised through
 * `monthlyContributionCents` (the single chokepoint), never read raw.
 *
 * Each year, after the year's net income and before the row is taken:
 *   - investment: `round(balance × (1 + annualReturn)) + annual contribution`
 *     (growth on the opening balance at the row's OWN rate, story 100.3, then the
 *     contributions, 100.2 D7). A contribution NOT flagged
 *     `contributionRecordedAsExpense === true` also leaves savings; a flagged one
 *     does not, because net income already lost it (story 45.1, FR72).
 *   - debt: pays `min(annual payment, balance)`, so the balance falls to
 *     `max(0, balance − annual payment)`. No interest (D2). Story 102.2 (FR170,
 *     replacing 100.2 D4): what the row PAID that year is cash out, added to the
 *     year's `expenses` and taken from its `netIncome` (and so from savings), in
 *     both loops. Nothing is paid once the debt is 0, so the payment stops at
 *     payoff. It is not grown by `expenseGrowthRate` (a fixed instalment, D4). A
 *     debt flagged `contributionRecordedAsExpense === true` ("Payment already in
 *     Expenses") keeps the 100.2 D4 math: it falls, and takes nothing from cash,
 *     because an Expenses line already does. Saved forecasts from before version
 *     5 reload their debts flagged (D1), so they project exactly as saved.
 */
export interface BalanceAccountInput {
  type: 'investment' | 'debt'
  balance: number
  contribution: number
  frequency: Frequency
  /**
   * Investment row (story 45.1): the contribution is already out of take-home
   * pay or an Expenses line, so it does not leave savings again. Debt row (story
   * 102.2, D1): the payment is already an Expenses line, so the row takes
   * nothing from cash (the 100.2 D4 math). Read strictly (`=== true`): anything
   * else means the money leaves savings, so no row creates money.
   */
  contributionRecordedAsExpense?: boolean
  /**
   * The row's annual return as a decimal (0.06 = 6%), story 100.3 (FR166).
   * REQUIRED on an investment row: it must satisfy `isValidGrowthRate` (finite,
   * −1..1), else `INVESTMENT_RETURN_OUT_OF_RANGE`; there is no engine default (D4).
   * Ignored, and not validated, on a debt row (100.2 D2: no debt interest).
   * The engine's old fixed 7% survives ONLY on the row-less path (no
   * `balanceAccounts`), which the Scenario Builder never takes (D5).
   */
  annualReturn?: number
}

/** The refusal for a negative investment/debt balance or contribution (story 100.2). */
export const BALANCE_ROW_NEGATIVE =
  'Investment and debt balances and contributions must be 0 or more'

/**
 * The refusal when the investment rows' balances do not add up to
 * `currentData.investments` (story 100.2), the same rule as `SAVINGS_ROWS_MISMATCH`.
 * Debt rows are not part of that sum.
 */
export const BALANCE_ROWS_MISMATCH = 'Investment balances must add up to the starting investments'

/**
 * The refusal for a balance row that is neither an investment nor a debt (story
 * 100.2). Typed API, but its input can come from parsed JSON.
 */
export const BALANCE_ROW_TYPE = 'Each balance row must be an investment or a debt'

/** How many units of float error (`|x| × Number.EPSILON`) a product may carry. */
const ROUNDING_ERROR_EPSILONS = 4
/** The widest window around .5 that is still snapped, in cents. */
const MAX_HALF_CENT_SNAP = 1e-6

/**
 * Story 104.1 (FR172): `Math.round`, except that a value float error left within
 * a few ulps of an exact half cent is rounded as that half (toward +Infinity,
 * `Math.round`'s own rule, D4). The engine's five growth sites round here.
 * `normalizeToMonthly` (`normalization.ts`) does not use it: since story 105.1 it
 * multiplies by an integer periods-per-year before dividing, which is exact.
 *
 * Why: `100 × 1.015` is `101.49999999999999`, so bare `Math.round` gave 101 where
 * the decimal answer is 102 (RD1, 100.3 review: 8,415 of b in 0..1,999,999 at
 * 1.5%, 3,650 at 4.5%, 1,154 at 5.5%, 0 at 6% and 7%).
 *
 * ⚠️ The snap is only as safe as the RATE's decimal grain is coarse. A rate with
 * k percent decimals puts true fractions on a 10^-(k+2) grid; once the window
 * (4ε·|x|, ~9e-7 at 1e9) reaches that grid, a TRUE .4999999 is snapped UP. So
 * a 5+-decimal rate (3.333333%) can round 1 cent high below the cap — MEASURED
 * in code review, accepted by Lucas 2026-10-06 (RD-1, deferred-work).
 * The snap is CAPPED at a 1e-6 window (~1.126e9 cents, ~$11.3M): above it this is
 * bare `Math.round`, so the RD1 miss survives there at any rate (deferred).
 * The cap value is empirical, not derived. MEASURED (story 104.1 dev) against
 * an integer oracle at 5.555%, 200,000 balances from 1e13 cents: uncapped windows
 * of 1, 2 and 4 epsilons gave 560, 950 and 1,730 mismatches,
 * `Math.round(+x.toPrecision(15))` 9,930, bare `Math.round` 170, this rule 170.
 * Do not widen either constant without re-running `forecasting.rounding.test.ts`.
 */
export function roundCents(x: number): number {
  const window = Math.abs(x) * Number.EPSILON * ROUNDING_ERROR_EPSILONS
  if (!(window <= MAX_HALF_CENT_SNAP)) return Math.round(x)
  const floor = Math.floor(x)
  // `floor + 0.5` is exact here, and `Math.round` of it keeps the sign of a zero
  // result (-0.5 → -0) as bare `Math.round` does.
  return Math.abs(x - floor - 0.5) <= window ? Math.round(floor + 0.5) : Math.round(x)
}

/**
 * One year of the balance rows (story 100.2): each row's CLOSING balance from its
 * opening balance. Shared by BOTH loops (D5), so baseline and projection cannot
 * model them differently. `growthMultipliers[i]` is the investment row's
 * `1 + annualReturn` (story 100.3), computed once before the loops.
 *
 * ⚠️ Written as `balance × (1 + r)`, never `balance + balance × r`: MEASURED
 * (2026-10-05) `1 + 0.07 === 1.07` and `round(b × 1.07) === round(b × (1 + 0.07))`
 * for every integer b in 0..1,999,999, so a row at 7% reproduces 100.2's figures
 * to the cent. The other form was not measured for every rate.
 *
 * `countedDebtPaid` (story 102.2, FR170) is what the UNFLAGGED debt rows paid
 * this year, `opening − closing`: the full payment while owed, the remainder in
 * the payoff year, 0 after. Both loops take it out of the year's net income.
 * Pure on the opening balances, so a loop can step the rows BEFORE it applies
 * the year's net income.
 */
function stepBalanceRows(
  rows: readonly BalanceAccountInput[],
  balances: readonly number[],
  annualContributions: readonly number[],
  growthMultipliers: readonly number[]
): { balances: number[]; countedDebtPaid: number } {
  let countedDebtPaid = 0
  const closing = balances.map((balance, i) => {
    const annual = annualContributions[i] ?? 0
    const row = rows[i]
    if (row?.type === 'investment') {
      return roundCents(balance * (growthMultipliers[i] ?? 1)) + annual
    }
    const next = Math.max(0, balance - annual)
    if (row?.contributionRecordedAsExpense !== true) countedDebtPaid += balance - next
    return next
  })
  return { balances: closing, countedDebtPaid }
}

/** Σ of the rows of one type. */
function sumRows(
  rows: readonly BalanceAccountInput[],
  balances: readonly number[],
  type: BalanceAccountInput['type']
): number {
  return balances.reduce((sum, balance, i) => (rows[i]?.type === type ? sum + balance : sum), 0)
}

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
  /**
   * Each savings row's CLOSING balance, in input order (story 100.1). Present on
   * PROJECTION rows only, and only when `currentData.savingsAccounts` was given.
   * `Σ savingsAccounts + unallocatedSavings === savings`, every year.
   */
  savingsAccounts?: number[]
  /**
   * The part of `savings` not assigned to any row: net income minus the rows'
   * contributions, accumulated. Negative when the contributions exceed what is
   * left over (they are still applied in full). Same presence rule as above.
   */
  unallocatedSavings?: number
  /**
   * Σ of the debt rows' closing balances (story 100.2). Present on BASELINE and
   * PROJECTION rows (D5), only when `currentData.balanceAccounts` was given.
   * `netWorth === savings + investments − debts`.
   */
  debts?: number
  /** Each investment/debt row's CLOSING balance, in input order. Same presence rule. */
  balanceAccounts?: number[]
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
 *   the window, is not a finite number (`validateAmount`); if a savings row's
 *   balance or contribution is not finite (`validateAmount`), negative
 *   (`SAVINGS_ROW_NEGATIVE`), or the balances do not sum to `savings`
 *   (`SAVINGS_ROWS_MISMATCH`); if an investment/debt row is neither type
 *   (`BALANCE_ROW_TYPE`), has a non-finite balance or contribution
 *   (`validateAmount`), a negative one (`BALANCE_ROW_NEGATIVE`), or the investment
 *   rows do not sum to `investments` (`BALANCE_ROWS_MISMATCH`); if an investment
 *   row's `annualReturn` is missing, not finite or outside −1..1
 *   (`INVESTMENT_RETURN_OUT_OF_RANGE`; a debt row's is ignored); or if the
 *   projection's balance, investment total or debt total overflows
 *   (`FORECAST_OUT_OF_RANGE`)
 */
export function calculateFinancialForecast(
  currentData: {
    income: NormalizableFinancialItem[]
    expenses: NormalizableFinancialItem[]
    savings: number // Current savings in cents
    investments: number // Current investments in cents
    /**
     * Optional per-account split of `savings` (story 100.1). When given, the
     * balances must sum to `savings` exactly (`SAVINGS_ROWS_MISMATCH`).
     */
    savingsAccounts?: SavingsAccountInput[]
    /**
     * Optional investment and debt rows (story 100.2). When given, the investment
     * rows' balances must sum to `investments` exactly (`BALANCE_ROWS_MISMATCH`),
     * and the debt rows lower net worth. When absent, the output is identical to
     * before the story (no new keys). Each investment row carries its own
     * `annualReturn` (story 100.3).
     */
    balanceAccounts?: BalanceAccountInput[]
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
  // Savings rows (story 100.1): every money term validated like the totals above,
  // never negative, and summing to `savings` exactly so the engine and its caller
  // cannot disagree about where the projection starts.
  const savingsAccounts = currentData.savingsAccounts
  if (savingsAccounts) {
    let balanceSum = 0
    for (const account of savingsAccounts) {
      validateAmount(account.balance)
      validateAmount(account.monthlyContribution)
      if (account.balance < 0 || account.monthlyContribution < 0) {
        throw new Error(SAVINGS_ROW_NEGATIVE)
      }
      balanceSum += account.balance
    }
    if (balanceSum !== currentData.savings) {
      throw new Error(SAVINGS_ROWS_MISMATCH)
    }
  }
  // Investment and debt rows (story 100.2), validated the same way. Each row's
  // contribution goes through the chokepoint once, here, so neither loop can read
  // it raw. `countedContributionTotal` is what leaves savings each year: investment
  // contributions NOT already in expenses (`=== true`, strict, as the savings
  // solver reads the flag). A debt's payment is NOT a fixed yearly total: it
  // stops at payoff, so each loop takes what the rows paid that year
  // (`stepBalanceRows` › `countedDebtPaid`, story 102.2).
  const balanceAccounts = currentData.balanceAccounts
  let balanceAnnualContributions: number[] | undefined
  // Each row's `1 + annualReturn` (story 100.3), computed once here beside the
  // contributions, not per iteration. 1 on a debt row (never read there).
  const balanceGrowthMultipliers: number[] = []
  let countedContributionTotal = 0
  let startingDebts = 0
  if (balanceAccounts) {
    let investmentSum = 0
    balanceAnnualContributions = balanceAccounts.map((account) => {
      if (account.type !== 'investment' && account.type !== 'debt') {
        throw new Error(BALANCE_ROW_TYPE)
      }
      validateAmount(account.balance)
      validateAmount(account.contribution)
      if (account.balance < 0 || account.contribution < 0) {
        throw new Error(BALANCE_ROW_NEGATIVE)
      }
      // Story 100.3: an investment row's own rate, the growth rates' rule. A
      // missing one is refused too (D4); a debt row's is ignored, not validated.
      if (account.type === 'investment') {
        if (!isValidGrowthRate(account.annualReturn)) {
          throw new Error(INVESTMENT_RETURN_OUT_OF_RANGE)
        }
        balanceGrowthMultipliers.push(1 + account.annualReturn)
      } else {
        balanceGrowthMultipliers.push(1)
      }
      const annual =
        monthlyContributionCents({
          monthlyContribution: account.contribution,
          frequency: account.frequency,
        }) * MONTHS_PER_YEAR
      // A finite contribution can normalise to Infinity (1e308 weekly). On an
      // investment the total check below would catch it, but a debt would just
      // floor to 0 silently, so refuse it here for both (code review 100.2).
      if (!Number.isFinite(annual)) throw new Error(FORECAST_OUT_OF_RANGE)
      if (account.type === 'investment') {
        investmentSum += account.balance
        if (account.contributionRecordedAsExpense !== true) countedContributionTotal += annual
      } else {
        startingDebts += account.balance
      }
      return annual
    })
    if (investmentSum !== currentData.investments) {
      throw new Error(BALANCE_ROWS_MISMATCH)
    }
  }

  const baseline: YearlyForecast[] = []
  const projection: YearlyForecast[] = []

  // Calculate baseline (current trends without scenario adjustments)
  let currentSavings = currentData.savings
  let currentInvestments = currentData.investments
  // Investment/debt rows (story 100.2) are modelled in THIS loop too (D5), with
  // the same `stepBalanceRows`, so a flat scenario still gives baseline ===
  // projection. Undefined without rows, so that path is untouched.
  let baselineRowBalances = balanceAccounts?.map((account) => account.balance)
  let currentDebts = startingDebts
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
    // with the projection's `roundCents(projInvestments * 1.07)` — search that
    // identifier; every line number this comment has carried has rotted within
    // days, twice inside story 67.1's own review: the RATE, the per-year
    // rounding (`roundCents` since story 104.1), and the POSITION (after the flow, before the row is taken,
    // because rows report CLOSING balances).
    //
    // ⚠️⚠️ THE FOUR TESTS ARE NOT EQUALLY SENSITIVE, and an earlier version of this
    // comment claimed they were ("changing one loop without the other fails all
    // four"). MEASURED, per lever:
    //   · RATE (baseline 1.07 -> 1.06)          -> 4 of 4 red
    //   · POSITION (move after `baseline.push`) -> 4 of 4 red, series shifted a year
    //   · REMOVE the statement entirely          -> 4 of 4 red
    //   · DROP the rounding here                 -> 1 of 4 red (the rounding probe ONLY;
    //     re-MEASURED by story 104.1 with `roundCents` in place)
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
    // ⚠️ CLOSED by story 100.3 (FR166) for every caller the app has: investment
    // ROWS carry their own rate (`annualReturn`, default 6% in the builder), and
    // `stepBalanceRows` applies it. The 7% below survives ONLY on the row-less API
    // path (no `balanceAccounts`), which the Scenario Builder never takes (it
    // always passes an array, possibly empty). Kept byte-identical (D5), with the
    // 67.1 block that pins it.
    //
    // ⚠️ SUPERSEDED IN PART by story 100.2 (FR165): "no scenario lever touches
    // investments" and "investments get no contributions" are no longer true
    // when `balanceAccounts` is given. Then each investment row compounds on its
    // own, at its OWN rate since story 100.3, and gains its contribution, a
    // counted contribution leaves savings, and debts fall by their payment
    // (`stepBalanceRows`, used by BOTH loops, D5).
    // Per-row rounding can differ from one compounded total by a cent a year
    // (D7, pinned). Without rows, the single statement below runs, unchanged.
    // Story 102.2: the rows step FIRST (pure on the opening balances), because
    // what the unflagged debts paid this year comes off the year's net income
    // and onto its expenses, exactly as in the projection loop (D5).
    const baselineStep =
      balanceAccounts && baselineRowBalances && balanceAnnualContributions
        ? stepBalanceRows(
            balanceAccounts,
            baselineRowBalances,
            balanceAnnualContributions,
            balanceGrowthMultipliers
          )
        : null
    const baselineDebtPaid = baselineStep?.countedDebtPaid ?? 0
    const baselineNetIncomeThisYear = baselineAnnualNetIncome - baselineDebtPaid
    currentSavings += baselineNetIncomeThisYear
    if (balanceAccounts && baselineStep) {
      baselineRowBalances = baselineStep.balances
      currentSavings -= countedContributionTotal
      currentInvestments = sumRows(balanceAccounts, baselineRowBalances, 'investment')
      currentDebts = sumRows(balanceAccounts, baselineRowBalances, 'debt')
    } else {
      // Compound investments at the SAME 7% the projection uses, in the SAME
      // position (after the flow, before the row is taken) and with the SAME
      // per-year `roundCents` as the projection's `projInvestments` statement
      // (search that identifier — deliberately not cited by line).
      // Any of the three drifting apart reopens the divergence this story closed.
      currentInvestments = roundCents(currentInvestments * 1.07)
    }

    const baselineYear: YearlyForecast = {
      year,
      income: baselineAnnualIncome,
      expenses: baselineAnnualExpenses + baselineDebtPaid,
      netIncome: baselineNetIncomeThisYear,
      savings: currentSavings,
      investments: currentInvestments,
      netWorth: currentSavings + currentInvestments - currentDebts,
      // Absent (not `undefined`) without rows, so existing `toEqual`s are unchanged.
      ...(baselineRowBalances ? { debts: currentDebts, balanceAccounts: baselineRowBalances } : {}),
    }
    baseline.push(baselineYear)
  }

  // Calculate projection with scenario adjustments
  let projSavings = currentData.savings
  let projInvestments = currentData.investments
  // Per-row closing balances and the unassigned remainder (story 100.1). Tracked
  // in the PROJECTION loop only (D6): the baseline keeps one savings pot.
  let rowBalances = savingsAccounts?.map((account) => account.balance)
  const annualContributions = savingsAccounts?.map(
    (account) => account.monthlyContribution * MONTHS_PER_YEAR
  )
  const annualContributionTotal = (annualContributions ?? []).reduce((sum, c) => sum + c, 0)
  let unallocatedSavings = 0
  // Investment/debt rows (story 100.2), the same model as the baseline loop's.
  let projRowBalances = balanceAccounts?.map((account) => account.balance)
  let projDebts = startingDebts

  for (let year = 1; year <= years; year++) {
    // Adjust income and expenses by growth rates
    const adjustedIncome = currentData.income.map((item) => ({
      ...item,
      amount: roundCents(item.amount * (1 + scenario.incomeGrowthRate) ** year),
    }))
    const adjustedExpenses = currentData.expenses.map((item) => ({
      ...item,
      amount: roundCents(item.amount * (1 + scenario.expenseGrowthRate) ** year),
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
    // Story 102.2 (FR170): the rows step before the flow (pure on the opening
    // balances), so what the unflagged debts paid this year can leave the year's
    // net income: the full payment while owed, the remainder in the payoff year,
    // nothing after. NOT grown by `expenseGrowthRate` (D4): it is added after
    // `adjustedExpenses`, never inside it. Same arithmetic as the baseline (D5).
    const projStep =
      balanceAccounts && projRowBalances && balanceAnnualContributions
        ? stepBalanceRows(
            balanceAccounts,
            projRowBalances,
            balanceAnnualContributions,
            balanceGrowthMultipliers
          )
        : null
    const projDebtPaid = projStep?.countedDebtPaid ?? 0
    const totalNetIncome = netIncome * MONTHS_PER_YEAR + oneTimeForYear - projDebtPaid

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
    if (balanceAccounts && projStep) {
      // Story 100.2: per-row growth/contribution and pay-down, in the SAME
      // position as the single statement below (closing balances), and the
      // counted contributions leave savings. See the baseline loop. (Stepped
      // above, before the flow, since story 102.2.)
      projRowBalances = projStep.balances
      projSavings -= countedContributionTotal
      projInvestments = sumRows(balanceAccounts, projRowBalances, 'investment')
      projDebts = sumRows(balanceAccounts, projRowBalances, 'debt')
    } else {
      // Investment growth with compounding
      projInvestments = roundCents(projInvestments * 1.07) // Assume 7% return
    }
    // Refuse, not clamp (D1), once the balance leaves finite numbers — several
    // individually valid events can sum past MAX_VALUE. Checked on the SUM, so an
    // overflow in either term (Infinity, or Infinity + -Infinity = NaN) is caught.
    // The investment and debt totals are checked on their own too (story 100.2):
    // two individually finite debts can sum to Infinity.
    if (
      !Number.isFinite(projSavings + projInvestments) ||
      !Number.isFinite(projInvestments) ||
      !Number.isFinite(projDebts)
    ) {
      throw new Error(FORECAST_OUT_OF_RANGE)
    }
    // The rows take the SAME position as the statements above (after this year's
    // flow, before the row is pushed), so they report CLOSING balances too. The
    // contributions are applied in full even when they exceed the year's net
    // income; the remainder then goes negative and the totals are unaffected.
    if (rowBalances && annualContributions) {
      rowBalances = rowBalances.map((balance, i) => balance + (annualContributions[i] ?? 0))
      // A counted investment contribution (story 100.2) has left savings, so it
      // leaves the unassigned remainder too, keeping rows + remainder === savings.
      unallocatedSavings += totalNetIncome - annualContributionTotal - countedContributionTotal
      if (!Number.isFinite(unallocatedSavings) || !rowBalances.every(Number.isFinite)) {
        throw new Error(FORECAST_OUT_OF_RANGE)
      }
    }

    const yearProjection: YearlyForecast = {
      year,
      income: calculateGrossPeriodIncome(adjustedIncome) * MONTHS_PER_YEAR,
      expenses: calculateTotalPeriodExpenses(adjustedExpenses) * MONTHS_PER_YEAR + projDebtPaid,
      netIncome: totalNetIncome,
      savings: projSavings,
      investments: projInvestments,
      netWorth: projSavings + projInvestments - projDebts,
      // Absent (not `undefined`) without rows, so existing `toEqual`s are unchanged.
      ...(rowBalances ? { savingsAccounts: rowBalances, unallocatedSavings } : {}),
      ...(projRowBalances ? { debts: projDebts, balanceAccounts: projRowBalances } : {}),
    }
    projection.push(yearProjection)
  }

  // Calculate summary
  // Debts count against the start (story 100.2, D1); 0 without debt rows.
  const startingNetWorth = currentData.savings + currentData.investments - startingDebts
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
