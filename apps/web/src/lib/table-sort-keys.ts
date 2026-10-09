import { debtOwedCents, getNormalizationMultiplier, normalizeToMonthly } from '@budget-planner/core'
import { resolveCategoryName } from '../hooks/useCategoryLabels'
import { isKnownFrequency, isReadableRow } from './readable-rows'
import type { SortKeyExtractors } from './table-sort'

/**
 * Extractors return `null`, never `NaN` or a throw: a throwing comparator blanks the page.
 * Keys sort by what the cell shows, not by the stored value.
 */

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Negated because the multiplier descends as the period lengthens, so ascending reads
 * weekly, biweekly, monthly, annually.
 */
function cadenceKey(frequency: unknown): number | null {
	if (!isKnownFrequency(frequency)) {
		return null
	}
	return -getNormalizationMultiplier(frequency)
}

function normalizedOrNull(amount: unknown, frequency: unknown): number | null {
	const candidate = { amount, frequency }
	if (!isReadableRow(candidate)) {
		return null
	}
	return normalizeToMonthly(candidate.amount, candidate.frequency)
}

export type FlowSortKey = 'name' | 'amount' | 'frequency' | 'category'

type FlowRow = {
	name: string
	amount: number
	frequency: string
	categoryId: string | null
}

/** Memoise on `categoryNames`: renaming a category reorders the table without any row changing. */
export function createFlowSortExtractors(
	categoryNames: ReadonlyMap<string, string>,
	includeCategory: boolean
): SortKeyExtractors<FlowRow, FlowSortKey> {
	const base = {
		name: (row: FlowRow) => textOrNull(row.name),
		amount: (row: FlowRow) => normalizedOrNull(row.amount, row.frequency),
		frequency: (row: FlowRow) => cadenceKey(row.frequency),
	}
	// Omitted when the column is hidden so a sort cannot outlive its column.
	return includeCategory
		? {
				...base,
				category: (row: FlowRow) => resolveCategoryName(row.categoryId, categoryNames),
			}
		: base
}

export type SavingsSortKey = 'name' | 'target' | 'currentBalance' | 'monthlyAllocation' | 'progress'

type SavingsRow = {
	id: string
	name: string
	targetAmount: number | null
	currentBalance: number
	monthlyAllocation?: number | null
}

/**
 * A row is automatic iff the solver placed it in `allocations`; a manual amount is floored
 * at 0 to match the solver.
 */
export function createSavingsSortExtractors(
	allocations: Readonly<Record<string, number>>,
	getProgress: (id: string) => number | null
): SortKeyExtractors<SavingsRow, SavingsSortKey> {
	return {
		name: (row) => textOrNull(row.name),
		target: (row) => finiteOrNull(row.targetAmount),
		currentBalance: (row) => finiteOrNull(row.currentBalance),
		monthlyAllocation: (row) =>
			finiteOrNull(
				row.id in allocations ? (allocations[row.id] ?? 0) : Math.max(0, row.monthlyAllocation ?? 0)
			),
		progress: (row) => finiteOrNull(getProgress(row.id)),
	}
}

export type BalanceSortKey = 'type' | 'name' | 'currentBalance' | 'contribution'

export type BalanceRow = {
	type: string
	name: string
	currentBalance: number
	monthlyContribution: number
	frequency: string
	paymentExpenseId?: unknown
}

/** Rebuild the extractors when the active profile's expenses change. */
export type DebtPaymentResolver = (
	row: BalanceRow
) => { amount: unknown; frequency: unknown } | null

/**
 * Sorted by enum order (investment, asset, debt), not by the rendered label, which
 * would put assets next to debts.
 */
/** An unknown value sorts last rather than tying with a real one. */
const TYPE_SORT_RANK: Readonly<Record<string, number>> = {
	investment: 0,
	asset: 1,
	debt: 2,
}
const TYPE_SORT_RANK_FALLBACK = 3

export function createBalanceSortExtractors(
	debtPayment: DebtPaymentResolver = () => null
): SortKeyExtractors<BalanceRow, BalanceSortKey> {
	return {
		// Own-property check: a `type` of 'constructor' would otherwise read an inherited function.
		type: (row) =>
			Object.hasOwn(TYPE_SORT_RANK, row.type)
				? (TYPE_SORT_RANK[row.type] ?? TYPE_SORT_RANK_FALLBACK)
				: TYPE_SORT_RANK_FALLBACK,
		name: (row) => textOrNull(row.name),
		currentBalance: (row) =>
			finiteOrNull(row.type === 'debt' ? debtOwedCents(row.currentBalance) : row.currentBalance),
		// An asset shows an em-dash and a debt shows its linked expense's payment, so neither
		// keys on the stored contribution.
		contribution: (row) => {
			if (row.type === 'asset') return null
			if (row.type === 'debt') {
				const payment = debtPayment(row)
				return payment === null ? null : normalizedOrNull(payment.amount, payment.frequency)
			}
			return normalizedOrNull(row.monthlyContribution, row.frequency)
		},
	}
}
