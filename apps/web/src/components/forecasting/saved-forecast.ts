import {
	DEFAULT_FORECAST_YEARS,
	type ForecastingResult,
	type ForecastingScenario,
	isValidForecastYears,
} from '@budget-planner/core/finance/forecasting'
import type { Frequency } from '@budget-planner/core/finance/normalization'
import type { ForecastWire } from '../../lib/forecasting/forecast-api'
import { isKnownFrequency } from '../../lib/readable-rows'

/** Money in cents. */
type SavedSavingsAccount = {
	name: string
	balance: number
	monthlyContribution: number
}

/** Money in cents; `balance` is a positive magnitude for both types. */
type SavedBalanceAccount = {
	name: string
	type: 'investment' | 'debt'
	balance: number
	contribution: number
	frequency: Frequency
	/** Legacy (pre-v5) debts were saved `false`; the builder reloads those flagged, by `version`. */
	contributionRecordedAsExpense: boolean
	annualReturn?: number
	paidByExpenseName?: string
}

/** Money in cents. */
type SavedAssetAccount = {
	name: string
	balance: number
}

/**
 * `savings`/`investments` are still written as the rows' sums so older cached clients reopen
 * at the right start; on load the rows win when they disagree.
 */
export type ScenarioInputs = {
	savings: number
	investments: number
	years: number
	savingsAccounts?: SavedSavingsAccount[]
	balanceAccounts?: SavedBalanceAccount[]
	assetAccounts?: SavedAssetAccount[]
}

export type SavedForecast = {
	id: string
	name: string
	description?: string
	scenario: ForecastingScenario
	result: ForecastingResult
	inputs?: ScenarioInputs
	version?: number
	createdAt: string
	updatedAt: string
}

/** Coerced like the builder's `itemsFromSaved`; `unknown` because a client wrote the JSON. */
function savedSavingsAccount(entry: unknown): SavedSavingsAccount {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const money = (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		balance: money(record['balance']),
		monthlyContribution: money(record['monthlyContribution']),
	}
}

/**
 * Returns null for a row that is neither investment nor debt: its sign is unknowable.
 * The legacy debt-flag rule needs `version`, so the builder applies it, not this.
 */
function savedBalanceAccount(entry: unknown): SavedBalanceAccount | null {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const type = record['type']
	if (type !== 'investment' && type !== 'debt') return null
	const money = (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
	const frequency = record['frequency']
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		type,
		balance: money(record['balance']),
		contribution: money(record['contribution']),
		frequency: isKnownFrequency(frequency) ? frequency : 'monthly',
		contributionRecordedAsExpense: record['contributionRecordedAsExpense'] === true,
		...(type === 'debt' &&
		typeof record['paidByExpenseName'] === 'string' &&
		record['paidByExpenseName'].trim() !== ''
			? { paidByExpenseName: record['paidByExpenseName'].trim() }
			: {}),
		...(type === 'investment' &&
		typeof record['annualReturn'] === 'number' &&
		Number.isFinite(record['annualReturn'])
			? { annualReturn: record['annualReturn'] }
			: {}),
	}
}

function savedAssetAccount(entry: unknown): SavedAssetAccount {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const balance = record['balance']
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		balance: typeof balance === 'number' && Number.isFinite(balance) && balance >= 0 ? balance : 0,
	}
}

export function mapToSavedForecast(profile: ForecastWire): SavedForecast | null {
	try {
		const parsed = JSON.parse(profile.scenarioData) as {
			scenario?: ForecastingScenario
			result?: ForecastingResult
			inputs?: Omit<ScenarioInputs, 'savingsAccounts' | 'balanceAccounts' | 'assetAccounts'> & {
				savingsAccounts?: unknown
				balanceAccounts?: unknown
				assetAccounts?: unknown
			}
		}
		if (!parsed?.scenario || !parsed?.result?.summary) {
			return null
		}
		// Only a bad `years` is replaced, never the whole `inputs`: dropping inputs would
		// re-baseline the reopened forecast to 0. Rows win when their sum disagrees with `savings`.
		const savedInputs = parsed.inputs
		const savingsAccounts = Array.isArray(savedInputs?.savingsAccounts)
			? savedInputs.savingsAccounts.map(savedSavingsAccount)
			: undefined
		const savings = savingsAccounts
			? savingsAccounts.reduce((sum, account) => sum + account.balance, 0)
			: savedInputs?.savings
		const balanceAccounts = Array.isArray(savedInputs?.balanceAccounts)
			? savedInputs.balanceAccounts
					.map(savedBalanceAccount)
					.filter((account): account is SavedBalanceAccount => account !== null)
			: undefined
		const investments = balanceAccounts
			? balanceAccounts.reduce(
					(sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
					0
				)
			: savedInputs?.investments
		const assetAccounts = Array.isArray(savedInputs?.assetAccounts)
			? savedInputs.assetAccounts.map(savedAssetAccount)
			: undefined
		const inputs: ScenarioInputs | undefined =
			savedInputs &&
			typeof savings === 'number' &&
			Number.isFinite(savings) &&
			typeof investments === 'number' &&
			Number.isFinite(investments)
				? {
						savings,
						investments,
						years: isValidForecastYears(savedInputs.years)
							? savedInputs.years
							: DEFAULT_FORECAST_YEARS,
						...(savingsAccounts ? { savingsAccounts } : {}),
						...(balanceAccounts ? { balanceAccounts } : {}),
						...(assetAccounts ? { assetAccounts } : {}),
					}
				: undefined
		return {
			id: String(profile.id),
			name: profile.name,
			description: profile.description ?? undefined,
			scenario: parsed.scenario,
			result: parsed.result,
			inputs,
			version: profile.version,
			// Re-serialising turns an unparseable date into a throw, so the row is skipped, not "Invalid Date".
			createdAt: new Date(profile.createdAt).toISOString(),
			updatedAt: new Date(profile.updatedAt).toISOString(),
		}
	} catch {
		return null
	}
}
