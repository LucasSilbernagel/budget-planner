/**
 * Pure assembly of the Premium financial summary report (Story 30.3, FR53).
 *
 * Takes already-read store rows and returns a plain, serializable model. No
 * React, no store imports, no clock read — the generated-at date arrives as a
 * parameter so the output is fully deterministic and unit-testable.
 *
 * ## Why this lives in `apps/web/src/lib` and not `packages/core`
 *
 * It assembles the *client* row shapes that live in `apps/web/src/stores`; core
 * would have to import upward to know them. Core stays the home for the generic
 * math, which this module calls rather than reimplements
 * (`calculateNetIncomeResult`, `normalizeToMonthly`). Keeping it here also avoids
 * the core `dist` rebuild that web `tsc` otherwise needs.
 *
 * ## Scope: persisted data only (Story 30.3, Decision 1)
 *
 * Budget, CURRENT net worth and savings — the three domains the app actually
 * persists. The retirement outlook and the forward net-worth projection are
 * deliberately ABSENT: every one of their inputs is ephemeral component state
 * (`RetirementAccumulationPlanner` and `NetWorthProjectionPage` hold them in
 * `useState`, with no store and no persistence key), so a report generated from
 * `/settings` has no data to read. This narrows FR53 by design, not by omission.
 *
 * ## Corrupt rows are partitioned, never thrown on
 *
 * `calculateNetIncomeResult` → `normalizeToMonthly` → `validateFrequency` THROWS
 * on a corrupt persisted `frequency`, and the sync applier writes rows without
 * validation. An unguarded call here would white-screen the report the same way
 * it can white-screen the overview. So every row is checked first; unreadable
 * ones are counted and excluded, and the view discloses the count rather than
 * silently under-reporting.
 */

import { calculateNetIncomeResult, normalizeToMonthly } from '@budget-planner/core'
import type { Frequency } from '@budget-planner/core'

// ============================================================================
// Input shapes (structural — deliberately not the store's own types)
// ============================================================================

/**
 * Structural shape of an income/expense row. `frequency` is typed `string`, not
 * `Frequency`, precisely so a corrupt persisted value is representable and can be
 * rejected here instead of throwing inside core. The store's own row types are
 * not exported, and are structurally assignable to this.
 */
export interface ReportCashflowInput {
  id: string
  name: string
  /** In cents, at `frequency` cadence. */
  amount: number
  frequency: string
}

/** Structural shape of a balance-tracking row (investment or debt). */
export interface ReportBalanceInput {
  id: string
  name: string
  type: string
  /** In cents. */
  currentBalance: number
}

/** Structural shape of a savings goal or account. */
export interface ReportSavingsInput {
  id: string
  name: string
  /** In cents; `null` ⇒ a savings account with no target, not a zero target. */
  targetAmount: number | null
  /** In cents. */
  currentBalance: number
}

export interface BuildFinancialSummaryInput {
  income: readonly ReportCashflowInput[]
  expenses: readonly ReportCashflowInput[]
  balances: readonly ReportBalanceInput[]
  savings: readonly ReportSavingsInput[]
  /** Rendered into the report header. Passed in so the model is deterministic. */
  generatedAt: Date
}

// ============================================================================
// Output model
// ============================================================================

export interface ReportCashflowRow {
  id: string
  name: string
  /** In cents, as entered, at `frequency` cadence. */
  amountCents: number
  frequency: string
  /** In cents, normalized to a monthly basis via core. */
  monthlyCents: number
}

export interface ReportBalanceRow {
  id: string
  name: string
  /** In cents. */
  balanceCents: number
}

export interface ReportSavingsRow {
  id: string
  name: string
  /** In cents; `null` for an account with no target. */
  targetCents: number | null
  /** In cents. */
  currentCents: number
  /**
   * 0-100, or `null` when there is no target to measure against. Never `NaN` or
   * `Infinity` — a null/zero/negative target yields `null`, and the view renders
   * a dash.
   */
  progressPercent: number | null
}

/** Whether the monthly budget lands above, below, or exactly at break-even. */
export type BudgetStatus = 'surplus' | 'deficit' | 'break-even'

export interface ReportBudgetSection {
  income: ReportCashflowRow[]
  expenses: ReportCashflowRow[]
  /** Monthly-normalized totals, in cents, from core's `calculateNetIncomeResult`. */
  monthlyIncomeCents: number
  monthlyExpensesCents: number
  monthlyNetCents: number
  status: BudgetStatus
  /** Rows excluded because their persisted amount or frequency was unreadable. */
  unreadableCount: number
  isEmpty: boolean
}

export interface ReportNetWorthSection {
  investments: ReportBalanceRow[]
  debts: ReportBalanceRow[]
  totalInvestmentsCents: number
  totalDebtsCents: number
  /** Investments − debts, in cents. May be negative. */
  netCents: number
  unreadableCount: number
  isEmpty: boolean
}

export interface ReportSavingsSection {
  goals: ReportSavingsRow[]
  totalCurrentCents: number
  totalTargetCents: number
  /** 0-100 across all targeted goals, or `null` when no goal carries a target. */
  overallProgressPercent: number | null
  unreadableCount: number
  isEmpty: boolean
}

export interface FinancialSummaryReportModel {
  /** `YYYY-MM-DD`, UTC. Locale-neutral and unambiguous on a printed page. */
  generatedAtISO: string
  budget: ReportBudgetSection
  netWorth: ReportNetWorthSection
  savings: ReportSavingsSection
  /** True when every section is empty — the report has nothing at all to show. */
  isEmpty: boolean
  /** Total rows excluded across all sections. */
  totalUnreadableCount: number
}

// ============================================================================
// Validation
// ============================================================================

/**
 * The frequencies core can normalize. Checked by membership rather than by
 * calling core's `validateFrequency`, which throws — see the module JSDoc.
 */
const KNOWN_FREQUENCIES: ReadonlySet<string> = new Set<Frequency>([
  'weekly',
  'biweekly',
  'monthly',
  'annually',
])

/**
 * The balance categories this report knows how to place. Validated for the same
 * reason `frequency` is: a row whose `type` is neither of these belongs in no
 * column, so without this check it would be filtered out of both totals while
 * still counting as "readable" — i.e. it would vanish from the document with no
 * disclosure, which is precisely the failure this module claims to prevent.
 * (Code review 2026-08-09: the omission was real and reproducible.)
 */
const KNOWN_FINANCE_TYPES: ReadonlySet<string> = new Set(['investment', 'debt'])

/** A cashflow row whose amount and frequency have both been proven readable. */
type ReadableCashflow = ReportCashflowInput & { frequency: Frequency }

/**
 * A row is readable when core would accept both its amount and its frequency.
 * Written as a type predicate so the checked `frequency` narrows from `string` to
 * `Frequency` — the filtered rows are then structurally valid input to core with
 * no cast, which keeps the validation and the type claim impossible to drift
 * apart.
 */
function isReadableCashflow(row: ReportCashflowInput): row is ReadableCashflow {
  return Number.isFinite(row.amount) && KNOWN_FREQUENCIES.has(row.frequency)
}

/**
 * A balance row is readable when its amount is finite AND its category is one
 * the report can place. Both halves matter — see {@link KNOWN_FINANCE_TYPES}.
 */
function isReadableBalance(row: ReportBalanceInput): boolean {
  return Number.isFinite(row.currentBalance) && KNOWN_FINANCE_TYPES.has(row.type)
}

/**
 * A savings row is readable when its balance is finite and its target is either
 * genuinely absent or a usable positive figure.
 *
 * ⚠️ Two deliberate details:
 *  - **`== null`, not `=== null`.** An absent `targetAmount` key means the same
 *    thing as an explicit `null` — "savings account, no target" — and the store
 *    itself uses loose equality for exactly this (`savingsStore.ts:132,141`).
 *    Strict equality classified a legacy row as corrupt and silently dropped its
 *    balance from the saved total.
 *  - **A non-positive target is corrupt, not "a target of zero".** The domain
 *    validator requires a positive integer whenever a target is supplied, so 0
 *    or a negative value can only arrive from unvalidated/legacy data. Excluding
 *    it here (and counting it) stops one bad row from poisoning the section
 *    aggregate for every other, valid goal — the cross-contamination a review
 *    reproduced: a single `-100000` target cancelled a healthy goal's target to
 *    zero and blanked the whole section's progress.
 */
function isReadableSavings(row: ReportSavingsInput): boolean {
  if (!Number.isFinite(row.currentBalance)) {
    return false
  }
  if (row.targetAmount == null) {
    return true
  }
  return Number.isFinite(row.targetAmount) && row.targetAmount > 0
}

// ============================================================================
// Section builders
// ============================================================================

function toCashflowRow(row: ReadableCashflow): ReportCashflowRow {
  return {
    id: row.id,
    name: row.name,
    amountCents: row.amount,
    frequency: row.frequency,
    monthlyCents: normalizeToMonthly(row.amount, row.frequency),
  }
}

function buildBudget(
  income: readonly ReportCashflowInput[],
  expenses: readonly ReportCashflowInput[]
): ReportBudgetSection {
  const readableIncome = income.filter(isReadableCashflow)
  const readableExpenses = expenses.filter(isReadableCashflow)
  const unreadableCount =
    income.length - readableIncome.length + (expenses.length - readableExpenses.length)

  // Core owns the normalize-and-total math; this module must not restate it.
  const totals = calculateNetIncomeResult(
    readableIncome.map((row) => ({ amount: row.amount, frequency: row.frequency })),
    readableExpenses.map((row) => ({ amount: row.amount, frequency: row.frequency }))
  )

  // Derived here rather than read from core's `isSurplus`, whose JSDoc says
  // ">= 0" while its implementation is "> 0" — at exact break-even that flag
  // reports a deficit. The boundary matters on a document a user keeps, so the
  // three cases are made explicit instead.
  let status: BudgetStatus = 'break-even'
  if (totals.netIncome > 0) {
    status = 'surplus'
  } else if (totals.netIncome < 0) {
    status = 'deficit'
  }

  return {
    income: readableIncome.map(toCashflowRow),
    expenses: readableExpenses.map(toCashflowRow),
    monthlyIncomeCents: totals.grossIncome,
    monthlyExpensesCents: totals.totalExpenses,
    monthlyNetCents: totals.netIncome,
    status,
    unreadableCount,
    isEmpty: readableIncome.length === 0 && readableExpenses.length === 0,
  }
}

/**
 * ⚠️ **Why this re-derives the totals instead of calling the store selectors.**
 *
 * The §5 reuse rule points at `useTotalInvestmentBalance`/`useTotalDebtBalance`/
 * `useNetBalance` (`stores/balanceStore.ts:256,266,276`), and the intent behind
 * that rule — no silent drift between what the report prints and what the app
 * shows — is right. But those selectors sum RAW rows: a single non-finite
 * `currentBalance` (reachable, since the sync applier writes without validating)
 * makes every one of them return `NaN`, and this report must stay legible in
 * exactly that case. So the formula is replicated over the READABLE subset, and
 * the no-drift guarantee is enforced by a parity test asserting this section
 * equals the selectors for clean data. That is a stronger guarantee than the
 * import would have been, because it fails loudly if either side changes.
 */
function buildNetWorth(balances: readonly ReportBalanceInput[]): ReportNetWorthSection {
  const readable = balances.filter(isReadableBalance)
  const investments = readable.filter((row) => row.type === 'investment')
  const debts = readable.filter((row) => row.type === 'debt')

  const sum = (rows: readonly ReportBalanceInput[]): number =>
    rows.reduce((total, row) => total + row.currentBalance, 0)

  const totalInvestmentsCents = sum(investments)
  const totalDebtsCents = sum(debts)

  const toRow = (row: ReportBalanceInput): ReportBalanceRow => ({
    id: row.id,
    name: row.name,
    balanceCents: row.currentBalance,
  })

  return {
    investments: investments.map(toRow),
    debts: debts.map(toRow),
    totalInvestmentsCents,
    totalDebtsCents,
    // Investments add, debts subtract — the same convention as `useNetBalance`,
    // proven equal by the parity test rather than asserted by this comment.
    netCents: totalInvestmentsCents - totalDebtsCents,
    unreadableCount: balances.length - readable.length,
    isEmpty: readable.length === 0,
  }
}

/**
 * Percentage of a target reached, or `null` when there is nothing to measure
 * against.
 *
 * ⚠️ **This must stay numerically identical to the app's own savings selectors.**
 * A code review found the report showing **30%** where `/savings` showed **25%**
 * for the same data, and **150%** where `/savings` showed **100%** — two surfaces
 * disagreeing about one number on a document the user is told to keep. The
 * canonical behaviour, which this reproduces exactly, is:
 *   - cap at 100 — `savingsStore.ts:135` and `packages/core/src/utils/savingsGoalCalculations.ts:29-38`
 *   - round to a whole percent — same two sites
 *   - guard the denominator so no division yields NaN or Infinity
 *
 * The formula is replicated rather than imported because the store selectors are
 * NOT corruption-safe (they sum raw rows, so a single non-finite value returns
 * NaN), and this report must stay readable in exactly that case. `parity with the
 * store selectors` is therefore enforced by a test instead — see the parity block
 * in `build-financial-summary.test.ts`.
 */
function toProgressPercent(currentCents: number, targetCents: number | null): number | null {
  if (targetCents == null || targetCents <= 0) {
    return null
  }
  return Math.min(100, Math.round((currentCents / targetCents) * 100))
}

function buildSavings(savings: readonly ReportSavingsInput[]): ReportSavingsSection {
  const readable = savings.filter(isReadableSavings)

  // Every readable row's balance counts toward "how much you have saved".
  const totalCurrentCents = readable.reduce((total, row) => total + row.currentBalance, 0)

  // ⚠️ Overall PROGRESS is measured across targeted goals ONLY — an untargeted
  // savings account contributes to neither the numerator nor the denominator.
  // This mirrors `getOverallProgress` (`savingsStore.ts:140-146`) and its comment
  // verbatim. Putting every balance over only the targeted totals (the original
  // implementation) inflated the figure: 300,000/1,000,000 = 30% where the app
  // itself reports 250,000/1,000,000 = 25%.
  const targeted = readable.filter((row) => row.targetAmount != null)
  const targetedBalanceCents = targeted.reduce((total, row) => total + row.currentBalance, 0)
  const totalTargetCents = targeted.reduce((total, row) => total + (row.targetAmount ?? 0), 0)

  return {
    goals: readable.map((row) => ({
      id: row.id,
      name: row.name,
      targetCents: row.targetAmount ?? null,
      currentCents: row.currentBalance,
      progressPercent: toProgressPercent(row.currentBalance, row.targetAmount),
    })),
    totalCurrentCents,
    totalTargetCents,
    overallProgressPercent: toProgressPercent(targetedBalanceCents, totalTargetCents),
    unreadableCount: savings.length - readable.length,
    isEmpty: readable.length === 0,
  }
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Assembles the printable financial summary from persisted store rows.
 *
 * @param input - Store rows plus the generated-at date (passed in for determinism)
 * @returns A plain, serializable report model; never throws on corrupt rows
 */
export function buildFinancialSummary(
  input: BuildFinancialSummaryInput
): FinancialSummaryReportModel {
  const budget = buildBudget(input.income, input.expenses)
  const netWorth = buildNetWorth(input.balances)
  const savings = buildSavings(input.savings)

  return {
    generatedAtISO: input.generatedAt.toISOString().slice(0, 10),
    budget,
    netWorth,
    savings,
    isEmpty: budget.isEmpty && netWorth.isEmpty && savings.isEmpty,
    totalUnreadableCount:
      budget.unreadableCount + netWorth.unreadableCount + savings.unreadableCount,
  }
}
