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
 * deliberately ABSENT. The retirement outlook's inputs are ephemeral component
 * state (`RetirementAccumulationPlanner` holds them in `useState`, with no store
 * and no persistence key), so a report generated from `/settings` has no data to
 * read; the forward net-worth projection has no source at all since story 43.3
 * (FR69) removed the free projection page. This narrows FR53 by design, not by
 * omission — see `components/reports/FinancialSummaryReport.tsx` for the full
 * record before adding either back.
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
import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import { netWorthFromTotals } from '../net-worth'

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
  /** Things owned outright — property, vehicle, cash (story 43.4, FR70). */
  assets: ReportBalanceRow[]
  totalInvestmentsCents: number
  totalDebtsCents: number
  /** Total of {@link assets}, in cents. Counts toward {@link netCents}. */
  totalAssetsCents: number
  /**
   * The savings total that contributes to {@link netCents} (story 32.2, FR59).
   * The individual savings rows stay in the savings section; this is carried here
   * so the printed net-worth arithmetic reconciles on the page.
   */
  totalSavingsCents: number
  /** Investments + savings + assets − debts, in cents. May be negative. */
  netCents: number
  /** Excludes unreadable BALANCE rows only — savings rows are counted in their own section. */
  unreadableCount: number
  /**
   * Unreadable SAVINGS rows, carried here for disclosure only and deliberately
   * NOT added to {@link unreadableCount} (which feeds the document-wide total).
   * Without it this section can print a figure that silently omits savings money,
   * or — worse — claim nothing was ever added when rows exist but could not be
   * read. Code review 32.2 reproduced exactly that.
   */
  excludedSavingsCount: number
  isEmpty: boolean
}

export interface ReportSavingsSection {
  goals: ReportSavingsRow[]
  totalCurrentCents: number
  totalTargetCents: number
  /** 0-100 across all targeted goals, or `null` when no goal carries a target. */
  overallProgressPercent: number | null
  /** Rows excluded entirely because their BALANCE could not be read. */
  unreadableCount: number
  /**
   * Rows whose balance counted but whose TARGET was unreadable, so they show no
   * progress. Disclosed separately and deliberately NOT added to
   * {@link unreadableCount} — the row was not excluded, and the document-wide
   * total counts exclusions.
   */
  unreadableTargetCount: number
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
 * The balance categories this report knows how to place. DERIVED from
 * `FINANCE_TYPES` (story 43.4) rather than restated: while this was a literal
 * `new Set(['investment', 'debt'])`, adding the `asset` type would have made
 * every asset row "unreadable" — dropped from net worth AND counted into
 * `unreadableCount`, so the printed report would have told the user that the
 * condo they had just entered could not be read.
 *
 * Validated for the same
 * reason `frequency` is: a row whose `type` is neither of these belongs in no
 * column, so without this check it would be filtered out of both totals while
 * still counting as "readable" — i.e. it would vanish from the document with no
 * disclosure, which is precisely the failure this module claims to prevent.
 * (Code review 2026-08-09: the omission was real and reproducible.)
 */
const KNOWN_FINANCE_TYPES: ReadonlySet<string> = new Set<string>(FINANCE_TYPES)

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
 * Whether a savings row's MONEY can be read. This is the only question that
 * matters for "how much have you saved" and for net worth.
 *
 * ⚠️ `Number.isFinite` does NOT coerce, so a persisted string (`"300000"`) is
 * correctly rejected here. That matters more than it looks: elsewhere in the app
 * a string balance makes `investments + savings` a string CONCATENATION and
 * produces a large, plausible-looking wrong number with no `NaN` to flag it (see
 * `deferred-work.md`). This report is immune by construction.
 */
function hasReadableBalance(row: ReportSavingsInput): boolean {
  return Number.isFinite(row.currentBalance)
}

/**
 * Whether a savings row carries a target that can be measured against — i.e.
 * whether it is a GOAL with usable progress, as opposed to an account or a row
 * whose target is corrupt.
 *
 * ⚠️ **`== null`, not `=== null`.** An absent `targetAmount` key means the same
 * thing as an explicit `null` — "savings account, no target" — and the store
 * itself uses loose equality for exactly this (`savingsStore.ts:132,141`).
 * Strict equality classified a legacy row as corrupt.
 *
 * ⚠️ **A non-positive target is corrupt, not "a target of zero".** The domain
 * validator requires a positive integer whenever a target is supplied, so 0 or a
 * negative value can only arrive from unvalidated/legacy data.
 */
function hasUsableTarget(row: ReportSavingsInput): boolean {
  if (row.targetAmount == null) {
    return false
  }
  return Number.isFinite(row.targetAmount) && row.targetAmount > 0
}

/**
 * A row whose target is corrupt — present, but not a figure progress can be
 * measured against. Its BALANCE is still real money and still counts.
 */
function hasCorruptTarget(row: ReportSavingsInput): boolean {
  return row.targetAmount != null && !hasUsableTarget(row)
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
 * ⚠️ **Why the TOTALS are re-derived but the DEFINITION is imported.**
 *
 * The §5 reuse rule points at `useTotalInvestmentBalance`/`useTotalDebtBalance`
 * (`stores/balanceStore.ts:256,266`), and the intent behind it — no silent drift
 * between what the report prints and what the app shows — is right. Those
 * selectors sum RAW rows: a single non-finite `currentBalance` (reachable, since
 * the sync applier writes without validating) makes them return `NaN`, and this
 * report must stay legible in exactly that case. So the per-type SUMS are
 * replicated over the readable subset.
 *
 * The net-worth FORMULA is a different matter and is now imported from
 * `lib/net-worth.ts` (story 32.2). It used to be replicated too, "guaranteed" by a
 * parity test — but that test re-implemented the selector inside the test file
 * and imported nothing from the store, so changing the app's definition could not
 * fail it. A no-drift claim is only real when the test imports the thing it
 * claims parity with; the definition now has exactly one home and every surface
 * calls it.
 *
 * @param balances - Raw balance rows; unreadable ones are excluded and counted
 * @param savings - The ALREADY-BUILT savings section. Taken whole rather than
 *   re-filtering `input.savings` here on purpose: `totalUnreadableCount` sums the
 *   per-section counts, so a second filter would count every corrupt savings row
 *   twice and make the document's own disclosure wrong.
 */
function buildNetWorth(
  balances: readonly ReportBalanceInput[],
  savings: ReportSavingsSection
): ReportNetWorthSection {
  const readableSavingsCents = savings.totalCurrentCents
  const readable = balances.filter(isReadableBalance)
  const investments = readable.filter((row) => row.type === 'investment')
  const debts = readable.filter((row) => row.type === 'debt')
  const assets = readable.filter((row) => row.type === 'asset')

  const sum = (rows: readonly ReportBalanceInput[]): number =>
    rows.reduce((total, row) => total + row.currentBalance, 0)

  const totalInvestmentsCents = sum(investments)
  const totalDebtsCents = sum(debts)
  const totalAssetsCents = sum(assets)

  const toRow = (row: ReportBalanceInput): ReportBalanceRow => ({
    id: row.id,
    name: row.name,
    balanceCents: row.currentBalance,
  })

  return {
    investments: investments.map(toRow),
    debts: debts.map(toRow),
    assets: assets.map(toRow),
    totalInvestmentsCents,
    totalDebtsCents,
    totalAssetsCents,
    totalSavingsCents: readableSavingsCents,
    // The app's one definition of net worth — shared with `useNetWorth()`, not
    // restated here (story 32.2).
    netCents: netWorthFromTotals({
      investmentsCents: totalInvestmentsCents,
      savingsCents: readableSavingsCents,
      assetsCents: totalAssetsCents,
      debtsCents: totalDebtsCents,
    }),
    unreadableCount: balances.length - readable.length,
    excludedSavingsCount: savings.unreadableCount,
    // ⚠️ Savings count toward net worth now, so a user with savings and no
    // balance rows HAS a net worth. Keying this on balance rows alone printed
    // "there is no net worth to summarize" over a real, positive figure. Tested
    // against the savings section's own emptiness, not against a zero total: a
    // savings account holding exactly 0 is still a row the user added.
    //
    // ⚠️ `savings.unreadableCount === 0` is the third clause and it is load-bearing
    // (code review 32.2). `savings.isEmpty` counts READABLE rows, so a user whose
    // only savings rows are corrupt satisfied the first two clauses and the section
    // printed "No investments, savings or debts have been added" as flat fact —
    // while the savings section on the same page disclosed that entries existed but
    // could not be read. That is the self-contradiction class this story fixed in
    // two other gates, reintroduced by the fix for the second one.
    isEmpty: readable.length === 0 && savings.isEmpty && savings.unreadableCount === 0,
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
  // `Number.isFinite` first: `NaN <= 0` is FALSE, so a non-finite target would slip
  // past a bare `<= 0` guard and divide into `NaN`. Reachable now that a row with a
  // corrupt target is kept for its balance instead of being dropped whole.
  if (targetCents == null || !Number.isFinite(targetCents) || targetCents <= 0) {
    return null
  }
  return Math.min(100, Math.round((currentCents / targetCents) * 100))
}

/**
 * ⚠️ **Balance-readability and target-readability are separate questions**
 * (split during the story 32.2 code review).
 *
 * They used to be one predicate: a row with a finite balance but a corrupt target
 * was dropped ENTIRELY. That was defensible while this section only reported
 * savings — but 32.2 made the savings total feed NET WORTH, and the app's own
 * `useTotalSavings` never looks at the target. So `{targetAmount: 0,
 * currentBalance: 100_000}` produced a printed net worth of 0 where all three
 * screens showed 1,000.00, with both figures perfectly legible and nothing to
 * signal the divergence.
 *
 * Now: a finite balance is real money and always counts. A corrupt target only
 * costs the row its PROGRESS (rendered "—", exactly like a genuine account) and
 * is disclosed via {@link ReportSavingsSection.unreadableTargetCount} — so it is
 * never silently indistinguishable from a legitimate no-target account.
 */
function buildSavings(savings: readonly ReportSavingsInput[]): ReportSavingsSection {
  const readable = savings.filter(hasReadableBalance)

  // Every readable row's balance counts toward "how much you have saved".
  const totalCurrentCents = readable.reduce((total, row) => total + row.currentBalance, 0)

  // ⚠️ Overall PROGRESS is measured across rows with a USABLE target only — an
  // untargeted savings account contributes to neither the numerator nor the
  // denominator, and neither does a row whose target is corrupt. This mirrors
  // `getOverallProgress` (`savingsStore.ts:140-146`) for clean data. Putting every
  // balance over only the targeted totals (the original implementation) inflated
  // the figure: 300,000/1,000,000 = 30% where the app reports 250,000/1,000,000 = 25%.
  const targeted = readable.filter(hasUsableTarget)
  const targetedBalanceCents = targeted.reduce((total, row) => total + row.currentBalance, 0)
  const totalTargetCents = targeted.reduce((total, row) => total + (row.targetAmount ?? 0), 0)

  return {
    goals: readable.map((row) => ({
      id: row.id,
      name: row.name,
      // A corrupt target is reported as ABSENT, never printed as a figure — the
      // document must not show `0` or `-1,000.00` as somebody's savings goal.
      targetCents: hasUsableTarget(row) ? row.targetAmount ?? null : null,
      currentCents: row.currentBalance,
      progressPercent: toProgressPercent(row.currentBalance, row.targetAmount),
    })),
    totalCurrentCents,
    totalTargetCents,
    overallProgressPercent: toProgressPercent(targetedBalanceCents, totalTargetCents),
    unreadableCount: savings.length - readable.length,
    unreadableTargetCount: readable.filter(hasCorruptTarget).length,
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
  // Savings first: net worth consumes its already-filtered total (story 32.2), so
  // a corrupt savings row is excluded and counted exactly once, in one section.
  const savings = buildSavings(input.savings)
  const netWorth = buildNetWorth(input.balances, savings)

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
