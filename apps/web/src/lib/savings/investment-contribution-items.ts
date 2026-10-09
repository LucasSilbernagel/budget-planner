import type { Frequency } from '@budget-planner/core/finance'
import { isKnownFrequency } from '../readable-rows'

export type InvestmentContributionItem = {
	id: string
	name: string
	amount: number
	frequency: Frequency
	recordedAsExpense: boolean
	unreadable: boolean
}

/** One mapping shared by /savings and the forecast seed, so seeded contributions match what /savings shows. */
export function investmentContributionItems(
	entries: readonly {
		id: string
		name: string
		monthlyContribution: number
		frequency: unknown
		contributionRecordedAsExpense?: boolean
	}[]
): InvestmentContributionItem[] {
	return entries.map((entry) => {
		// isFinite: NaN/±Infinity are numbers and null is NaN after JSON; core's normalizer throws on all of them.
		const unreadable = !Number.isFinite(entry.monthlyContribution)
		return {
			id: entry.id,
			name: entry.name,
			amount: unreadable ? 0 : entry.monthlyContribution,
			// A corrupt cadence degrades to monthly rather than throwing in the solver during render.
			frequency: isKnownFrequency(entry.frequency) ? entry.frequency : 'monthly',
			// `=== true`: a persisted "false" string would otherwise cancel a real deduction.
			recordedAsExpense: entry.contributionRecordedAsExpense === true,
			unreadable,
		}
	})
}
