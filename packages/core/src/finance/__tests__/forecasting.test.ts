/**
 * `calculateFinancialForecast` — one-time event arithmetic (story `forecast-1`).
 *
 * ⚠️ THIS IS THE FIRST TEST FILE `forecasting.ts` HAS EVER HAD. Before this story
 * `packages/core/src/finance/__tests__/` covered categoryBreakdown, netIncome,
 * normalization, retirement, savingsAllocation, savingsCapacity and visualization —
 * but nothing touched the forecasting engine, and `grep -rn "oneTimeEvents"` over
 * the core tests returned zero hits. The only fixture anywhere in the repo was a
 * single POSITIVE event in `scenario-builder.test.tsx`.
 *
 * That gap is why story 57.1 could ship marketing copy promising "a big one-off
 * cost" against an engine nobody had ever asserted anything about. These tests pin
 * the arithmetic in BOTH directions so the copy has something to stand on.
 *
 * ⚠️ MIXED PROVENANCE, worth knowing when reading a green run here:
 *   - The one-time-event tests (`forecast-1`) are CHARACTERIZATION — the engine
 *     already summed signed amounts, so they were GREEN on first run, and their
 *     discriminating power comes from the mutation arms (clamp the reduce, flip
 *     an expected sign), not from a red-to-green transition.
 *   - The closing-balance tests (`forecast-2`) are genuine RED-to-GREEN
 *     regressions: they failed against the old loop order and pass against the
 *     new one. Arm F1 (revert the loop) reddens exactly those three.
 *
 * ⚠️ Every fixture here uses `investments: 0`, so nothing in this file observes
 * the projection's 7% compounding or the baseline's lack of it. The chart-side
 * consequence of that gap is recorded in `deferred-work.md`.
 */

import { describe, expect, it } from 'vitest'
import { type ForecastingScenario, calculateFinancialForecast } from '../forecasting'

/** 5000.00/mo in, 4000.00/mo out, 1000.00 saved, nothing invested. */
const CURRENT_DATA = {
  income: [{ amount: 500000, frequency: 'monthly' as const }],
  expenses: [{ amount: 400000, frequency: 'monthly' as const }],
  savings: 100000,
  investments: 0,
}

const FLAT: ForecastingScenario = {
  name: 'flat',
  incomeGrowthRate: 0,
  expenseGrowthRate: 0,
}

const YEARS = 3

describe('calculateFinancialForecast — one-time events', () => {
  it('a NEGATIVE one-time event reduces the projection by exactly its amount', () => {
    const cost = -5000000 // 50,000.00 out

    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const withCost = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
      YEARS
    )

    // The whole point of story `forecast-1`: an outflow is expressible, and the
    // engine subtracts it exactly — no clamping, no absolute value.
    expect(withCost.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + cost)
    expect(withCost.summary.endingNetWorth).toBeLessThan(baseline.summary.endingNetWorth)
  })

  it('a POSITIVE one-time event increases the projection by exactly its amount', () => {
    const windfall = 5000000

    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const withWindfall = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: 2, amount: windfall }] },
      YEARS
    )

    expect(withWindfall.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + windfall)
  })

  it('lands the event in the year it names, and only that year', () => {
    const cost = -5000000
    const withCost = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
      YEARS
    )
    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    const netIncomeByYear = (r: typeof withCost) => r.projection.map((p) => p.netIncome)
    const base = netIncomeByYear(baseline)
    const shifted = netIncomeByYear(withCost)

    // Year 2 (index 1) absorbs the whole event; every other year is untouched.
    expect(shifted[1]).toBe(base[1] + cost)
    expect(shifted[0]).toBe(base[0])
    expect(shifted[2]).toBe(base[2])
  })

  it('sums several events in the same year, mixed signs included', () => {
    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const mixed = calculateFinancialForecast(
      CURRENT_DATA,
      {
        ...FLAT,
        oneTimeEvents: [
          { year: 2, amount: 3000000 },
          { year: 2, amount: -5000000 },
        ],
      },
      YEARS
    )

    // A windfall and a cost in the same year net out; nothing short-circuits on
    // the first event, and a negative does not abort the reduce.
    expect(mixed.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth - 2000000)
  })

  it('drops an event dated outside the projection window', () => {
    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const outOfRange = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: YEARS + 5, amount: -5000000 }] },
      YEARS
    )

    // The loop filters by `e.year === year` for years 1..YEARS, so an event
    // beyond the horizon never matches.
    //
    // ⚠️ This assertion alone is weak — an unchanged `endingNetWorth` is a
    // negative result. The row-level check below is what distinguishes "never
    // matched any year" from "matched and was applied".
    //
    // (Until story `forecast-2` the final-year case ALSO produced an unchanged
    // `endingNetWorth`, for an unrelated reason — rows reported opening
    // balances. That collision is gone: a final-year event now moves the
    // summary, which the test below asserts.)
    expect(outOfRange.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth)
    // Discriminating half: an out-of-window event touches no row at all, whereas
    // the final-year case DOES move that year's `netIncome`.
    expect(outOfRange.projection.map((p) => p.netIncome)).toEqual(
      baseline.projection.map((p) => p.netIncome)
    )
  })

  /**
   * ⚠️ THIS WAS A CHARACTERIZATION OF A DEFECT UNTIL STORY `forecast-2` FIXED IT.
   *
   * Rows used to be pushed BEFORE the year's flow was applied, so each carried an
   * OPENING balance beside a `netIncome` that was that year's flow. A final-year
   * event therefore never reached `netWorth`, `endingNetWorth` or `totalGrowth`
   * at all — it was invisible in the chart and the summary. The test was written
   * to fail once the loop was corrected, and it did; this is its updated form.
   */
  it('lands a FINAL-year event in the reported net worth, not only in netIncome', () => {
    const cost = -5000000
    const baseline = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const lastYear = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: YEARS, amount: cost }] },
      YEARS
    )

    // The flow reflects the event…
    expect(lastYear.projection[YEARS - 1].netIncome).toBe(
      baseline.projection[YEARS - 1].netIncome + cost
    )
    // …and so does the balance the user actually sees.
    expect(lastYear.projection[YEARS - 1].netWorth).toBe(
      baseline.projection[YEARS - 1].netWorth + cost
    )
    expect(lastYear.summary.endingNetWorth).toBe(baseline.summary.endingNetWorth + cost)
    expect(lastYear.summary.totalGrowth).toBe(baseline.summary.totalGrowth + cost)
  })

  /**
   * The invariant that makes the loop order observable, independent of any event:
   * a row reports the balance at the END of its year.
   */
  it('reports CLOSING balances: year 1 already includes year 1 flow', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const yearOne = r.projection[0]

    // Regression guard for the exact symptom: year 1's net worth used to equal
    // `startingNetWorth`, so a forecast appeared to achieve nothing in year one.
    expect(yearOne.netWorth).not.toBe(r.summary.startingNetWorth)
    expect(yearOne.savings).toBe(CURRENT_DATA.savings + yearOne.netIncome)

    // N years of saving accumulate N times, not N-1.
    expect(r.projection[YEARS - 1].savings).toBe(CURRENT_DATA.savings + yearOne.netIncome * YEARS)
  })

  it('baseline uses the same closing-balance convention as the projection', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    // If the two loops disagreed, baseline-vs-projection would compare balances
    // taken at different instants — the comparison the whole chart rests on.
    expect(r.baseline[0].savings).toBe(CURRENT_DATA.savings + r.baseline[0].netIncome)
    expect(r.baseline.map((b) => b.savings)).toEqual(r.projection.map((p) => p.savings))
  })
})
