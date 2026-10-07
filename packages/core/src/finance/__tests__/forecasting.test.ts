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
 * ⚠️ Every fixture in the blocks BELOW uses `investments: 0`, so none of them
 * observes the 7% compounding at all — multiply the investment term by zero and
 * it vanishes. That blindness is what let the baseline's missing compounding
 * survive the engine's entire life. The final block (`investment compounding,
 * both loops`, story 67.1) is the only one with a non-zero fixture, and it is the
 * only one that can see it. Do not zero those fixtures out.
 */

import { describe, expect, it } from 'vitest'
import {
  BALANCE_ROWS_MISMATCH,
  BALANCE_ROW_NEGATIVE,
  BALANCE_ROW_TYPE,
  type BalanceAccountInput,
  DEFAULT_INVESTMENT_RETURN,
  FORECAST_OUT_OF_RANGE,
  type ForecastingScenario,
  INVESTMENT_RETURN_OUT_OF_RANGE,
  SAVINGS_ROWS_MISMATCH,
  SAVINGS_ROW_NEGATIVE,
  type SavingsAccountInput,
  calculateFinancialForecast,
} from '../forecasting'

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

/**
 * ANNUAL ACCUMULATION (the `MONTHS_PER_YEAR` fix, 2026-09-24).
 *
 * ⚠️⚠️ WHY THIS BLOCK EXISTS AT ALL. Every one of the eight tests in the block
 * above is SCALE-INVARIANT: six compare a `withEvent` run against a `baseline` run
 * from the same function, and two (`reports CLOSING balances…`, `baseline uses the
 * same closing-balance convention…`) assert an internal relation within a single
 * run. Either way, multiplying the whole engine by a constant moves both sides
 * equally, so all eight stayed GREEN while the engine added a MONTHLY net income
 * once per YEARLY iteration.
 *
 * ⚠️ Precisely what was wrong: the FLOW was a twelfth of a year's surplus. The
 * BALANCES were not uniformly 1/12 — a row is `opening + n × flow`, so with this
 * file's 100000 opening, year 1 read 200000 against a correct 1300000 (a factor of
 * 6.5, not 12), and `investments` was never affected at all. "Every figure was 12x
 * low" is the wrong summary; "every figure was computed from a flow that was 12x
 * low" is the right one.
 *
 * A suite that can only see differences cannot see a uniform scale error. These
 * tests pin ABSOLUTE cents so that class of defect is observable at all.
 *
 * ⚠️ Every expected number below is derived BY HAND from the inputs, and the
 * arithmetic is written out beside it. None was copied from a test run. If you
 * change a fixture, redo the arithmetic — do not paste what the runner prints.
 */
describe('calculateFinancialForecast — annual accumulation', () => {
  it('accumulates a full YEAR of surplus per projection year, not one month', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    // BY HAND: income 500000/mo and expenses 400000/mo are both `monthly`, so the
    // monthly-normalized net is 500000 − 400000 = 100000. A year of that is
    // 100000 × 12 = 1200000. Opening savings is 100000, so the closing balances
    // are 100000 + 1200000 = 1300000, then +1200000 = 2500000, then 3700000.
    expect(r.projection[0].savings, '100000 + 1200000').toBe(1_300_000)
    expect(r.projection[1].savings, '1300000 + 1200000').toBe(2_500_000)
    expect(r.projection[2].savings, '2500000 + 1200000').toBe(3_700_000)

    // The row's own flow field reports that same annual figure.
    expect(r.projection[0].netIncome, '100000 × 12').toBe(1_200_000)

    // ⚠️ For the record only: the pre-fix values were 200000 / 300000 / 400000 with
    // netIncome 100000, a monthly flow added once a year. The `toBe` assertions
    // above are what catch a silent revert of `* MONTHS_PER_YEAR`; this line cannot
    // be the failing assertion, because `toBe` throws first. It documents the old
    // value, it does not guard it.
    expect(r.projection[0].savings).not.toBe(200_000)
  })

  it('reports the summary in the same annual units', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    // BY HAND: starting = savings 100000 + investments 0 = 100000. Ending is the
    // final row's net worth, 3700000. Growth = 3700000 − 100000 = 3600000, over
    // YEARS = 3 ⇒ 3600000 / 3 = 1200000, which must equal one year's flow.
    expect(r.summary.startingNetWorth, 'savings 100000 + investments 0').toBe(100_000)
    expect(r.summary.endingNetWorth, 'final row netWorth').toBe(3_700_000)
    expect(r.summary.totalGrowth, '3700000 − 100000').toBe(3_600_000)
    expect(r.summary.averageAnnualGrowth, '3600000 / 3').toBe(1_200_000)
  })

  it('annualizes a weekly item EXACTLY (amount × 52), not through a rounded monthly figure', () => {
    const weekly = calculateFinancialForecast(
      {
        income: [{ amount: 100000, frequency: 'weekly' as const }],
        expenses: [],
        savings: 0,
        investments: 0,
      },
      FLAT,
      1
    )

    // BY HAND (story 111.1, FR179): a year of a weekly 1,000.00 is 52 of them,
    // 100000 × 52 = 5200000.
    //
    // ⚠️ This is the discriminating assertion for the two wrong ways to annualize:
    //   - round(raw × 52/12) × 12 = 5199996  (the monthly round trip this story
    //     REMOVED: 433333.33… ⇒ 433333, × 12; four cents light)
    //   - raw × 12                = 1200000  (ignores frequency entirely)
    // Until 111.1 this test pinned 5199996 as a deliberate trade (forecast agrees
    // with the Overview's monthly-canonical figures). Lucas reversed it 2026-10-06.
    expect(weekly.projection[0].income, '100000 × 52').toBe(5_200_000)
    // Documents the rejected alternative; cannot itself be the failing assertion.
    expect(weekly.projection[0].income).not.toBe(5_199_996)
    expect(weekly.projection[0].netIncome, 'no expenses, so net === gross').toBe(5_200_000)
  })

  it('keeps a row internally consistent: income − expenses === netIncome', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    const row = r.projection[0]

    // BY HAND: income 500000 × 12 = 6000000; expenses 400000 × 12 = 4800000;
    // 6000000 − 4800000 = 1200000 = netIncome. Exact, not approximate: the ×12 is
    // applied after per-item rounding, so it distributes over the subtraction.
    expect(row.income, '500000 × 12').toBe(6_000_000)
    expect(row.expenses, '400000 × 12').toBe(4_800_000)
    expect(row.income - row.expenses, 'must equal the row flow').toBe(row.netIncome)

    // ⚠️ Reintroducing the DELETED raw-sum helpers reddens this TEST — but via the
    // `toBe(6_000_000)` above, not via the line below, which `toBe` pre-empts. Note
    // a raw sum is only distinguishable here because of the `× 12`: on an
    // all-`monthly` fixture `reduce(amount)` and the normalized total are the SAME
    // number. The weekly/annually tests are what pin the normalization itself.
    expect(row.income).not.toBe(500_000)
  })

  it('offsets a row by exactly its one-time event, leaving the recurring flow annual', () => {
    const cost = -5_000_000
    const withEvent = calculateFinancialForecast(
      CURRENT_DATA,
      { ...FLAT, oneTimeEvents: [{ year: 2, amount: cost }] },
      YEARS
    )
    const row = withEvent.projection[1]

    // BY HAND: year 2's flow is the annual 1200000 PLUS the absolute event
    // −5000000 ⇒ 1200000 − 5000000 = −3800000.
    //
    // The three shapes this distinguishes, all recomputed:
    //   RIGHT  netIncome * 12 + event   = 1200000 + (−5000000) = −3800000
    //   WRONG  (netIncome + event) * 12 = (100000 − 5000000) × 12 = −58800000
    //   OLD    netIncome + event        = 100000 − 5000000 = −4900000
    //
    // ⚠️ An earlier version of this comment claimed the over-scaled shape was
    // −60000000 and listed it as a THIRD distinct case. Both were wrong:
    // 1200000 − 60000000 = −58800000, i.e. the same value as the WRONG line above,
    // and −60000000 (the event scaled with no flow at all) is a value no mutation
    // of this code produces. The `.not.toBe(-60_000_000)` guard that rested on it
    // has been removed as dead. The `toBe` below is what actually catches the
    // over-scaling mutation, and it was confirmed doing so by name.
    expect(row.netIncome, '1200000 + (−5000000); over-scaled would be −58800000').toBe(-3_800_000)

    // The recurring part of the SAME row is still a full year, and the row's
    // income/expenses fields exclude the event entirely.
    expect(row.income - row.expenses, 'recurring flow only').toBe(1_200_000)
    expect(row.netIncome, 'annual flow + the event, exactly once').toBe(
      row.income - row.expenses + cost
    )
  })

  it('handles empty data without NaN, leaving the opening balance untouched', () => {
    const r = calculateFinancialForecast(
      { income: [], expenses: [], savings: 250_000, investments: 0 },
      FLAT,
      YEARS
    )

    // BY HAND: no rows ⇒ normalized totals are 0 ⇒ annual flow 0 × 12 = 0. Savings
    // stay at the opening 250000 for all three years and growth is exactly 0.
    expect(r.projection[0].netIncome).toBe(0)
    expect(r.projection.map((p) => p.savings)).toEqual([250_000, 250_000, 250_000])
    expect(r.summary.totalGrowth).toBe(0)
    expect(r.summary.averageAnnualGrowth, '0 / 3, not NaN').toBe(0)
    expect(Number.isNaN(r.summary.averageAnnualGrowth)).toBe(false)
    // ⚠️ HONEST SCOPE: this test is a zero/NaN guard, NOT an annualization guard.
    // 0 × 12 === 0, so every assertion here is green under the ÷12 defect too. It
    // contributes nothing to this block's "make the scale error observable" job.
    // ⚠️ It also does NOT cover `years: 0`, where `totalGrowth / years` used to
    // be NaN. Since story 77.1 the engine REFUSES `years: 0` outright; that and
    // the other bounds are pinned in `forecasting-bounds.test.ts`.
  })

  it('annualizes the BASELINE loop too, not only the projection', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    // BY HAND: the baseline sees no growth rates, so its flow is the same 1200000
    // and its closing balances match the projection's exactly. (Investments are 0
    // in this fixture, so the 7% compounding both loops now apply has nothing to
    // act on either way — see the `investment compounding, both loops` block for
    // the arm that can actually see it.)
    expect(r.baseline[0].netIncome, '100000 × 12').toBe(1_200_000)
    expect(r.baseline[0].savings, '100000 + 1200000').toBe(1_300_000)
    expect(r.baseline[0].income, '500000 × 12').toBe(6_000_000)

    // ⚠️ Annualizing only ONE loop would leave the chart comparing a monthly
    // baseline against an annual scenario — a 12x phantom gap on a flat forecast.
    expect(r.baseline.map((b) => b.savings)).toEqual(r.projection.map((p) => p.savings))
  })
})

/**
 * FREQUENCY NORMALIZATION ON EVERY FIELD AND BOTH LOOPS.
 *
 * ⚠️⚠️ WHY THIS BLOCK IS SEPARATE. The block above pins the annual scale, but it
 * cannot see whether frequency is normalized, because every fixture it uses is
 * all-`monthly` — and for a `monthly` row a raw `reduce(amount)` and the
 * monthly-normalized total are the SAME NUMBER, so `× 12` makes the two
 * implementations indistinguishable. A code review proved the hole: swapping
 * `calculateTotalPeriodExpenses` back to the deleted raw sum left the entire suite
 * GREEN, because no test used a non-monthly EXPENSE, and the one weekly test
 * asserted only `projection[0]`, never `baseline[0]`.
 *
 * Every test below therefore uses a NON-MONTHLY frequency and checks BOTH loops.
 */
describe('calculateFinancialForecast — frequency normalization, both loops', () => {
  /** One weekly expense, nothing else. 100000 × 52 = 5200000 a year (story 111.1). */
  const WEEKLY_EXPENSE = {
    income: [],
    expenses: [{ amount: 100000, frequency: 'weekly' as const }],
    savings: 0,
    investments: 0,
  }

  it('normalizes a weekly EXPENSE on the projection row, not just income', () => {
    const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

    // BY HAND: 100000 × 52 = 5200000 (the pre-111.1 monthly round trip gave 5199996).
    // A raw sum would report 100000 × 12 = 1200000 — the mutation this closes.
    expect(r.projection[0].expenses, '100000 × 52').toBe(5_200_000)
    expect(r.projection[0].netIncome, 'no income, so net === −expenses').toBe(-5_200_000)
  })

  it('normalizes a weekly expense on the BASELINE row too', () => {
    const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

    // The baseline builds its fields from a separate set of hoisted constants
    // (`baselineAnnualIncome`/`baselineAnnualExpenses`), so it needs its own
    // assertion — the projection passing proves nothing about it.
    expect(r.baseline[0].expenses, 'same figure via the baseline path').toBe(5_200_000)
    expect(r.baseline[0].netIncome).toBe(-5_200_000)
    expect(r.baseline[0].savings, '0 opening − 5200000').toBe(-5_200_000)
  })

  it('normalizes a weekly INCOME on the baseline row too', () => {
    const r = calculateFinancialForecast(
      {
        income: [{ amount: 100000, frequency: 'weekly' as const }],
        expenses: [],
        savings: 0,
        investments: 0,
      },
      FLAT,
      1
    )

    expect(r.baseline[0].income, '100000 × 52').toBe(5_200_000)
    expect(r.baseline[0].netIncome).toBe(5_200_000)
  })

  /**
   * Story 111.1 (FR179, Lucas 2026-10-06): an `annually` row counts its FULL
   * amount each year. Until 111.1 these two fixtures pinned "a known, accepted
   * precision loss": the monthly round trip `round(x / 12) × 12` was off by
   * -5..+6 cents per item per year (writing `x = 12k + r`: short by `r` for
   * `r <= 5`, OVER by `12 - r` for `r >= 6`). That trade is reversed, and the two
   * fixtures stay as exactness probes, one per arm of the old error.
   */
  it('counts an annually row in full when r <= 5 (was one cent light)', () => {
    const r = calculateFinancialForecast(
      {
        income: [{ amount: 1_200_013, frequency: 'annually' as const }],
        expenses: [],
        savings: 0,
        investments: 0,
      },
      FLAT,
      1
    )

    // BY HAND: 1200013 × 1 = 1200013. Old: 1200013 = 12 × 100001 + 1, so r = 1,
    // round(100001.08…) × 12 = 1200012, one cent light.
    expect(r.projection[0].income, '1200013 × 1').toBe(1_200_013)
    expect(r.baseline[0].income, 'same via the baseline').toBe(1_200_013)
  })

  it('counts an annually row in full when r >= 6 (was six cents HEAVY)', () => {
    const r = calculateFinancialForecast(
      {
        income: [{ amount: 1_200_018, frequency: 'annually' as const }],
        expenses: [],
        savings: 0,
        investments: 0,
      },
      FLAT,
      1
    )

    // BY HAND: 1200018 × 1 = 1200018. Old: r = 6, round(100001.5) = 100002, × 12 =
    // 1200024, six cents OVER the entered amount.
    expect(r.projection[0].income, '1200018 × 1').toBe(1_200_018)
    expect(r.baseline[0].income, 'same via the baseline').toBe(1_200_018)
  })

  it('counts an annual 10.00 as 10.00 a year, on both loops (story 111.1 AC 2)', () => {
    const r = calculateFinancialForecast(
      {
        income: [{ amount: 1000, frequency: 'annually' as const }],
        expenses: [{ amount: 1000, frequency: 'annually' as const }],
        savings: 0,
        investments: 0,
      },
      FLAT,
      1
    )
    // BY HAND: 1000 × 1. Old: round(1000 / 12) = 83, × 12 = 996.
    for (const row of [r.projection[0], r.baseline[0]]) {
      expect(row.income).toBe(1000)
      expect(row.expenses).toBe(1000)
      expect(row.netIncome).toBe(0)
    }
  })

  /**
   * The AC 2 sweep: for EVERY frequency, the forecast's first year at 0% growth is
   * the integer `amount × periods`, on both loops. The oracle is integer
   * arithmetic, never the engine's own formula. The old error depended only on
   * `amount × periods` mod 12, so 0..2399 (every residue, 200 times) covers every
   * class; `normalization.annual.test.ts` sweeps the helper over 0..1,999,999.
   */
  it('year 1 at 0% growth is exactly amount × periods, for every frequency (sweep)', () => {
    const PERIODS = { weekly: 52, biweekly: 26, monthly: 12, annually: 1 } as const
    const misses: string[] = []
    for (const frequency of Object.keys(PERIODS) as (keyof typeof PERIODS)[]) {
      for (let amount = 0; amount < 2400; amount++) {
        const r = calculateFinancialForecast(
          {
            income: [{ amount, frequency }],
            expenses: [{ amount, frequency }],
            savings: 0,
            investments: 0,
          },
          FLAT,
          1
        )
        const want = amount * PERIODS[frequency]
        const p = r.projection[0]
        const b = r.baseline[0]
        if (
          p?.income !== want ||
          p.expenses !== want ||
          b?.income !== want ||
          b.expenses !== want
        ) {
          misses.push(`${frequency} ${amount}: ${p?.income}/${b?.income} want ${want}`)
        }
      }
    }
    expect(misses.slice(0, 5)).toEqual([])
    expect(misses).toHaveLength(0)
  })

  /**
   * ⚠️ The reconciliation invariant off the FLAT path. Every other test here uses
   * growth rates of 0, which makes `adjustedIncome` identical to
   * `currentData.income` — so a review found that feeding the row's fields the
   * UN-adjusted arrays left the whole suite green. Non-zero growth is what
   * distinguishes them.
   */
  it('applies growth to the row fields and still reconciles', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, { ...FLAT, incomeGrowthRate: 0.1 }, 2)

    // BY HAND, year 1: each income item grows first —
    // round(500000 × 1.1^1) = round(550000) = 550000; monthly-normalized = 550000;
    // × 12 = 6600000. Expenses are ungrown: 400000 × 12 = 4800000.
    // Flow = 6600000 − 4800000 = 1800000.
    expect(r.projection[0].income, 'round(500000 × 1.1) × 12').toBe(6_600_000)
    expect(r.projection[0].expenses, 'ungrown: 400000 × 12').toBe(4_800_000)
    expect(r.projection[0].netIncome, '6600000 − 4800000').toBe(1_800_000)

    // BY HAND, year 2: round(500000 × 1.1^2) = round(605000.000…) = 605000;
    // × 12 = 7260000; flow = 7260000 − 4800000 = 2460000.
    expect(r.projection[1].income, 'round(500000 × 1.21) × 12').toBe(7_260_000)
    expect(r.projection[1].netIncome, '7260000 − 4800000').toBe(2_460_000)

    // The invariant holds on the grown path, which is the point of this test.
    for (const row of r.projection) {
      expect(row.income - row.expenses).toBe(row.netIncome)
    }

    // ⚠️ And the BASELINE must NOT grow — it is the no-scenario comparison.
    expect(r.baseline[0].income, 'baseline ignores growth: 500000 × 12').toBe(6_000_000)
  })
})

/**
 * BOTH LOOPS COMPOUND INVESTMENTS AT 7% (story 67.1, FR106).
 *
 * ⚠️⚠️ WHY THIS BLOCK EXISTS AT ALL, AND WHY IT IS THE ONLY ONE THAT COULD CATCH
 * THIS. Every other fixture in this file uses `investments: 0`. The defect was
 * that the baseline loop hoisted `const currentInvestments` outside the year loop
 * and never reassigned it, while the projection compounded at 7% — so with an
 * EMPTY scenario the two series split from the first plotted point by
 * `investments_0 * (1.07^n - 1)`, the investment term alone. Multiply that by zero
 * and it vanishes, which is exactly why 937 green core tests said nothing about it
 * for the engine's entire life. **A fixture with no investments passes before AND
 * after this story and proves nothing.** Do not "simplify" these fixtures to zero.
 *
 * ⚠️ DIRECTION, and it was a product decision, not a coin toss (Lucas,
 * 2026-09-24): the BASELINE grows at 7% too; the projection's `* 1.07` is
 * untouched. `ForecastingScenario` has no investment field of any kind, so the 7%
 * is an engine constant that NO scenario lever produces — "the projection's 7% is
 * the scenario's own contribution" is factually false, not merely the less
 * appealing reading. The baseline answers "what if I change nothing", not "what if
 * my investments stop growing".
 *
 * ⚠️ The 7% itself remains hard-coded with no parameter and no user control. That
 * is a separate, still-open item in `deferred-work.md`; this story makes it
 * load-bearing on one more line rather than fixing it.
 */
describe('calculateFinancialForecast — investment compounding, both loops', () => {
  /** As CURRENT_DATA, but with 10,000.00 invested so the 7% has something to act on. */
  const INVESTED = { ...CURRENT_DATA, investments: 1_000_000 }

  it('produces two IDENTICAL series for a scenario with no adjustments', () => {
    const r = calculateFinancialForecast(INVESTED, FLAT, YEARS)

    // FR106 in one assertion: an empty scenario changes nothing, so the "if
    // nothing changes" line and the scenario line must agree in every field of
    // every row — not merely in `savings`, which was already equal because the
    // recurring flow cancels exactly (see the annualization block above).
    expect(r.baseline).toEqual(r.projection)
  })

  it('grows the BASELINE investments year on year, not just the projection', () => {
    const r = calculateFinancialForecast(INVESTED, FLAT, YEARS)

    // BY HAND, compounding ONE YEAR AT A TIME from 1000000:
    //   y1 = round(1000000 × 1.07) = round(1070000)   = 1070000
    //   y2 = round(1070000 × 1.07) = round(1144900)   = 1144900
    //   y3 = round(1144900 × 1.07) = round(1225043)   = 1225043
    // Pre-fix the baseline reported 1000000 for all three.
    expect(
      r.baseline.map((b) => b.investments),
      'iterative 7%, not a flat carry'
    ).toEqual([1_070_000, 1_144_900, 1_225_043])

    // ⚠️ POSITION IS LOAD-BEARING, and the array above is what pins it: a row
    // reports a CLOSING balance (story `forecast-2`), so year 1 must ALREADY be
    // grown. Compounding after the `baseline.push` shifts the whole series one
    // year — MEASURED as [1000000, 1070000, 1144900] — which this `toEqual`
    // catches at index 0. (A separate `.not.toBe(1_000_000)` assertion lived here
    // and was removed: it could never fail independently of the array.)

    // netWorth follows: savings (100000 + 1200000 × n) + investments.
    expect(
      r.baseline.map((b) => b.netWorth),
      '1300000+1070000, 2500000+1144900, …'
    ).toEqual([2_370_000, 3_644_900, 4_925_043])
  })

  it('rounds EVERY year, rather than carrying a fraction and rounding once', () => {
    // ⚠️⚠️ THE FIXTURE *IS* THE TEST HERE, and the two obvious choices are both
    // blind. MEASURED:
    //   · 1_000_000 cannot see a rounding bug AT ALL — `1.07 × 1000000`,
    //     `× 1070000` and `× 1144900` are each EXACT in IEEE-754, so the
    //     unrounded chain is byte-identical to the rounded one. The whole-result
    //     `toEqual` above therefore says NOTHING about rounding.
    //   · 333_333 (this test's first fixture) catches "no rounding at all" but
    //     NOT the realistic wrong implementation below: per-year rounding and
    //     carry-then-round-on-row both give [356666, 381633, 408347].
    // 100_007 separates them at year 2. That is the only reason it is the fixture.
    const r = calculateFinancialForecast({ ...CURRENT_DATA, investments: 100_007 }, FLAT, YEARS)

    // BY HAND, rounding at each step:
    //   y1 = round(100007 × 1.07) = round(107007.49) = 107007
    //   y2 = round(107007 × 1.07) = round(114497.49) = 114497
    //   y3 = round(114497 × 1.07) = round(122511.79) = 122512
    expect(r.baseline.map((b) => b.investments)).toEqual([107_007, 114_497, 122_512])
    expect(r.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_512])

    // THE DISCRIMINATION, asserted rather than asserted-about. An implementation
    // that keeps a FRACTIONAL accumulator and rounds only when the row is
    // recorded (`v *= 1.07` … `investments: Math.round(v)`) yields
    // [107007, 114498, 122513] — MEASURED, and it diverges from per-year rounding
    // for 886,398 of the first 2,000,000 starting balances (44%), the smallest
    // being 3 cents. Without this line the test's own title would be a claim it
    // does not check.
    expect(
      r.baseline.map((b) => b.investments),
      'carry-then-round-on-row would give [107007, 114498, 122513]'
    ).not.toEqual([107_007, 114_498, 122_513])
  })

  it('keeps the investment series identical under a NON-flat scenario too', () => {
    // ⚠️ This is what makes the deep-equal test above non-vacuous. No scenario
    // lever touches investments — `ForecastingScenario` carries income growth,
    // expense growth and one-time events, and nothing else — so the two
    // investment series must agree for EVERY scenario, not only the empty one.
    // Savings legitimately diverge here; investments must not.
    const r = calculateFinancialForecast(
      INVESTED,
      {
        ...FLAT,
        incomeGrowthRate: 0.05,
        expenseGrowthRate: 0.03,
        oneTimeEvents: [{ year: 2, amount: -5_000_000 }],
      },
      YEARS
    )

    expect(r.baseline.map((b) => b.investments)).toEqual(r.projection.map((p) => p.investments))
    expect(
      r.baseline.map((b) => b.investments),
      'the same 7% chain as the flat run'
    ).toEqual([1_070_000, 1_144_900, 1_225_043])

    // The control: this scenario really is non-flat, so the series are NOT equal
    // overall. Without this, the assertion above could pass on a run that had
    // silently collapsed to the flat case.
    expect(r.baseline.map((b) => b.savings)).not.toEqual(r.projection.map((p) => p.savings))
  })
})

/**
 * Per-account savings rows (story 100.1, FR164, D2/D6).
 *
 * Contributions MOVE money between the user's own savings pots: every cent of a
 * year's net income already lands in `savings`. So the rows can only SPLIT that
 * figure, never change it. The invariant below is the whole contract, and the
 * strip-and-`toEqual` test is what proves the totals did not move.
 */
describe('calculateFinancialForecast — savings account rows (100.1)', () => {
  /** Hand-computable: 1000.00/mo net, two rows contributing 200.00 + 50.00/mo. */
  const TWO_ROWS: SavingsAccountInput[] = [
    { balance: 100000, monthlyContribution: 20000 },
    { balance: 0, monthlyContribution: 5000 },
  ]

  const strip = (r: ReturnType<typeof calculateFinancialForecast>) => ({
    ...r,
    projection: r.projection.map(
      ({ savingsAccounts: _a, unallocatedSavings: _u, ...rest }) => rest
    ),
  })

  it("reports each row's CLOSING balance and the unassigned remainder, by hand", () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, savingsAccounts: TWO_ROWS },
      FLAT,
      YEARS
    )
    // Year 1: each row gains its monthly contribution × 12; the 12,000.00 of net
    // income minus the 3,000.00 contributed is not assigned to any row.
    expect(r.projection.map((p) => p.savingsAccounts)).toEqual([
      [340000, 60000],
      [580000, 120000],
      [820000, 180000],
    ])
    expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([900000, 1800000, 2700000])
  })

  const FIXTURES: Array<{
    label: string
    rows: SavingsAccountInput[]
    scenario: ForecastingScenario
    investments?: number
  }> = [
    { label: 'one row', rows: [{ balance: 100000, monthlyContribution: 12345 }], scenario: FLAT },
    {
      label: 'three rows',
      rows: [
        { balance: 30000, monthlyContribution: 1 },
        { balance: 30000, monthlyContribution: 33333 },
        { balance: 40000, monthlyContribution: 0 },
      ],
      scenario: FLAT,
    },
    {
      label: 'contributions bigger than the surplus',
      rows: [{ balance: 100000, monthlyContribution: 500000 }],
      scenario: FLAT,
    },
    {
      label: 'a one-time event year, growth rates and investments',
      rows: TWO_ROWS,
      scenario: {
        name: 'busy',
        incomeGrowthRate: 0.05,
        expenseGrowthRate: 0.03,
        oneTimeEvents: [
          { year: 2, amount: -5_000_000 },
          { year: 3, amount: 777_777 },
        ],
      },
      investments: 1_000_007,
    },
  ]

  for (const { label, rows, scenario, investments } of FIXTURES) {
    it(`rows + unassigned === savings in every year (${label})`, () => {
      const data = { ...CURRENT_DATA, investments: investments ?? 0 }
      const r = calculateFinancialForecast({ ...data, savingsAccounts: rows }, scenario, 10)
      for (const p of r.projection) {
        const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
        expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
      }
    })

    it(`changes no total, no baseline and no summary (${label})`, () => {
      const data = { ...CURRENT_DATA, investments: investments ?? 0 }
      const withRows = calculateFinancialForecast({ ...data, savingsAccounts: rows }, scenario, 10)
      const without = calculateFinancialForecast(data, scenario, 10)
      expect(strip(withRows)).toEqual(without)
      // Control: the rows really were reported, so the strip had something to strip.
      expect(withRows.projection[0]?.savingsAccounts).toHaveLength(rows.length)
    })
  }

  it('applies contributions in full when they exceed what is left over: unassigned goes negative', () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, savingsAccounts: [{ balance: 100000, monthlyContribution: 150000 }] },
      FLAT,
      1
    )
    // 1,500.00 × 12 contributed against 1,000.00 × 12 of net income.
    expect(r.projection[0]?.savingsAccounts).toEqual([1_900_000])
    expect(r.projection[0]?.unallocatedSavings).toBe(-600_000)
    expect(r.projection[0]?.savings).toBe(1_300_000)
  })

  it('leaves the baseline rows without the new fields (rows model the projection only, D6)', () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, savingsAccounts: TWO_ROWS },
      FLAT,
      YEARS
    )
    for (const b of r.baseline) {
      expect(Object.keys(b)).not.toContain('savingsAccounts')
      expect(Object.keys(b)).not.toContain('unallocatedSavings')
    }
  })

  it('adds no new key when no rows are given', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    for (const p of r.projection) {
      expect(Object.keys(p)).not.toContain('savingsAccounts')
      expect(Object.keys(p)).not.toContain('unallocatedSavings')
    }
  })

  it('accepts an empty row list when the starting savings are 0: everything is unassigned', () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, savings: 0, savingsAccounts: [] },
      FLAT,
      1
    )
    expect(r.projection[0]?.savingsAccounts).toEqual([])
    expect(r.projection[0]?.unallocatedSavings).toBe(r.projection[0]?.savings)
  })

  it('refuses rows whose balances do not add up to the starting savings', () => {
    expect(() =>
      calculateFinancialForecast(
        { ...CURRENT_DATA, savings: 100001, savingsAccounts: TWO_ROWS },
        FLAT,
        YEARS
      )
    ).toThrow(SAVINGS_ROWS_MISMATCH)
    expect(() =>
      calculateFinancialForecast({ ...CURRENT_DATA, savingsAccounts: [] }, FLAT, YEARS)
    ).toThrow(SAVINGS_ROWS_MISMATCH)
  })

  it('refuses a negative balance or contribution', () => {
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          savingsAccounts: [
            { balance: 200000, monthlyContribution: 0 },
            { balance: -100000, monthlyContribution: 0 },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(SAVINGS_ROW_NEGATIVE)
    expect(() =>
      calculateFinancialForecast(
        { ...CURRENT_DATA, savingsAccounts: [{ balance: 100000, monthlyContribution: -1 }] },
        FLAT,
        YEARS
      )
    ).toThrow(SAVINGS_ROW_NEGATIVE)
  })

  it("refuses a non-finite balance or contribution with validateAmount's message", () => {
    for (const bad of [
      { balance: Number.NaN, monthlyContribution: 0 },
      { balance: 100000, monthlyContribution: Number.POSITIVE_INFINITY },
      { balance: 100000, monthlyContribution: null as unknown as number },
    ]) {
      expect(() =>
        calculateFinancialForecast({ ...CURRENT_DATA, savingsAccounts: [bad] }, FLAT, YEARS)
      ).toThrow('Amount must be a finite number')
    }
  })
})

/**
 * Investment and debt rows (story 100.2, FR165, D1/D2/D4/D5/D7).
 *
 * Every expected figure below is derived BY HAND in the comment beside it (and
 * checked with a calculator), never by calling the engine's own formula.
 *
 *   - Investment row: `inv_y = round(inv_{y-1} × 1.07) + annualContribution` (D7).
 *     Since story 100.3 the rate is the row's own `annualReturn`; every investment
 *     fixture here carries `annualReturn: 0.07` (100.3 D4: the engine has no
 *     default), so every figure below is still the 100.2 figure, unchanged.
 *   - A counted contribution (flag not `=== true`) also leaves savings; a flagged
 *     one does not, because net income already lost it (45.1, FR72).
 *   - Debt row: `debt_y = max(0, debt_{y-1} − annualContribution)`. FLAGGED
 *     (`contributionRecordedAsExpense === true`), savings is not touched: the
 *     payment is already an Expenses line (100.2 D4). Unflagged, what it paid is
 *     cash out (story 102.2; its own block below).
 *   - Both loops (D5), so a flat scenario keeps baseline === projection (67.1).
 */
describe('calculateFinancialForecast — investment and debt rows (100.2)', () => {
  /**
   * Three rows over CURRENT_DATA (1,000.00/mo net, so 12,000.00 a year):
   *   - counted investment 10,000.00, contributing 100.00/mo (1,200.00 a year);
   *   - flagged investment 1,000.07, contributing 50.00/WEEK: 5000 × 52 =
   *     260000 a year (story 111.1; the raw `5000 × 12` would be 60000, and the
   *     pre-111.1 monthly round trip round(5000 × 52/12) × 12 gave 260004);
   *   - debt 5,000.00, paying 200.00/mo (2,400.00 a year).
   */
  const MIXED: BalanceAccountInput[] = [
    {
      type: 'investment',
      annualReturn: 0.07,
      balance: 1_000_000,
      contribution: 10_000,
      frequency: 'monthly',
    },
    {
      type: 'investment',
      annualReturn: 0.07,
      balance: 100_007,
      contribution: 5_000,
      frequency: 'weekly',
      contributionRecordedAsExpense: true,
    },
    // Story 102.2: flagged "payment already in Expenses", so the 100.2 D4 math
    // (and every figure below) is unchanged. That is the AC-3 parity proof.
    {
      type: 'debt',
      balance: 500_000,
      contribution: 20_000,
      frequency: 'monthly',
      contributionRecordedAsExpense: true,
    },
  ]
  const MIXED_DATA = { ...CURRENT_DATA, investments: 1_100_007, balanceAccounts: MIXED }

  it('grows, pays down and moves money between buckets, by hand', () => {
    const r = calculateFinancialForecast(MIXED_DATA, FLAT, YEARS)

    // Counted investment: round(1000000 × 1.07) = 1070000, + 120000 = 1190000;
    // round(1190000 × 1.07) = 1273300, + 120000 = 1393300; round(1393300 × 1.07)
    // = 1490831, + 120000 = 1610831.
    // Flagged investment: round(100007 × 1.07) = round(107007.49) = 107007,
    // + 260000 = 367007; round(367007 × 1.07) = round(392697.49) = 392697,
    // + 260000 = 652697; round(652697 × 1.07) = round(698385.79) = 698386,
    // + 260000 = 958386. (Pre-111.1, at 260004 a year: 367011, 652706, 958399.)
    // Debt: 500000 − 240000 = 260000; − 240000 = 20000; max(0, −220000) = 0.
    expect(r.projection.map((p) => p.balanceAccounts)).toEqual([
      [1_190_000, 367_007, 260_000],
      [1_393_300, 652_697, 20_000],
      [1_610_831, 958_386, 0],
    ])
    expect(r.projection.map((p) => p.investments)).toEqual([1_557_007, 2_045_997, 2_569_217])
    expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0])
    // Savings: + 1,200,000 net income − 120,000 counted contribution a year. The
    // flagged contribution and the flagged debt payment take nothing more (D4, 45.1).
    expect(r.projection.map((p) => p.savings)).toEqual([1_180_000, 2_260_000, 3_340_000])
    // netWorth = savings + investments − debts.
    expect(r.projection.map((p) => p.netWorth)).toEqual([2_477_007, 4_285_997, 5_909_217])
    // Starting: 100000 + 1100007 − 500000.
    expect(r.summary.startingNetWorth).toBe(700_007)
    expect(r.summary.endingNetWorth).toBe(5_909_217)
  })

  it('models the rows in the baseline too, so a flat scenario keeps baseline === projection (D5, 67.1)', () => {
    const r = calculateFinancialForecast(MIXED_DATA, FLAT, YEARS)
    expect(r.baseline).toEqual(r.projection)
    // Control: the baseline really carries the rows (not two empty series).
    expect(r.baseline.map((b) => b.debts)).toEqual([260_000, 20_000, 0])
  })

  it('annualises an annual contribution exactly (story 111.1)', () => {
    // annually 1200013: 1200013 × 1 = 1200013 a year. (Pre-111.1 the monthly
    // round trip round(1200013 / 12) × 12 gave 1200012, one cent light.)
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 0,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 0,
            contribution: 1_200_013,
            frequency: 'annually',
          },
        ],
      },
      FLAT,
      1
    )
    expect(r.projection[0]?.investments).toBe(1_200_013)
    // Counted, so savings loses the same: 100000 + 1200000 − 1200013.
    expect(r.projection[0]?.savings).toBe(99_987)
  })

  it('degrades an unrecognised frequency to monthly, as the chokepoint does', () => {
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 0,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 0,
            contribution: 10_000,
            frequency: 'quarterly' as never,
          },
        ],
      },
      FLAT,
      1
    )
    expect(r.projection[0]?.investments).toBe(120_000)
  })

  it('one investment row with no contribution compounds exactly like the old single total', () => {
    const withRow = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 100_007,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 100_007,
            contribution: 0,
            frequency: 'monthly',
          },
        ],
      },
      FLAT,
      YEARS
    )
    const without = calculateFinancialForecast(
      { ...CURRENT_DATA, investments: 100_007 },
      FLAT,
      YEARS
    )
    // The 67.1 rounding probe's chain: 107007, 114497, 122512.
    expect(withRow.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_512])
    expect(withRow.projection.map((p) => p.investments)).toEqual(
      without.projection.map((p) => p.investments)
    )
    expect(withRow.projection.map((p) => p.netWorth)).toEqual(
      without.projection.map((p) => p.netWorth)
    )
    expect(withRow.summary).toEqual(without.summary)
  })

  it('rounds each investment row on its own, which can differ from one total by a cent (D7, recorded)', () => {
    // 50003 + 50004 = 100007, the single-total chain above.
    // Row A: round(53503.21) = 53503; round(57248.21) = 57248; round(61255.36) = 61255.
    // Row B: round(53504.28) = 53504; round(57249.28) = 57249; round(61256.43) = 61256.
    // Sum: 107007, 114497, 122511 — ONE cent below the total's 122512 in year 3.
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 100_007,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 50_003,
            contribution: 0,
            frequency: 'monthly',
          },
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 50_004,
            contribution: 0,
            frequency: 'monthly',
          },
        ],
      },
      FLAT,
      YEARS
    )
    expect(r.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_511])
  })

  it('flag parity: a flagged contribution plus its expense row ends where an unflagged one does', () => {
    const row = (flag: boolean): BalanceAccountInput => ({
      type: 'investment',
      annualReturn: 0.07,
      balance: 200_000,
      contribution: 30_000,
      frequency: 'monthly',
      contributionRecordedAsExpense: flag,
    })
    const counted = calculateFinancialForecast(
      { ...CURRENT_DATA, investments: 200_000, balanceAccounts: [row(false)] },
      FLAT,
      10
    )
    const flaggedWithExpense = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        expenses: [...CURRENT_DATA.expenses, { amount: 30_000, frequency: 'monthly' as const }],
        investments: 200_000,
        balanceAccounts: [row(true)],
      },
      FLAT,
      10
    )
    expect(flaggedWithExpense.summary.endingNetWorth).toBe(counted.summary.endingNetWorth)
    expect(flaggedWithExpense.projection.map((p) => p.investments)).toEqual(
      counted.projection.map((p) => p.investments)
    )
    // Control: the flag is not a no-op. Year 1 savings, by hand: counted
    // 100000 + 1200000 − 360000 = 940000; flagged with no expense row 1300000.
    const flaggedNoExpense = calculateFinancialForecast(
      { ...CURRENT_DATA, investments: 200_000, balanceAccounts: [row(true)] },
      FLAT,
      1
    )
    expect(flaggedNoExpense.projection[0]?.savings).toBe(1_300_000)
    expect(counted.projection[0]?.savings).toBe(940_000)
  })

  it('a debt with no payment stays put and lowers net worth by exactly its balance', () => {
    const withDebt = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        balanceAccounts: [
          { type: 'debt', balance: 750_000, contribution: 0, frequency: 'monthly' },
        ],
      },
      FLAT,
      YEARS
    )
    const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    expect(withDebt.projection.map((p) => p.debts)).toEqual([750_000, 750_000, 750_000])
    withDebt.projection.forEach((p, i) => {
      expect(p.netWorth).toBe((without.projection[i]?.netWorth ?? Number.NaN) - 750_000)
    })
    expect(withDebt.summary.startingNetWorth).toBe(without.summary.startingNetWorth - 750_000)
  })

  it('a FLAGGED payment bigger than the debt pays it off and stops at 0; it never touches savings (D4, kept by 102.2 for flagged rows)', () => {
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        balanceAccounts: [
          {
            type: 'debt',
            balance: 100_000,
            contribution: 50_000,
            frequency: 'monthly',
            contributionRecordedAsExpense: true,
          },
        ],
      },
      FLAT,
      YEARS
    )
    // 100000 − 600000 → 0, and it stays there.
    expect(r.projection.map((p) => p.debts)).toEqual([0, 0, 0])
    expect(r.projection.map((p) => p.balanceAccounts)).toEqual([[0], [0], [0]])
    const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    expect(r.projection.map((p) => p.savings)).toEqual(without.projection.map((p) => p.savings))
  })

  it('keeps the 100.1 invariant with counted, flagged and debt rows: rows + unassigned === savings', () => {
    const r = calculateFinancialForecast(
      {
        ...MIXED_DATA,
        savingsAccounts: [
          { balance: 60_000, monthlyContribution: 20_000 },
          { balance: 40_000, monthlyContribution: 0 },
        ],
      },
      FLAT,
      10
    )
    for (const p of r.projection) {
      const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
      expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
    }
    // Year 1 by hand: 1,200,000 net − 240,000 to the savings rows − 120,000
    // counted investment contribution = 840,000 unassigned.
    expect(r.projection[0]?.unallocatedSavings).toBe(840_000)
  })

  it('adds no new key when no balance rows are given', () => {
    const r = calculateFinancialForecast({ ...CURRENT_DATA, investments: 100_007 }, FLAT, YEARS)
    for (const row of [...r.baseline, ...r.projection]) {
      expect(Object.keys(row)).not.toContain('debts')
      expect(Object.keys(row)).not.toContain('balanceAccounts')
    }
  })

  it('accepts an empty row list when the starting investments are 0', () => {
    const r = calculateFinancialForecast({ ...CURRENT_DATA, balanceAccounts: [] }, FLAT, 1)
    expect(r.projection[0]?.balanceAccounts).toEqual([])
    expect(r.projection[0]?.debts).toBe(0)
    expect(r.projection[0]?.netWorth).toBe(1_300_000)
  })

  it('refuses investment rows that do not add up to the starting investments', () => {
    expect(() =>
      calculateFinancialForecast({ ...MIXED_DATA, investments: 1_100_008 }, FLAT, YEARS)
    ).toThrow(BALANCE_ROWS_MISMATCH)
    // Debts do not count towards the investment total.
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          investments: 500_000,
          balanceAccounts: [
            { type: 'debt', balance: 500_000, contribution: 0, frequency: 'monthly' },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(BALANCE_ROWS_MISMATCH)
  })

  it('refuses a negative balance or contribution', () => {
    const bad: BalanceAccountInput[] = [
      {
        type: 'investment',
        annualReturn: 0.07,
        balance: -1,
        contribution: 0,
        frequency: 'monthly',
      },
      { type: 'debt', balance: -1, contribution: 0, frequency: 'monthly' },
      { type: 'debt', balance: 0, contribution: -1, frequency: 'monthly' },
    ]
    for (const row of bad) {
      const investments = row.type === 'investment' ? row.balance : 0
      expect(() =>
        calculateFinancialForecast(
          { ...CURRENT_DATA, investments, balanceAccounts: [row] },
          FLAT,
          YEARS
        )
      ).toThrow(BALANCE_ROW_NEGATIVE)
    }
  })

  it("refuses a non-finite balance or contribution with validateAmount's message", () => {
    const bad: BalanceAccountInput[] = [
      { type: 'debt', balance: Number.NaN, contribution: 0, frequency: 'monthly' },
      { type: 'debt', balance: 0, contribution: Number.POSITIVE_INFINITY, frequency: 'monthly' },
      { type: 'debt', balance: 0, contribution: null as never, frequency: 'monthly' },
    ]
    for (const row of bad) {
      expect(() =>
        calculateFinancialForecast({ ...CURRENT_DATA, balanceAccounts: [row] }, FLAT, YEARS)
      ).toThrow('Amount must be a finite number')
    }
  })

  it('refuses a row that is neither an investment nor a debt', () => {
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          balanceAccounts: [
            { type: 'asset' as never, balance: 0, contribution: 0, frequency: 'monthly' },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(BALANCE_ROW_TYPE)
  })

  it('refuses a debt total that overflows, rather than projecting Infinity', () => {
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          balanceAccounts: [
            { type: 'debt', balance: 1.7e308, contribution: 0, frequency: 'monthly' },
            { type: 'debt', balance: 1.7e308, contribution: 0, frequency: 'monthly' },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(FORECAST_OUT_OF_RANGE)
  })

  it('refuses a debt payment that normalises to Infinity, rather than flooring the debt to 0 (code review)', () => {
    // 1e308 weekly × 52 overflows; without the guard the debt silently reads 0.
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          balanceAccounts: [
            { type: 'debt', balance: 100_000, contribution: 1e308, frequency: 'weekly' },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(FORECAST_OUT_OF_RANGE)
  })

  /**
   * Story 111.1 AC 5: an income or expense whose ANNUAL figure overflows is
   * refused on the BASELINE too. The projection's running-balance check already
   * caught it there; the baseline had no guard, so a separate `baselineInput`
   * (107.1) carrying 1e307 weekly (× 52 = Infinity) leaked `Infinity` into every
   * baseline row.
   */
  it('refuses an income or expense whose annual figure overflows, on the baseline too (111.1)', () => {
    const huge = (field: 'income' | 'expenses') => ({
      ...CURRENT_DATA,
      [field]: [{ amount: 1e307, frequency: 'weekly' as const }],
    })
    for (const field of ['income', 'expenses'] as const) {
      // Projection side (already refused before 111.1, by the running balance).
      expect(() => calculateFinancialForecast(huge(field), FLAT, YEARS)).toThrow(
        FORECAST_OUT_OF_RANGE
      )
      // Baseline side only: the projection data is ordinary.
      expect(() => calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS, huge(field))).toThrow(
        FORECAST_OUT_OF_RANGE
      )
    }
  })
})

/**
 * A debt's payment is cash out only while the debt is owed (story 102.2, FR170,
 * replacing 100.2 D4 for UNFLAGGED debt rows).
 *
 * Every figure is derived BY HAND in the comment beside it. CURRENT_DATA nets
 * 1,000.00/mo (income 60,000.00 and expenses 48,000.00 a year, 12,000.00 left).
 * An unflagged debt row pays `min(annual payment, opening balance)` each year; that
 * amount is added to the year's `expenses` and taken from its `netIncome`, in
 * BOTH loops.
 */
describe('calculateFinancialForecast — a debt payment stops at payoff (102.2)', () => {
  const debt = (
    balance: number,
    contribution: number,
    over: Partial<BalanceAccountInput> = {}
  ): BalanceAccountInput => ({
    type: 'debt',
    balance,
    contribution,
    frequency: 'monthly',
    ...over,
  })

  it('pays the full payment while owed, only the remainder in the payoff year, nothing after, by hand', () => {
    // 5,000.00 at 200.00/mo = 2,400.00 a year.
    //   Y1: pays 2,400.00 → 2,600.00 owed. expenses 48,000 + 2,400 = 50,400.00;
    //       net 12,000 − 2,400 = 9,600.00; savings 1,000 + 9,600 = 10,600.00.
    //   Y2: pays 2,400.00 → 200.00 owed. net 9,600.00; savings 20,200.00.
    //   Y3: pays the 200.00 remainder → 0. expenses 48,200.00; net 11,800.00;
    //       savings 32,000.00.
    //   Y4: pays nothing. expenses 48,000.00; net 12,000.00; savings 44,000.00.
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
      FLAT,
      4
    )
    expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0, 0])
    expect(r.projection.map((p) => p.expenses)).toEqual([
      5_040_000, 5_040_000, 4_820_000, 4_800_000,
    ])
    expect(r.projection.map((p) => p.netIncome)).toEqual([960_000, 960_000, 1_180_000, 1_200_000])
    expect(r.projection.map((p) => p.savings)).toEqual([1_060_000, 2_020_000, 3_200_000, 4_400_000])
    // netWorth = savings − debts.
    expect(r.projection.map((p) => p.netWorth)).toEqual([800_000, 2_000_000, 3_200_000, 4_400_000])
    expect(r.summary.startingNetWorth).toBe(-400_000)
    // Income is untouched: the payment is an outflow, not lost income.
    expect(r.projection.map((p) => p.income)).toEqual([6_000_000, 6_000_000, 6_000_000, 6_000_000])
  })

  it('deducts in the baseline too, so a flat scenario keeps baseline === projection (D5, 67.1)', () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
      FLAT,
      4
    )
    expect(r.baseline).toEqual(r.projection)
    // Control: the baseline really carries the deduction (not two untouched series).
    expect(r.baseline.map((b) => b.netIncome)).toEqual([960_000, 960_000, 1_180_000, 1_200_000])
  })

  it('a payment of 0 leaves the debt constant and deducts nothing', () => {
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(750_000, 0)] },
      FLAT,
      YEARS
    )
    const without = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)
    expect(r.projection.map((p) => p.debts)).toEqual([750_000, 750_000, 750_000])
    expect(r.projection.map((p) => p.savings)).toEqual(without.projection.map((p) => p.savings))
    expect(r.projection.map((p) => p.expenses)).toEqual(without.projection.map((p) => p.expenses))
  })

  it('a payment bigger than the debt pays only the debt in year 1, then nothing', () => {
    // 1,000.00 owed, 500.00/mo = 6,000.00 a year: Y1 pays 1,000.00 only.
    //   Y1 net 12,000 − 1,000 = 11,000.00; savings 12,000.00. Y2 net 12,000.00; savings 24,000.00.
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(100_000, 50_000)] },
      FLAT,
      2
    )
    expect(r.projection.map((p) => p.netIncome)).toEqual([1_100_000, 1_200_000])
    expect(r.projection.map((p) => p.savings)).toEqual([1_200_000, 2_400_000])
    expect(r.projection.map((p) => p.debts)).toEqual([0, 0])
  })

  it('annualises a weekly payment exactly before deducting it (story 111.1)', () => {
    // 50.00/week: 5000 × 52 = 260,000 a year (pre-111.1: round(5000 × 52/12) =
    // 21667 a month, × 12 = 260,004). Net 1,200,000 − 260,000 = 940,000.
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(1_000_000, 5_000, { frequency: 'weekly' })] },
      FLAT,
      1
    )
    expect(r.projection[0]?.netIncome).toBe(940_000)
    expect(r.projection[0]?.debts).toBe(740_000)
  })

  it('does not grow the payment with the expense growth rate (D4: a fixed instalment)', () => {
    // Expenses grow 10%: Y1 round(400000 × 1.1) = 440000/mo → 5,280,000 a year;
    // Y2 round(400000 × 1.21) = 484000/mo → 5,808,000. The 2,400.00 payment stays flat.
    const r = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(1_000_000, 20_000)] },
      { ...FLAT, expenseGrowthRate: 0.1 },
      2
    )
    expect(r.projection.map((p) => p.expenses)).toEqual([5_520_000, 6_048_000])
    // 6,000,000 − 5,520,000 = 480,000; 6,000,000 − 6,048,000 = −48,000.
    expect(r.projection.map((p) => p.netIncome)).toEqual([480_000, -48_000])
  })

  it('counts only the unflagged debts; a corrupt flag counts as unflagged (strict === true)', () => {
    // Flagged 200.00/mo takes nothing; unflagged 100.00/mo takes 1,200.00 a year;
    // the string 'true' is not `true`, so its 50.00/mo (600.00 a year) is taken too.
    // Net 12,000 − 1,200 − 600 = 10,200.00.
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        balanceAccounts: [
          debt(1_000_000, 20_000, { contributionRecordedAsExpense: true }),
          debt(1_000_000, 10_000),
          debt(1_000_000, 5_000, { contributionRecordedAsExpense: 'true' as never }),
        ],
      },
      FLAT,
      1
    )
    expect(r.projection[0]?.netIncome).toBe(1_020_000)
    // Every row still falls by its payment, flagged or not.
    expect(r.projection[0]?.balanceAccounts).toEqual([760_000, 880_000, 940_000])
  })

  it('keeps the 100.1 invariant with an unflagged debt: rows + unassigned === savings', () => {
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        balanceAccounts: [debt(500_000, 20_000)],
        savingsAccounts: [
          { balance: 60_000, monthlyContribution: 20_000 },
          { balance: 40_000, monthlyContribution: 0 },
        ],
      },
      FLAT,
      5
    )
    for (const p of r.projection) {
      const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
      expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
    }
    // Y1 by hand: 1,200,000 − 240,000 paid − 240,000 to the savings rows = 720,000.
    // Y3 (payoff, 20,000 paid): 720,000 + 720,000 + (1,200,000 − 20,000 − 240,000).
    expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([
      720_000, 1_440_000, 2_380_000, 3_340_000, 4_300_000,
    ])
  })

  it('keeps the 100.1 invariant with a counted investment, a flagged debt and an unflagged debt together (T6 mix)', () => {
    // Counted investment 100.00/mo (1,200.00 a year leaves savings); flagged debt
    // 200.00/mo (takes nothing); unflagged debt 5,000.00 at 200.00/mo.
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 1_000_000,
        balanceAccounts: [
          {
            type: 'investment',
            annualReturn: 0.07,
            balance: 1_000_000,
            contribution: 10_000,
            frequency: 'monthly',
          },
          debt(1_000_000, 20_000, { contributionRecordedAsExpense: true }),
          debt(500_000, 20_000),
        ],
        savingsAccounts: [
          { balance: 60_000, monthlyContribution: 20_000 },
          { balance: 40_000, monthlyContribution: 0 },
        ],
      },
      FLAT,
      4
    )
    for (const p of r.projection) {
      const rowSum = (p.savingsAccounts ?? []).reduce((sum, b) => sum + b, 0)
      expect(rowSum + (p.unallocatedSavings ?? Number.NaN), `year ${p.year}`).toBe(p.savings)
    }
    // By hand, unassigned per year = 1,200,000 − unflagged debt paid − 240,000 to
    // the savings rows − 120,000 counted contribution; the flagged debt takes 0.
    //   Y1 −240,000 → 600,000; Y2 −240,000 → 600,000; Y3 −20,000 → 820,000; Y4 → 840,000.
    expect(r.projection.map((p) => p.unallocatedSavings)).toEqual([
      600_000, 1_200_000, 2_020_000, 2_860_000,
    ])
    // Both debts still fall: flagged 10,000.00 − 2,400.00 a year; unflagged pays off in Y3.
    expect(r.projection.map((p) => p.balanceAccounts?.slice(1))).toEqual([
      [760_000, 260_000],
      [520_000, 20_000],
      [280_000, 0],
      [40_000, 0],
    ])
  })

  it('a moved payment ends where the old expense line did until payoff, then savings rise by the payment every year (AC-5)', () => {
    // (a) pre-story: the payment is an Expenses line and the debt is flagged (D4).
    // (b) story 102.2: the expense line is gone and the debt row pays (unflagged).
    const before = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        expenses: [...CURRENT_DATA.expenses, { amount: 20_000, frequency: 'monthly' as const }],
        balanceAccounts: [debt(500_000, 20_000, { contributionRecordedAsExpense: true })],
      },
      FLAT,
      5
    )
    const after = calculateFinancialForecast(
      { ...CURRENT_DATA, balanceAccounts: [debt(500_000, 20_000)] },
      FLAT,
      5
    )
    // Same debt path either way.
    expect(after.projection.map((p) => p.debts)).toEqual(before.projection.map((p) => p.debts))
    // Years 1-2 (owed all year): identical money.
    for (const i of [0, 1]) {
      expect(after.projection[i]?.netIncome).toBe(before.projection[i]?.netIncome)
      expect(after.projection[i]?.expenses).toBe(before.projection[i]?.expenses)
      expect(after.projection[i]?.savings).toBe(before.projection[i]?.savings)
    }
    // Payoff year 3: only the 200.00 remainder was paid, so 2,200.00 more is kept.
    const diff = (i: number) =>
      (after.projection[i]?.savings ?? Number.NaN) - (before.projection[i]?.savings ?? Number.NaN)
    expect(diff(2)).toBe(220_000)
    // Every later year keeps the whole 2,400.00 payment: net income higher by
    // exactly P, and the savings gap widens by P a year.
    for (const i of [3, 4]) {
      expect(
        (after.projection[i]?.netIncome ?? Number.NaN) -
          (before.projection[i]?.netIncome ?? Number.NaN)
      ).toBe(240_000)
      expect(diff(i) - diff(i - 1)).toBe(240_000)
    }
  })
})

/**
 * Each investment row carries its own annual return (story 100.3, FR166).
 *
 * Every expected figure is derived BY HAND in the comment beside it, never by
 * calling the engine's own formula. Rule: `inv_y = round(inv_{y-1} × (1 +
 * annualReturn)) + annualContribution`, the 100.2 rule with the row's own rate.
 */
describe('calculateFinancialForecast — per-investment annual return (100.3)', () => {
  /** One investment row, no contribution, at `rate`; `investments` matches. */
  function oneRow(balance: number, annualReturn: unknown, contribution = 0) {
    return {
      ...CURRENT_DATA,
      investments: balance,
      balanceAccounts: [
        {
          type: 'investment' as const,
          balance,
          contribution,
          frequency: 'monthly' as const,
          annualReturn: annualReturn as number,
        },
      ],
    }
  }

  it('the default for a new investment row is 6% (D2)', () => {
    expect(DEFAULT_INVESTMENT_RETURN).toBe(0.06)
  })

  /**
   * AC-3: at 0.07 every row reproduces 100.2's pinned figures to the cent. The
   * constants are COPIED from the 100.2 tests above (`grows, pays down and moves
   * money between buckets, by hand` and `rounds each investment row on its own`),
   * not recomputed. (Re-copied by story 111.1: the weekly contribution now
   * annualises to 260000, not 260004, so the flagged row's chain moved.)
   */
  it('at 7% the 100.2 fixtures give the 100.2 figures exactly (parity)', () => {
    const PINNED_100_2 = {
      balanceAccounts: [
        [1_190_000, 367_007, 260_000],
        [1_393_300, 652_697, 20_000],
        [1_610_831, 958_386, 0],
      ],
      investments: [1_557_007, 2_045_997, 2_569_217],
      savings: [1_180_000, 2_260_000, 3_340_000],
      netWorth: [2_477_007, 4_285_997, 5_909_217],
      startingNetWorth: 700_007,
      endingNetWorth: 5_909_217,
    }
    const mixed = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 1_100_007,
        balanceAccounts: [
          {
            type: 'investment',
            balance: 1_000_000,
            contribution: 10_000,
            frequency: 'monthly',
            annualReturn: 0.07,
          },
          {
            type: 'investment',
            balance: 100_007,
            contribution: 5_000,
            frequency: 'weekly',
            contributionRecordedAsExpense: true,
            annualReturn: 0.07,
          },
          // Flagged (story 102.2): the 100.2 D4 math these figures were pinned under.
          {
            type: 'debt',
            balance: 500_000,
            contribution: 20_000,
            frequency: 'monthly',
            contributionRecordedAsExpense: true,
          },
        ],
      },
      FLAT,
      YEARS
    )
    for (const series of [mixed.projection, mixed.baseline]) {
      expect(series.map((p) => p.balanceAccounts)).toEqual(PINNED_100_2.balanceAccounts)
      expect(series.map((p) => p.investments)).toEqual(PINNED_100_2.investments)
      expect(series.map((p) => p.savings)).toEqual(PINNED_100_2.savings)
      expect(series.map((p) => p.netWorth)).toEqual(PINNED_100_2.netWorth)
    }
    expect(mixed.summary.startingNetWorth).toBe(PINNED_100_2.startingNetWorth)
    expect(mixed.summary.endingNetWorth).toBe(PINNED_100_2.endingNetWorth)

    // The per-row rounding fixture (100.2 D7): 107007, 114497, 122511.
    const split = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 100_007,
        balanceAccounts: [
          {
            type: 'investment',
            balance: 50_003,
            contribution: 0,
            frequency: 'monthly',
            annualReturn: 0.07,
          },
          {
            type: 'investment',
            balance: 50_004,
            contribution: 0,
            frequency: 'monthly',
            annualReturn: 0.07,
          },
        ],
      },
      FLAT,
      YEARS
    )
    expect(split.projection.map((p) => p.investments)).toEqual([107_007, 114_497, 122_511])
  })

  it('compounds a row at 6% on BOTH series, by hand', () => {
    // round(1000000 × 1.06) = 1060000; round(1060000 × 1.06) = 1123600;
    // round(1123600 × 1.06) = round(1191016) = 1191016 (all exact).
    const r = calculateFinancialForecast(oneRow(1_000_000, 0.06), FLAT, YEARS)
    expect(r.projection.map((p) => p.investments)).toEqual([1_060_000, 1_123_600, 1_191_016])
    expect(r.baseline.map((b) => b.investments)).toEqual([1_060_000, 1_123_600, 1_191_016])
  })

  it('rounds every year at 6% (the 67.1 rounding probe, at the new rate)', () => {
    // round(100007 × 1.06) = round(106007.42) = 106007;
    // round(106007 × 1.06) = round(112367.42) = 112367;
    // round(112367 × 1.06) = round(119109.02) = 119109.
    const r = calculateFinancialForecast(oneRow(100_007, 0.06), FLAT, YEARS)
    expect(r.projection.map((p) => p.investments)).toEqual([106_007, 112_367, 119_109])
  })

  /**
   * Code review 100.3: rates the field can produce but no figure pinned yet.
   * 100000 cents, no contribution, BY HAND:
   *   0%:    100000 every year.
   *   −25%:  75000; 56250; 56250 × 0.75 = 42187.5 (exact in binary) → 42188.
   *   5.5%:  105500; 105500 × 1.055 = 111302.5 → 111303;
   *          111303 × 1.055 = 117424.665 → 117425.
   */
  it.each([
    [0, [100_000, 100_000, 100_000]],
    [-0.25, [75_000, 56_250, 42_188]],
    [0.055, [105_500, 111_303, 117_425]],
  ])('compounds a row at %s on BOTH series, by hand', (rate, expected) => {
    const r = calculateFinancialForecast(oneRow(100_000, rate), FLAT, YEARS)
    expect(r.projection.map((p) => p.investments)).toEqual(expected)
    expect(r.baseline.map((b) => b.investments)).toEqual(expected)
  })

  it('two rows at different rates each compound at their own rate', () => {
    // A: 500000 at 2%: 510000, 520200, round(530604) = 530604.
    // B: 300000 at 10%: 330000, round(363000.00000000006) = 363000,
    //    round(399300.00000000006) = 399300.
    // investments = A + B: 840000, 883200, 929904.
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 800_000,
        balanceAccounts: [
          {
            type: 'investment',
            balance: 500_000,
            contribution: 0,
            frequency: 'monthly',
            annualReturn: 0.02,
          },
          {
            type: 'investment',
            balance: 300_000,
            contribution: 0,
            frequency: 'monthly',
            annualReturn: 0.1,
          },
        ],
      },
      FLAT,
      YEARS
    )
    expect(r.projection.map((p) => p.balanceAccounts)).toEqual([
      [510_000, 330_000],
      [520_200, 363_000],
      [530_604, 399_300],
    ])
    expect(r.projection.map((p) => p.investments)).toEqual([840_000, 883_200, 929_904])
  })

  it('accepts −100% (the row drops to 0, then gains only its contributions) and +100% (doubles)', () => {
    // −100%: round(100000 × 0) + 120000 = 120000; round(120000 × 0) + 120000 = 120000.
    const lost = calculateFinancialForecast(oneRow(100_000, -1, 10_000), FLAT, 2)
    expect(lost.projection.map((p) => p.investments)).toEqual([120_000, 120_000])
    // +100%: 100000 × 2 + 120000 = 320000; 320000 × 2 + 120000 = 760000. Growth
    // comes BEFORE the contribution (100.2 D7): (100000 + 120000) × 2 would be 440000.
    const doubled = calculateFinancialForecast(oneRow(100_000, 1, 10_000), FLAT, 2)
    expect(doubled.projection.map((p) => p.investments)).toEqual([320_000, 760_000])
  })

  it('refuses a rate outside −100%..100%, not a finite number, or missing (D4)', () => {
    expect(INVESTMENT_RETURN_OUT_OF_RANGE).toBe('Investment returns must be from -100% to 100%')
    const bad: unknown[] = [
      -1.0001,
      1.0001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      null,
      '0.06',
    ]
    for (const rate of bad) {
      expect(
        () => calculateFinancialForecast(oneRow(100_000, rate), FLAT, YEARS),
        String(rate)
      ).toThrow(INVESTMENT_RETURN_OUT_OF_RANGE)
    }
    // A row with no `annualReturn` key at all (D4: no hidden default).
    expect(() =>
      calculateFinancialForecast(
        {
          ...CURRENT_DATA,
          investments: 100_000,
          balanceAccounts: [
            { type: 'investment', balance: 100_000, contribution: 0, frequency: 'monthly' },
          ],
        },
        FLAT,
        YEARS
      )
    ).toThrow(INVESTMENT_RETURN_OUT_OF_RANGE)
  })

  it('ignores the rate on a debt row: NaN there does not throw, and the debt pays down as before', () => {
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        balanceAccounts: [
          {
            type: 'debt',
            balance: 500_000,
            contribution: 20_000,
            frequency: 'monthly',
            annualReturn: Number.NaN,
          },
        ],
      },
      FLAT,
      YEARS
    )
    // 500000 − 240000 = 260000; − 240000 = 20000; max(0, −220000) = 0.
    expect(r.projection.map((p) => p.debts)).toEqual([260_000, 20_000, 0])
  })

  it('a flat scenario keeps baseline === projection with a row at a non-7% rate (67.1, 100.2 D5)', () => {
    const r = calculateFinancialForecast(
      {
        ...CURRENT_DATA,
        investments: 100_007,
        balanceAccounts: [
          {
            type: 'investment',
            balance: 100_007,
            contribution: 10_000,
            frequency: 'monthly',
            annualReturn: 0.03,
          },
          { type: 'debt', balance: 50_000, contribution: 1_000, frequency: 'monthly' },
        ],
      },
      FLAT,
      YEARS
    )
    expect(r.baseline).toEqual(r.projection)
    // Control, by hand: round(100007 × 1.03) = round(103007.21) = 103007, + 120000.
    expect(r.baseline[0]?.investments).toBe(223_007)
  })
})
