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

  it('normalizes frequency BEFORE annualizing, rather than scaling the raw amount', () => {
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

    // BY HAND: `calculateTotalMonthlyNormalized` applies 52/12 and rounds PER ITEM:
    // 100000 × 52/12 = 433333.33… ⇒ 433333. A year of that is 433333 × 12 = 5199996.
    //
    // ⚠️ This is the discriminating assertion for the two wrong ways to annualize:
    //   - raw × 52            = 5200000  (skips per-item rounding; off by 4 cents)
    //   - raw × 12            = 1200000  (ignores frequency entirely)
    // The 4-cent gap against 5200000 is the whole point — it proves the rounding
    // happened in monthly space, where every other surface in the app rounds.
    expect(weekly.projection[0].income, 'round(100000 × 52/12) = 433333, × 12').toBe(5_199_996)
    // Documents the rejected alternative; cannot itself be the failing assertion.
    expect(weekly.projection[0].income).not.toBe(5_200_000)
    expect(weekly.projection[0].netIncome, 'no expenses, so net === gross').toBe(5_199_996)
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
    // ⚠️ It also does NOT cover `years: 0`, where `totalGrowth / years` really is
    // NaN and reaches the UI. That is pre-existing, out of scope by this spec, and
    // recorded in `deferred-work.md`.
  })

  it('annualizes the BASELINE loop too, not only the projection', () => {
    const r = calculateFinancialForecast(CURRENT_DATA, FLAT, YEARS)

    // BY HAND: the baseline sees no growth rates, so its flow is the same 1200000
    // and its closing balances match the projection's exactly (investments are 0,
    // so the projection's 7% compounding has nothing to act on).
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
  /** One weekly expense, nothing else. round(100000 × 52/12) = 433333, × 12 = 5199996. */
  const WEEKLY_EXPENSE = {
    income: [],
    expenses: [{ amount: 100000, frequency: 'weekly' as const }],
    savings: 0,
    investments: 0,
  }

  it('normalizes a weekly EXPENSE on the projection row, not just income', () => {
    const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

    // BY HAND: round(100000 × 52/12) = round(433333.33…) = 433333; × 12 = 5199996.
    // A raw sum would report 100000 × 12 = 1200000 — the mutation this closes.
    expect(r.projection[0].expenses, 'round(100000 × 52/12) × 12').toBe(5_199_996)
    expect(r.projection[0].netIncome, 'no income, so net === −expenses').toBe(-5_199_996)
  })

  it('normalizes a weekly expense on the BASELINE row too', () => {
    const r = calculateFinancialForecast(WEEKLY_EXPENSE, FLAT, 1)

    // The baseline builds its fields from a separate set of hoisted constants
    // (`baselineAnnualIncome`/`baselineAnnualExpenses`), so it needs its own
    // assertion — the projection passing proves nothing about it.
    expect(r.baseline[0].expenses, 'same figure via the baseline path').toBe(5_199_996)
    expect(r.baseline[0].netIncome).toBe(-5_199_996)
    expect(r.baseline[0].savings, '0 opening − 5199996').toBe(-5_199_996)
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

    expect(r.baseline[0].income, 'round(100000 × 52/12) × 12').toBe(5_199_996)
    expect(r.baseline[0].netIncome).toBe(5_199_996)
  })

  /**
   * ⚠️ A KNOWN, ACCEPTED PRECISION LOSS — pinned so it cannot drift unnoticed.
   *
   * `annually` is the one frequency whose round trip used to be EXACT: the deleted
   * raw-sum helper reported the entered amount verbatim. Going through monthly
   * space costs up to 11 cents per item per year, because the monthly figure is
   * rounded before being lifted back. This is deliberate — it makes forecasting
   * agree with the app-wide monthly-canonical convention rather than be exact on
   * its own — and it is the trade named in the `MONTHS_PER_YEAR` docblock.
   */
  it('loses up to 11 cents on an annually row, the accepted monthly-canonical cost', () => {
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

    // BY HAND: 1200013 / 12 = 100001.083… ⇒ round = 100001; × 12 = 1200012.
    // One cent under the entered 1200013. NOT a bug; a pinned convention.
    expect(r.projection[0].income, 'round(1200013 / 12) × 12 = 1200012').toBe(1_200_012)
    expect(r.projection[0].income).toBeLessThan(1_200_013)
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
