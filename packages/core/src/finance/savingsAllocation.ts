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

import {
  type AllocationMode,
  isSavingsAccount,
  resolveAllocationMode,
} from '../services/savingsGoals'
import { type NormalizableFinancialItem, calculateNetPeriodIncome } from './netIncome'
import { normalizeToMonthly } from './normalization'

/**
 * A savings account/goal as the solver needs it — a subset of `ClientSavingsGoal`.
 * - `targetAmount` null ⇒ a goal-less savings account, which takes NO part in the
 *   allocation at all (Story 64.1, FR98). See `isExcludedFromAllocation` below.
 * - `allocationMode` absent ⇒ treated as `automatic` (see `resolveAllocationMode`).
 * - `monthlyAllocation` is the fixed amount (cents) for `manual` accounts and is
 *   ignored for `automatic` accounts; absent/`null` counts as 0.
 *
 * ⚠️ `targetAmount` is REQUIRED, and that is deliberate rather than strict for its
 * own sake. "No target" is expressed as an ABSENT value (`null`/undefined — see
 * `isSavingsAccount`), so an OPTIONAL field here would make every caller that
 * simply forgot to pass one look exactly like a caller declaring an account, and
 * the row would be silently dropped from the solve with nothing to catch it. When
 * this field was added, all 44 account literals in this module's own test suite
 * omitted it — under an optional declaration every one of them would have flipped
 * to "account", zeroed every allocation figure in the suite, and still compiled.
 * Required makes `tsc` name each site instead. Do not relax it.
 */
export interface AllocationAccount {
  id: string
  targetAmount: number | null
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
 * `allocations` maps each automatic GOAL's id to its computed even-share in cents;
 * manual goals are absent, and so are goal-less savings accounts of either mode
 * (Story 64.1).
 *
 * ⚠️ `Σ allocations === distributablePool` holds **whenever at least one automatic
 * goal remains**. With none, the pool is still computed and reported while
 * `allocations` is empty, so the sum is 0 and the identity does NOT hold. That is
 * intended, not a gap: `SavingsPage` renders the leftover figure with an explicit
 * "nothing is set to receive it" message, which needs the real pool. This was
 * always true of the `count === 0` path; story 64.1 only made it reachable for a
 * user who has savings rows but no goals among them.
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
 * True when a row takes NO part in the allocation at all (Story 64.1, FR98).
 *
 * A target-less entry is a savings ACCOUNT — a balance the user wanted to record,
 * not something they are saving toward — so it is asked for no monthly allocation
 * and given none. It is excluded from BOTH arms: it does not consume the manual
 * deduction in `sumManualAllocations` and it does not receive an automatic share in
 * `solveAutomaticAllocations`. Excluding only one arm would leave a manual account
 * shrinking a pool it can no longer draw from.
 *
 * ⚠️ Delegates to `isSavingsAccount`, which is the declared single source of truth
 * for the goal-vs-account discriminator (Story 16-1) and uses LOOSE equality. Do
 * not re-implement it as `targetAmount === null`: an absent key means the same
 * thing as an explicit null, and a strict check would keep allocating to such a
 * row. Do not reach for `!targetAmount` either — a target of 0 is a goal, and the
 * suite pins that.
 *
 * ⚠️ Two boundaries worth stating plainly. (1) `undefined` is OUT OF CONTRACT for the
 * declared type, which is `number | null`; it is nonetheless treated as an account,
 * because rows reach the solver from paths that do not validate (a server pull, a
 * hand-edited localStorage blob) and the loose check costs nothing. The suite covers
 * it through a cast, not because the type permits it. (2) `isSavingsAccount` is NOT
 * re-exported from this package's public index — only the `AllocationMode` type is
 * (see `src/index.ts`, which records why the `services/savingsGoals` subpath does not
 * resolve for consumers) — so `apps/web` cannot call it and hand-rolls the same
 * `== null` check at its three read sites. That parity is unguarded; widening the
 * public surface is the fix if it ever drifts.
 */
function isExcludedFromAllocation(account: AllocationAccount): boolean {
  return isSavingsAccount(account)
}

/**
 * Sums the manual savings allocations, treating absent/null/non-finite/negative
 * amounts as 0 (so a malformed amount can never poison the pool with NaN).
 *
 * Story 64.1: a goal-less savings account is skipped even when it carries a stored
 * manual amount. `SavingsPage` neutralizes that field on save, but a row can still
 * arrive with a stale value from a server pull or hand-edited localStorage, and it
 * must not silently reserve money against a row that receives nothing.
 */
function sumManualAllocations(savingsAccounts: AllocationAccount[]): number {
  return (savingsAccounts || []).reduce((sum, account) => {
    if (isExcludedFromAllocation(account) || !isManual(account)) {
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
 * Among the rows that take part at all, "automatic" is the complement of "manual":
 * every one that is not in `manual` mode receives a share (an absent or
 * unrecognized mode defaults to automatic). That split stays exhaustive, so no
 * participating account — and no cent of the pool — is ever dropped.
 *
 * Story 64.1 adds a third population ahead of that split: goal-less savings
 * accounts, which take part in neither arm (see `isExcludedFromAllocation`).
 *
 * The even share is `floor(pool / N)`, and the leftover cents (`pool mod N`, a
 * value in `0..N-1`) are handed out one-at-a-time to the automatic accounts in
 * input order. This is deterministic and preserves the total exactly.
 *
 * Account ids are assumed unique (they are uuid primary keys). Duplicate ids
 * would collapse in the `allocations` record and break the sum invariant.
 *
 * @returns The pool, the count of automatic goals, and the per-account
 *   allocations (automatic goals only). With zero automatic goals, the pool is
 *   still computed but `allocations` is empty — see the note on
 *   `AutomaticAllocationResult` about the sum identity.
 */
export function solveAutomaticAllocations(
  input: AutomaticAllocationInput
): AutomaticAllocationResult {
  const distributablePool = calculateDistributablePool(input)
  const automaticAccounts = (input.savingsAccounts || []).filter(
    (account) => !isExcludedFromAllocation(account) && !isManual(account)
  )
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
