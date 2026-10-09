import type {
	CategoryBreakdownItem,
	CategoryBreakdownRow,
} from '@budget-planner/core/finance/categoryBreakdown'
import { FREQUENCIES } from '@budget-planner/core/finance/normalization'
import type { useExpenses } from '../../../stores/expenseStore'
import type { useIncomeSources } from '../../../stores/incomeStore'

type IncomeRow = ReturnType<typeof useIncomeSources>[number]
type ExpenseRow = ReturnType<typeof useExpenses>[number]

// The core helper throws on corrupt rows; a bad persisted row must degrade that row, not the render.
export function toBreakdownItems(
	rows: readonly (IncomeRow | ExpenseRow)[]
): CategoryBreakdownItem[] {
	const items: CategoryBreakdownItem[] = []
	for (const row of rows) {
		// Log the id only: the row holds the user's financial data.
		if (typeof row?.amount !== 'number' || !Number.isFinite(row.amount)) {
			console.warn('Skipping a row with a non-numeric amount in the category breakdown:', row?.id)
			continue
		}
		if (!FREQUENCIES.includes(row.frequency)) {
			console.warn('Skipping a row with an unknown frequency in the category breakdown:', row.id)
			continue
		}
		items.push({ categoryId: row.categoryId, amount: row.amount, frequency: row.frequency })
	}
	return items
}

// generateColorMap skips an empty key, so the residual bucket needs a sentinel.
export function rowKey(row: CategoryBreakdownRow): string {
	return row.categoryId ?? 'uncategorized'
}
