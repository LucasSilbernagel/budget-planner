// Safe Withdrawal Model: FV = Ir × (12 / r) funds monthly income Ir forever at annual return r
// without touching principal.

import { type CurrencyOptions, formatCurrency } from '../format/currency'

// Rates below this produce absurdly large required assets.
const MIN_ANNUAL_RETURN_RATE = 0.001

export type RetirementInput = {
	monthlyIncome: number
	annualReturnRate: number
}

export type RetirementResult = {
	requiredAssets: number
	requiredAssetsFormatted: string
	monthlyIncome: number
	monthlyIncomeFormatted: string
	annualReturnRate: number
	annualReturnRatePercentage: number
}

export function calculateRetirementRequirement(
	input: RetirementInput,
	currencyOptions: Partial<CurrencyOptions> = {}
): RetirementResult {
	if (input.annualReturnRate <= 0) {
		throw new Error(
			'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
		)
	}

	if (input.annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
		throw new Error(
			`Annual return rate must be at least ${
				MIN_ANNUAL_RETURN_RATE * 100
			}% to avoid precision issues in calculations.`
		)
	}

	const monthlyIncomeDollars = input.monthlyIncome / 100

	const requiredAssetsDollars = monthlyIncomeDollars * (12 / input.annualReturnRate)

	const requiredAssets = Math.round(requiredAssetsDollars * 100)

	if (!Number.isSafeInteger(requiredAssets)) {
		throw new Error(
			'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.'
		)
	}

	return {
		requiredAssets,
		requiredAssetsFormatted: formatCurrency(requiredAssets, currencyOptions),
		monthlyIncome: input.monthlyIncome,
		monthlyIncomeFormatted: formatCurrency(input.monthlyIncome, currencyOptions),
		annualReturnRate: input.annualReturnRate,
		annualReturnRatePercentage: input.annualReturnRate * 100,
	}
}

// `annualReturnRate` is the WITHDRAWAL-phase (post-retirement) rate, despite its name.
export function calculateRequiredAssets(monthlyIncome: number, annualReturnRate: number): number {
	if (!Number.isFinite(monthlyIncome)) {
		throw new Error('Monthly income must be a finite number')
	}

	if (!Number.isFinite(annualReturnRate)) {
		throw new Error('Annual return rate must be a finite number')
	}

	if (annualReturnRate <= 0) {
		throw new Error(
			'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
		)
	}

	if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
		throw new Error(
			`Annual return rate must be at least ${
				MIN_ANNUAL_RETURN_RATE * 100
			}% to avoid precision issues in calculations.`
		)
	}

	const monthlyIncomeDollars = monthlyIncome / 100
	const requiredAssetsDollars = monthlyIncomeDollars * (12 / annualReturnRate)
	const requiredAssets = Math.round(requiredAssetsDollars * 100)

	if (!Number.isSafeInteger(requiredAssets)) {
		throw new Error('Calculation overflow: Required assets exceeds safe integer limit.')
	}

	return requiredAssets
}

// One constant shared with the sync schema, so the two can't drift into a hand-mirrored enum.
export const INCOME_BASES = ['monthly', 'annual'] as const

export type IncomeBasis = (typeof INCOME_BASES)[number]

// Applied at the boundary so the Safe Withdrawal Model core stays monthly-only.
export function toMonthlyIncomeCents(amountCents: number, basis: IncomeBasis): number {
	if (!Number.isFinite(amountCents)) {
		throw new Error('Income amount must be a finite number')
	}

	return basis === 'annual' ? Math.round(amountCents / 12) : amountCents
}

// WITHDRAWAL-phase rate: the inverse of calculateRequiredAssets.
export function calculateSafeMonthlyWithdrawal(assets: number, annualReturnRate: number): number {
	if (!Number.isFinite(assets)) {
		throw new Error('Assets must be a finite number')
	}

	if (!Number.isFinite(annualReturnRate)) {
		throw new Error('Annual return rate must be a finite number')
	}

	if (annualReturnRate <= 0) {
		throw new Error(
			'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.'
		)
	}

	if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
		throw new Error(
			`Annual return rate must be at least ${
				MIN_ANNUAL_RETURN_RATE * 100
			}% to avoid precision issues in calculations.`
		)
	}

	const assetsDollars = assets / 100
	const monthlyWithdrawalDollars = assetsDollars * (annualReturnRate / 12)
	const result = Math.round(monthlyWithdrawalDollars * 100)

	if (!Number.isSafeInteger(result)) {
		throw new Error('Calculation overflow: Withdrawal amount exceeds safe integer limit.')
	}

	return result
}

export type CompoundingInput = {
	principal: number
	annualContribution: number
	annualReturnRate: number
	years: number
}

export type YearlyProjection = {
	year: number
	startingBalance: number
	annualContribution: number
	endingBalance: number
}

const MAX_PROJECTION_YEARS = 100

// FV = P × (1 + r)^n + C × [((1 + r)^n - 1) / r], compounded annually and rounded each year.
export function calculateCompoundingProjection(input: CompoundingInput): YearlyProjection[] {
	const { principal, annualContribution, annualReturnRate, years } = input

	if (!Number.isFinite(principal)) {
		throw new Error('Principal must be a finite number')
	}

	if (!Number.isFinite(annualContribution)) {
		throw new Error('Annual contribution must be a finite number')
	}

	if (!Number.isFinite(annualReturnRate)) {
		throw new Error('Annual return rate must be a finite number')
	}

	if (!Number.isFinite(years)) {
		throw new Error('Number of years must be a finite number')
	}

	if (annualReturnRate <= 0) {
		throw new Error('Annual return rate must be positive (greater than 0)')
	}

	if (annualReturnRate < MIN_ANNUAL_RETURN_RATE) {
		throw new Error(
			`Annual return rate must be at least ${
				MIN_ANNUAL_RETURN_RATE * 100
			}% to avoid precision issues.`
		)
	}

	if (years < 0) {
		throw new Error('Number of years must be non-negative')
	}

	if (years === 0) {
		return []
	}

	if (years > MAX_PROJECTION_YEARS) {
		throw new Error(
			`Number of years must not exceed ${MAX_PROJECTION_YEARS} to prevent performance issues and calculation overflow.`
		)
	}

	const projections: YearlyProjection[] = []
	let currentBalance = principal

	const safeContribution = annualContribution >= 0 ? annualContribution : 0

	for (let year = 1; year <= years; year++) {
		const startingBalance = currentBalance

		const growth = Math.round(startingBalance * (1 + annualReturnRate) * 100) / 100

		currentBalance = growth + safeContribution

		if (!Number.isSafeInteger(Math.round(currentBalance))) {
			throw new Error(
				`Projection overflow at year ${year}: Result exceeds safe integer limit. Try smaller values or fewer years.`
			)
		}

		projections.push({
			year,
			startingBalance,
			annualContribution: safeContribution,
			endingBalance: Math.round(currentBalance),
		})
	}

	return projections
}

export type RetirementModel = (typeof RETIREMENT_MODELS)[number]

export const RETIREMENT_MODELS = ['deplete', 'perpetual'] as const

const MAX_RETIREMENT_SEARCH_YEARS = 150

// `principal·(1+i)^n + contribution·((1+i)^n − 1)/i`, i = rate/12, end-of-month. Monthly, not
// annual, compounding: only that reproduces the source spreadsheet at any month count.
export function projectAccumulatedNestEgg(
	principalCents: number,
	monthlyContributionCents: number,
	annualReturnRate: number,
	months: number
): number {
	if (!Number.isFinite(principalCents)) {
		throw new Error('Principal must be a finite number')
	}

	if (!Number.isFinite(monthlyContributionCents)) {
		throw new Error('Monthly contribution must be a finite number')
	}

	if (!Number.isFinite(annualReturnRate)) {
		throw new Error('Annual return rate must be a finite number')
	}

	if (!Number.isFinite(months)) {
		throw new Error('Number of months must be a finite number')
	}

	if (annualReturnRate < 0) {
		throw new Error('Annual return rate must be non-negative')
	}

	if (months < 0) {
		throw new Error('Number of months must be non-negative')
	}

	if (!Number.isInteger(months)) {
		throw new Error('Number of months must be an integer')
	}

	const principalDollars = Math.max(0, principalCents) / 100
	const contributionDollars = Math.max(0, monthlyContributionCents) / 100
	const monthlyRate = annualReturnRate / 12

	// Guards `0 × Infinity = NaN` when `months` is astronomically large.
	if (principalDollars === 0 && contributionDollars === 0) {
		return 0
	}

	let futureValueDollars: number
	if (monthlyRate === 0) {
		futureValueDollars = principalDollars + contributionDollars * months
	} else {
		const growthFactor = (1 + monthlyRate) ** months
		futureValueDollars =
			principalDollars * growthFactor + contributionDollars * ((growthFactor - 1) / monthlyRate)
	}

	const nestEggCents = Math.round(futureValueDollars * 100)

	if (!Number.isSafeInteger(nestEggCents)) {
		throw new Error(
			'Projection overflow: nest egg exceeds safe integer limit. Try smaller values or fewer months.'
		)
	}

	return nestEggCents
}

// Deplete: PV of an income growing at the accumulation rate, discounted at the post-retirement
// rate. Equal rates give k === 1 exactly, reducing to years × income.
export function calculateRequiredNestEgg(
	desiredAnnualIncomeCents: number,
	annualReturnRate: number,
	postRetirementReturnRate: number,
	retirementAge: number,
	lifeExpectancy: number,
	model: RetirementModel
): number {
	if (!Number.isFinite(desiredAnnualIncomeCents)) {
		throw new Error('Desired annual income must be a finite number')
	}

	// FINITE checks first, then the branch: a non-negative check above the perpetual branch would
	// replace calculateRequiredAssets' pinned "must be positive" message.
	if (!Number.isFinite(annualReturnRate)) {
		throw new Error('Annual return rate must be a finite number')
	}

	if (!Number.isFinite(postRetirementReturnRate)) {
		throw new Error('Post-retirement return rate must be a finite number')
	}

	if (model === 'perpetual') {
		const monthlyIncomeCents = toMonthlyIncomeCents(desiredAnnualIncomeCents, 'annual')
		const requiredCents = calculateRequiredAssets(monthlyIncomeCents, postRetirementReturnRate)

		// Then the accumulation rate, which perpetual doesn't use but must not accept as garbage.
		if (annualReturnRate < 0) {
			throw new Error('Annual return rate must be a non-negative finite number')
		}

		return requiredCents
	}

	// A post-retirement rate of -1 makes k infinite, and nothing downstream catches it.
	if (annualReturnRate < 0) {
		throw new Error('Annual return rate must be a non-negative finite number')
	}

	if (postRetirementReturnRate < 0) {
		throw new Error('Post-retirement return rate must be a non-negative finite number')
	}

	if (!Number.isFinite(retirementAge)) {
		throw new Error('Retirement age must be a finite number')
	}

	if (!Number.isFinite(lifeExpectancy)) {
		throw new Error('Life expectancy must be a finite number')
	}

	const yearsInRetirement = Math.max(0, lifeExpectancy - retirementAge)
	const incomeCents = Math.max(0, desiredAnnualIncomeCents)

	// Short-circuit zero income: with k > 1 and a huge horizon the factor is Infinity, and
	// 0 × Infinity is NaN.
	if (incomeCents === 0) {
		return 0
	}

	const k = (1 + annualReturnRate) / (1 + postRetirementReturnRate)
	// Removable singularity: at k = 1 the closed form is 0/0.
	const annuityFactor = k === 1 ? yearsInRetirement : (1 - k ** yearsInRetirement) / (1 - k)

	// `+ 0` normalizes -0 (zero years with k > 1), which `toBe(0)` would reject.
	const requiredCents = Math.round(incomeCents * annuityFactor) + 0

	if (!Number.isSafeInteger(requiredCents)) {
		throw new Error('Required nest egg exceeds safe integer limit.')
	}

	return requiredCents
}

export type RetirementAccumulationInput = {
	currentAge: number
	currentSavedCents: number
	monthlySavingsCents: number
	annualReturnRate: number // ACCUMULATION-phase rate, decimal
	postRetirementReturnRate: number // WITHDRAWAL-phase rate, decimal
	desiredAnnualIncomeCents: number // cents per year
	lifeExpectancy: number
	model: RetirementModel
}

export type RetirementAccumulationResult = {
	reachable: boolean
	savedPerYearCents: number
	monthsToRetirement: number | null
	yearsToRetirement: number | null
	earliestRetirementAge: number | null
	projectedNestEggCents: number | null
	requiredNestEggCents: number | null
}

// The projected nest egg rises with time and the required one doesn't, so at most one crossing
// exists. The two rates drive disjoint halves of the search.
export function solveRetirementAccumulation(
	input: RetirementAccumulationInput
): RetirementAccumulationResult {
	const {
		currentAge,
		currentSavedCents,
		monthlySavingsCents,
		annualReturnRate,
		postRetirementReturnRate,
		desiredAnnualIncomeCents,
		lifeExpectancy,
		model,
	} = input

	if (!Number.isFinite(currentAge)) {
		throw new Error('Current age must be a finite number')
	}

	if (!Number.isFinite(lifeExpectancy)) {
		throw new Error('Life expectancy must be a finite number')
	}

	if (!Number.isFinite(monthlySavingsCents)) {
		throw new Error('Monthly savings must be a finite number')
	}

	if (!Number.isFinite(currentSavedCents)) {
		throw new Error('Current saved amount must be a finite number')
	}

	if (!Number.isFinite(desiredAnnualIncomeCents)) {
		throw new Error('Desired annual income must be a finite number')
	}

	if (!Number.isFinite(annualReturnRate) || annualReturnRate < 0) {
		throw new Error('Annual return rate must be a non-negative finite number')
	}

	if (!Number.isFinite(postRetirementReturnRate) || postRetirementReturnRate < 0) {
		throw new Error('Post-retirement return rate must be a non-negative finite number')
	}

	const savedPerYearCents = Math.max(0, monthlySavingsCents) * 12

	const notReachable = {
		reachable: false,
		savedPerYearCents,
		monthsToRetirement: null,
		yearsToRetirement: null,
		earliestRetirementAge: null,
		projectedNestEggCents: null,
		requiredNestEggCents: null,
	} satisfies RetirementAccumulationResult

	if (currentAge >= lifeExpectancy) {
		return notReachable
	}

	// Tests the POST-RETIREMENT rate: a sub-precision one would make calculateRequiredAssets throw
	// out of the search instead of reporting not reachable.
	if (model === 'perpetual' && postRetirementReturnRate < MIN_ANNUAL_RETURN_RATE) {
		return notReachable
	}

	const maxMonths = Math.min(
		Math.ceil((lifeExpectancy - currentAge) * 12),
		MAX_RETIREMENT_SEARCH_YEARS * 12
	)

	for (let months = 0; months < maxMonths; months++) {
		const retirementAge = currentAge + months / 12
		if (retirementAge >= lifeExpectancy) {
			break
		}

		const projectedNestEggCents = projectAccumulatedNestEgg(
			currentSavedCents,
			monthlySavingsCents,
			annualReturnRate,
			months
		)
		const requiredNestEggCents = calculateRequiredNestEgg(
			desiredAnnualIncomeCents,
			annualReturnRate,
			postRetirementReturnRate,
			retirementAge,
			lifeExpectancy,
			model
		)

		if (projectedNestEggCents >= requiredNestEggCents) {
			return {
				reachable: true,
				savedPerYearCents,
				monthsToRetirement: months,
				yearsToRetirement: months / 12,
				earliestRetirementAge: retirementAge,
				projectedNestEggCents,
				requiredNestEggCents,
			}
		}
	}

	return notReachable
}
