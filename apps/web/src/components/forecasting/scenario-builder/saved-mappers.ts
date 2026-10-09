import {
	DEFAULT_INVESTMENT_RETURN,
	type ForecastingScenario,
} from '@budget-planner/core/finance/forecasting'
import type { NormalizableFinancialItem } from '@budget-planner/core/finance/normalization'
import { isKnownFrequency } from '../../../lib/readable-rows'
import type { ScenarioInputs } from '../saved-forecast'
import { balanceRowType, nonNegativeCents } from './row-coercion'
import type {
	LocalAssetAccount,
	LocalBalanceAccount,
	LocalFinancialItem,
	LocalSavingsAccount,
	OneTimeEvent,
} from './types'

// JSON has no NaN, so an emptied rate comes back null; load it as 0.
// An out-of-range finite rate is kept so the field can flag it (refuse, not clamp).
export function growthRateFromSaved(rate: unknown): number {
	return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0
}

// Absent, null or non-finite reloads at the default; an out-of-range finite rate is kept and flagged.
function annualReturnFromSaved(rate: unknown): number {
	return typeof rate === 'number' && Number.isFinite(rate) ? rate : DEFAULT_INVESTMENT_RETURN
}

export function itemsFromSaved(
	items: (NormalizableFinancialItem & { name?: string })[] | undefined,
	prefix: string
): LocalFinancialItem[] {
	if (!items || items.length === 0) return []
	return items.map((item, index) => ({
		...item,
		id: `${prefix}-loaded-${index}`,
		// Coerce defensively so a corrupt saved item can't seed NaN or an uncontrolled input.
		name: item.name ?? '',
		amount: Number.isFinite(item.amount) ? item.amount : 0,
		frequency: item.frequency ?? 'monthly',
	}))
}

// A v1 forecast has only a savings total, reloaded as one Savings row (none when 0).
export function savingsFromSaved(inputs: ScenarioInputs | undefined): LocalSavingsAccount[] {
	// Defensive: this is the builder's boundary, so a caller skipping the route can't crash it.
	const saved: unknown = inputs?.savingsAccounts
	if (Array.isArray(saved)) {
		return saved.map((entry: unknown, index) => {
			const account =
				typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
			return {
				id: `savings-loaded-${index}`,
				name: typeof account['name'] === 'string' ? account['name'] : '',
				balance: nonNegativeCents(account['balance']),
				monthlyContribution: nonNegativeCents(account['monthlyContribution']),
			}
		})
	}
	// A negative v1 total is kept, not clamped: its field flags it and holds Save until fixed.
	if (inputs && Number.isFinite(inputs.savings) && inputs.savings !== 0) {
		return [
			{ id: 'savings-loaded-0', name: 'Savings', balance: inputs.savings, monthlyContribution: 0 },
		]
	}
	return []
}

// Older versions reload their investments total as one row. Pre-v5 debts reload flagged, since their payment
// is still among the saved expenses. A debt's saved rate is ignored.
export function balanceFromSaved(
	inputs: ScenarioInputs | undefined,
	version: unknown
): LocalBalanceAccount[] {
	const legacyDebts = !(typeof version === 'number' && version >= 5)
	const saved: unknown = inputs?.balanceAccounts
	if (Array.isArray(saved)) {
		const rows: LocalBalanceAccount[] = []
		for (const entry of saved as unknown[]) {
			const account =
				typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
			const type = balanceRowType(account['type'])
			if (type === null) continue
			const frequency = account['frequency']
			const paidBy = account['paidByExpenseName']
			const flagged =
				(type === 'debt' && legacyDebts) || account['contributionRecordedAsExpense'] === true
			// A labelled debt row never shows its flag, so a flagged row drops the label instead of hiding a ticked box.
			const paidByName =
				type === 'debt' && !flagged && typeof paidBy === 'string' ? paidBy.trim() : ''
			rows.push({
				id: `balance-loaded-${rows.length}`,
				name: typeof account['name'] === 'string' ? account['name'] : '',
				type,
				balance: nonNegativeCents(account['balance']),
				contribution: nonNegativeCents(account['contribution']),
				frequency: isKnownFrequency(frequency) ? frequency : 'monthly',
				contributionRecordedAsExpense: flagged,
				annualReturn:
					type === 'investment'
						? annualReturnFromSaved(account['annualReturn'])
						: DEFAULT_INVESTMENT_RETURN,
				...(paidByName !== '' ? { paidByExpenseName: paidByName } : {}),
			})
		}
		return rows
	}
	if (inputs && Number.isFinite(inputs.investments) && inputs.investments !== 0) {
		return [
			{
				id: 'balance-loaded-0',
				name: 'Investments',
				type: 'investment',
				balance: inputs.investments,
				contribution: 0,
				frequency: 'monthly',
				contributionRecordedAsExpense: false,
				// Older forecasts saved no rate and reopen at 6%, not the 7% they were computed at (accepted).
				annualReturn: DEFAULT_INVESTMENT_RETURN,
			},
		]
	}
	return []
}

// Pre-v6 forecasts have no assetAccounts. Defensive: bad entries become blank rows at 0.
export function assetsFromSaved(inputs: ScenarioInputs | undefined): LocalAssetAccount[] {
	const saved: unknown = inputs?.assetAccounts
	if (!Array.isArray(saved)) return []
	return saved.map((entry: unknown, index) => {
		const account =
			typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
		return {
			id: `asset-loaded-${index}`,
			name: typeof account['name'] === 'string' ? account['name'] : '',
			balance: nonNegativeCents(account['balance']),
		}
	})
}

// Saved events may carry a name the type omits; default it when absent.
export function eventsFromSaved(events: ForecastingScenario['oneTimeEvents']): OneTimeEvent[] {
	if (!events || events.length === 0) return []
	return events.map((event, index) => ({
		id: `event-loaded-${index}`,
		year: event.year,
		// JSON turns non-finite into null, which the engine refuses; coerce so older forecasts still open.
		amount: Number.isFinite(event.amount) ? Math.round(event.amount) : 0,
		name: (event as { name?: string }).name ?? 'One-time event',
	}))
}
