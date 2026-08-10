/**
 * Unit tests for the financial summary report model (Story 30.3, FR53).
 *
 * Every monetary expectation below is a HAND-COMPUTED literal, never re-derived
 * with the same helper the implementation calls — a test that recomputes with
 * `normalizeToMonthly` would pass even if the multiplier were wrong, which is
 * exactly the true-by-construction failure this suite exists to avoid.
 *
 * ⚠️ The weekly multiplier is `52 / 12` evaluated EXACTLY (4.33333…), not the
 * rounded `×4.333` that `_bmad-output/project-context.md` documents, and core
 * rounds PER ROW (`calculateTotalMonthlyNormalized` → `normalizeToMonthly`).
 * So 10000c weekly is `Math.round(10000 × 52/12)` = `Math.round(43333.33…)` =
 * **43333**, not 43330. Using the documented factor would be wrong by 3 cents on
 * this row alone, and the error compounds across a report.
 */

import { describe, expect, it } from 'vitest'
import { type BuildFinancialSummaryInput, buildFinancialSummary } from '../build-financial-summary'

/** Fixed date so `generatedAtISO` is deterministic. */
const GENERATED_AT = new Date('2026-08-08T12:34:56.000Z')

function buildInput(overrides: Partial<BuildFinancialSummaryInput> = {}) {
  return buildFinancialSummary({
    income: [],
    expenses: [],
    balances: [],
    savings: [],
    generatedAt: GENERATED_AT,
    ...overrides,
  })
}

describe('buildFinancialSummary — budget section', () => {
  it('normalizes each frequency to a monthly basis with core, rounding PER ROW', () => {
    const model = buildInput({
      income: [
        { id: 'i1', name: 'Salary', amount: 500_000, frequency: 'monthly' },
        { id: 'i2', name: 'Freelance', amount: 10_000, frequency: 'weekly' },
      ],
      expenses: [
        { id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' },
        { id: 'e2', name: 'Groceries', amount: 20_000, frequency: 'weekly' },
        { id: 'e3', name: 'Insurance', amount: 120_000, frequency: 'annually' },
      ],
    })

    // 500000×1 = 500000; round(10000 × 52/12) = round(43333.33…) = 43333
    expect(model.budget.monthlyIncomeCents).toBe(543_333)
    // 150000×1 = 150000; round(20000 × 52/12) = round(86666.66…) = 86667;
    // round(120000 × 1/12) = 10000
    expect(model.budget.monthlyExpensesCents).toBe(246_667)
    expect(model.budget.monthlyNetCents).toBe(296_666)
    expect(model.budget.status).toBe('surplus')

    // The per-row monthly figure is carried on the row itself, same rounding.
    expect(model.budget.income[1].monthlyCents).toBe(43_333)
    expect(model.budget.expenses[2].monthlyCents).toBe(10_000)
  })

  it('normalizes a biweekly row at 26/12, rounding the half-cent up', () => {
    const model = buildInput({
      income: [{ id: 'i1', name: 'Stipend', amount: 10_000, frequency: 'biweekly' }],
    })
    // round(10000 × 26/12) = round(21666.66…) = 21667
    expect(model.budget.monthlyIncomeCents).toBe(21_667)
  })

  it('preserves the row as entered alongside its normalized figure', () => {
    const model = buildInput({
      income: [{ id: 'i1', name: 'Freelance', amount: 10_000, frequency: 'weekly' }],
    })
    expect(model.budget.income[0]).toEqual({
      id: 'i1',
      name: 'Freelance',
      amountCents: 10_000,
      frequency: 'weekly',
      monthlyCents: 43_333,
    })
  })

  it('reports a deficit when expenses exceed income', () => {
    const model = buildInput({
      income: [{ id: 'i1', name: 'Salary', amount: 100_000, frequency: 'monthly' }],
      expenses: [{ id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' }],
    })
    expect(model.budget.monthlyNetCents).toBe(-50_000)
    expect(model.budget.status).toBe('deficit')
  })

  it('reports EXACT break-even as break-even, not as a deficit', () => {
    // Core's own `isSurplus` flag is `netIncome > 0` while its JSDoc claims
    // ">= 0", so a break-even budget reads as a deficit through that flag. This
    // section derives the three cases explicitly instead; the boundary is
    // asserted here so a future refactor cannot quietly adopt the flag.
    const model = buildInput({
      income: [{ id: 'i1', name: 'Salary', amount: 200_000, frequency: 'monthly' }],
      expenses: [{ id: 'e1', name: 'Rent', amount: 200_000, frequency: 'monthly' }],
    })
    expect(model.budget.monthlyNetCents).toBe(0)
    expect(model.budget.status).toBe('break-even')
  })
})

describe('buildFinancialSummary — net worth section', () => {
  it('totals investments and debts separately and nets them', () => {
    const model = buildInput({
      balances: [
        { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 },
        { id: 'b2', name: 'Pension', type: 'investment', currentBalance: 1_200_000 },
        { id: 'b3', name: 'Mortgage', type: 'debt', currentBalance: 15_000_000 },
      ],
    })
    expect(model.netWorth.totalInvestmentsCents).toBe(2_000_000)
    expect(model.netWorth.totalDebtsCents).toBe(15_000_000)
    // Debts SUBTRACT — mirrors the `useNetBalance` selector.
    expect(model.netWorth.netCents).toBe(-13_000_000)
    expect(model.netWorth.investments).toHaveLength(2)
    expect(model.netWorth.debts).toHaveLength(1)
  })

  it('nets to zero when investments exactly offset debts', () => {
    const model = buildInput({
      balances: [
        { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 500_000 },
        { id: 'b2', name: 'Loan', type: 'debt', currentBalance: 500_000 },
      ],
    })
    expect(model.netWorth.netCents).toBe(0)
  })
})

describe('buildFinancialSummary — savings section', () => {
  it('measures overall progress across TARGETED GOALS ONLY, matching the app', () => {
    const model = buildInput({
      savings: [
        { id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
        { id: 's2', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 },
      ],
    })
    expect(model.savings.goals[0].progressPercent).toBe(25)
    // Every readable balance counts toward "how much you have saved"...
    expect(model.savings.totalCurrentCents).toBe(300_000)
    expect(model.savings.totalTargetCents).toBe(1_000_000)
    // ...but the untargeted ACCOUNT is excluded from BOTH sides of progress:
    // 250000/1000000 = 25%, NOT 300000/1000000 = 30%. This is the exact figure
    // `getOverallProgress` (savingsStore.ts:140-146) reports for the same data —
    // see the parity block below. A review caught the report printing 30% where
    // the app showed 25%.
    expect(model.savings.overallProgressPercent).toBe(25)
  })

  it('returns null progress for an account with no target, never NaN', () => {
    const model = buildInput({
      savings: [{ id: 's1', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 }],
    })
    expect(model.savings.goals[0].progressPercent).toBeNull()
    expect(model.savings.overallProgressPercent).toBeNull()
  })

  it('treats a missing targetAmount key exactly like an explicit null', () => {
    // The store uses loose `== null` for this state (savingsStore.ts:132,141), so
    // a legacy row without the key is a savings ACCOUNT, not a corrupt row.
    // Strict equality used to classify it unreadable and drop its balance.
    const model = buildInput({
      savings: [{ id: 's1', name: 'Legacy account', currentBalance: 50_000 } as never],
    })
    expect(model.savings.unreadableCount).toBe(0)
    expect(model.savings.totalCurrentCents).toBe(50_000)
    expect(model.savings.goals[0].targetCents).toBeNull()
    expect(model.savings.goals[0].progressPercent).toBeNull()
  })

  it('caps an overfunded goal at 100%, as every other surface does', () => {
    // `getSavingsProgress` and core's `calculateProgress` both cap and round.
    // The report printed 150% where the app showed 100% for the same goal.
    const model = buildInput({
      savings: [{ id: 's1', name: 'Holiday', targetAmount: 100_000, currentBalance: 150_000 }],
    })
    expect(model.savings.goals[0].progressPercent).toBe(100)
  })

  it('rounds progress to a whole percent, as every other surface does', () => {
    // 1/3 → 33.33…% must print as 33%, not 33.33333333333333%.
    const model = buildInput({
      savings: [{ id: 's1', name: 'Thirds', targetAmount: 300_000, currentBalance: 100_000 }],
    })
    expect(model.savings.goals[0].progressPercent).toBe(33)
  })

  it('excludes a non-positive target as corrupt WITHOUT poisoning the aggregate', () => {
    // One negative target used to cancel a healthy goal's target to zero, blanking
    // the whole section's total and progress while reporting 0 unreadable rows —
    // one bad row silently corrupting every other valid goal's figures.
    const model = buildInput({
      savings: [
        { id: 's1', name: 'Emergency fund', targetAmount: 100_000, currentBalance: 50_000 },
        { id: 's2', name: 'Corrupt', targetAmount: -100_000, currentBalance: 0 },
      ],
    })
    expect(model.savings.unreadableCount).toBe(1)
    expect(model.savings.goals).toHaveLength(1)
    expect(model.savings.totalTargetCents).toBe(100_000)
    expect(model.savings.overallProgressPercent).toBe(50)
  })

  it('excludes a zero target as corrupt rather than dividing by it', () => {
    const model = buildInput({
      savings: [{ id: 's1', name: 'Zeroed goal', targetAmount: 0, currentBalance: 50_000 }],
    })
    expect(model.savings.unreadableCount).toBe(1)
    expect(model.savings.isEmpty).toBe(true)
    expect(model.savings.overallProgressPercent).toBeNull()
  })
})

describe('buildFinancialSummary — corrupt rows are partitioned, never thrown on', () => {
  // The sync applier writes rows without validation, and core's
  // `validateFrequency`/`validateAmount` THROW. An unguarded call would
  // white-screen the report, so unreadable rows are excluded and counted.

  it('excludes a row with an unrecognised frequency and counts it', () => {
    const model = buildInput({
      income: [
        { id: 'i1', name: 'Salary', amount: 500_000, frequency: 'monthly' },
        { id: 'i2', name: 'Corrupt', amount: 100_000, frequency: 'fortnightly' },
      ],
    })
    expect(model.budget.monthlyIncomeCents).toBe(500_000)
    expect(model.budget.income).toHaveLength(1)
    expect(model.budget.unreadableCount).toBe(1)
    expect(model.totalUnreadableCount).toBe(1)
  })

  it('excludes a NaN amount rather than rendering NaN', () => {
    const model = buildInput({
      expenses: [
        { id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' },
        { id: 'e2', name: 'Corrupt', amount: Number.NaN, frequency: 'monthly' },
      ],
    })
    expect(model.budget.monthlyExpensesCents).toBe(150_000)
    expect(model.budget.unreadableCount).toBe(1)
  })

  it('excludes a non-finite balance and a non-finite savings figure', () => {
    const model = buildInput({
      balances: [
        { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
        { id: 'b2', name: 'Corrupt', type: 'investment', currentBalance: Number.POSITIVE_INFINITY },
      ],
      savings: [{ id: 's1', name: 'Corrupt', targetAmount: 100_000, currentBalance: Number.NaN }],
    })
    expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
    expect(model.netWorth.unreadableCount).toBe(1)
    expect(model.savings.unreadableCount).toBe(1)
    expect(model.savings.isEmpty).toBe(true)
    expect(model.totalUnreadableCount).toBe(2)
  })

  it('does not throw when EVERY row is corrupt', () => {
    expect(() =>
      buildInput({
        income: [{ id: 'i1', name: 'Bad', amount: Number.NaN, frequency: 'weekly' }],
        balances: [{ id: 'b1', name: 'Bad', type: 'investment', currentBalance: Number.NaN }],
        savings: [{ id: 's1', name: 'Bad', targetAmount: null, currentBalance: Number.NaN }],
      })
    ).not.toThrow()
  })
})

describe('buildFinancialSummary — empty and large states', () => {
  it('marks every section empty and the whole report empty with no data', () => {
    const model = buildInput()
    expect(model.budget.isEmpty).toBe(true)
    expect(model.netWorth.isEmpty).toBe(true)
    expect(model.savings.isEmpty).toBe(true)
    expect(model.isEmpty).toBe(true)
    expect(model.budget.monthlyNetCents).toBe(0)
    expect(model.netWorth.netCents).toBe(0)
    expect(model.savings.overallProgressPercent).toBeNull()
  })

  it('is NOT empty when only one section has data', () => {
    const model = buildInput({
      balances: [{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 1 }],
    })
    expect(model.isEmpty).toBe(false)
    expect(model.budget.isEmpty).toBe(true)
    expect(model.netWorth.isEmpty).toBe(false)
  })

  it('handles a large multi-page data set without loss of precision', () => {
    // 120 monthly rows of 1000c each — a report spanning several printed pages.
    const income = Array.from({ length: 120 }, (_, index) => ({
      id: `i${index}`,
      name: `Source ${index}`,
      amount: 1_000,
      frequency: 'monthly',
    }))
    const model = buildInput({ income })
    expect(model.budget.income).toHaveLength(120)
    expect(model.budget.monthlyIncomeCents).toBe(120_000)
    expect(model.budget.unreadableCount).toBe(0)
  })
})

describe('buildFinancialSummary — header', () => {
  it('renders the generated-at date as a locale-neutral ISO day', () => {
    expect(buildInput().generatedAtISO).toBe('2026-08-08')
  })
})

describe('buildFinancialSummary — corrupt balance CATEGORY', () => {
  it('excludes a row whose type is neither investment nor debt, AND counts it', () => {
    // Such a row belongs in no column, so without a category check it was filtered
    // out of both totals while still counting as "readable" — it vanished from the
    // document with no disclosure at all. `frequency` was guarded this way from the
    // start; `type` was not. (Code review 2026-08-09.)
    const model = buildInput({
      balances: [
        { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
        { id: 'b2', name: 'Mystery', type: 'crypto', currentBalance: 999_999 },
      ],
    })
    expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
    expect(model.netWorth.netCents).toBe(100_000)
    expect(model.netWorth.investments).toHaveLength(1)
    expect(model.netWorth.unreadableCount).toBe(1)
    expect(model.totalUnreadableCount).toBe(1)
  })
})

describe('buildFinancialSummary — a fully unreadable section is not "empty"', () => {
  it('reports unreadable rows even when NOTHING readable survives', () => {
    // `isEmpty` counts readable rows only, so an all-corrupt store looked identical
    // to a brand-new one. The view keys its "add your data" copy off this, and its
    // disclosure lived in the other branch — so the user with the most to lose was
    // told they had nothing and should add some.
    const model = buildInput({
      income: [{ id: 'i1', name: 'Salary', amount: 500_000, frequency: 'fortnightly' }],
    })
    expect(model.isEmpty).toBe(true)
    expect(model.totalUnreadableCount).toBe(1)
  })
})

describe('buildFinancialSummary — PARITY with the app’s own selectors', () => {
  // ⚠️ These are the real guarantee that the printed report and the live pages can
  // never disagree about a number. The formulas are replicated in the builder
  // rather than imported, because the store selectors sum RAW rows and return NaN
  // on a single corrupt value, which this report must survive. Replication without
  // these tests is exactly how the 30%-vs-25% divergence shipped.

  /** `getOverallProgress` — savingsStore.ts:140-146, verbatim. */
  const canonicalOverallProgress = (
    goals: { targetAmount: number | null; currentBalance: number }[]
  ): number => {
    const targeted = goals.filter((g) => g.targetAmount != null)
    const totalBalance = targeted.reduce((sum, g) => sum + g.currentBalance, 0)
    const totalTarget = targeted.reduce((sum, g) => sum + (g.targetAmount ?? 0), 0)
    if (totalTarget <= 0) return 0
    return Math.min(100, Math.round((totalBalance / totalTarget) * 100))
  }

  /** `getSavingsProgress` — savingsStore.ts:128-136, verbatim. */
  const canonicalGoalProgress = (target: number | null, balance: number): number | null => {
    if (target == null) return null
    if (target === 0) return 0
    return Math.min(100, Math.round((balance / target) * 100))
  }

  /** `useTotalInvestmentBalance` / `useTotalDebtBalance` / `useNetBalance`. */
  const canonicalNetWorth = (rows: { type: string; currentBalance: number }[]) => ({
    investments: rows
      .filter((r) => r.type === 'investment')
      .reduce((s, r) => s + r.currentBalance, 0),
    debts: rows.filter((r) => r.type === 'debt').reduce((s, r) => s + r.currentBalance, 0),
    net: rows.reduce(
      (s, r) => s + (r.type === 'investment' ? r.currentBalance : -r.currentBalance),
      0
    ),
  })

  const cleanSavings = [
    { id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
    { id: 's2', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 },
    { id: 's3', name: 'Holiday', targetAmount: 100_000, currentBalance: 150_000 },
    { id: 's4', name: 'Thirds', targetAmount: 300_000, currentBalance: 100_000 },
  ]
  const cleanBalances = [
    { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 },
    { id: 'b2', name: 'Pension', type: 'investment', currentBalance: 1_200_000 },
    { id: 'b3', name: 'Mortgage', type: 'debt', currentBalance: 15_000_000 },
  ]

  it('overall savings progress equals getOverallProgress for clean data', () => {
    const model = buildInput({ savings: cleanSavings })
    expect(model.savings.overallProgressPercent).toBe(canonicalOverallProgress(cleanSavings))
  })

  it('per-goal savings progress equals getSavingsProgress for every clean row', () => {
    const model = buildInput({ savings: cleanSavings })
    for (const [index, goal] of model.savings.goals.entries()) {
      const source = cleanSavings[index]
      expect(goal.progressPercent).toBe(
        canonicalGoalProgress(source.targetAmount, source.currentBalance)
      )
    }
  })

  it('net worth totals equal the balance-store selectors for clean data', () => {
    const model = buildInput({ balances: cleanBalances })
    const canonical = canonicalNetWorth(cleanBalances)
    expect(model.netWorth.totalInvestmentsCents).toBe(canonical.investments)
    expect(model.netWorth.totalDebtsCents).toBe(canonical.debts)
    expect(model.netWorth.netCents).toBe(canonical.net)
  })

  it('DIVERGES from the selectors only where they are not corruption-safe', () => {
    // The one deliberate difference, pinned so it stays deliberate: the selectors
    // return NaN on a non-finite row; the report drops and discloses it instead.
    const corrupt = [
      { id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
      { id: 'b2', name: 'Bad', type: 'investment', currentBalance: Number.NaN },
    ]
    expect(canonicalNetWorth(corrupt).investments).toBeNaN()
    const model = buildInput({ balances: corrupt })
    expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
    expect(model.netWorth.unreadableCount).toBe(1)
  })
})
