import { type AllocationMode, resolveAllocationMode } from '../services/savingsGoals'
import { calculateNetPeriodIncome, type NormalizableFinancialItem } from './netIncome'
import { normalizeToMonthly } from './normalization'

export type AllocationAccount = {
	id: string
	allocationMode?: AllocationMode
	monthlyAllocation?: number | null
}

// recordedAsExpense can only be user-supplied: same-money and different-money rows are
// byte-identical, so no heuristic can de-duplicate them.
export type PoolContributionItem = NormalizableFinancialItem & {
	recordedAsExpense?: boolean
}

export type AutomaticAllocationInput = {
	incomeSources: NormalizableFinancialItem[]
	expenses: NormalizableFinancialItem[]
	investmentContributions: PoolContributionItem[]
	savingsAccounts: AllocationAccount[]
}

// Σ allocations === distributablePool only when an automatic row exists; with none the
// pool is still reported so the UI can show the unallocated leftover.
export type AutomaticAllocationResult = {
	distributablePool: number
	automaticAccountCount: number
	allocations: Record<string, number>
}

function isManual(account: AllocationAccount): boolean {
	return resolveAllocationMode(account) === 'manual'
}

function sumManualAllocations(savingsAccounts: AllocationAccount[]): number {
	return (savingsAccounts || []).reduce((sum, account) => {
		if (!isManual(account)) {
			return sum
		}
		const amount = account.monthlyAllocation
		return sum + (Number.isFinite(amount) ? Math.max(0, amount as number) : 0)
	}, 0)
}

// The skip is strictly `=== true` and happens before per-item rounding, so a skipped
// row removes exactly its rounded amount.
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

export function calculateDistributablePool(input: AutomaticAllocationInput): number {
	const netPeriodIncome = calculateNetPeriodIncome(input.incomeSources || [], input.expenses || [])
	const contributions = sumMonthlyInvestmentContributions(input.investmentContributions)
	const manualAllocations = sumManualAllocations(input.savingsAccounts)

	return Math.max(0, netPeriodIncome - contributions - manualAllocations)
}

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
	let leftoverCents = distributablePool - baseShare * count

	for (const account of automaticAccounts) {
		allocations[account.id] = baseShare + (leftoverCents > 0 ? 1 : 0)
		if (leftoverCents > 0) {
			leftoverCents--
		}
	}

	return { distributablePool, automaticAccountCount: count, allocations }
}
