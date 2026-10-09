import {
	calculateFinancialForecast,
	DEFAULT_FORECAST_YEARS,
	DEFAULT_INVESTMENT_RETURN,
	type ForecastingResult,
	type ForecastingScenario,
	isValidForecastYears,
	isValidGrowthRate,
	MAX_FORECAST_YEARS,
	MAX_GROWTH_RATE,
	MIN_FORECAST_YEARS,
	MIN_GROWTH_RATE,
} from '@budget-planner/core/finance/forecasting'
import { roundingDriftToleranceCents } from '@budget-planner/core/finance/normalization'
import { Link } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CardHeader } from '@/components/ui/CardHeader'
import { CardTitle } from '@/components/ui/CardTitle'
import { signedAmount, vsTodayCents, withTodayBaseline } from '../../lib/forecasting/today-baseline'
import { useFormattedAmount } from '../../stores/currencyStore'
import { GroupedAmount } from '../ui/GroupedAmount'
import type { SavedForecast, ScenarioInputs } from './saved-forecast'
import { AssetAccountRow } from './scenario-builder/AssetAccountRow'
import { BalanceAccountRow } from './scenario-builder/BalanceAccountRow'
import { FinancialItemRow } from './scenario-builder/FinancialItemRow'
import { forecastInputFromRows, toNormalizableItems } from './scenario-builder/forecast-input'
import { FREQUENCY_OPTIONS } from './scenario-builder/frequency-options'
import { generateId } from './scenario-builder/generate-id'
import { InputField } from './scenario-builder/InputField'
import { OneTimeEventRow } from './scenario-builder/OneTimeEventRow'
import { formatPercentage, parsePercentText } from './scenario-builder/percentage'
import { SavingsAccountRow } from './scenario-builder/SavingsAccountRow'
import { StatCard } from './scenario-builder/StatCard'
import {
	assetsFromSaved,
	balanceFromSaved,
	eventsFromSaved,
	growthRateFromSaved,
	itemsFromSaved,
	savingsFromSaved,
} from './scenario-builder/saved-mappers'
import { sortByMonthlyDesc } from './scenario-builder/store-mappers'
import type {
	LocalAssetAccount,
	LocalBalanceAccount,
	LocalFinancialItem,
	LocalSavingsAccount,
	OneTimeEvent,
} from './scenario-builder/types'
import { useCurrentForecastData } from './scenario-builder/useCurrentForecastData'
import { yearsLabel } from './scenario-builder/years-label'

const DEBOUNCE_DELAY_MS = 500

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
const FIELDS_INVALID_SHORT = 'Fix the highlighted fields to save'

const SAVINGS_WHAT_IF_NOTE = "What-if only: changes here don't change your Savings page."
const NO_SAVINGS_ACCOUNTS = 'No savings accounts in this scenario'

const BALANCE_WHAT_IF_NOTE =
	"What-if only: changes here don't change your Balance Tracking page. Debts count against your starting net worth."
const NO_BALANCE_ACCOUNTS = 'No investments or debts in this scenario'
export const ASSET_WHAT_IF_NOTE =
	"What-if only: changes here don't change your Balance Tracking page. An asset keeps the value you enter every year."
export const NO_ASSET_ACCOUNTS = 'No assets in this scenario'

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
