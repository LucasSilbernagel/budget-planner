/**
 * Automatic Leftover-Allocation Solver (Story 26.2)
 *
 * Works out how much money is left over each month after expenses, investment/
 * retirement contributions, and fixed (manual) savings allocations, then splits
 * that leftover pool evenly across the savings accounts set to `automatic` mode.
 *
 * All amounts are integer cents. The split uses deterministic cent-rounding that
 * neither creates nor destroys a cent: the sum of the automatic allocations
 * always equals the distributable pool exactly.
 *
 * Pure functions, no side effects.
 *
 * Architecture Requirement: FR40 - Automatic even split of leftover funds
 *   (completes FR7). Extends the savings-capacity basis (net period income) with
 *   contribution and manual-allocation deductions.
 */

import { type AllocationMode, resolveAllocationMode } from '../services/savingsGoals'
import { type NormalizableFinancialItem, calculateNetPeriodIncome } from './netIncome'
import { normalizeToMonthly } from './normalization'

/**
 * A savings account/goal as the solver needs it — a subset of `ClientSavingsGoal`.
 * - `allocationMode` absent ⇒ treated as `automatic` (see `resolveAllocationMode`).
 * - `monthlyAllocation` is the fixed amount (cents) for `manual` accounts and is
 *   ignored for `automatic` accounts; absent/`null` counts as 0.
 */
export interface AllocationAccount {
  id: string
  allocationMode?: AllocationMode
  monthlyAllocation?: number | null
}

/**
 * One investment/retirement contribution as the pool needs it (Story 45.1, FR72).
 *
 * `recordedAsExpense` is the user's statement that this contribution is ALREADY
 * present in the expense list, so subtracting it here as well would remove the
 * same money twice. Absent/`false` ⇒ deduct, which is the behaviour that shipped
 * before this story and the behaviour every existing caller keeps by default.
 *
 * ⚠️ This flag is USER-SUPPLIED and can only be user-supplied. A user whose
 * expense line and contribution describe the SAME money and a user whose describe
 * DIFFERENT money produce byte-identical rows — same names, same amounts, same
 * cadences. No rule computed from row content can separate them, so any heuristic
 * de-duplication would simply trade one wrong figure for a different wrong figure.
 * See FR72 and the story's D5.
 */
export interface PoolContributionItem extends NormalizableFinancialItem {
  recordedAsExpense?: boolean
}

/**
 * Inputs to the leftover-allocation solver.
 * `investmentContributions` are the investment/retirement contributions at their
 * own cadence (i.e. `balanceTracking` entries of type `investment`, shaped as
 * `{ amount: monthlyContribution, frequency }`). The solver normalizes them to a
 * monthly base internally, so the caller does not pre-normalize.
 */
export interface AutomaticAllocationInput {
  incomeSources: NormalizableFinancialItem[]
  expenses: NormalizableFinancialItem[]
  investmentContributions: PoolContributionItem[]
  savingsAccounts: AllocationAccount[]
}

/**
 * Result of solving the automatic allocations.
 * `allocations` maps each automatic account's id to its computed even-share in
 * cents; manual accounts are absent. `Σ allocations === distributablePool`.
 */
export interface AutomaticAllocationResult {
  distributablePool: number // cents, always >= 0
  automaticAccountCount: number
  allocations: Record<string, number>
}

/** True when an account is in `manual` mode; every other account is automatic. */
function isManual(account: AllocationAccount): boolean {
  return resolveAllocationMode(account) === 'manual'
}

/**
 * Sums the manual savings allocations, treating absent/null/non-finite/negative
 * amounts as 0 (so a malformed amount can never poison the pool with NaN).
 */
function sumManualAllocations(savingsAccounts: AllocationAccount[]): number {
  return (savingsAccounts || []).reduce((sum, account) => {
    if (!isManual(account)) {
      return sum
    }
    const amount = account.monthlyAllocation
    return sum + (Number.isFinite(amount) ? Math.max(0, amount as number) : 0)
  }, 0)
}

/**
 * Sums investment/retirement contributions normalized to a monthly base (cents).
 * Each contribution is clamped at 0 so a stray negative amount cannot inflate the
 * pool (mirrors the manual-allocation clamp above). Invalid (NaN/non-finite)
 * amounts still throw via `normalizeToMonthly`'s validation.
 *
 * Story 45.1 (FR72): a contribution the user has marked as already recorded on the
 * expense list is SKIPPED, because `netPeriodIncome` has already subtracted it.
 *
 * ⚠️ The skip is strictly `=== true`, never truthy. A persisted `"false"` string
 * or a `1` reaching the store by a route that does not validate must never
 * silently disable a real deduction — only a genuine boolean `true` skips.
 *
 * ⚠️ The skip happens BEFORE normalization, so a skipped row contributes nothing
 * at all. That matters because `normalizeToMonthly` rounds PER ITEM and this
 * reducer sums already-rounded values: excluding a row must remove exactly the
 * rounded amount that row would have contributed, not an unrounded recomputation.
 */
function sumMonthlyInvestmentContributions(
  investmentContributions: PoolContributionItem[]
): number {
  return (investmentContributions || []).reduce((sum, contribution) => {
    if (contribution.recordedAsExpense === true) {
      return sum
    }
    return sum + Math.max(0, normalizeToMonthly(contribution.amount, contribution.frequency))
  }, 0)
}

/**
 * Computes the leftover pool available to distribute across automatic accounts:
 *   max(0, netPeriodIncome − Σ(normalized COUNTED contributions) − Σ(manual allocations))
 *
 * A contribution flagged `recordedAsExpense` is not counted: `netPeriodIncome`
 * already removed that money as an expense (Story 45.1, FR72).
 *
 * @returns The distributable pool in cents, always >= 0 and never NaN. (Invalid
 *   income/expense/contribution amounts throw via the normalization validators;
 *   a malformed manual amount is treated as 0 rather than poisoning the pool.)
 */
export function calculateDistributablePool(input: AutomaticAllocationInput): number {
  const netPeriodIncome = calculateNetPeriodIncome(input.incomeSources || [], input.expenses || [])
  const contributions = sumMonthlyInvestmentContributions(input.investmentContributions)
  const manualAllocations = sumManualAllocations(input.savingsAccounts)

  return Math.max(0, netPeriodIncome - contributions - manualAllocations)
}

/**
 * Solves the automatic leftover allocation: computes the distributable pool and
 * splits it evenly across the automatic savings accounts with exact cents.
 *
 * "Automatic" is the complement of "manual": every account that is not in
 * `manual` mode receives a share (an absent or unrecognized mode defaults to
 * automatic). This keeps the manual/automatic split exhaustive, so no account —
 * and no cent of the pool — is ever dropped.
 *
 * The even share is `floor(pool / N)`, and the leftover cents (`pool mod N`, a
 * value in `0..N-1`) are handed out one-at-a-time to the automatic accounts in
 * input order. This is deterministic and preserves the total exactly.
 *
 * Account ids are assumed unique (they are uuid primary keys). Duplicate ids
 * would collapse in the `allocations` record and break the sum invariant.
 *
 * @returns The pool, the count of automatic accounts, and the per-account
 *   allocations (automatic accounts only). With zero automatic accounts, the
 *   pool is still computed but `allocations` is empty.
 */
export function solveAutomaticAllocations(
  input: AutomaticAllocationInput
): AutomaticAllocationResult {
  const distributablePool = calculateDistributablePool(input)
  const automaticAccounts = (input.savingsAccounts || []).filter((account) => !isManual(account))
  const count = automaticAccounts.length

  const allocations: Record<string, number> = {}
  if (count === 0) {
    return { distributablePool, automaticAccountCount: 0, allocations }
  }

  const baseShare = Math.floor(distributablePool / count)
  let leftoverCents = distributablePool - baseShare * count // 0 .. count-1

  for (const account of automaticAccounts) {
    allocations[account.id] = baseShare + (leftoverCents > 0 ? 1 : 0)
    if (leftoverCents > 0) {
      leftoverCents--
    }
  }

  return { distributablePool, automaticAccountCount: count, allocations }
}
