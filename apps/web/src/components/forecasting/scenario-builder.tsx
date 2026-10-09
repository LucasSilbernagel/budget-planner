import {
	calculateFinancialForecast,
	DEFAULT_FORECAST_YEARS,
	DEFAULT_INVESTMENT_RETURN,
	type ForecastInputData,
	type ForecastingResult,
	type ForecastingScenario,
	isValidForecastYears,
	isValidGrowthRate,
	MAX_FORECAST_YEARS,
	MAX_GROWTH_RATE,
	MIN_FORECAST_YEARS,
	MIN_GROWTH_RATE,
} from '@budget-planner/core/finance/forecasting'
import type {
	Frequency,
	NormalizableFinancialItem,
} from '@budget-planner/core/finance/normalization'
import {
	normalizeToMonthly,
	roundingDriftToleranceCents,
} from '@budget-planner/core/finance/normalization'
import { solveAutomaticAllocations } from '@budget-planner/core/finance/savingsAllocation'
import {
	type CurrencyOptions,
	currencySymbol,
	formatForInputDisplay,
} from '@budget-planner/core/format/currency'
import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import {
	debtOwedCents,
	resolveDebtPaymentExpense,
} from '@budget-planner/core/services/balanceTracking'
import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'
import { Link } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CardHeader } from '@/components/ui/CardHeader'
import { CardTitle } from '@/components/ui/CardTitle'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { cn } from '@/lib/cn'
import { useIsInitialSyncPending } from '../../hooks/useIsInitialSyncPending'
import { useStoresHydrated } from '../../hooks/useStoresHydrated'
import { signedAmount, vsTodayCents, withTodayBaseline } from '../../lib/forecasting/today-baseline'
import { type MoneyDraft, parseMoneyDraft, reformatAmountOnBlur } from '../../lib/money-input'
import { exceedsMoneyLimit, moneyLimitMessage } from '../../lib/money-limit'
import { decimalCommaToPoint } from '../../lib/percent-text'
import { isKnownFrequency } from '../../lib/readable-rows'
import { sanitizeMoneyChange, sanitizeWithCaret } from '../../lib/sanitized-input'
import { investmentContributionItems } from '../../lib/savings/investment-contribution-items'
import type { SavedForecast, ScenarioInputs } from '../../routes/forecasting'
import { useBalanceEntries, useInvestmentEntries } from '../../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { useSavingsGoals } from '../../stores/savingsStore'
import { GroupedAmount } from '../ui/GroupedAmount'

const DEBOUNCE_DELAY_MS = 500

export type LocalFinancialItem = NormalizableFinancialItem & {
	id: string
	name: string
}

// Never written back to the savings store: the row is the scenario's own copy.
type LocalSavingsAccount = {
	id: string
	name: string
	balance: number
	monthlyContribution: number
}

// balance is a positive magnitude for both types; contribution is at frequency cadence (the engine normalises).
type LocalBalanceAccount = {
	id: string
	name: string
	type: 'investment' | 'debt'
	balance: number
	contribution: number
	frequency: Frequency
	// Already counted in Expenses, so the engine does not take it from cash again.
	contributionRecordedAsExpense: boolean
	annualReturn: number
	paidByExpenseName?: string
}

// A constant: no growth and no contribution.
type LocalAssetAccount = {
	id: string
	name: string
	balance: number
}

type OneTimeEvent = {
	id: string
	year: number
	amount: number // In cents
	name: string
}

export type ScenarioBuilderProps = {
	onSave: (data: {
		name: string
		description?: string
		scenario: ForecastingScenario
		result: ForecastingResult
		inputs: ScenarioInputs
	}) =>
		| { success: boolean; error?: string }
		| undefined
		| Promise<{ success: boolean; error?: string } | undefined>
	onResultChange?: (result: ForecastingResult | null) => void
	// Read once in state initializers; the parent remounts the builder via key when it changes.
	initialForecast?: SavedForecast | null
	// Defaults to ready deliberately: the none arm renders a <Link>, and most tests render without a router.
	saveAvailability?: SaveAvailability
	// Lets the page lock its tabs mid-save: a CSS-hidden builder would hide the failure alert.
	onSavingChange?: (isSaving: boolean) => void
}

// Separate arms because a bare null conflated not-yet-loaded, no profiles, expired session, denied and failed.
type SaveAvailability =
	| { kind: 'loading' }
	| { kind: 'ready' }
	| { kind: 'none' }
	| { kind: 'error' }

type ScenarioFormData = {
	name: string
	description: string
	incomeGrowthRate: number
	expenseGrowthRate: number
	years: number
}

// No demo rows: a user with nothing recorded gets an empty builder.
const DEFAULT_FORM = {
	name: 'My Financial Forecast',
	description: 'Projecting my financial situation over the next 10 years',
	// Zero: the builder invents no growth by default.
	incomeGrowthRate: 0,
	expenseGrowthRate: 0,
	years: DEFAULT_FORECAST_YEARS,
} satisfies ScenarioFormData

// NO_PROFILE and PROFILE_ERROR copy must stay distinct: a failed fetch does not mean "create a profile".
const NO_PROFILE_NOTICE =
	'Saving a forecast needs a financial profile, and this account does not have one yet.'
const NO_PROFILE_SHORT = 'Needs a financial profile'
const PROFILE_ERROR_NOTICE =
	'We could not check your financial profiles, so saving is unavailable right now. Reload the page to try again.'
const PROFILE_ERROR_SHORT = 'Profile check failed'
const FALLBACK_SAVE_ERROR = 'Failed to save forecast'

const YEARS_INVALID_MESSAGE = `Enter a whole number of years from ${MIN_FORECAST_YEARS} to ${MAX_FORECAST_YEARS}.`
const YEARS_INVALID_SHORT = 'Fix the projection period to save'

const GROWTH_INVALID_MESSAGE = `Enter a growth rate from ${MIN_GROWTH_RATE * 100}% to ${
	MAX_GROWTH_RATE * 100
}%.`
const RETURN_INVALID_MESSAGE = `Enter an annual return from ${MIN_GROWTH_RATE * 100}% to ${
	MAX_GROWTH_RATE * 100
}%.`
const AMOUNT_NEGATIVE_MESSAGE = 'Enter an amount of 0 or more.'
const FIELDS_INVALID_SHORT = 'Fix the highlighted fields to save'

const SAVINGS_WHAT_IF_NOTE = "What-if only: changes here don't change your Savings page."
const NO_SAVINGS_ACCOUNTS = 'No savings accounts in this scenario'

const BALANCE_WHAT_IF_NOTE =
	"What-if only: changes here don't change your Balance Tracking page. Debts count against your starting net worth."
const NO_BALANCE_ACCOUNTS = 'No investments or debts in this scenario'
export const ASSET_WHAT_IF_NOTE =
	"What-if only: changes here don't change your Balance Tracking page. An asset keeps the value you enter every year."
export const NO_ASSET_ACCOUNTS = 'No assets in this scenario'
const NOT_FROM_LEFT_OVER_LABEL = 'Not taken from the money left over'
const PAYMENT_IN_EXPENSES_LABEL = 'Payment already in Expenses'
const BALANCE_TYPE_OPTIONS = [
	{ value: 'investment' as const, label: 'Investment' },
	{ value: 'debt' as const, label: 'Debt' },
]

function yearsLabel(years: number): string {
	return `${years} ${years === 1 ? 'year' : 'years'}`
}

// JSON has no NaN, so an emptied rate comes back null; load it as 0.
// An out-of-range finite rate is kept so the field can flag it (refuse, not clamp).
function growthRateFromSaved(rate: unknown): number {
	return typeof rate === 'number' && Number.isFinite(rate) ? rate : 0
}

// Absent, null or non-finite reloads at the default; an out-of-range finite rate is kept and flagged.
function annualReturnFromSaved(rate: unknown): number {
	return typeof rate === 'number' && Number.isFinite(rate) ? rate : DEFAULT_INVESTMENT_RETURN
}

const FREQUENCY_OPTIONS = [
	{ value: 'weekly' as const, label: 'Weekly' },
	{ value: 'biweekly' as const, label: 'Biweekly' },
	{ value: 'monthly' as const, label: 'Monthly' },
	{ value: 'annually' as const, label: 'Annually' },
]

function generateId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function toNormalizableItems(items: LocalFinancialItem[]): NormalizableFinancialItem[] {
	return items.map(({ id: _id, ...rest }) => rest)
}

function formatPercentage(value: string | number): string {
	return `${(Number(value) * 100).toFixed(2)}%`
}

// Sorted only on load, never on edit: a live re-sort would move the row being typed in.
// Stable, and a corrupt frequency ranks as 0 instead of throwing.
function sortByMonthlyDesc(items: LocalFinancialItem[]): LocalFinancialItem[] {
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

function itemsFromSaved(
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

// Same coercion as core's sumManualAllocations, so a manual row seeds exactly what /savings counts.
function nonNegativeCents(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
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

// A v1 forecast has only a savings total, reloaded as one Savings row (none when 0).
function savingsFromSaved(inputs: ScenarioInputs | undefined): LocalSavingsAccount[] {
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

// Assets have their own rows, so they map to null too.
function balanceRowType(type: unknown): LocalBalanceAccount['type'] | null {
	return type === 'investment' || type === 'debt' ? type : null
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

export type ForecastRows = {
	incomeItems: LocalFinancialItem[]
	expenseItems: LocalFinancialItem[]
	savingsAccounts: LocalSavingsAccount[]
	balanceAccounts: LocalBalanceAccount[]
	assetAccounts: LocalAssetAccount[]
}

// Totals are the rows' sums, so they can't disagree (the engine refuses a mismatch).
// One conversion for scenario and today's data, so an unedited scenario equals the baseline.
function forecastInputFromRows(rows: ForecastRows): ForecastInputData {
	return {
		income: toNormalizableItems(rows.incomeItems),
		expenses: toNormalizableItems(rows.expenseItems),
		savings: rows.savingsAccounts.reduce((sum, account) => sum + account.balance, 0),
		investments: rows.balanceAccounts.reduce(
			(sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
			0
		),
		savingsAccounts: rows.savingsAccounts.map(({ balance, monthlyContribution }) => ({
			balance,
			monthlyContribution,
		})),
		balanceAccounts: rows.balanceAccounts.map(
			({
				type,
				balance,
				contribution,
				frequency,
				contributionRecordedAsExpense,
				annualReturn,
			}) => ({
				type,
				balance,
				contribution,
				frequency,
				contributionRecordedAsExpense,
				...(type === 'investment' ? { annualReturn } : {}),
			})
		),
		assets: rows.assetAccounts.reduce((sum, account) => sum + account.balance, 0),
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

// ready waits for store hydration (zustand reports the empty server snapshot while hydrating) and, on a
// fresh device, for the first sync pull; otherwise the seed and baseline would be zeros.
export function useCurrentForecastData(): {
	ready: boolean
	rows: (ForecastRows & { unfilteredExpenseItems: LocalFinancialItem[] }) | null
	data: ForecastInputData | null
} {
	const storesHydrated = useStoresHydrated()
	const storeIncome = useIncomeSources()
	const storeExpenses = useExpenses()
	const storeSavingsGoals = useSavingsGoals()
	const storeBalanceEntries = useBalanceEntries()
	const storeBalanceRowCount = useMemo(
		() =>
			storeBalanceEntries.filter(
				(entry) => balanceRowType(entry.type) !== null || entry.type === 'asset'
			).length,
		[storeBalanceEntries]
	)
	const storeInvestmentEntries = useInvestmentEntries()
	const storeContributionItems = useMemo(
		() => investmentContributionItems(storeInvestmentEntries),
		[storeInvestmentEntries]
	)
	const nothingToSeed =
		storeIncome.length === 0 &&
		storeExpenses.length === 0 &&
		// Rows, not the total: a goal with a 0 balance still seeds a row.
		storeSavingsGoals.length === 0 &&
		// Rows again: a debt-only user, an investment at 0 or an asset-only user still seeds.
		storeBalanceRowCount === 0
	const isInitialSyncPending = useIsInitialSyncPending(nothingToSeed)
	const ready = storesHydrated && !isInitialSyncPending

	const rows = useMemo(
		() =>
			ready
				? rowsFromStores({
						income: storeIncome,
						expenses: storeExpenses,
						savingsGoals: storeSavingsGoals,
						balanceEntries: storeBalanceEntries,
						contributionItems: storeContributionItems,
					})
				: null,
		[
			ready,
			storeIncome,
			storeExpenses,
			storeSavingsGoals,
			storeBalanceEntries,
			storeContributionItems,
		]
	)
	const data = useMemo(() => (rows ? forecastInputFromRows(rows) : null), [rows])
	return { ready, rows, data }
}

// Older versions reload their investments total as one row. Pre-v5 debts reload flagged, since their payment
// is still among the saved expenses. A debt's saved rate is ignored.
function balanceFromSaved(
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
function assetsFromSaved(inputs: ScenarioInputs | undefined): LocalAssetAccount[] {
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
function eventsFromSaved(events: ForecastingScenario['oneTimeEvents']): OneTimeEvent[] {
	if (!events || events.length === 0) return []
	return events.map((event, index) => ({
		id: `event-loaded-${index}`,
		year: event.year,
		// JSON turns non-finite into null, which the engine refuses; coerce so older forecasts still open.
		amount: Number.isFinite(event.amount) ? Math.round(event.amount) : 0,
		name: (event as { name?: string }).name ?? 'One-time event',
	}))
}

export function ScenarioBuilder({
	onSave,
	onResultChange,
	initialForecast,
	saveAvailability = { kind: 'ready' },
	onSavingChange,
}: ScenarioBuilderProps): React.ReactElement {
	const formatCurrency = useFormattedAmount()
	// Lazy initializers run once per load: the parent remounts this component via key.
	const [incomeItems, setIncomeItems] = useState<LocalFinancialItem[]>(() =>
		initialForecast ? itemsFromSaved(initialForecast.scenario.newIncome, 'income') : []
	)
	const [expenseItems, setExpenseItems] = useState<LocalFinancialItem[]>(() =>
		initialForecast
			? sortByMonthlyDesc(itemsFromSaved(initialForecast.scenario.newExpenses, 'expense'))
			: []
	)

	const [formData, setFormData] = useState<ScenarioFormData>(() =>
		initialForecast
			? {
					name: initialForecast.scenario.name,
					description: initialForecast.scenario.description ?? '',
					incomeGrowthRate: growthRateFromSaved(initialForecast.scenario.incomeGrowthRate),
					expenseGrowthRate: growthRateFromSaved(initialForecast.scenario.expenseGrowthRate),
					years: initialForecast.inputs?.years ?? DEFAULT_FORM.years,
				}
			: DEFAULT_FORM
	)
	// The last period the engine accepts; formData.years keeps what the user typed so they can fix it.
	const [lastValidYears, setLastValidYears] = useState<number>(() =>
		isValidForecastYears(formData.years) ? formData.years : DEFAULT_FORM.years
	)
	const yearsValid = isValidForecastYears(formData.years)
	// The growth fields keep the typed text; validation uses the parsed value.
	const incomeGrowthValid = isValidGrowthRate(formData.incomeGrowthRate)
	const expenseGrowthValid = isValidGrowthRate(formData.expenseGrowthRate)

	// Fields holding a value not written to state. Rows report synchronously from their change handlers,
	// so the debounced recompute never runs with a bad value it cannot see.
	const [invalidAmountRows, setInvalidAmountRows] = useState<ReadonlySet<string>>(() => new Set())
	const setAmountRowValidity = useCallback((rowId: string, valid: boolean) => {
		setInvalidAmountRows((prev) => {
			if (valid !== prev.has(rowId)) return prev
			const next = new Set(prev)
			if (valid) next.delete(rowId)
			else next.add(rowId)
			return next
		})
	}, [])
	const otherFieldInvalid = !incomeGrowthValid || !expenseGrowthValid || invalidAmountRows.size > 0

	// Empty/0 is the pre-seed value, and final for a loaded forecast without saved inputs:
	// reading the live stores there would silently re-baseline an old forecast.
	const [savingsAccounts, setSavingsAccounts] = useState<LocalSavingsAccount[]>(() =>
		initialForecast ? savingsFromSaved(initialForecast.inputs) : []
	)
	// Derived, never stored, so the total and the rows cannot disagree.
	const savings = useMemo(
		() => savingsAccounts.reduce((sum, account) => sum + account.balance, 0),
		[savingsAccounts]
	)
	const [balanceAccounts, setBalanceAccounts] = useState<LocalBalanceAccount[]>(() =>
		initialForecast ? balanceFromSaved(initialForecast.inputs, initialForecast.version) : []
	)
	const investments = useMemo(
		() =>
			balanceAccounts.reduce(
				(sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
				0
			),
		[balanceAccounts]
	)
	const [assetAccounts, setAssetAccounts] = useState<LocalAssetAccount[]>(() =>
		initialForecast ? assetsFromSaved(initialForecast.inputs) : []
	)
	const [oneTimeEvents, setOneTimeEvents] = useState<OneTimeEvent[]>(() =>
		initialForecast ? eventsFromSaved(initialForecast.scenario.oneTimeEvents) : []
	)

	// An effect, not a lazy initializer: while hydrating the stores report the empty server snapshot, and a
	// one-shot initializer would keep it. hasSeeded starts true for a loaded forecast so it is never re-baselined.
	const today = useCurrentForecastData()
	const readyToSeed = today.ready

	const [hasSeeded, setHasSeeded] = useState<boolean>(() => Boolean(initialForecast))
	// The seed can land seconds after hydration on a fresh device; anything the user edited by then must survive it.
	const incomeRowsTouched = useRef(false)
	const expenseRowsTouched = useRef(false)
	const savingsRowsTouched = useRef(false)
	const balanceRowsTouched = useRef(false)
	const assetRowsTouched = useRef(false)

	useEffect(() => {
		const seeded = today.rows
		if (hasSeeded || !readyToSeed || !seeded) return
		if (!incomeRowsTouched.current) setIncomeItems(seeded.incomeItems)
		// A linked expense leaves the Expenses rows only when balance rows are seeded in this same pass,
		// or the payment would vanish.
		if (!balanceRowsTouched.current) setBalanceAccounts(seeded.balanceAccounts)
		if (!expenseRowsTouched.current) {
			setExpenseItems(
				balanceRowsTouched.current ? seeded.unfilteredExpenseItems : seeded.expenseItems
			)
		}
		if (!savingsRowsTouched.current) setSavingsAccounts(seeded.savingsAccounts)
		if (!assetRowsTouched.current) setAssetAccounts(seeded.assetAccounts)
		setHasSeeded(true)
	}, [hasSeeded, readyToSeed, today.rows])

	// Shown with today's baseline, not the stored one, which stays empty until today's data is ready.
	// The result must still show: Save lives in the summary.
	const [result, setResult] = useState<ForecastingResult | null>(() =>
		initialForecast?.result
			? (withTodayBaseline(initialForecast.result, today.data) ?? {
					...initialForecast.result,
					baseline: [],
				})
			: null
	)
	// Lifted too: a forecast with a field flagged on load never recomputes, so Projections would stay empty.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on today's data alone — `result` is read only to find the placeholder, and re-running on every recompute would be wasted work (a recomputed baseline is never empty).
	useEffect(() => {
		if (!today.data || !result || result.baseline.length > 0) return
		const filled = withTodayBaseline(result, today.data)
		if (!filled) return
		setResult(filled)
		onResultChangeRef.current?.(filled)
	}, [today.data])
	// The engine reports per-row balances by index; mapping back by id stops a stale row showing another's figure.
	// A loaded forecast whose saved result covers its rows starts mapped, so per-row lines show immediately.
	const [resultSavingsRowIds, setResultSavingsRowIds] = useState<readonly string[]>(() => {
		if (!initialForecast) return []
		const rows = savingsFromSaved(initialForecast.inputs)
		const saved = initialForecast.result?.projection?.at(-1)?.savingsAccounts
		return Array.isArray(saved) && saved.length === rows.length ? rows.map((row) => row.id) : []
	})
	const [resultBalanceRowIds, setResultBalanceRowIds] = useState<readonly string[]>(() => {
		if (!initialForecast) return []
		const rows = balanceFromSaved(initialForecast.inputs, initialForecast.version)
		const saved = initialForecast.result?.projection?.at(-1)?.balanceAccounts
		return Array.isArray(saved) && saved.length === rows.length ? rows.map((row) => row.id) : []
	})
	const [isCalculating, setIsCalculating] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	// Separate from error, which every debounced recompute clears. Failures only: a successful save switches
	// tabs, which CSS-hides this component.
	const [saveOutcome, setSaveOutcome] = useState<string | null>(null)
	const saveOutcomeRef = useRef<HTMLDivElement>(null)
	const savingsHeadingId = useId()
	const balanceHeadingId = useId()
	const assetHeadingId = useId()
	const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// role=alert announces on insertion only, so handleSave clears saveOutcome before each attempt to remount it.
	// Focus lands just before Save, so one Tab returns to retry.
	useEffect(() => {
		if (saveOutcome) {
			saveOutcomeRef.current?.focus()
		}
	}, [saveOutcome])

	// A change of availability retires any outcome, or a stale "try again" sits beside a disabled button.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed deliberately on the arm alone — re-running when `saveOutcome` changes would erase the outcome the moment it is set.
	useEffect(() => {
		setSaveOutcome(null)
	}, [saveAvailability.kind])

	// loading does not block: the window is brief, and the page's save guard still refuses accurately.
	// Invalid fields block too: the on-screen result is the last valid one, so it would not match the saved inputs.
	const saveBlockedReason =
		saveAvailability.kind === 'none'
			? NO_PROFILE_SHORT
			: saveAvailability.kind === 'error'
				? PROFILE_ERROR_SHORT
				: otherFieldInvalid
					? FIELDS_INVALID_SHORT
					: !yearsValid
						? YEARS_INVALID_SHORT
						: null

	// A ref, so a non-memoized callback doesn't change calculateForecast's identity.
	const onResultChangeRef = useRef(onResultChange)
	useEffect(() => {
		onResultChangeRef.current = onResultChange
	}, [onResultChange])

	// biome-ignore lint/correctness/useExhaustiveDependencies: these are exactly the inputs the debounced calculateForecast (declared below) depends on; depending on calculateForecast itself would reference it before initialization (TDZ).
	useEffect(() => {
		if (debounceTimer.current) {
			clearTimeout(debounceTimer.current)
		}

		debounceTimer.current = setTimeout(() => {
			calculateForecast()
		}, DEBOUNCE_DELAY_MS)

		return () => {
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current)
			}
		}
	}, [
		incomeItems,
		expenseItems,
		formData,
		savingsAccounts,
		balanceAccounts,
		assetAccounts,
		oneTimeEvents,
		invalidAmountRows,
		// The baseline is today, so a store change recomputes.
		today.data,
	])

	const calculateForecast = useCallback(async () => {
		// An invalid field never reaches the engine: the last valid result stays and the field says why.
		// A stale calculation error is cleared; saveOutcome is left alone.
		if (
			!isValidForecastYears(formData.years) ||
			!isValidGrowthRate(formData.incomeGrowthRate) ||
			!isValidGrowthRate(formData.expenseGrowthRate) ||
			invalidAmountRows.size > 0
		) {
			setError(null)
			return
		}
		// No baseline until today's data is ready, or the scenario is compared against zeros.
		const baselineData = today.data
		if (!baselineData) return
		setIsCalculating(true)
		setError(null)
		// A recompute retires the previous save outcome so it never sits beside a fresh calculation error.
		setSaveOutcome(null)

		try {
			const scenario: ForecastingScenario = {
				name: formData.name,
				description: formData.description || undefined,
				incomeGrowthRate: formData.incomeGrowthRate,
				expenseGrowthRate: formData.expenseGrowthRate,
				newIncome: toNormalizableItems(incomeItems),
				newExpenses: toNormalizableItems(expenseItems),
				oneTimeEvents: oneTimeEvents.map(({ id: _id, ...rest }) => rest),
			}

			const currentData = forecastInputFromRows({
				incomeItems,
				expenseItems,
				savingsAccounts,
				balanceAccounts,
				assetAccounts,
			})

			const newResult = calculateFinancialForecast(
				currentData,
				scenario,
				formData.years,
				baselineData
			)
			setResult(newResult)
			setResultSavingsRowIds(savingsAccounts.map((account) => account.id))
			setResultBalanceRowIds(balanceAccounts.map((account) => account.id))
			// Keep the last good result on error rather than blanking the chart.
			onResultChangeRef.current?.(newResult)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to calculate forecast')
		} finally {
			setIsCalculating(false)
		}
	}, [
		incomeItems,
		expenseItems,
		formData,
		savingsAccounts,
		balanceAccounts,
		assetAccounts,
		oneTimeEvents,
		invalidAmountRows,
		today.data,
	])

	const handleFormChange = useCallback((field: keyof ScenarioFormData, value: string | number) => {
		setFormData((prev) => ({
			...prev,
			[field]: typeof value === 'string' ? value : value,
		}))
	}, [])

	const handleYearsChange = useCallback(
		(value: string | number) => {
			const years = Number(value)
			handleFormChange('years', years)
			if (isValidForecastYears(years)) setLastValidYears(years)
		},
		[handleFormChange]
	)

	// These record that the user changed the list, so the store seed leaves it alone.
	const editIncomeItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>> = useCallback(
		(update) => {
			incomeRowsTouched.current = true
			setIncomeItems(update)
		},
		[]
	)
	const editExpenseItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>> = useCallback(
		(update) => {
			expenseRowsTouched.current = true
			setExpenseItems(update)
		},
		[]
	)

	const addIncomeItem = useCallback(() => {
		editIncomeItems((prev) => [
			...prev,
			{
				id: generateId('income'),
				name: 'New Income',
				amount: 0,
				frequency: 'monthly',
			},
		])
	}, [editIncomeItems])

	const addExpenseItem = useCallback(() => {
		editExpenseItems((prev) => [
			...prev,
			{
				id: generateId('expense'),
				name: 'New Expense',
				amount: 0,
				frequency: 'monthly',
			},
		])
	}, [editExpenseItems])

	const updateFinancialItem = useCallback(
		(
			_items: LocalFinancialItem[],
			setItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>>,
			id: string,
			field: keyof LocalFinancialItem,
			value: string | number
		) => {
			setItems((prev) =>
				prev.map((item) =>
					item.id === id
						? {
								...item,
								[field]: typeof value === 'string' ? value : value,
							}
						: item
				)
			)
		},
		[]
	)

	const deleteFinancialItem = useCallback(
		(
			items: LocalFinancialItem[],
			setItems: React.Dispatch<React.SetStateAction<LocalFinancialItem[]>>,
			id: string
		) => {
			if (items.length <= 1) {
				setError('At least one item is required')
				return
			}
			setItems((prev) => prev.filter((item) => item.id !== id))
		},
		[]
	)

	// None of these touch the savings store: the rows are what-if only.
	const editSavingsAccounts: React.Dispatch<React.SetStateAction<LocalSavingsAccount[]>> =
		useCallback((update) => {
			savingsRowsTouched.current = true
			setSavingsAccounts(update)
		}, [])

	const addSavingsAccount = useCallback(() => {
		editSavingsAccounts((prev) => [
			...prev,
			{ id: generateId('savings'), name: 'New Account', balance: 0, monthlyContribution: 0 },
		])
	}, [editSavingsAccounts])

	const updateSavingsAccount = useCallback(
		(id: string, field: 'name' | 'balance' | 'monthlyContribution', value: string | number) => {
			editSavingsAccounts((prev) =>
				prev.map((account) => (account.id === id ? { ...account, [field]: value } : account))
			)
		},
		[editSavingsAccounts]
	)

	// No at-least-one rule: a scenario with no savings accounts is legitimate.
	const deleteSavingsAccount = useCallback(
		(id: string) => {
			editSavingsAccounts((prev) => prev.filter((account) => account.id !== id))
		},
		[editSavingsAccounts]
	)

	const editBalanceAccounts: React.Dispatch<React.SetStateAction<LocalBalanceAccount[]>> =
		useCallback((update) => {
			balanceRowsTouched.current = true
			setBalanceAccounts(update)
		}, [])

	const addBalanceAccount = useCallback(() => {
		editBalanceAccounts((prev) => [
			...prev,
			{
				id: generateId('balance'),
				name: 'New Investment',
				type: 'investment',
				balance: 0,
				contribution: 0,
				frequency: 'monthly',
				contributionRecordedAsExpense: false,
				annualReturn: DEFAULT_INVESTMENT_RETURN,
			},
		])
	}, [editBalanceAccounts])

	const updateBalanceAccount = useCallback(
		<K extends Exclude<keyof LocalBalanceAccount, 'id'>>(
			id: string,
			field: K,
			value: LocalBalanceAccount[K]
		) => {
			editBalanceAccounts((prev) =>
				prev.map((account) => {
					if (account.id !== id) return account
					const next = { ...account, [field]: value }
					// Any type change clears the flag: "already in Expenses" means something different per type.
					// The annual return and paidByExpenseName are kept, hidden.
					if (next.type !== account.type) next.contributionRecordedAsExpense = false
					return next
				})
			)
		},
		[editBalanceAccounts]
	)

	const deleteBalanceAccount = useCallback(
		(id: string) => {
			editBalanceAccounts((prev) => prev.filter((account) => account.id !== id))
		},
		[editBalanceAccounts]
	)

	const editAssetAccounts: React.Dispatch<React.SetStateAction<LocalAssetAccount[]>> = useCallback(
		(update) => {
			assetRowsTouched.current = true
			setAssetAccounts(update)
		},
		[]
	)

	const addAssetAccount = useCallback(() => {
		editAssetAccounts((prev) => [
			...prev,
			{ id: generateId('asset'), name: 'New Asset', balance: 0 },
		])
	}, [editAssetAccounts])

	const updateAssetAccount = useCallback(
		(id: string, field: 'name' | 'balance', value: string | number) => {
			editAssetAccounts((prev) =>
				prev.map((account) => (account.id === id ? { ...account, [field]: value } : account))
			)
		},
		[editAssetAccounts]
	)

	const deleteAssetAccount = useCallback(
		(id: string) => {
			editAssetAccounts((prev) => prev.filter((account) => account.id !== id))
		},
		[editAssetAccounts]
	)

	const addOneTimeEvent = useCallback(() => {
		setOneTimeEvents((prev) => [
			...prev,
			{
				id: generateId('event'),
				year: 1,
				amount: 0,
				name: 'One-time Event',
			},
		])
	}, [])

	const updateOneTimeEvent = useCallback(
		(id: string, field: keyof OneTimeEvent, value: string | number) => {
			setOneTimeEvents((prev) =>
				prev.map((event) =>
					event.id === id
						? {
								...event,
								[field]: typeof value === 'string' ? value : value,
							}
						: event
				)
			)
		},
		[]
	)

	const deleteOneTimeEvent = useCallback((id: string) => {
		setOneTimeEvents((prev) => prev.filter((event) => event.id !== id))
	}, [])

	const handleSave = useCallback(async () => {
		if (!result) {
			setError('No forecast calculated yet')
			return
		}
		// Guard against double-submit: a second concurrent save would race the
		// first and spuriously trip the unique-name constraint.
		if (isSaving) {
			return
		}
		// Belt and braces: the button is already disabled in this state.
		if (saveBlockedReason) {
			return
		}

		const scenario: ForecastingScenario = {
			name: formData.name,
			description: formData.description || undefined,
			incomeGrowthRate: formData.incomeGrowthRate,
			expenseGrowthRate: formData.expenseGrowthRate,
		}

		if (incomeItems.length > 0) {
			scenario.newIncome = toNormalizableItems(incomeItems)
		}
		if (expenseItems.length > 0) {
			scenario.newExpenses = toNormalizableItems(expenseItems)
		}
		if (oneTimeEvents.length > 0) {
			scenario.oneTimeEvents = oneTimeEvents.map(({ id: _id, ...rest }) => rest)
		}

		// Clear before the attempt, so a retry failing with the same message remounts the alert and re-announces.
		setSaveOutcome(null)
		setIsSaving(true)
		onSavingChange?.(true)
		try {
			const saveResult = await onSave({
				name: formData.name,
				description: formData.description || undefined,
				scenario,
				result,
				// savings and investments stay beside the rows so an older client reading only the totals still reopens it.
				inputs: {
					savings,
					investments,
					years: formData.years,
					savingsAccounts: savingsAccounts.map(({ name, balance, monthlyContribution }) => ({
						name,
						balance,
						monthlyContribution,
					})),
					// annualReturn on investment rows only: debts are saved without one.
					balanceAccounts: balanceAccounts.map(
						({
							name,
							type,
							balance,
							contribution,
							frequency,
							contributionRecordedAsExpense,
							annualReturn,
							paidByExpenseName,
						}) => ({
							name,
							type,
							balance,
							contribution,
							frequency,
							contributionRecordedAsExpense,
							...(type === 'investment' ? { annualReturn } : {}),
							...(type === 'debt' && paidByExpenseName ? { paidByExpenseName } : {}),
						})
					),
					assetAccounts: assetAccounts.map(({ name, balance }) => ({ name, balance })),
				},
			})
			setSaveOutcome(
				saveResult && !saveResult.success ? saveResult.error || FALLBACK_SAVE_ERROR : null
			)
		} catch (err) {
			// || FALLBACK_SAVE_ERROR: an Error with an empty message would otherwise render no alert.
			setSaveOutcome((err instanceof Error && err.message) || FALLBACK_SAVE_ERROR)
		} finally {
			setIsSaving(false)
			// Same `finally` as `isSaving`, so the page's tab lock cannot latch on any
			// exit path — resolve, reject, or a caller that throws synchronously.
			onSavingChange?.(false)
		}
	}, [
		result,
		isSaving,
		saveBlockedReason,
		onSavingChange,
		formData,
		incomeItems,
		expenseItems,
		oneTimeEvents,
		savings,
		savingsAccounts,
		investments,
		balanceAccounts,
		assetAccounts,
		onSave,
	])

	// Empty for a result computed without rows (a v1 forecast's saved result).
	const savingsOutcome = useMemo(() => {
		if (!result) return null
		const last = result.projection.at(-1)
		if (!last?.savingsAccounts || last.unallocatedSavings === undefined) return null
		const byRowId = new Map<string, number>()
		resultSavingsRowIds.forEach((id, index) => {
			const balance = last.savingsAccounts?.[index]
			if (balance !== undefined) byRowId.set(id, balance)
		})
		// Shown only while the result was computed for exactly the rows on screen, never a stale one.
		const currentIds = savingsAccounts.map((account) => account.id)
		const matchesRows =
			currentIds.length === resultSavingsRowIds.length &&
			currentIds.every((id, index) => id === resultSavingsRowIds.at(index))
		const hasRows = currentIds.length > 0
		// A negative remainder with nothing contributed is an income deficit, not over-contribution.
		const contributing =
			savingsAccounts.some((account) => account.monthlyContribution > 0) ||
			balanceAccounts.some(
				(account) =>
					account.type === 'investment' &&
					!account.contributionRecordedAsExpense &&
					account.contribution > 0
			)
		// Automatic rows seed from a monthly left-over but the forecast annualises exactly, so rounding can dip
		// a few cents below 0; a shortfall within that drift is not over-contribution.
		const roundingTolerance = roundingDriftToleranceCents(
			[
				...incomeItems.map((item) => item.frequency),
				...expenseItems.map((item) => item.frequency),
				...balanceAccounts
					.filter((account) => !account.contributionRecordedAsExpense && account.contribution > 0)
					.map((account) => account.frequency),
			],
			result.projection.length
		)
		const withinRounding =
			last.unallocatedSavings < 0 && -last.unallocatedSavings <= roundingTolerance
		return {
			years: result.projection.length,
			byRowId,
			unallocated: withinRounding ? 0 : last.unallocatedSavings,
			matchesRows,
			hasRows,
			contributing,
		}
	}, [result, resultSavingsRowIds, savingsAccounts, balanceAccounts, incomeItems, expenseItems])

	const balanceOutcome = useMemo(() => {
		if (!result) return null
		const closing = result.projection.at(-1)?.balanceAccounts
		if (!closing) return null
		const byRowId = new Map<string, number>()
		resultBalanceRowIds.forEach((id, index) => {
			const balance = closing[index]
			if (balance !== undefined) byRowId.set(id, balance)
		})
		return { years: result.projection.length, byRowId }
	}, [result, resultBalanceRowIds])

	const summary = useMemo(() => {
		if (!result) return null
		return {
			startingNetWorth: result.summary.startingNetWorth,
			endingNetWorth: result.summary.endingNetWorth,
			totalGrowth: result.summary.totalGrowth,
			averageAnnualGrowth: result.summary.averageAnnualGrowth,
		}
	}, [result])
	const vsToday = useMemo(() => (result ? vsTodayCents(result) : null), [result])

	return (
		<div className="space-y-8">
			<div className="mb-6">
				<h2 className="text-2xl font-bold text-subheading">Scenario Builder</h2>
				<p className="text-muted mt-1">Create and configure your financial forecasting scenario</p>
			</div>

			{/* The error arm must not offer "create a profile": a failed fetch says nothing about having profiles. */}
			{saveAvailability.kind === 'none' || saveAvailability.kind === 'error' ? (
				<div
					data-testid="save-blocked-notice"
					className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg text-sm"
				>
					{saveAvailability.kind === 'none' ? (
						<p>
							{NO_PROFILE_NOTICE}{' '}
							<Link to="/profiles" className="font-medium underline hover:no-underline">
								Create a profile
							</Link>
						</p>
					) : (
						<p>{PROFILE_ERROR_NOTICE}</p>
					)}
				</div>
			) : null}

			{/* This slot is the calculation's; save failures render beside the Save button. */}
			{error && (
				<div
					data-testid="calculation-error"
					className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
				>
					{error}
				</div>
			)}

			<Card as="section" variant="inset" className="rounded-xl p-6 space-y-6">
				<CardTitle as="h3">Scenario Settings</CardTitle>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					<InputField
						label="Scenario Name"
						value={formData.name}
						onChange={(v) => handleFormChange('name', v)}
						type="text"
						placeholder="My Financial Forecast"
					/>

					<InputField
						label="Description"
						value={formData.description}
						onChange={(v) => handleFormChange('description', v)}
						type="text"
						placeholder="Optional description"
					/>

					<InputField
						label="Projection Period (years)"
						value={formData.years}
						onChange={handleYearsChange}
						type="number"
						min={MIN_FORECAST_YEARS}
						max={MAX_FORECAST_YEARS}
						step={1}
						error={yearsValid ? undefined : YEARS_INVALID_MESSAGE}
					/>
					{/* min/max are HTML hints only; isValidForecastYears is the real guard (1e9 would hang the engine). */}

					{/* type="text": a number input rejects the formatted "0.00%" and renders blank. */}
					<InputField
						label="Income Growth Rate"
						value={formData.incomeGrowthRate}
						onChange={(v) => handleFormChange('incomeGrowthRate', Number(v))}
						type="text"
						inputMode="decimal"
						formatValue={formatPercentage}
						parseValue={parsePercentText}
						error={incomeGrowthValid ? undefined : GROWTH_INVALID_MESSAGE}
					/>

					{/* type="text": a number input rejects the formatted "0.00%" and renders blank. */}
					<InputField
						label="Expense Growth Rate"
						value={formData.expenseGrowthRate}
						onChange={(v) => handleFormChange('expenseGrowthRate', Number(v))}
						type="text"
						inputMode="decimal"
						formatValue={formatPercentage}
						parseValue={parsePercentText}
						error={expenseGrowthValid ? undefined : GROWTH_INVALID_MESSAGE}
					/>
				</div>
			</Card>

			<Card
				as="section"
				variant="inset"
				className="rounded-xl p-6 space-y-4"
				aria-labelledby={savingsHeadingId}
			>
				{/* Below the heading row: beside it, the row overflowed at 320px. */}
				<CardHeader>
					<CardTitle as="h3" id={savingsHeadingId}>
						Savings Accounts
					</CardTitle>
					<Button type="button" onClick={addSavingsAccount}>
						+ Add Account
					</Button>
				</CardHeader>
				<p className="text-muted text-sm">{SAVINGS_WHAT_IF_NOTE}</p>

				{savingsAccounts.length === 0 ? (
					<p className="text-muted text-sm">{NO_SAVINGS_ACCOUNTS}</p>
				) : (
					<div className="space-y-4">
						{savingsAccounts.map((account, index) => {
							const closing = savingsOutcome?.byRowId.get(account.id)
							return (
								<SavingsAccountRow
									key={account.id}
									account={account}
									position={index + 1}
									onUpdate={updateSavingsAccount}
									onDelete={deleteSavingsAccount}
									onValidityChange={setAmountRowValidity}
									outcome={
										savingsOutcome && closing !== undefined
											? {
													label: `After ${yearsLabel(savingsOutcome.years)}:`,
													amount: formatCurrency(closing),
												}
											: null
									}
								/>
							)
						})}
					</div>
				)}

				{savingsOutcome?.matchesRows &&
					(savingsOutcome.unallocated < 0 && savingsOutcome.contributing ? (
						<p
							data-testid="savings-unassigned"
							className="text-sm text-amber-800 dark:text-amber-200"
						>
							Your contributions are{' '}
							<GroupedAmount text={formatCurrency(-savingsOutcome.unallocated)} /> more than you
							have left over by year {savingsOutcome.years}
						</p>
					) : (
						savingsOutcome.hasRows && (
							<p data-testid="savings-unassigned" className="text-sm text-body">
								Not assigned to an account after {yearsLabel(savingsOutcome.years)}:{' '}
								<GroupedAmount text={formatCurrency(savingsOutcome.unallocated)} />
							</p>
						)
					))}
			</Card>

			<Card
				as="section"
				variant="inset"
				className="rounded-xl p-6 space-y-4"
				aria-labelledby={balanceHeadingId}
			>
				<CardHeader>
					<CardTitle as="h3" id={balanceHeadingId}>
						Investments &amp; Debts
					</CardTitle>
					<Button type="button" onClick={addBalanceAccount}>
						+ Add Balance
					</Button>
				</CardHeader>
				<p className="text-muted text-sm">{BALANCE_WHAT_IF_NOTE}</p>

				{balanceAccounts.length === 0 ? (
					<p className="text-muted text-sm">{NO_BALANCE_ACCOUNTS}</p>
				) : (
					<div className="space-y-4">
						{balanceAccounts.map((account, index) => {
							const closing = balanceOutcome?.byRowId.get(account.id)
							return (
								<BalanceAccountRow
									key={account.id}
									account={account}
									position={index + 1}
									onUpdate={updateBalanceAccount}
									onDelete={deleteBalanceAccount}
									onValidityChange={setAmountRowValidity}
									outcome={
										balanceOutcome && closing !== undefined
											? // A debt starting at 0 was never owed, so it reads After N years: 0, not "paid off".
												account.type === 'debt' && closing === 0 && account.balance > 0
												? { label: `Paid off within ${yearsLabel(balanceOutcome.years)}` }
												: {
														label: `After ${yearsLabel(balanceOutcome.years)}:`,
														amount: formatCurrency(closing),
													}
											: null
									}
								/>
							)
						})}
					</div>
				)}
			</Card>

			<Card
				as="section"
				variant="inset"
				className="rounded-xl p-6 space-y-4"
				aria-labelledby={assetHeadingId}
			>
				<CardHeader>
					<CardTitle as="h3" id={assetHeadingId}>
						Assets
					</CardTitle>
					<Button type="button" onClick={addAssetAccount}>
						+ Add Asset
					</Button>
				</CardHeader>
				<p className="text-muted text-sm">{ASSET_WHAT_IF_NOTE}</p>

				{assetAccounts.length === 0 ? (
					<p className="text-muted text-sm">{NO_ASSET_ACCOUNTS}</p>
				) : (
					<div className="space-y-4">
						{assetAccounts.map((account, index) => (
							<AssetAccountRow
								key={account.id}
								account={account}
								position={index + 1}
								onUpdate={updateAssetAccount}
								onDelete={deleteAssetAccount}
								onValidityChange={setAmountRowValidity}
							/>
						))}
					</div>
				)}
			</Card>

			<Card as="section" variant="inset" className="rounded-xl p-6 space-y-4">
				<CardHeader>
					<CardTitle as="h3">Income Sources</CardTitle>
					<Button type="button" onClick={addIncomeItem}>
						+ Add Income
					</Button>
				</CardHeader>

				<div className="space-y-4">
					{incomeItems.map((item) => (
						<FinancialItemRow
							key={item.id}
							item={item}
							frequencyOptions={FREQUENCY_OPTIONS}
							onUpdate={(field, value) =>
								updateFinancialItem(incomeItems, editIncomeItems, item.id, field, value)
							}
							onDelete={() => deleteFinancialItem(incomeItems, editIncomeItems, item.id)}
							onValidityChange={setAmountRowValidity}
						/>
					))}
				</div>
			</Card>

			<Card as="section" variant="inset" className="rounded-xl p-6 space-y-4">
				<CardHeader>
					<CardTitle as="h3">Expense Categories</CardTitle>
					<Button type="button" onClick={addExpenseItem}>
						+ Add Expense
					</Button>
				</CardHeader>

				<div className="space-y-4">
					{expenseItems.map((item) => (
						<FinancialItemRow
							key={item.id}
							item={item}
							frequencyOptions={FREQUENCY_OPTIONS}
							onUpdate={(field, value) =>
								updateFinancialItem(expenseItems, editExpenseItems, item.id, field, value)
							}
							onDelete={() => deleteFinancialItem(expenseItems, editExpenseItems, item.id)}
							onValidityChange={setAmountRowValidity}
						/>
					))}
				</div>
			</Card>

			<Card as="section" variant="inset" className="rounded-xl p-6 space-y-4">
				<CardHeader>
					<CardTitle as="h3">One-Time Events</CardTitle>
					<Button type="button" onClick={addOneTimeEvent}>
						+ Add Event
					</Button>
				</CardHeader>

				{oneTimeEvents.length === 0 ? (
					<p className="text-muted text-sm">No one-time events configured</p>
				) : (
					<div className="space-y-4">
						{oneTimeEvents.map((event) => (
							<OneTimeEventRow
								key={event.id}
								event={event}
								onUpdate={updateOneTimeEvent}
								onDelete={deleteOneTimeEvent}
								maxYear={lastValidYears}
								onValidityChange={setAmountRowValidity}
							/>
						))}
					</div>
				)}
			</Card>

			{result && (
				<section className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-6">
					<CardTitle as="h3" className="mb-4">
						Forecast Summary
					</CardTitle>

					<dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
						<StatCard
							label="Starting Net Worth"
							value={formatCurrency(summary?.startingNetWorth || 0)}
						/>
						<StatCard
							label="Ending Net Worth"
							value={formatCurrency(summary?.endingNetWorth || 0)}
						/>
						<StatCard
							label="Total Growth"
							value={formatCurrency(summary?.totalGrowth || 0)}
							highlight
						/>
						<StatCard
							label="Avg Annual Growth"
							value={formatCurrency(Math.round(summary?.averageAnnualGrowth || 0))}
						/>
						{vsToday !== null && (
							<StatCard label="vs. today" value={signedAmount(vsToday, formatCurrency)} />
						)}
					</dl>

					{/* Before the Save button in the same parent, so one Tab from the focused message returns to Save. */}
					<div className="mt-6 space-y-3">
						{saveOutcome && (
							<div
								ref={saveOutcomeRef}
								data-testid="save-outcome"
								role="alert"
								tabIndex={-1}
								className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							>
								{saveOutcome}
							</div>
						)}
						{saveBlockedReason && (
							<p
								data-testid="save-blocked-reason"
								className="text-sm text-amber-800 dark:text-amber-200 text-right"
							>
								{saveBlockedReason}
							</p>
						)}
						<div className="flex justify-end">
							<button
								type="button"
								onClick={handleSave}
								className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								disabled={isCalculating || isSaving || saveBlockedReason !== null}
							>
								{isCalculating ? 'Calculating...' : isSaving ? 'Saving...' : 'Save Forecast'}
							</button>
						</div>
					</div>
				</section>
			)}

			{isCalculating && (
				<div className="flex items-center justify-center py-4">
					<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
					<span className="ml-2 text-body">Calculating forecast...</span>
				</div>
			)}
		</div>
	)
}

type InputFieldProps = {
	label: string
	value: string | number
	onChange: (value: string | number) => void
	type: 'text' | 'number'
	placeholder?: string
	min?: number
	max?: number
	step?: number
	inputMode?: 'decimal' | 'numeric'
	formatValue?: (value: string | number) => string
	parseValue?: (value: string) => string | number
	// Opt-in per call site: this component also serves non-money fields like the scenario name.
	sanitize?: (raw: string) => string
	error?: string
	// Money fields must opt out: the hydration render parses with the default locale, so de-DE 1234,56 saves 100x.
	adoptPreHydrationValue?: boolean
	autoComplete?: 'off'
}

function InputField({
	label,
	value,
	onChange,
	type,
	placeholder,
	min,
	max,
	step,
	inputMode,
	formatValue,
	parseValue,
	sanitize,
	error,
	adoptPreHydrationValue = true,
	autoComplete,
}: InputFieldProps): React.ReactElement {
	const [internalValue, setInternalValue] = useState<string>(() => {
		// formatValue includes the symbol, so seed through the field's filter to mount a legal value.
		const seeded = formatValue ? formatValue(value) : String(value)
		return sanitize ? sanitize(seeded) : seeded
	})

	const inputRef = useRef<HTMLInputElement>(null)

	const commit = (rawValue: string) => {
		setInternalValue(rawValue)

		if (parseValue) {
			onChange(parseValue(rawValue))
		} else if (type === 'number') {
			const numValue = Number.parseFloat(rawValue)
			// isFinite, not isNaN, so no raw Infinity reaches the parent.
			onChange(Number.isFinite(numValue) ? numValue : 0)
		} else {
			onChange(rawValue)
		}
	}

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		// Filter first so displayed and lifted values come from the same string; sanitizeWithCaret keeps the cursor.
		commit(sanitize ? sanitizeWithCaret(e.target, sanitize) : e.target.value)
	}

	// Adopt text typed before hydration: hydration fires no onChange, so the next re-render would overwrite it.
	// Compare after filtering, so rejected characters only clean the DOM.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
	useLayoutEffect(() => {
		const input = inputRef.current
		if (!input || !adoptPreHydrationValue) return
		const adopted = sanitize ? sanitize(input.value) : input.value
		if (adopted !== internalValue) {
			commit(adopted)
		} else if (input.value !== adopted) {
			input.value = adopted
		}
	}, [])

	const inputId = useId()
	const errorId = `${inputId}-error`

	return (
		<FormField>
			<FormLabel htmlFor={inputId}>{label}</FormLabel>
			<input
				ref={inputRef}
				id={inputId}
				type={type}
				value={internalValue}
				onChange={handleChange}
				placeholder={placeholder}
				min={min}
				max={max}
				step={step}
				inputMode={inputMode}
				autoComplete={autoComplete}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
			/>
			{error && (
				<p id={errorId} className="mt-1 text-sm text-red-600 dark:text-red-300">
					{error}
				</p>
			)}
		</FormField>
	)
}

type FinancialItemRowProps = {
	item: LocalFinancialItem
	frequencyOptions: { value: string; label: string }[]
	onUpdate: (field: keyof LocalFinancialItem, value: string | number) => void
	onDelete: () => void
	onValidityChange: (rowId: string, valid: boolean) => void
}

// allowNegative is for the event row, whose field holds a magnitude (a typed minus selects Money out).
function amountProblem(
	draft: MoneyDraft,
	preferences: Pick<CurrencyOptions, 'mode' | 'currency' | 'locale'>,
	allowNegative = false
): string | null {
	if ('problem' in draft) return draft.problem
	if (!allowNegative && draft.cents < 0) return AMOUNT_NEGATIVE_MESSAGE
	if (exceedsMoneyLimit(Math.abs(draft.cents))) return moneyLimitMessage(preferences)
	return null
}

// Refused text stays as typed instead of re-echoing as 0.00 beside the error.
function reechoAmountOnBlur(
	value: string,
	locale: string | undefined,
	setter: (v: string) => void
): void {
	if ('problem' in parseMoneyDraft(value, locale)) return
	reformatAmountOnBlur(value, locale, setter)
}

// Withdraws the report on unmount, so a removed row can never keep Save blocked.
function useWithdrawValidityOnUnmount(
	rowId: string,
	onValidityChange: (rowId: string, valid: boolean) => void
): void {
	useEffect(() => () => onValidityChange(rowId, true), [rowId, onValidityChange])
}

function FinancialItemRow({
	item,
	frequencyOptions,
	onUpdate,
	onDelete,
	onValidityChange,
}: FinancialItemRowProps): React.ReactElement {
	const preferences = useCurrencyPreferences()
	const { mode, currency, locale } = preferences

	const nameId = useId()
	const amountId = useId()
	const frequencyId = useId()

	// A draft string, not item.amount: a refused entry isn't written, so a controlled value would snap back
	// to the last good amount and erase what the user typed.
	const [draft, setDraft] = useState<string>(() => formatForInputDisplay(item.amount, locale))
	const [amountError, setAmountError] = useState<string | null>(null)
	useWithdrawValidityOnUnmount(item.id, onValidityChange)

	// A bad entry is reported and not written; an empty field is still 0.
	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		setDraft(raw)
		const parsed = parseMoneyDraft(raw, locale)
		const problem = amountProblem(parsed, preferences)
		if (problem === null && 'cents' in parsed) onUpdate('amount', parsed.cents)
		setAmountError(problem)
		onValidityChange(item.id, problem === null)
	}
	const amountErrorId = `${amountId}-error`

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
				<FormField>
					<FormLabel htmlFor={nameId}>Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={item.name}
						onChange={(e) => onUpdate('name', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Income/Expense name"
					/>
				</FormField>

				<FormField>
					<FormLabel htmlFor={amountId}>Amount</FormLabel>
					<div className="relative">
						{mode === 'symbol' && (
							<span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
								{currencySymbol(currency)}
							</span>
						)}
						<input
							id={amountId}
							type="text"
							inputMode="decimal"
							value={draft}
							onChange={handleAmountChange}
							onBlur={(e) => reechoAmountOnBlur(e.target.value, locale, setDraft)}
							aria-invalid={amountError ? true : undefined}
							aria-describedby={amountError ? amountErrorId : undefined}
							className={cn(
								'w-full',
								mode === 'symbol' ? 'px-6' : 'px-2',
								'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
							)}
							placeholder="0.00"
						/>
					</div>
					{amountError && (
						<p id={amountErrorId} className="mt-1 text-xs text-red-600 dark:text-red-300">
							{amountError}
						</p>
					)}
				</FormField>

				<FormField>
					<FormLabel htmlFor={frequencyId}>Frequency</FormLabel>
					<select
						id={frequencyId}
						value={item.frequency}
						onChange={(e) => onUpdate('frequency', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
					>
						{frequencyOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				<div className="flex justify-end">
					<button
						type="button"
						onClick={onDelete}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}

type OneTimeEventRowProps = {
	event: OneTimeEvent
	onUpdate: (id: string, field: keyof OneTimeEvent, value: string | number) => void
	onDelete: (id: string) => void
	maxYear: number
	onValidityChange: (rowId: string, valid: boolean) => void
}

function OneTimeEventRow({
	event,
	onUpdate,
	onDelete,
	maxYear,
	onValidityChange,
}: OneTimeEventRowProps): React.ReactElement {
	const preferences = useCurrencyPreferences()
	const { mode, currency, locale } = preferences

	// The stored amount stays signed; direction is derived from it when non-zero.
	// State only remembers the choice at 0, where the sign carries nothing.
	const [pendingDirection, setPendingDirection] = useState<'in' | 'out'>(
		event.amount < 0 ? 'out' : 'in'
	)
	const direction: 'in' | 'out' =
		event.amount !== 0 ? (event.amount < 0 ? 'out' : 'in') : pendingDirection

	// cents === 0 is returned unnegated: a stored -0 would reload as Money in.
	const signed = (cents: number, dir: 'in' | 'out') =>
		dir === 'out' && cents !== 0 ? -cents : cents

	// A draft magnitude string, for the same reason as FinancialItemRow's draft.
	const [draft, setDraft] = useState<string>(() =>
		formatForInputDisplay(Math.abs(event.amount), locale)
	)
	const [amountError, setAmountError] = useState<string | null>(null)
	useWithdrawValidityOnUnmount(event.id, onValidityChange)

	const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		const typedMinus = raw.startsWith('-')
		const hasDigit = /\d/.test(raw)
		// A typed minus selects Money out; a lone - stays visible until a digit follows.
		setDraft(typedMinus && hasDigit ? raw.slice(1) : raw)

		if (!hasDigit) {
			setAmountError(null)
			onValidityChange(event.id, true)
			if (raw === '') {
				// Keep the chosen direction through zero, where the sign cannot hold it.
				if (pendingDirection !== direction) setPendingDirection(direction)
				onUpdate(event.id, 'amount', 0)
				return
			}
			// A digit-free partial (-, .) writes nothing; a lone - is how the minus selects Money out on the first keystroke.
			if (typedMinus && direction !== 'out') setPendingDirection('out')
			return
		}

		// A typed minus selects Money out rather than erasing the entry, and is honoured before validation
		// so a refused entry keeps that intent.
		const nextDirection = typedMinus ? 'out' : direction
		if (nextDirection !== direction) setPendingDirection(nextDirection)
		const parsed = parseMoneyDraft(raw, locale)
		// Refused (unreadable or above the money limit): reported on this field, nothing written.
		const problem = amountProblem(parsed, preferences, true)
		setAmountError(problem)
		onValidityChange(event.id, problem === null)
		if (problem !== null || !('cents' in parsed)) {
			// A non-zero amount's sign is the direction, so re-sign the kept amount; pendingDirection alone would be ignored.
			if (nextDirection !== direction && event.amount !== 0) {
				onUpdate(event.id, 'amount', signed(Math.abs(event.amount), nextDirection))
			}
			return
		}
		onUpdate(event.id, 'amount', signed(Math.abs(parsed.cents), nextDirection))
	}

	const handleDirectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const next = e.target.value === 'out' ? 'out' : 'in'
		setPendingDirection(next)
		onUpdate(event.id, 'amount', signed(Math.abs(event.amount), next))
	}

	const amountId = `event-amount-${event.id}`
	const directionId = `event-direction-${event.id}`
	const yearId = `event-year-${event.id}`
	const nameId = `event-name-${event.id}`
	const yearCalendarId = `${yearId}-calendar`
	const yearHelpId = `${yearId}-help`
	// Year 1 is the first projected year. Read at render: event rows only exist client-side, so no hydration mismatch.
	const calendarYear = new Date().getFullYear() + event.year

	const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const year = Math.max(1, Math.min(maxYear, Number.parseInt(e.target.value, 10) || 1))
		onUpdate(event.id, 'year', year)
	}

	return (
		<Card className="p-4 shadow-sm border border-default">
			{/* items-start: the year cell has two lines under its input. */}
			<div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
				<FormField>
					<FormLabel htmlFor={nameId}>Event Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={event.name}
						onChange={(e) => onUpdate(event.id, 'name', e.target.value)}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Bonus, house deposit, etc."
					/>
				</FormField>

				<FormField>
					<FormLabel htmlFor={directionId}>Direction</FormLabel>
					<select
						id={directionId}
						value={direction}
						onChange={handleDirectionChange}
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded text-sm"
					>
						<option value="in">Money in</option>
						<option value="out">Money out</option>
					</select>
				</FormField>

				<FormField>
					<FormLabel htmlFor={amountId}>Amount</FormLabel>
					<div className="relative">
						{mode === 'symbol' && (
							<span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
								{currencySymbol(currency)}
							</span>
						)}
						<input
							id={amountId}
							type="text"
							inputMode="decimal"
							// Magnitude only: direction carries the sign.
							value={draft}
							onChange={handleAmountChange}
							onBlur={(e) => reechoAmountOnBlur(e.target.value, locale, setDraft)}
							aria-invalid={amountError ? true : undefined}
							aria-describedby={amountError ? `${amountId}-error` : undefined}
							className={cn(
								'w-full',
								mode === 'symbol' ? 'px-6' : 'px-2',
								'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
							)}
							placeholder="0.00"
						/>
					</div>
					{amountError && (
						<p id={`${amountId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
							{amountError}
						</p>
					)}
				</FormField>

				{/* A count from the forecast start, not a calendar year; the calendar year shows beside it. */}
				<FormField>
					{/* whitespace-nowrap: under CI's DejaVu Sans this label wraps near 768px and drops the input. */}
					<FormLabel htmlFor={yearId} className="whitespace-nowrap">
						Years from now
					</FormLabel>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<input
							id={yearId}
							type="number"
							value={event.year}
							onChange={handleYearChange}
							min={1}
							max={maxYear}
							step={1}
							aria-describedby={`${yearCalendarId} ${yearHelpId}`}
							className="w-20 shrink-0 px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						/>
						<span id={yearCalendarId} className="text-sm text-muted whitespace-nowrap">
							Year {event.year} ({calendarYear})
						</span>
					</div>
					<p id={yearHelpId} className="mt-1 text-xs text-muted">
						1 = the first year of your forecast
					</p>
				</FormField>

				<div className="flex justify-end md:pt-6">
					<button
						type="button"
						onClick={() => onDelete(event.id)}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}

type SavingsAccountRowProps = {
	account: LocalSavingsAccount
	position: number
	onUpdate: (
		id: string,
		field: 'name' | 'balance' | 'monthlyContribution',
		value: string | number
	) => void
	onDelete: (id: string) => void
	// One key per field, so fixing one bad field cannot unblock another.
	onValidityChange: (key: string, valid: boolean) => void
	outcome: { label: string; amount: string } | null
}

// Not InputField: rows remount by key when the seed lands, so its pre-hydration machinery isn't needed.
function useMoneyDraft(
	cents: number,
	validityKey: string,
	onValidityChange: (key: string, valid: boolean) => void,
	write: (cents: number) => void
) {
	const preferences = useCurrencyPreferences()
	const { locale } = preferences
	const [draft, setDraft] = useState<string>(() => formatForInputDisplay(cents, locale))
	// A negative can arrive from an old saved forecast; flag it from the first render as if typed.
	const [error, setError] = useState<string | null>(() =>
		cents < 0 ? AMOUNT_NEGATIVE_MESSAGE : null
	)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
	useEffect(() => {
		if (cents < 0) onValidityChange(validityKey, false)
	}, [])
	useWithdrawValidityOnUnmount(validityKey, onValidityChange)
	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = sanitizeMoneyChange(e.target, locale)
		setDraft(raw)
		const parsed = parseMoneyDraft(raw, locale)
		const problem = amountProblem(parsed, preferences)
		if (problem === null && 'cents' in parsed) write(parsed.cents)
		setError(problem)
		onValidityChange(validityKey, problem === null)
	}
	const onBlur = (e: React.FocusEvent<HTMLInputElement>) =>
		reechoAmountOnBlur(e.target.value, locale, setDraft)
	return { draft, error, onChange, onBlur }
}

// A plain decimal, optionally signed, optionally ending in %.
const PERCENT_TEXT = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*%?\s*$/

// parseFloat alone reads a prefix (5abc -> 5, 2,5 -> 2, 1e2 -> 100), so the whole text must match.
// A single decimal comma converts to a point first.
function parsePercentText(raw: string): number {
	const text = decimalCommaToPoint(raw)
	return PERCENT_TEXT.test(text) ? Number.parseFloat(text) / 100 : Number.NaN
}

function usePercentDraft(
	rate: number,
	validityKey: string,
	onValidityChange: (key: string, valid: boolean) => void,
	write: (rate: number) => void
) {
	const [draft, setDraft] = useState<string>(() => formatPercentage(rate))
	const [error, setError] = useState<string | null>(() =>
		isValidGrowthRate(rate) ? null : RETURN_INVALID_MESSAGE
	)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — reports the value the row ARRIVED with; later changes report from `onChange`.
	useEffect(() => {
		if (!isValidGrowthRate(rate)) onValidityChange(validityKey, false)
	}, [])
	useWithdrawValidityOnUnmount(validityKey, onValidityChange)
	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = e.target.value
		setDraft(raw)
		const parsed = parsePercentText(raw)
		const problem = isValidGrowthRate(parsed) ? null : RETURN_INVALID_MESSAGE
		if (problem === null) write(parsed)
		setError(problem)
		onValidityChange(validityKey, problem === null)
	}
	return { draft, error, onChange }
}

function RowPercentField({
	label,
	rowLabel,
	field,
}: {
	label: string
	rowLabel: string
	field: ReturnType<typeof usePercentDraft>
}): React.ReactElement {
	const id = useId()
	return (
		<FormField>
			<FormLabel htmlFor={id}>{label}</FormLabel>
			<input
				id={id}
				type="text"
				inputMode="decimal"
				value={field.draft}
				onChange={field.onChange}
				aria-label={`${label} for ${rowLabel}`}
				autoComplete="off"
				aria-invalid={field.error ? true : undefined}
				aria-describedby={field.error ? `${id}-error` : undefined}
				className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
			/>
			{field.error && (
				<p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
					{field.error}
				</p>
			)}
		</FormField>
	)
}

function RowMoneyField({
	label,
	rowLabel,
	field,
}: {
	label: string
	rowLabel: string
	field: ReturnType<typeof useMoneyDraft>
}): React.ReactElement {
	const { mode, currency } = useCurrencyPreferences()
	const id = useId()
	return (
		<FormField>
			<FormLabel htmlFor={id}>{label}</FormLabel>
			<div className="relative">
				{mode === 'symbol' && (
					<span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">
						{currencySymbol(currency)}
					</span>
				)}
				<input
					id={id}
					type="text"
					inputMode="decimal"
					value={field.draft}
					onChange={field.onChange}
					onBlur={field.onBlur}
					aria-label={`${label} for ${rowLabel}`}
					autoComplete="off"
					aria-invalid={field.error ? true : undefined}
					aria-describedby={field.error ? `${id}-error` : undefined}
					className={cn(
						'w-full',
						mode === 'symbol' ? 'px-6' : 'px-2',
						'py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'
					)}
					placeholder="0.00"
				/>
			</div>
			{field.error && (
				<p id={`${id}-error`} className="mt-1 text-xs text-red-600 dark:text-red-300">
					{field.error}
				</p>
			)}
		</FormField>
	)
}

function SavingsAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
	outcome,
}: SavingsAccountRowProps): React.ReactElement {
	const nameId = useId()
	const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const contribution = useMoneyDraft(
		account.monthlyContribution,
		`${account.id}:contribution`,
		onValidityChange,
		(c) => onUpdate(account.id, 'monthlyContribution', c)
	)
	// Each accessible name carries the row's name, or a screen reader hears "Balance" N times.
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'account' : rowName

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
				<FormField className="min-w-0">
					<FormLabel htmlFor={nameId}>Account Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={account.name}
						onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
						// Labelled by position, not the row name: this field is the name and would rename itself while typed in.
						aria-label={`Account Name, row ${position}`}
						autoComplete="off"
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Savings account or goal"
					/>
				</FormField>

				<RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
				<RowMoneyField label="Monthly Contribution" rowLabel={rowLabel} field={contribution} />

				<div className="flex justify-end">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						// Unique per row, or every row's button has the same name.
						aria-label={rowName === '' ? 'Remove account' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
			{/* Plain text, not a live region: it changes on every recompute. */}
			{outcome && (
				<p className="mt-3 text-sm text-body">
					{outcome.label} <GroupedAmount text={outcome.amount} />
				</p>
			)}
		</Card>
	)
}

type BalanceAccountRowProps = {
	account: LocalBalanceAccount
	position: number
	onUpdate: <K extends Exclude<keyof LocalBalanceAccount, 'id'>>(
		id: string,
		field: K,
		value: LocalBalanceAccount[K]
	) => void
	onDelete: (id: string) => void
	onValidityChange: (key: string, valid: boolean) => void
	outcome: { label: string; amount?: string } | null
}

function BalanceAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
	outcome,
}: BalanceAccountRowProps): React.ReactElement {
	const nameId = useId()
	const typeId = useId()
	const frequencyId = useId()
	const flagId = useId()
	const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const contribution = useMoneyDraft(
		account.contribution,
		`${account.id}:contribution`,
		onValidityChange,
		(c) => onUpdate(account.id, 'contribution', c)
	)
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'unnamed balance' : rowName
	const isInvestment = account.type === 'investment'
	const flagLabel = isInvestment ? NOT_FROM_LEFT_OVER_LABEL : PAYMENT_IN_EXPENSES_LABEL
	const showFlag = isInvestment || !account.paidByExpenseName
	const selectClass =
		'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
				<FormField className="min-w-0">
					<FormLabel htmlFor={nameId}>Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={account.name}
						onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
						aria-label={`Balance Name, row ${position}`}
						autoComplete="off"
						className={selectClass}
						placeholder="Investment or debt"
					/>
				</FormField>

				<FormField>
					<FormLabel htmlFor={typeId}>Type</FormLabel>
					<select
						id={typeId}
						value={account.type}
						onChange={(e) =>
							onUpdate(account.id, 'type', e.target.value === 'debt' ? 'debt' : 'investment')
						}
						aria-label={`Type for ${rowLabel}`}
						autoComplete="off"
						className={selectClass}
					>
						{BALANCE_TYPE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				<RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
				<RowMoneyField label="Contribution" rowLabel={rowLabel} field={contribution} />

				<FormField>
					<FormLabel htmlFor={frequencyId}>Frequency</FormLabel>
					<select
						id={frequencyId}
						value={account.frequency}
						onChange={(e) =>
							onUpdate(
								account.id,
								'frequency',
								isKnownFrequency(e.target.value) ? e.target.value : 'monthly'
							)
						}
						aria-label={`Frequency for ${rowLabel}`}
						autoComplete="off"
						className={selectClass}
					>
						{FREQUENCY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				{/* Its own component, so switching to Debt unmounts it and withdraws its validity key. */}
				{isInvestment && (
					<AnnualReturnField
						account={account}
						rowLabel={rowLabel}
						onUpdate={onUpdate}
						onValidityChange={onValidityChange}
					/>
				)}

				{/* md:col-start-3 keeps it in the last column when Annual return wraps it onto its own row. */}
				<div className="flex justify-end md:col-start-3">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						aria-label={rowName === '' ? 'Remove balance' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
			{/* break-words so a long expense name wraps at 320px. */}
			{!isInvestment && account.paidByExpenseName && (
				<p className="mt-3 text-sm text-faint break-words min-w-0">
					from Expenses: {account.paidByExpenseName}
				</p>
			)}
			{/* Hidden on a debt row with a from-Expenses label: its payment is the row's own, and ticking it would
count that payment nowhere. */}
			{showFlag && (
				<div className="mt-3 flex items-start gap-2">
					<input
						id={flagId}
						type="checkbox"
						checked={account.contributionRecordedAsExpense}
						onChange={(e) =>
							onUpdate(account.id, 'contributionRecordedAsExpense', e.target.checked)
						}
						aria-label={`${flagLabel}, for ${rowLabel}`}
						autoComplete="off"
						className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
					/>
					<label htmlFor={flagId} className="text-sm text-label">
						{flagLabel}
					</label>
				</div>
			)}
			{/* Plain text, not a live region: it changes on every recompute. */}
			{outcome && (
				<p className="mt-3 text-sm text-body">
					{outcome.label}
					{outcome.amount !== undefined && (
						<>
							{' '}
							<GroupedAmount text={outcome.amount} />
						</>
					)}
				</p>
			)}
		</Card>
	)
}

// Its own component so it unmounts with the type, withdrawing its validity report.
function AnnualReturnField({
	account,
	rowLabel,
	onUpdate,
	onValidityChange,
}: {
	account: LocalBalanceAccount
	rowLabel: string
	onUpdate: BalanceAccountRowProps['onUpdate']
	onValidityChange: (key: string, valid: boolean) => void
}): React.ReactElement {
	const rate = usePercentDraft(
		account.annualReturn,
		`${account.id}:annualReturn`,
		onValidityChange,
		(r) => onUpdate(account.id, 'annualReturn', r)
	)
	return <RowPercentField label="Annual return" rowLabel={rowLabel} field={rate} />
}

type AssetAccountRowProps = {
	account: LocalAssetAccount
	position: number
	onUpdate: (id: string, field: 'name' | 'balance', value: string | number) => void
	onDelete: (id: string) => void
	onValidityChange: (key: string, valid: boolean) => void
}

function AssetAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
}: AssetAccountRowProps): React.ReactElement {
	const nameId = useId()
	const value = useMoneyDraft(account.balance, `${account.id}:value`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'unnamed asset' : rowName

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
				<FormField className="min-w-0">
					<FormLabel htmlFor={nameId}>Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={account.name}
						onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
						aria-label={`Asset Name, row ${position}`}
						autoComplete="off"
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="House, car"
					/>
				</FormField>

				{/* "Value", not "Balance", so it is never named like a balance row's field. */}
				<RowMoneyField label="Value" rowLabel={rowLabel} field={value} />

				<div className="flex justify-end">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						aria-label={rowName === '' ? 'Remove asset' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}

// GroupedAmount: large amounts overrun these cards, so they may break only after a group separator.
type StatCardProps = {
	label: string
	value: string
	highlight?: boolean
}

function StatCard({ label, value, highlight }: StatCardProps): React.ReactElement {
	return (
		<div
			className={cn(
				'rounded-lg p-4 text-center',
				highlight ? 'bg-white dark:bg-gray-800 shadow' : 'bg-blue-100 dark:bg-blue-900/40'
			)}
		>
			<dt className="text-xs font-medium text-body uppercase tracking-wider">{label}</dt>
			<dd
				className={cn(
					'mt-1 text-lg font-semibold',
					highlight ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-100'
				)}
			>
				<GroupedAmount text={value} />
			</dd>
		</div>
	)
}
