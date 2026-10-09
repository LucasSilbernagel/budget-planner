import { DEFAULT_INVESTMENT_RETURN } from '@budget-planner/core/finance/forecasting'
import type { Frequency } from '@budget-planner/core/finance/normalization'
import { normalizeToMonthly } from '@budget-planner/core/finance/normalization'
import { solveAutomaticAllocations } from '@budget-planner/core/finance/savingsAllocation'
import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import {
	debtOwedCents,
	resolveDebtPaymentExpense,
} from '@budget-planner/core/services/balanceTracking'
import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import { isKnownFrequency } from '../../../lib/readable-rows'
import type { useExpenses } from '../../../stores/expenseStore'
import type { useIncomeSources } from '../../../stores/incomeStore'
import type { useSavingsGoals } from '../../../stores/savingsStore'
import { balanceRowType, nonNegativeCents } from './row-coercion'
import type {
	ForecastRows,
	LocalAssetAccount,
	LocalBalanceAccount,
	LocalFinancialItem,
	LocalSavingsAccount,
} from './types'

// Sorted only on load, never on edit: a live re-sort would move the row being typed in.
// Stable, and a corrupt frequency ranks as 0 instead of throwing.
export function sortByMonthlyDesc(items: LocalFinancialItem[]): LocalFinancialItem[] {
	const monthly = (item: LocalFinancialItem): number => {
		try {
			return normalizeToMonthly(item.amount, item.frequency)
		} catch {
			return 0
		}
	}
	return items
		.map((item) => ({ item, monthly: monthly(item) }))
		.sort((a, b) => b.monthly - a.monthly)
		.map(({ item }) => item)
}

// Fields mapped explicitly (a spread leaks store fields into saved JSON); amounts stay raw since the engine normalizes.
// Frequencies are validated: unvalidated store rows can hold one that throws for the whole forecast.
function itemsFromStore(
	rows: readonly { name: string; amount: number; frequency: Frequency }[],
	prefix: string
): LocalFinancialItem[] {
	return rows.map((row, index) => ({
		id: `${prefix}-seeded-${index}`,
		name: typeof row.name === 'string' ? row.name : '',
		amount: Number.isFinite(row.amount) ? row.amount : 0,
		frequency: isKnownFrequency(row.frequency) ? row.frequency : 'monthly',
	}))
}

// Automatic rows seed from allocations, the solver output /savings shows; null (solver threw) seeds 0.
// Fields mapped explicitly so store fields stay out of the saved JSON.
function savingsFromStore(
	goals: readonly ClientSavingsGoal[],
	allocations: Readonly<Record<string, number>> | null
): LocalSavingsAccount[] {
	return goals.map((goal, index) => ({
		id: `savings-seeded-${index}`,
		name: typeof goal.name === 'string' ? goal.name : '',
		balance: nonNegativeCents(goal.currentBalance),
		monthlyContribution:
			(goal.allocationMode ?? 'automatic') === 'manual'
				? nonNegativeCents(goal.monthlyAllocation)
				: nonNegativeCents(allocations?.[goal.id]),
	}))
}

// Negative or non-finite seeds 0 (the Overview sums a legacy negative asset raw, so the two can differ).
// Fields mapped explicitly so store fields stay out of the saved JSON.
function assetsFromStore(entries: readonly ClientBalanceTracking[]): LocalAssetAccount[] {
	return entries
		.filter((entry) => entry.type === 'asset')
		.map((entry, index) => ({
			id: `asset-seeded-${index}`,
			name: typeof entry.name === 'string' ? entry.name : '',
			balance: nonNegativeCents(entry.currentBalance),
		}))
}

// A debt's contribution is its linked expense, which moves into the first debt linked to it (consumedExpenseIds),
// so a payment is never counted twice. Debts seed |balance|; fields are mapped explicitly.
function balanceFromStore(
	entries: readonly ClientBalanceTracking[],
	expenses: readonly { id: string; name: unknown; amount: unknown; frequency: unknown }[]
): { rows: LocalBalanceAccount[]; consumedExpenseIds: ReadonlySet<string> } {
	const rows: LocalBalanceAccount[] = []
	const consumedExpenseIds = new Set<string>()
	for (const entry of entries) {
		const type = balanceRowType(entry.type)
		if (type === null) continue
		const raw = entry.currentBalance
		const balance =
			type === 'debt'
				? typeof raw === 'number' && Number.isFinite(raw)
					? debtOwedCents(raw)
					: 0
				: nonNegativeCents(raw)
		let linked: (typeof expenses)[number] | null = null
		if (type === 'debt') {
			const resolved = resolveDebtPaymentExpense(entry, expenses)
			// The expense moves only if the debt can carry it: a 0 debt or non-positive amount would drop the payment.
			const amount = resolved?.amount
			if (
				resolved !== null &&
				!consumedExpenseIds.has(resolved.id) &&
				balance > 0 &&
				typeof amount === 'number' &&
				Number.isFinite(amount) &&
				amount > 0
			) {
				linked = resolved
				consumedExpenseIds.add(resolved.id)
			}
		}
		const linkedName = typeof linked?.name === 'string' ? linked.name.trim() : ''
		rows.push({
			id: `balance-seeded-${rows.length}`,
			name: typeof entry.name === 'string' ? entry.name : '',
			type,
			balance,
			...(type === 'debt'
				? debtPaymentFromExpense(linked)
				: {
						contribution: nonNegativeCents(entry.monthlyContribution),
						frequency: isKnownFrequency(entry.frequency) ? entry.frequency : 'monthly',
					}),
			// Starts off: its payment left the Expenses rows with it.
			contributionRecordedAsExpense:
				type === 'investment' && entry.contributionRecordedAsExpense === true,
			annualReturn: DEFAULT_INVESTMENT_RETURN,
			...(linkedName !== '' ? { paidByExpenseName: linkedName } : {}),
		})
	}
	return { rows, consumedExpenseIds }
}

// Same coercion as other seeded money (finite and >= 0, else 0); an unknown frequency reads monthly.
function debtPaymentFromExpense(expense: { amount: unknown; frequency: unknown } | null): {
	contribution: number
	frequency: Frequency
} {
	if (expense === null) return { contribution: 0, frequency: 'monthly' }
	return {
		contribution: nonNegativeCents(expense.amount),
		frequency: isKnownFrequency(expense.frequency) ? expense.frequency : 'monthly',
	}
}

// The builder seed and the forecast baseline share this mapping. Linked expenses move into debt rows;
// unfilteredExpenseItems keeps them for when balance rows were edited first and carry no payment.
export function rowsFromStores(stores: {
	income: ReturnType<typeof useIncomeSources>
	expenses: ReturnType<typeof useExpenses>
	savingsGoals: ReturnType<typeof useSavingsGoals>
	balanceEntries: readonly ClientBalanceTracking[]
	contributionItems: Parameters<typeof solveAutomaticAllocations>[0]['investmentContributions']
}): ForecastRows & { unfilteredExpenseItems: LocalFinancialItem[] } {
	const seeded = balanceFromStore(stores.balanceEntries, stores.expenses)
	let allocations: Record<string, number> | null = null
	try {
		allocations = solveAutomaticAllocations({
			incomeSources: stores.income,
			expenses: stores.expenses,
			investmentContributions: stores.contributionItems,
			savingsAccounts: stores.savingsGoals,
		}).allocations
	} catch {
		allocations = null
	}
	return {
		incomeItems: itemsFromStore(stores.income, 'income'),
		expenseItems: sortByMonthlyDesc(
			itemsFromStore(
				stores.expenses.filter((row) => !seeded.consumedExpenseIds.has(row.id)),
				'expense'
			)
		),
		unfilteredExpenseItems: sortByMonthlyDesc(itemsFromStore(stores.expenses, 'expense')),
		savingsAccounts: savingsFromStore(stores.savingsGoals, allocations),
		balanceAccounts: seeded.rows,
		assetAccounts: assetsFromStore(stores.balanceEntries),
	}
}
