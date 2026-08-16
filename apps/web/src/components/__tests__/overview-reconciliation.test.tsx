/**
 * Overview reconciliation against a hand-computed example (story 32.3, FR58).
 *
 * ⚠️ WHY THIS FILE EXISTS. Stories 32.1 and 32.2 corrected the page totals and
 * unified net worth, but neither was ever reconciled end to end against a number
 * computed by hand — and `expenseStore.ts` claims its total equals the
 * Overview's "by construction" in a COMMENT, not a test. That is the same shape
 * as the parity claim 32.2 disproved. Narrated reconciliation ("I checked, it
 * adds up") is worth nothing next week; this is the executable form.
 *
 * ⚠️ EVERY EXPECTATION BELOW IS HAND-COMPUTED, in the comments, from the
 * multipliers — never re-derived by calling the same helper the implementation
 * calls. `build-financial-summary.test.ts` states the rule: a test that builds
 * its expectation with `calculateTotalMonthlyNormalized` passes with a wrong
 * operator. The arithmetic is written out so a reader can check it without
 * running anything.
 *
 * ⚠️ Unit tests run CURRENCY-LESS (`vitest.setup.ts` pins `{ mode: 'none',
 * currency: 'NONE' }`), so figures assert as locale-grouped decimals with no
 * symbol — "5,033.33", not "$5,033.33".
 *
 * Harness note: `HomePage.test.tsx` uses a bare `render` PLUS a `vi.mock` of
 * `usePremiumAccess` (without it the Overview's premium section reaches the
 * network); `ExpensesPage.test.tsx` uses `renderWithProviders` and mocks
 * nothing. Both conditions are reproduced here rather than unified — the pages
 * genuinely differ, and unifying them is not this story's job.
 */

import { renderWithProviders, screen } from '@/test/utils'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { buildFinancialSummary } from '../../lib/report/build-financial-summary'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { type OverviewDuration, useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'

const TS = '2026-08-15T00:00:00.000Z'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURE, AND THE ARITHMETIC, DONE BY HAND
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Each entry is converted to a MONTHLY figure and rounded to the nearest cent
 * AS IT IS CONVERTED (core rounds per row), then the monthly figures are summed.
 *
 * INCOME
 *   Salary     200,000c  biweekly   round(200,000 × 26/12) = round(433,333.33…) = 433,333
 *   Freelance   60,000c  monthly    × 1                                         =  60,000
 *   Dividend   120,000c  annually   round(120,000 × 1/12)                       =  10,000
 *                                              monthly total                    = 503,333
 *   raw sum = 380,000c — MATERIALLY different from 503,333c, so a regression
 *   back to raw-summing mixed frequencies cannot hide behind a near-miss.
 *
 * EXPENSES
 *   Rent       150,000c  monthly    × 1                                         = 150,000
 *   Groceries   20,000c  weekly     round(20,000 × 52/12) = round(86,666.66…)   =  86,667
 *   Insurance   90,000c  annually   round(90,000 × 1/12)                        =   7,500
 *                                              monthly total                    = 244,167
 *   raw sum = 260,000c — again materially different.
 *
 * BALANCES (32.2's fixture, so a sign slip lands on a DISTINCT wrong value:
 *   − savings → −13,300,000; + debts → +17,300,000; pre-32.2 → −13,000,000)
 *   investments 800,000 + 1,200,000 = 2,000,000
 *   savings       250,000 +  50,000 =   300,000
 *   debts                           = 15,000,000
 *   net worth = 2,000,000 + 300,000 − 15,000,000 = −12,700,000
 *
 * DISPLAY AT EACH DURATION — the monthly figure divided by the multiplier:
 *   weekly    ÷ (52/12) i.e. × 12/52
 *     income   round(503,333 × 12/52) = round(6,039,996 / 52) = round(116,153.76…) = 116,154
 *     expenses round(244,167 × 12/52) = round(2,930,004 / 52) = round( 56,346.23…) =  56,346
 *   biweekly  × 12/26
 *     income   round(6,039,996 / 26) = round(232,307.53…) = 232,308
 *     expenses round(2,930,004 / 26) = round(112,692.46…) = 112,692
 *   monthly   × 1        income 503,333          expenses 244,167
 *   annually  × 12       income 6,039,996        expenses 2,930,004
 *
 * Net worth is POINT-IN-TIME and carries no period: −12,700,000 at all four.
 */

const INCOME_FIXTURE = [
  { id: 'inc-salary', name: 'Salary', amount: 200_000, frequency: 'biweekly' as const },
  { id: 'inc-freelance', name: 'Freelance', amount: 60_000, frequency: 'monthly' as const },
  { id: 'inc-dividend', name: 'Dividend', amount: 120_000, frequency: 'annually' as const },
]

const EXPENSE_FIXTURE = [
  { id: 'exp-rent', name: 'Rent', amount: 150_000, frequency: 'monthly' as const },
  { id: 'exp-groceries', name: 'Groceries', amount: 20_000, frequency: 'weekly' as const },
  { id: 'exp-insurance', name: 'Insurance', amount: 90_000, frequency: 'annually' as const },
]

/** Hand-computed display strings, currency-less. See the block comment above. */
const EXPECTED: Record<OverviewDuration, { income: string; expenses: string }> = {
  weekly: { income: '1,161.54', expenses: '563.46' }, // 116,154c / 56,346c
  biweekly: { income: '2,323.08', expenses: '1,126.92' }, // 232,308c / 112,692c
  monthly: { income: '5,033.33', expenses: '2,441.67' }, // 503,333c / 244,167c
  annually: { income: '60,399.96', expenses: '29,300.04' }, // 6,039,996c / 2,930,004c
}

/** Net worth is point-in-time — the same at every duration. −12,700,000c. */
const EXPECTED_NET_WORTH = '-127,000.00'

const DURATIONS: readonly OverviewDuration[] = ['weekly', 'biweekly', 'monthly', 'annually']

/**
 * The exact trimmed text of a money element.
 *
 * Used with `toBe`, so an assertion cannot be satisfied by a SUPERSET rendering
 * ("15,033.33" contains "5,033.33"). Unit tests run currency-less, so the text
 * is the bare grouped decimal with no symbol to strip.
 */
function exactMoney(testId: string): string {
  return (screen.getByTestId(testId).textContent ?? '').trim()
}

/** Cents → the grouped decimal string the app renders currency-less. */
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function mockFreeTier(): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: false,
  }
  usePremiumAccess.mockReturnValue({ status })
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useOverviewDurationStore.setState({ duration: 'annually' })
}

/** ONE seed, read by every surface under test. */
function seedFixture(): void {
  useIncomeStore.setState({
    incomeSources: INCOME_FIXTURE.map((row) => ({
      ...row,
      userId: 0,
      createdAt: TS,
      updatedAt: TS,
    })),
  })
  useExpenseStore.setState({
    expenses: EXPENSE_FIXTURE.map((row) => ({
      ...row,
      userId: 0,
      createdAt: TS,
      updatedAt: TS,
    })),
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'inv-1',
        type: 'investment',
        name: 'ISA',
        currentBalance: 800_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'inv-2',
        type: 'investment',
        name: 'Pension',
        currentBalance: 1_200_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'debt-1',
        type: 'debt',
        name: 'Mortgage',
        currentBalance: 15_000_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-1',
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 250_000,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: 'sav-2',
        name: 'Rainy day',
        targetAmount: null,
        currentBalance: 50_000,
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFreeTier()
  clearStores()
})

afterEach(() => {
  cleanup()
  clearStores()
})

describe('AC-11: the Overview reconciles against a hand-computed example', () => {
  for (const duration of DURATIONS) {
    it(`shows the hand-computed income, expenses and net worth at ${duration}`, () => {
      seedFixture()
      useOverviewDurationStore.setState({ duration })
      render(<HomePage />)

      // ⚠️ ANCHORED (`^…$` on the trimmed text), not a substring. A bare
      // `toContain('5,033.33')` is satisfied by "15,033.33" — so a bug that
      // double-counts an entry into a value whose string merely ENDS with the
      // expected digits would pass. Code review 32.3.
      expect(exactMoney('overview-total-income')).toBe(EXPECTED[duration].income)
      expect(exactMoney('overview-total-expenses')).toBe(EXPECTED[duration].expenses)
      // Point-in-time: unaffected by the period control.
      expect(exactMoney('overview-net-worth')).toBe(EXPECTED_NET_WORTH)
    })
  }

  it('does NOT show the raw entered sums — the FR58 defect detector', () => {
    seedFixture()
    useOverviewDurationStore.setState({ duration: 'monthly' })
    render(<HomePage />)

    // ⚠️ POSITIVE ASSERTIONS FIRST, so this test is self-sufficient. As
    // negatives alone it passed on a blank, crashed or NaN element — a test
    // titled "the FR58 defect detector" that detected nothing. Code review 32.3.
    expect(exactMoney('overview-total-income')).toBe('5,033.33')
    expect(exactMoney('overview-total-expenses')).toBe('2,441.67')
    // raw income 380,000c and raw expenses 260,000c. A regression to raw-summing
    // mixed frequencies would render these instead.
    expect(exactMoney('overview-total-income')).not.toBe('3,800.00')
    expect(exactMoney('overview-total-expenses')).not.toBe('2,600.00')
  })

  /**
   * Spreadsheet parity, BOTH DIRECTIONS — the cross-check §1 calls for.
   *
   * income   2,000×26 + 600×12 + 1,200 = $60,400.00 vs the app's $60,399.96 → 4¢ DOWN
   * expenses 1,500×12 +   200×52 + 900 = $29,300.00 vs the app's $29,300.04 → 4¢ UP
   *
   * A one-sided rounding bug cannot satisfy both. The residual is a property of
   * per-entry rounding, NOT a defect — story 32.3 §7 and deferred-work.md:525
   * both fence "fixing" it as an app-wide product decision with its own story.
   */
  it('lands 4c below the spreadsheet on income and 4c above it on expenses', () => {
    seedFixture()
    useOverviewDurationStore.setState({ duration: 'annually' })
    render(<HomePage />)

    expect(screen.getByTestId('overview-total-income')).toHaveTextContent('60,399.96')
    expect(screen.getByTestId('overview-total-income')).not.toHaveTextContent('60,400.00')
    expect(screen.getByTestId('overview-total-expenses')).toHaveTextContent('29,300.04')
    expect(screen.getByTestId('overview-total-expenses')).not.toHaveTextContent('29,300.00')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * AC-12 — CROSS-SURFACE AGREEMENT, BY IMPORTING BOTH SIDES
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ THE WHOLE POINT IS THAT BOTH SIDES ARE IMPORTED AND COMPARED. Two tests
 * each asserting their own constant do NOT pin agreement — they both stay green
 * while the two surfaces drift apart, which is precisely what happened before
 * 32.2 (a parity test that re-implemented the selector inside the test file, and
 * therefore could not fail) and what `expenseStore.ts`'s "equal by construction"
 * comment still asserts with no test behind it.
 *
 * So each case below seeds ONCE, reads the figure off each surface, and compares
 * the surfaces to EACH OTHER — the hand-computed constant is an additional pin,
 * not the mechanism.
 */
describe('AC-12: every surface showing this money agrees, for one seed', () => {
  /** Render one surface in isolation and return the text of one element. */
  function textFrom(surface: 'overview' | 'income' | 'expenses', testId: string): string {
    if (surface === 'overview') {
      render(<HomePage />)
    } else if (surface === 'income') {
      renderWithProviders(<IncomePage />)
    } else {
      renderWithProviders(<ExpensesPage />)
    }
    const text = screen.getByTestId(testId).textContent ?? ''
    // Properly UNMOUNT between surfaces (code review 32.2): wiping innerHTML
    // leaves the React root mounted and still subscribed to the shared stores.
    cleanup()
    return text.trim()
  }

  for (const duration of DURATIONS) {
    it(`the Overview and the Income page show the same total at ${duration}`, () => {
      seedFixture()
      useOverviewDurationStore.setState({ duration })

      const overview = textFrom('overview', 'overview-total-income')
      const page = textFrom('income', 'period-total-amount')

      expect(overview).toBe(page)
      expect(overview).toContain(EXPECTED[duration].income)
    })

    it(`the Overview and the Expenses page show the same total at ${duration}`, () => {
      seedFixture()
      useOverviewDurationStore.setState({ duration })

      const overview = textFrom('overview', 'overview-total-expenses')
      const page = textFrom('expenses', 'period-total-amount')

      expect(overview).toBe(page)
      expect(overview).toContain(EXPECTED[duration].expenses)
    })
  }

  /**
   * The printed report is a fourth surface showing the same money. It is built
   * from the same store rows, so its monthly figures must equal the Overview's
   * monthly figures — compared here by importing `buildFinancialSummary` itself
   * rather than by restating its expected output.
   */
  it('the printed report agrees with the Overview at the monthly basis', () => {
    seedFixture()
    useOverviewDurationStore.setState({ duration: 'monthly' })

    const report = buildFinancialSummary({
      income: INCOME_FIXTURE,
      expenses: EXPENSE_FIXTURE,
      balances: [],
      savings: [],
      generatedAt: new Date(TS),
    })

    const overviewIncome = textFrom('overview', 'overview-total-income')
    const overviewExpenses = textFrom('overview', 'overview-total-expenses')

    // ⚠️ THE COMPARISON IS SURFACE-TO-SURFACE, via the report's OWN output.
    // This first read `toBe(503_333)` and, separately, `toContain('5,033.33')` —
    // two hand-pinned constants with agreement only transitive through them,
    // while the comment above claimed the import WAS the mechanism. Code review
    // 32.3 called that out as the same "parity claimed in a comment" shape this
    // file's preamble exists to kill. Now the report's number formats the string
    // the Overview must contain, so the two cannot drift apart silently.
    expect(overviewIncome).toContain(formatCents(report.budget.monthlyIncomeCents))
    expect(overviewExpenses).toContain(formatCents(report.budget.monthlyExpensesCents))
    // Pinned to the hand-computed values as well, so agreement on a WRONG shared
    // number (both reverting together) still fails.
    expect(report.budget.monthlyIncomeCents).toBe(503_333)
    expect(report.budget.monthlyExpensesCents).toBe(244_167)
  })

  /**
   * Net period income, from §1's cross-checks:
   *   monthly  503,333 − 244,167 =   259,166c
   *   annually 6,039,996 − 2,930,004 = 3,109,992c
   * Computed here from the report's own two fields, so it cannot drift from the
   * figures the other assertions pin.
   */
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE PIES AT THE TWO NON-INTEGRAL PERIODS — the regime 32.3 CREATED
   * ══════════════════════════════════════════════════════════════════════════
   *
   * ⚠️ ADDED IN CODE REVIEW, AND IT WAS THE REVIEW'S HEADLINE FINDING. Every
   * other test in this story pins the CARDS. Nothing pinned a pie FIGURE at
   * weekly or biweekly — the two periods this story newly made reachable — so a
   * bug confined to that regime rendered every weekly slice wrong while the whole
   * suite stayed green. Verified by mutation before these tests were written:
   * making `periodScaledData` denormalize to 'monthly' at both non-integral
   * periods left 1463/1463 passing.
   *
   * The pies scale EACH ENTRY then sum; the cards sum monthly then scale ONCE.
   * Hand-computed for the §1 EXPENSES fixture at biweekly (× 12/26):
   *
   *   Rent      monthly 150,000c → round(150,000 × 12/26) = round(69,230.77) = 69,231
   *   Groceries monthly  86,667c → round( 86,667 × 12/26) = round(40,000.15) = 40,000
   *   Insurance monthly   7,500c → round(  7,500 × 12/26) = round( 3,461.54) =  3,462
   *                                            per-entry sum = 112,693c
   *   card: round(244,167 × 12/26) = round(112,692.46)     = 112,692c
   *
   * A ONE-CENT divergence between two figures on the same screen — the exact
   * divergence AC-9's disclosure exists for, which until now no test proved was
   * real. `112,693c` → "1,126.93"; the card reads "1,126.92".
   */
  const PIE_TOTAL_TESTID = 'breakdown-pie-total-expense'

  it('AC-9: the expenses pie sums per entry and lands 1c ABOVE the card at biweekly', () => {
    seedFixture()
    useOverviewDurationStore.setState({ duration: 'biweekly' })
    render(<HomePage />)

    expect(screen.getByTestId(PIE_TOTAL_TESTID)).toHaveTextContent('1,126.93')
    // ...while the card, scaling the whole set once, reads one cent LESS.
    expect(screen.getByTestId('overview-total-expenses')).toHaveTextContent('1,126.92')
    // And the disclosure that exists for precisely this is on screen.
    expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()
  })

  it('AC-8: the pies carry correct per-entry figures at weekly', () => {
    seedFixture()
    useOverviewDurationStore.setState({ duration: 'weekly' })
    render(<HomePage />)

    // Hand-computed, weekly = × 12/52:
    //   Rent      round(150,000 × 12/52) = round(34,615.38) = 34,615
    //   Groceries round( 86,667 × 12/52) = round(20,000.08) = 20,000
    //   Insurance round(  7,500 × 12/52) = round( 1,730.77) =  1,731
    //                              per-entry sum = 56,346c → "563.46"
    // (Coincidentally equal to the card here; the biweekly case above is the one
    // that proves the two routes are genuinely computed differently.)
    expect(screen.getByTestId(PIE_TOTAL_TESTID)).toHaveTextContent('563.46')
    // The individual slices, so a wrong per-entry factor cannot hide inside a
    // total that happens to come out right.
    const section = screen.getByTestId('breakdown-pie-expense')
    expect(within(section).getByText('346.15')).toBeInTheDocument() // Rent
    expect(within(section).getByText('200.00')).toBeInTheDocument() // Groceries
    expect(within(section).getByText('17.31')).toBeInTheDocument() // Insurance
  })

  it('net period income follows from the two totals', () => {
    const report = buildFinancialSummary({
      income: INCOME_FIXTURE,
      expenses: EXPENSE_FIXTURE,
      balances: [],
      savings: [],
      generatedAt: new Date(TS),
    })

    expect(report.budget.monthlyIncomeCents - report.budget.monthlyExpensesCents).toBe(259_166)
    expect((report.budget.monthlyIncomeCents - report.budget.monthlyExpensesCents) * 12).toBe(
      3_109_992
    )
  })
})
