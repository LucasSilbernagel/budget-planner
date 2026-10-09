import { calculateNetIncomeResult } from '@budget-planner/core/finance/netIncome'
import {
	type IncomeBasis,
	type RetirementAccumulationResult,
	type RetirementModel,
	solveRetirementAccumulation,
	toMonthlyIncomeCents,
} from '@budget-planner/core/finance/retirement'
import {
	currencySymbol,
	formatCurrency,
	formatForInputDisplay,
	parseFromInput,
} from '@budget-planner/core/format/currency'
import { monthlyContributionCents } from '@budget-planner/core/services/balanceTracking'
import type React from 'react'
import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/cn'
import { summarizeEndingExpenses } from '../lib/retirement-ending-expenses'
import { parseAge, parseCurrencyToCents, parsePercentageToDecimal } from '../lib/retirement-parsers'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { useBalanceEntries, useTotalInvestmentBalance } from '../stores/balanceStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { useExpenses } from '../stores/expenseStore'
import { useIncomeSources } from '../stores/incomeStore'
import {
	useMarkDesiredIncomeAuthored,
	useRetirementPlan,
	useSetAdoptedMonthlyCents,
	useSetAnnualReturnInput,
	useSetCurrentAgeInput,
	useSetDesiredIncomeForLocale,
	useSetDesiredIncomeInput,
	useSetIncomeBasis,
	useSetLifeExpectancyInput,
	useSetModel,
	useSetPostRetirementReturn,
} from '../stores/retirementPlannerStore'
import { ErrorBoundary } from './ErrorBoundary'
import { RetirementTimelineChart } from './RetirementTimelineChart'
import { Card } from './ui/Card'
import { CardTitle } from './ui/CardTitle'
import { FormField } from './ui/FormField'
import { FormLabel } from './ui/FormLabel'
import { GroupedAmount } from './ui/GroupedAmount'

// Applied to take-home income, not gross as in the 50% rule of thumb; kept as an
// editable starting point.
const DEFAULT_INCOME_REPLACEMENT_RATE = 0.5

// Mirrors core's module-private MAX_PROJECTION_YEARS.
const MAX_PROJECTION_YEARS = 100

type ParsedInputs =
	| { ok: true; input: Parameters<typeof solveRetirementAccumulation>[0] }
	| { ok: false; reason: 'incomplete' | 'invalid' }

// `nonPositive` (accounts exist, no contribution) must never borrow the `empty` wording.
type DerivedFigure = {
	state: 'ok' | 'empty' | 'nonPositive' | 'unreadable'
	cents: number
	// Separate from `state`: an exactly-zero source is nonPositive but was not floored.
	flooredFromNegative: boolean
	note: string | null
}

type SolveState =
	| {
			status: 'solved'
			result: RetirementAccumulationResult
			input: Parameters<typeof solveRetirementAccumulation>[0]
	  }
	| { status: 'failed'; detail: string | null }
	| null

const MODEL_COPY = {
	deplete: {
		label: 'Deplete by life expectancy',
		explanation:
			'Draw your savings down to zero by your life expectancy — you spend both the returns and the principal over your retirement.',
	},
	perpetual: {
		label: 'Perpetual safe-withdrawal',
		explanation:
			'Live off the investment returns forever without touching the principal — your nest egg lasts indefinitely.',
	},
} satisfies Record<RetirementModel, { label: string; explanation: string }>

const SOLVER_ERROR_COPY: Record<string, string> = {
	'Annual return rate must be positive (greater than 0)':
		'Please enter a valid return rate (must be greater than 0%)',
	'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.':
		'Please enter a valid return rate (must be greater than 0%)',
	'Annual return rate must be at least 0.1% to avoid precision issues in calculations.':
		'Return rate must be at least 0.1% to ensure accurate calculations',
	'Annual return rate must be a finite number':
		'Please enter a valid expected annual return (while saving)',
	'Annual return rate must be a non-negative finite number':
		'Please enter a valid expected annual return (while saving) — it cannot be negative',
	'Post-retirement return rate must be a finite number':
		'Please enter a valid post-retirement annual return',
	'Post-retirement return rate must be a non-negative finite number':
		'Please enter a valid post-retirement annual return — it cannot be negative',
	'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.':
		'The calculated amount is too large. Please try smaller values.',
	'Calculation overflow: Required assets exceeds safe integer limit.':
		'The calculated amount is too large. Please try smaller values.',
	'Calculation overflow: Withdrawal amount exceeds safe integer limit.':
		'The calculated amount is too large. Please try smaller values.',
	'Number of years must not exceed 100 to prevent performance issues and calculation overflow.':
		'Please enter a projection period of 100 years or less',
	// With two rates this also fires on a long life expectancy, so it must not blame income alone.
	'Required nest egg exceeds safe integer limit.':
		'These numbers are too large to plan for. Check your life expectancy, and the gap between your two return rates — a big gap over a very long retirement grows beyond what can be calculated.',
	'Projection overflow: nest egg exceeds safe integer limit. Try smaller values or fewer months.':
		'Your savings grow beyond what can be calculated. Please try smaller amounts.',
	'Current saved amount must be a finite number':
		'We could not read your saved amount. Please check your investment accounts on the Balance Tracking page.',
	'Monthly savings must be a finite number':
		'We could not read your monthly savings. Please check the monthly contributions on your Balance Tracking page.',
	'Current age must be a finite number': 'Please enter a valid current age.',
	'Life expectancy must be a finite number': 'Please enter a valid life expectancy.',
	'Desired annual income must be a finite number':
		'Please enter a valid desired retirement income.',
}

// Keyed on exact core error strings, so a reworded core guard silently loses its detail line.
export function describeSolverError(error: unknown): string | null {
	return error instanceof Error ? (SOLVER_ERROR_COPY[error.message] ?? null) : null
}

// Re-checks the safe-integer bound: × 12 happens after parseCurrencyToCents' guard.
function toAnnualIncomeCents(amountCents: number, basis: IncomeBasis): number {
	if (basis === 'annual') {
		return amountCents
	}

	const annualCents = amountCents * 12

	if (!Number.isSafeInteger(annualCents)) {
		throw new Error('Invalid currency: value exceeds safe integer limit')
	}

	return annualCents
}

// Stops at retirement when reachable, else life expectancy: a curve still accumulating past
// retirement would contradict the deplete plan. Floored at 1, capped at MAX_PROJECTION_YEARS.
function chartHorizonYears(
	input: Parameters<typeof solveRetirementAccumulation>[0],
	result: RetirementAccumulationResult
): number {
	const yearsToRetirement =
		result.reachable && result.earliestRetirementAge !== null
			? Math.ceil(result.earliestRetirementAge - input.currentAge)
			: null

	const horizon =
		yearsToRetirement === null
			? Math.max(0, input.lifeExpectancy - input.currentAge)
			: Math.max(1, yearsToRetirement)

	return Math.min(MAX_PROJECTION_YEARS, horizon)
}

// Both derived figures come from investment rows and are floored at zero at the binding boundary,
// so the display matches what the solver and chart receive.
function RetirementAccumulationPlannerInner() {
	const { mode, currency, locale } = useCurrencyPreferences()
	// Nest-egg base, not net worth: assets-only, and asset rows are excluded because this figure
	// is compounded at the investment return rate.
	const totalInvestmentCents = useTotalInvestmentBalance()
	const balanceEntries = useBalanceEntries()
	const incomeSources = useIncomeSources()
	const expenses = useExpenses()

	// Floored here, not downstream, so the card never shows a negative beside solver figures
	// computed from zero (core clamps too).

	const derivedCurrentSaved = useMemo<DerivedFigure>(() => {
		if (!balanceEntries.some((entry) => entry.type === 'investment')) {
			return {
				state: 'empty',
				cents: 0,
				flooredFromNegative: false,
				note: 'Only investment accounts count toward your nest egg — add them on the Balance Tracking page.',
			}
		}
		// Hand-edited or legacy localStorage can make this NaN, Infinity or fractional: formatCurrency
		// would show 0.00 while the solver throws.
		if (!Number.isSafeInteger(totalInvestmentCents)) {
			return {
				state: 'unreadable',
				cents: 0,
				flooredFromNegative: false,
				note: "We couldn't read your investment account balances.",
			}
		}
		if (totalInvestmentCents < 0) {
			return {
				state: 'nonPositive',
				cents: 0,
				flooredFromNegative: true,
				note: 'Your investment accounts currently net below zero, so this plan assumes nothing saved yet.',
			}
		}
		if (totalInvestmentCents === 0) {
			// Accounts exist but hold nothing. Not floored, so no "worse than shown"
			// caveat — but it still must not read like the empty state.
			return {
				state: 'nonPositive',
				cents: 0,
				flooredFromNegative: false,
				note: 'Your investment accounts currently hold nothing.',
			}
		}
		return { state: 'ok', cents: totalInvestmentCents, flooredFromNegative: false, note: null }
	}, [balanceEntries, totalInvestmentCents])

	// Contributions recorded as expenses still count in full: that flag only affects the savings pool.
	// monthlyContributionCents throws on a non-finite amount (caught below).
	const derivedMonthlySavings = useMemo<DerivedFigure>(() => {
		// `entry != null`: persisted arrays can hold null from a truncated write. Insurance only:
		// useTotalInvestmentBalance currently throws on the same element first.
		const investments = balanceEntries.filter(
			(entry) => entry != null && entry.type === 'investment'
		)

		if (investments.length === 0) {
			return {
				state: 'empty',
				cents: 0,
				flooredFromNegative: false,
				note: 'Add an investment account on the Balance Tracking page, and say what you put in each month.',
			}
		}

		let total = 0
		// Counted per row because the clamp erases the evidence. Not `flooredFromNegative`, which
		// describes the whole figure, not individual rows.
		let negativeRows = 0
		try {
			for (const entry of investments) {
				const monthly = monthlyContributionCents(entry)
				if (monthly < 0) {
					negativeRows += 1
				}
				// Clamped per row then summed, matching the savings pool to the cent; clamping the total
				// would let one negative row eat another's contribution.
				total += Math.max(0, monthly)
			}
		} catch {
			// Reachable: the sync applier writes pulled rows unvalidated, and a throw would hit the ErrorBoundary.
			return {
				state: 'unreadable',
				cents: 0,
				flooredFromNegative: false,
				note: "We couldn't read your investment account contributions.",
			}
		}

		// Only overflow reaches this; every summand is already an integer.
		if (!Number.isSafeInteger(total)) {
			return {
				state: 'unreadable',
				cents: 0,
				flooredFromNegative: false,
				note: "We couldn't read your investment account contributions.",
			}
		}

		// Two different zeros: 'clamped up from negative' must not get the 'add a contribution' advice.
		if (total === 0) {
			if (negativeRows > 0) {
				return {
					state: 'nonPositive',
					cents: 0,
					flooredFromNegative: true,
					note: 'Your investment account contributions currently come to less than nothing, so this plan assumes nothing saved each month.',
				}
			}
			// Accounts exist but nothing goes into them: left unexplained, the plan reports this user can never retire.
			return {
				state: 'nonPositive',
				cents: 0,
				flooredFromNegative: false,
				note: 'Your investment accounts have no monthly contribution set yet — add one on the Balance Tracking page.',
			}
		}

		// A positive total that hid a clamped row overstates the honest sum; disclosed on the card only.
		return {
			state: 'ok',
			cents: total,
			flooredFromNegative: false,
			note:
				negativeRows > 0
					? 'One or more accounts have a negative monthly contribution, which this plan counts as nothing.'
					: null,
		}
	}, [balanceEntries])

	// A floored-from-negative or unreadable figure must never be presented as a neutral zero.
	const flooredFromNegative =
		derivedCurrentSaved.flooredFromNegative || derivedMonthlySavings.flooredFromNegative
	const derivedUnreadable =
		derivedCurrentSaved.state === 'unreadable' || derivedMonthlySavings.state === 'unreadable'
	const noSourceData = derivedCurrentSaved.state === 'empty'

	// Held as annual cents, not a display string, so a basis switch cannot rewrite a typed value.
	// Wrapped: a corrupt income/expense row would otherwise throw to the ErrorBoundary.
	const prefillDesiredIncomeCents = useMemo<number | null>(() => {
		try {
			const { grossIncome } = calculateNetIncomeResult(
				incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
				expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
			)
			if (grossIncome <= 0) {
				return null
			}
			return Math.round(grossIncome * 12 * DEFAULT_INCOME_REPLACEMENT_RATE)
		} catch {
			return null
		}
	}, [incomeSources, expenses])

	// A suggestion only: never a solver input, never part of the nest-egg base.
	const endingExpenses = useMemo(() => summarizeEndingExpenses(expenses), [expenses])

	// Raw input strings, so the parse gates can tell 'not filled in' from 'entered zero'.
	// The derived figures are deliberately not persisted; they track the live stores.
	const {
		currentAgeInput,
		lifeExpectancyInput,
		desiredIncomeInput,
		desiredIncomeTouched,
		adoptedMonthlyCents,
		desiredIncomeLocale,
		incomeBasis,
		annualReturnInput,
		postRetirementReturnInput,
		postRetirementTouched,
		model,
	} = useRetirementPlan()
	const setCurrentAgeInput = useSetCurrentAgeInput()
	const setLifeExpectancyInput = useSetLifeExpectancyInput()
	const setDesiredIncomeInput = useSetDesiredIncomeInput()
	const markDesiredIncomeAuthored = useMarkDesiredIncomeAuthored()
	const setDesiredIncomeForLocale = useSetDesiredIncomeForLocale()
	const setAdoptedMonthlyCents = useSetAdoptedMonthlyCents()
	const setIncomeBasis = useSetIncomeBasis()
	const setAnnualReturnInput = useSetAnnualReturnInput()
	const setPostRetirementReturn = useSetPostRetirementReturn()
	const setModel = useSetModel()

	// The post-retirement rate mirrors the accumulation rate until edited; it is stored empty (not '6.0')
	// so the mirror survives. Read effectivePostRetirementReturnInput, never the raw state.
	const effectivePostRetirementReturnInput = postRetirementTouched
		? postRetirementReturnInput
		: annualReturnInput

	// The seed is annual but the field is read in the selected basis, so it is converted as written
	// (otherwise Monthly would solve at 12x the intended income).

	// desiredIncomeTouched is the persistence guard: the prefill goes null -> real on every hydration,
	// and without it this would overwrite the saved value. Untouched seeds follow the basis.
	useEffect(() => {
		if (prefillDesiredIncomeCents === null || desiredIncomeTouched) {
			return
		}
		const seededCents =
			incomeBasis === 'annual'
				? prefillDesiredIncomeCents
				: Math.round(prefillDesiredIncomeCents / 12)
		const next = formatForInputDisplay(seededCents, locale)
		setDesiredIncomeForLocale(next, locale)
	}, [
		prefillDesiredIncomeCents,
		locale,
		incomeBasis,
		desiredIncomeTouched,
		setDesiredIncomeForLocale,
	])

	// Keep an adopted figure in the field's current basis; cleared once the user types.
	useEffect(() => {
		// resetPlan() clears desiredIncomeTouched without clearing this field, so both effects could fire.
		if (adoptedMonthlyCents === null || !desiredIncomeTouched) {
			return
		}
		const next =
			incomeBasis === 'annual'
				? toAnnualIncomeCents(adoptedMonthlyCents, 'monthly')
				: adoptedMonthlyCents
		setDesiredIncomeForLocale(formatForInputDisplay(next, locale), locale)
	}, [adoptedMonthlyCents, desiredIncomeTouched, incomeBasis, locale, setDesiredIncomeForLocale])

	// A persisted display string is locale-dependent ('55.000,00' de-DE reads as $55 in en-US):
	// parse under the locale it was written in, re-format under the current one. Also for synced values.
	useEffect(() => {
		if (desiredIncomeLocale === '' || desiredIncomeLocale === locale) {
			return
		}
		let next: string
		try {
			next = formatForInputDisplay(
				parseCurrencyToCents(desiredIncomeInput, desiredIncomeLocale),
				locale
			)
		} catch {
			// No magnitude to carry: keep the characters and adopt the locale so this does not retry every render.
			setDesiredIncomeForLocale(desiredIncomeInput, locale)
			return
		}
		setDesiredIncomeForLocale(next, locale)
	}, [locale, desiredIncomeLocale, desiredIncomeInput, setDesiredIncomeForLocale])

	// Both guards are load-bearing: empty must stay 'not filled in', and a digit-free partial ('-')
	// must stay visible rather than becoming 0.00.
	const reEcho = (setter: React.Dispatch<React.SetStateAction<string>>) => () => {
		setter((prev) =>
			prev.trim() === '' || !/\d/.test(prev)
				? prev
				: formatForInputDisplay(parseFromInput(prev, locale), locale)
		)
	}

	const parsed = useMemo<ParsedInputs>(() => {
		try {
			const currentAge = parseAge(currentAgeInput)
			const lifeExpectancy = parseAge(lifeExpectancyInput)
			const anyMoneyEmpty = desiredIncomeInput.trim() === ''
			// Test the effective value (raw is '' while mirroring); parsePercentageToDecimal returns 0
			// for '', so a cleared field would silently become 0%.
			const anyRateEmpty =
				annualReturnInput.trim() === '' || effectivePostRetirementReturnInput.trim() === ''

			if (currentAge === null || lifeExpectancy === null || anyMoneyEmpty || anyRateEmpty) {
				return { ok: false, reason: 'incomplete' }
			}

			return {
				ok: true,
				input: {
					currentAge,
					currentSavedCents: derivedCurrentSaved.cents,
					monthlySavingsCents: derivedMonthlySavings.cents,
					annualReturnRate: parsePercentageToDecimal(annualReturnInput),
					postRetirementReturnRate: parsePercentageToDecimal(effectivePostRetirementReturnInput),
					desiredAnnualIncomeCents: toAnnualIncomeCents(
						parseCurrencyToCents(desiredIncomeInput, locale),
						incomeBasis
					),
					lifeExpectancy,
					model,
				},
			}
		} catch {
			return { ok: false, reason: 'invalid' }
		}
	}, [
		currentAgeInput,
		lifeExpectancyInput,
		derivedCurrentSaved.cents,
		derivedMonthlySavings.cents,
		desiredIncomeInput,
		incomeBasis,
		annualReturnInput,
		// Derived value, not its two raw states: useExhaustiveDependencies would flag those as unused.
		effectivePostRetirementReturnInput,
		model,
		locale,
	])

	// Bundles the solved input with the result; the try/catch keeps a solver throw off the ErrorBoundary.
	const solved = useMemo<SolveState>(() => {
		if (!parsed.ok) {
			return null
		}
		try {
			return {
				status: 'solved',
				result: solveRetirementAccumulation(parsed.input),
				input: parsed.input,
			}
		} catch (e) {
			return { status: 'failed', detail: describeSolverError(e) }
		}
	}, [parsed])

	const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency, locale })

	// Reuses toAnnualIncomeCents for its post-×12 safe-integer check.
	const inBasisCents = (monthlyCents: number): number =>
		incomeBasis === 'annual' ? toAnnualIncomeCents(monthlyCents, 'monthly') : monthlyCents

	const basisNoun = incomeBasis === 'annual' ? 'a year' : 'a month'

	// Both halves required: without markDesiredIncomeAuthored the seed effect overwrites the
	// chosen value on the next hydration. Only ever called from the user's click.
	const adoptEndingExpensesFigure = (remainingMonthlyCents: number): void => {
		setDesiredIncomeForLocale(
			formatForInputDisplay(inBasisCents(remainingMonthlyCents), locale),
			locale
		)
		markDesiredIncomeAuthored(locale)
		setAdoptedMonthlyCents(remainingMonthlyCents)
	}

	const controlChrome =
		'min-h-[44px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'

	const inputClass = (withSymbol: boolean) =>
		`w-full py-3 ${mode === 'symbol' && withSymbol ? 'pl-10 pr-4' : 'px-4'} ${controlChrome}`

	// Called, not mounted as a component, so the input keeps its identity and focus while typing.
	// type="text": setSelectionRange throws on type="number".
	const currencyField = ({
		id,
		label,
		help,
		note,
		value,
		onChange,
		onUserEdit,
		children,
	}: {
		id: string
		label: string
		help: string
		note: string
		value: string
		onChange: React.Dispatch<React.SetStateAction<string>>
		// Fired on typing, not blur: tabbing through must not count as authoring the value.
		onUserEdit?: () => void
		children?: React.ReactNode
	}) => {
		// Help and note are both described, unconditionally: aria-describedby is an id list.
		const helpId = `${id}-help`
		const noteId = `${id}-note`
		return (
			<FormField>
				<FormLabel htmlFor={id} className="mb-2">
					{label}
				</FormLabel>
				<div className="relative">
					{mode === 'symbol' && (
						<span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
							{currencySymbol(currency)}
						</span>
					)}
					<input
						type="text"
						id={id}
						name={id}
						value={value}
						onChange={(e) => {
							// Latch only after sanitizing and only if the value moved from `value` (current state):
							// a rejected keystroke must not end the income seed forever.
							const sanitized = sanitizeMoneyChange(e.target, locale)
							if (sanitized !== value) {
								onUserEdit?.()
							}
							onChange(sanitized)
						}}
						onBlur={reEcho(onChange)}
						inputMode="decimal"
						placeholder="0.00"
						className={inputClass(true)}
						aria-label={label}
						aria-required="true"
						aria-describedby={`${helpId} ${noteId}`}
					/>
				</div>
				{/* Help sits directly under its input, before adjunct controls, or it reads as the select's help. */}
				<p id={helpId} className="text-sm text-muted mt-1">
					{help}
				</p>
				<p id={noteId} className="text-sm text-muted mt-1" data-testid={noteId}>
					{note}
				</p>
				{children}
			</FormField>
		)
	}

	const derivedField = ({
		id,
		label,
		caption,
		figure,
	}: {
		id: string
		label: string
		caption: string
		figure: DerivedFigure
	}) => (
		<Card variant="inset" className="p-4" data-testid={id}>
			<dt className="text-sm text-muted">{label}</dt>
			{/* Figures change when other stores update, so announce them; aria-atomic because each digit
         group is its own text node. */}
			<dd className="mt-1" aria-live="polite" aria-atomic="true">
				{/* No hydrated gate needed: stores skipHydration, so server and first client render agree on 0.00. */}
				<span className="block text-2xl font-bold text-subheading">
					<GroupedAmount text={formatAmount(figure.cents)} />
				</span>
				{/* Caption only for a real figure; otherwise 0.00 is a placeholder and the claim would be false. */}
				{figure.state === 'ok' && <span className="block text-xs text-muted mt-1">{caption}</span>}
				{figure.note !== null && (
					<span className="block text-xs text-muted mt-1">{figure.note}</span>
				)}
			</dd>
		</Card>
	)

	// Covers floored and unreadable figures: an unreadable source was handed to the solver as zero.
	const resultsCaveat = (toneClass: string) => {
		if (!flooredFromNegative && !derivedUnreadable) {
			return null
		}
		return (
			<p data-testid="derived-floor-disclosure" className={cn('text-xs mt-4', toneClass)}>
				{derivedUnreadable
					? 'Some of your saved data could not be read, so this projection assumes zero for it — treat these figures as incomplete.'
					: 'A figure above came out below zero, so this projection treats it as zero — your real position is worse than these numbers suggest.'}
			</p>
		)
	}

	return (
		<div className="space-y-8">
			<div data-testid="retirement-savings-position">
				<CardTitle as="h3" className="mb-4">
					Your Savings Position
				</CardTitle>
				<dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{derivedField({
						id: 'derived-current-saved',
						label: 'Current Amount Saved',
						caption: 'From your investment accounts',
						figure: derivedCurrentSaved,
					})}

					{derivedField({
						id: 'derived-monthly-savings',
						label: 'Monthly Savings',
						caption: 'What you put into your investment accounts each month',
						figure: derivedMonthlySavings,
					})}
				</dl>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
				<FormField>
					<FormLabel htmlFor="currentAge" className="mb-2">
						Current Age
					</FormLabel>
					<input
						type="number"
						id="currentAge"
						name="currentAge"
						value={currentAgeInput}
						onChange={(e) => setCurrentAgeInput(e.target.value)}
						inputMode="numeric"
						min="0"
						step="1"
						placeholder="35"
						className={inputClass(false)}
						aria-label="Current Age"
						aria-required="true"
					/>
					<p className="text-sm text-muted mt-1">Your age today, in years</p>
				</FormField>

				<FormField>
					<FormLabel htmlFor="lifeExpectancy" className="mb-2">
						Life Expectancy
					</FormLabel>
					<input
						type="number"
						id="lifeExpectancy"
						name="lifeExpectancy"
						value={lifeExpectancyInput}
						onChange={(e) => setLifeExpectancyInput(e.target.value)}
						inputMode="numeric"
						min="0"
						step="1"
						placeholder="90"
						className={inputClass(false)}
						aria-label="Life Expectancy"
						aria-required="true"
					/>
					<p className="text-sm text-muted mt-1">The age you plan through</p>
				</FormField>

				<div className="sm:col-span-2">
					{currencyField({
						id: 'desiredIncome',
						label: 'Desired Retirement Income',
						help: `The ${incomeBasis} income you want in retirement`,
						note: "Don't include expenses that will no longer be relevant in retirement.",
						value: desiredIncomeInput,
						onChange: setDesiredIncomeInput,
						onUserEdit: () => {
							markDesiredIncomeAuthored(locale)
							setAdoptedMonthlyCents(null)
						},
						children: (
							<>
								<FormField className="mt-2">
									<FormLabel htmlFor="incomeBasis">Income period</FormLabel>
									<select
										id="incomeBasis"
										value={incomeBasis}
										onChange={(e) => setIncomeBasis(e.target.value as IncomeBasis)}
										className={cn('w-full px-3 py-2', controlChrome)}
									>
										<option value="annual">Annual</option>
										<option value="monthly">Monthly</option>
									</select>
								</FormField>

								{/* Nothing below writes the field; the button is the only path. */}
								{endingExpenses.state !== 'none' && (
									<p
										className="mt-2 text-sm text-muted"
										data-testid="desired-income-ending-expenses"
									>
										{endingExpenses.state === 'unreadable' ? (
											// Refuse rather than render a suggestion that is silently missing money or out of range.
											"We can't total your expenses, so we can't suggest a figure."
										) : (
											<>
												Your expenses today are{' '}
												{formatAmount(inBasisCents(endingExpenses.totalMonthlyCents))} {basisNoun}.
												You've marked{' '}
												{formatAmount(inBasisCents(endingExpenses.markedMonthlyCents))} {basisNoun}{' '}
												as ending before retirement, leaving{' '}
												{formatAmount(inBasisCents(endingExpenses.remainingMonthlyCents))}.{' '}
												<button
													type="button"
													onClick={() =>
														adoptEndingExpensesFigure(endingExpenses.remainingMonthlyCents)
													}
													className="underline font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
												>
													Use this figure
												</button>
											</>
										)}
									</p>
								)}
							</>
						),
					})}
				</div>

				<FormField>
					<FormLabel htmlFor="annualReturn" className="mb-2">
						Expected Annual Return
					</FormLabel>
					<div className="relative">
						{/* type="text": a number input drops "," so 2,5 became 25%. parsePercentageToDecimal reads
               a single comma as the decimal point. */}
						<input
							type="text"
							id="annualReturn"
							name="annualReturn"
							value={annualReturnInput}
							onChange={(e) => setAnnualReturnInput(e.target.value)}
							inputMode="decimal"
							placeholder="6.0"
							className={cn(inputClass(false), 'pr-10')}
							aria-label="Expected Annual Return"
							aria-required="true"
						/>
						<span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
							%
						</span>
					</div>
					{/* The second clause is true only under deplete; under perpetual this rate only affects the curve. */}
					<p className="text-sm text-muted mt-1">
						{model === 'deplete'
							? 'Expected yearly return while you are still saving — under this model it also sets how fast your retirement income is assumed to rise'
							: 'Expected yearly return while you are still saving'}
					</p>
				</FormField>

				{/* Distinct ids: reusing annualReturn would put two controls behind one <label>. */}
				<FormField>
					<FormLabel htmlFor="postRetirementReturn" className="mb-2">
						Post-Retirement Annual Return
					</FormLabel>
					<div className="relative">
						<input
							// text, not number: see the Expected Annual Return field.
							type="text"
							id="postRetirementReturn"
							name="postRetirementReturn"
							value={effectivePostRetirementReturnInput}
							// One action writes the rate and its touched flag so they persist together.
							onChange={(e) => setPostRetirementReturn(e.target.value)}
							inputMode="decimal"
							placeholder="6.0"
							className={cn(inputClass(false), 'pr-10')}
							aria-label="Post-Retirement Annual Return"
							aria-required="true"
						/>
						<span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
							%
						</span>
					</div>
					{/* Hidden once edited: postRetirementTouched is persisted and never reset. */}
					<p className="text-sm text-muted mt-1">
						{postRetirementTouched
							? 'What your savings earn once you retire — lower it to model a safer allocation'
							: 'What your savings earn once you retire — lower it to model a safer allocation. Follows the rate above until you change it'}
					</p>
				</FormField>
			</div>

			{/* The fieldset is a transparent wrapper; panel styles on it put the rendered legend at the border edge.
         float-left/clear-both are cross-browser insurance. The legend must stay the first child. */}
			<fieldset>
				<legend className="float-left w-full block text-sm font-medium text-label mb-2">
					Retirement target model
				</legend>
				<Card
					variant="inset"
					data-testid="retirement-model-panel"
					className="clear-both p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
				>
					{(
						Object.entries(MODEL_COPY) as [
							RetirementModel,
							{ label: string; explanation: string },
						][]
					).map(([key, copy]) => (
						<label
							key={key}
							className={cn(
								'flex gap-3 p-3 min-h-[44px] rounded-lg border cursor-pointer transition-colors',
								model === key
									? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
									: 'border-gray-300 dark:border-gray-600'
							)}
						>
							<input
								type="radio"
								name="retirementModel"
								value={key}
								checked={model === key}
								onChange={() => setModel(key)}
								className="mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
							<span>
								<span className="block font-medium text-subheading">{copy.label}</span>
								<span className="block text-sm text-body mt-1">{copy.explanation}</span>
							</span>
						</label>
					))}
				</Card>
			</fieldset>

			{/* Gates key on status === 'solved', never truthiness: all-falsy gates rendered a blank void. */}
			{!parsed.ok && (
				<Card variant="inset" className="p-4 text-body" role="status">
					{parsed.reason === 'invalid'
						? 'Please check your inputs — one of the values is not a valid number.'
						: 'Enter all the details above to see your retirement outlook.'}
				</Card>
			)}

			{solved?.status === 'failed' && (
				<Card
					variant="inset"
					data-testid="accumulation-solve-failed"
					className="p-4 text-body"
					role="status"
				>
					<p>
						Those numbers are too large to compute. Please check your inputs — a value like age or
						life expectancy looks out of range.
					</p>
					{solved.detail && <p className="text-sm mt-2">{solved.detail}</p>}
					{resultsCaveat('text-body')}
				</Card>
			)}

			{/* !noSourceData: with no investment accounts and zero desired income, the solve succeeds
         and would show a confident all-zero outlook. */}
			{solved?.status === 'solved' && solved.result.reachable && !noSourceData && (
				<div
					data-testid="accumulation-outputs"
					className="p-6 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-xl"
				>
					<CardTitle as="h3" className="text-green-800 dark:text-green-300 mb-4">
						Your Retirement Outlook
					</CardTitle>
					<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
						<OutputRow
							label="Saved per year"
							value={formatAmount(solved.result.savedPerYearCents)}
							amount
						/>
						<OutputRow
							label="Total saved"
							value={formatAmount(solved.input.currentSavedCents)}
							amount
						/>
						<OutputRow
							label="Months to retirement"
							value={String(solved.result.monthsToRetirement)}
						/>
						<OutputRow
							label="Years to retirement"
							value={(solved.result.yearsToRetirement ?? 0).toFixed(1)}
						/>
						<OutputRow
							label="Earliest retirement age"
							value={String(Math.round(solved.result.earliestRetirementAge ?? 0))}
						/>
						<OutputRow
							label="Nest egg at retirement"
							value={formatAmount(solved.result.projectedNestEggCents ?? 0)}
							amount
						/>
						<OutputRow
							label="Required nest egg"
							value={formatAmount(solved.result.requiredNestEggCents ?? 0)}
							amount
						/>
						{/* Measured against current savings: on this branch the projection already meets the target. */}
						<OutputRow
							label="Still to accumulate"
							value={
								(solved.result.requiredNestEggCents ?? 0) - solved.input.currentSavedCents <= 0
									? 'Already covered'
									: formatAmount(
											(solved.result.requiredNestEggCents ?? 0) - solved.input.currentSavedCents
										)
							}
							amount
						/>
					</dl>
					{model === 'perpetual' && (
						<p className="text-xs text-green-600 dark:text-green-400 mt-4">
							Required nest egg uses the Safe Withdrawal Model — enough to withdraw{' '}
							{formatAmount(toMonthlyIncomeCents(solved.input.desiredAnnualIncomeCents, 'annual'))}{' '}
							a month without touching the principal.
						</p>
					)}
					{resultsCaveat('text-green-700 dark:text-green-300')}
				</div>
			)}

			{/* A no-data user whose plan solves must still reach the no-data arm. */}
			{solved?.status === 'solved' && (!solved.result.reachable || noSourceData) && (
				<div
					data-testid="accumulation-not-reachable"
					className="p-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl text-body"
					role="status"
				>
					{solved.input.currentAge >= solved.input.lifeExpectancy ? (
						// Targeted copy for the age-window case: the blocker is the ages, not
						// the savings, so the generic "save more" levers would mislead.
						<>
							<CardTitle as="h3" className="text-amber-800 dark:text-amber-300 mb-2">
								Your current age is at or past your life expectancy
							</CardTitle>
							<p className="text-sm">
								There&rsquo;s no retirement window to plan for. Set a life expectancy greater than
								your current age to see your outlook. You still save{' '}
								<strong>{formatAmount(solved.result.savedPerYearCents)}</strong> per year.
							</p>
						</>
					) : noSourceData ? (
						// Nothing to grow: the generic levers would tell a new user to save more on a page with no savings control.
						<>
							<CardTitle as="h3" className="text-amber-800 dark:text-amber-300 mb-2">
								We don&rsquo;t have your savings data yet
							</CardTitle>
							<p className="text-sm">
								This plan has nothing to grow yet. Add your investment accounts on the Balance
								Tracking page, along with what you put into them each month — both figures above
								fill in automatically, and your outlook appears here.
							</p>
						</>
					) : (
						<>
							<CardTitle as="h3" className="text-amber-800 dark:text-amber-300 mb-2">
								Retirement isn&rsquo;t reachable with these numbers
							</CardTitle>
							<p className="text-sm">
								Your savings don&rsquo;t reach the nest egg this plan needs before your life
								expectancy. You still save{' '}
								<strong>{formatAmount(solved.result.savedPerYearCents)}</strong> per year — try one
								of these levers:
							</p>
							{/* Savings figures are derived, so these levers name other pages. */}
							<ul className="list-disc pl-5 mt-3 text-sm space-y-1">
								<li>Put more into your investment accounts on the Balance Tracking page</li>
								<li>Retire on a lower annual income</li>
								{/* Only the post-retirement rate: under deplete a higher saving-phase rate also raises the
                   requirement (6% to 10% pushed retirement further away). */}
								<li>Assume a higher return after you retire</li>
								<li>Extend your life-expectancy horizon</li>
							</ul>
						</>
					)}
					{resultsCaveat('text-amber-800 dark:text-amber-300')}
				</div>
			)}

			{/* Accumulation only, so the post-retirement rate deliberately does not appear. */}
			<div>
				<CardTitle as="h3" className="mb-4">
					Your Savings Until Retirement
				</CardTitle>
				{solved?.status === 'solved' && parsed.ok && !noSourceData ? (
					<RetirementTimelineChart
						currentSavedCents={parsed.input.currentSavedCents}
						monthlySavingsCents={parsed.input.monthlySavingsCents}
						annualReturnRate={parsed.input.annualReturnRate}
						currentAge={parsed.input.currentAge}
						yearsToProject={chartHorizonYears(parsed.input, solved.result)}
						earliestRetirementAge={
							solved.result.reachable ? solved.result.earliestRetirementAge : null
						}
					/>
				) : (
					// Three states: 'fill in the details' beneath a 'too large' panel would contradict it.
					<Card variant="inset" className="p-8 text-center text-muted">
						<p>
							{solved?.status === 'failed'
								? 'No projection — the numbers above are out of range.'
								: parsed.ok === false && parsed.reason === 'invalid'
									? 'No projection — one of the values above is not a valid number.'
									: noSourceData
										? // A flat line at zero; say nothing rather than report reaching 0.00 decades from now.
											'No projection yet — add your investment accounts to see how your savings grow.'
										: 'Fill in the details above to see how your savings grow.'}
						</p>
					</Card>
				)}
			</div>
		</div>
	)
}

// Only `amount` rows use GroupedAmount: plain numbers like 35.2 would break at '.' in de-DE.
// The label shrinks first so a wrapped value stays right-aligned.
function OutputRow({
	label,
	value,
	amount = false,
}: {
	label: string
	value: string
	amount?: boolean
}) {
	return (
		<div className="flex justify-between items-baseline gap-4">
			<dt className="shrink-[1000] text-sm text-green-700 dark:text-green-300">{label}</dt>
			<dd className="text-right font-semibold text-green-800 dark:text-green-200">
				{amount ? <GroupedAmount text={value} /> : value}
			</dd>
		</div>
	)
}

export function RetirementAccumulationPlanner() {
	return (
		<ErrorBoundary>
			<RetirementAccumulationPlannerInner />
		</ErrorBoundary>
	)
}
