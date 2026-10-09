/** The output is only a suggestion for the desired-income field; it must never feed the nest-egg base of the solve. */

import { calculateTotalMonthlyNormalized } from '@budget-planner/core/finance/normalization'
import { isReadableRow, toNormalizableItems } from './readable-rows'

export type EndingExpenseRow = {
	amount: number
	frequency: string
	endsBeforeRetirement?: boolean
}

export type EndingExpensesSummary =
	| { state: 'none' }
	/** Refuses rather than disclosing and continuing: a wrong suggestion is worse than none. */
	| { state: 'unreadable' }
	| {
			state: 'ok'
			totalMonthlyCents: number
			markedMonthlyCents: number
			remainingMonthlyCents: number
	  }

export function isMarked(row: EndingExpenseRow): boolean {
	// `=== true`: legacy rows lack the key, and localStorage may hold the truthy string "false".
	return row.endsBeforeRetirement === true
}

/** Normalizes through toNormalizableItems: its typeof check stops a string amount turning `+` into concatenation. */
export function summarizeEndingExpenses(rows: readonly unknown[]): EndingExpensesSummary {
	const marked = rows.filter(
		(row): row is EndingExpenseRow => isReadableRow(row) && isMarked(row as EndingExpenseRow)
	)
	const markedByPredicate = rows.filter(
		(row) =>
			typeof row === 'object' &&
			row !== null &&
			(row as EndingExpenseRow).endsBeforeRetirement === true
	)

	if (markedByPredicate.length === 0) {
		return { state: 'none' }
	}

	// Any unreadable row refuses the whole summary. Fractional cents (core rounds them away) and negatives
	// (localStorage bypasses DB checks) are refused too.
	if (
		rows.some((row) => !isReadableRow(row) || !Number.isSafeInteger(row.amount) || row.amount < 0)
	) {
		return { state: 'unreadable' }
	}

	const totalMonthlyCents = calculateTotalMonthlyNormalized(toNormalizableItems(rows))
	const markedMonthlyCents = calculateTotalMonthlyNormalized(toNormalizableItems(marked))

	// Bound the annual form: the consumer multiplies by 12 by default, and toAnnualIncomeCents throws past the safe range.
	const unsafe = (cents: number): boolean =>
		!Number.isSafeInteger(cents) || !Number.isSafeInteger(cents * 12)
	if (unsafe(totalMonthlyCents) || unsafe(markedMonthlyCents)) {
		return { state: 'unreadable' }
	}

	// Unreachable (amounts are non-negative and marked ⊆ rows); a cheap invariant, deliberately untested.
	const remainingMonthlyCents = Math.max(0, totalMonthlyCents - markedMonthlyCents)

	return { state: 'ok', totalMonthlyCents, markedMonthlyCents, remainingMonthlyCents }
}
