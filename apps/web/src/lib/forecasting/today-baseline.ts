/**
 * "Today" for a forecast (story 107.1, FR175).
 *
 * A forecast's baseline is the user's CURRENT saved data projected flat: no
 * growth, no one-time events. The builder passes that data to the engine as the
 * baseline input; a SAVED forecast's stored `result.baseline` was computed the old
 * way (from the scenario's own rows), so it is never shown: these helpers
 * recompute it from today's data instead (D2).
 *
 * The data comes from `useCurrentForecastData()` (`scenario-builder.tsx`), which
 * maps the stores with the same functions that seed the builder's rows.
 */

import {
  type ForecastInputData,
  type ForecastingResult,
  type ForecastingScenario,
  type YearlyForecast,
  calculateFinancialForecast,
  isValidForecastYears,
} from '@budget-planner/core'

/** No growth, no events: the baseline loop ignores the scenario anyway. */
const FLAT: ForecastingScenario = {
  name: 'Today',
  incomeGrowthRate: 0,
  expenseGrowthRate: 0,
  oneTimeEvents: [],
}

/**
 * Today's data projected over `years`, or `null` when there is no data yet (the
 * stores have not settled) or the engine refuses it (a corrupt row, a period
 * outside 1-30). A `null` is never shown as a figure.
 */
export function todayBaseline(
  data: ForecastInputData | null,
  years: number
): YearlyForecast[] | null {
  // A period the engine would refuse is not even sent (a corrupt saved result
  // can have an empty projection).
  if (!data || !isValidForecastYears(years)) return null
  try {
    return calculateFinancialForecast(data, FLAT, years).baseline
  } catch {
    return null
  }
}

/**
 * A saved forecast's result with its baseline replaced by today's, over the
 * years the saved projection covers. `null` when today's baseline is not
 * available, so a caller never falls back to the stored one.
 */
export function withTodayBaseline(
  result: ForecastingResult,
  data: ForecastInputData | null
): ForecastingResult | null {
  const baseline = todayBaseline(data, result.projection.length)
  return baseline ? { ...result, baseline } : null
}

/**
 * The "vs. today" figure: the projection's ending net worth minus the baseline's,
 * in cents. `null` when the result has no baseline row.
 */
export function vsTodayCents(result: ForecastingResult): number | null {
  const baselineEnd = result.baseline.at(-1)
  return baselineEnd ? result.summary.endingNetWorth - baselineEnd.netWorth : null
}

/**
 * A signed amount: `+` for 0 and above, and nothing added below 0 because
 * `formatCurrency` emits its own `-` (the list's Total Growth guard, story
 * `forecast-1`: a hard-coded `+` rendered `+-40,000.00`).
 */
export function signedAmount(cents: number, formatCurrency: (cents: number) => string): string {
  return `${cents >= 0 ? '+' : ''}${formatCurrency(cents)}`
}
