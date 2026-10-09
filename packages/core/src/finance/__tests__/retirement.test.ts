// Safe Withdrawal Model: FV = monthly income × (12 / annual rate).

import { describe, expect, it } from 'vitest'
import {
	type CompoundingInput,
	calculateCompoundingProjection,
	calculateRequiredAssets,
	calculateRequiredNestEgg,
	calculateRetirementRequirement,
	calculateSafeMonthlyWithdrawal,
	projectAccumulatedNestEgg,
	type RetirementAccumulationInput,
	type RetirementInput,
	solveRetirementAccumulation,
	toMonthlyIncomeCents,
} from '../retirement'

describe('Retirement Modeler', () => {
	describe('calculateRetirementRequirement', () => {
		it('should calculate required assets for $5000/month income at 6% return', () => {
			const input: RetirementInput = {
				monthlyIncome: 500000,
				annualReturnRate: 0.06,
			}

			const result = calculateRetirementRequirement(input, { mode: 'symbol', currency: 'USD' })

			expect(result.requiredAssets).toBe(100000000)
			expect(result.monthlyIncome).toBe(500000)
			expect(result.annualReturnRate).toBe(0.06)
			expect(result.annualReturnRatePercentage).toBe(6)
			expect(result.requiredAssetsFormatted).toContain('$1,000,000')
			expect(result.monthlyIncomeFormatted).toContain('$5,000')
		})

		it('should calculate required assets for $1000/month income at 4% return', () => {
			const input: RetirementInput = {
				monthlyIncome: 100000,
				annualReturnRate: 0.04,
			}

			const result = calculateRetirementRequirement(input, { mode: 'symbol', currency: 'USD' })

			expect(result.requiredAssets).toBe(30000000)
			expect(result.requiredAssetsFormatted).toContain('$300,000')
		})

		it('should calculate required assets for $2500/month income at 5% return', () => {
			const input: RetirementInput = {
				monthlyIncome: 250000,
				annualReturnRate: 0.05,
			}

			const result = calculateRetirementRequirement(input)

			expect(result.requiredAssets).toBe(60000000)
			expect(result.annualReturnRatePercentage).toBe(5)
		})

		it('should throw error for zero return rate', () => {
			const input: RetirementInput = {
				monthlyIncome: 500000,
				annualReturnRate: 0,
			}

			expect(() => calculateRetirementRequirement(input)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should throw error for negative return rate', () => {
			const input: RetirementInput = {
				monthlyIncome: 500000,
				annualReturnRate: -0.05,
			}

			expect(() => calculateRetirementRequirement(input)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should handle edge case: very high return rate (12%)', () => {
			const input: RetirementInput = {
				monthlyIncome: 500000,
				annualReturnRate: 0.12,
			}

			const result = calculateRetirementRequirement(input)

			expect(result.requiredAssets).toBe(50000000)
		})

		it('should handle edge case: very low return rate (1%)', () => {
			const input: RetirementInput = {
				monthlyIncome: 500000,
				annualReturnRate: 0.01,
			}

			const result = calculateRetirementRequirement(input)

			expect(result.requiredAssets).toBe(600000000)
		})
	})

	describe('calculateRequiredAssets', () => {
		it('should calculate required assets for given monthly income and return rate', () => {
			const result = calculateRequiredAssets(500000, 0.06)
			expect(result).toBe(100000000)
		})

		it('should throw error for zero return rate', () => {
			expect(() => calculateRequiredAssets(500000, 0)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should handle exact calculation: $1000/month at 8% return', () => {
			const result = calculateRequiredAssets(100000, 0.08)
			expect(result).toBe(15000000)
		})
	})

	describe('calculateSafeMonthlyWithdrawal', () => {
		it('should calculate safe monthly withdrawal from $1,000,000 at 6% return', () => {
			// Reverse: Ir = FV × (r / 12).
			const result = calculateSafeMonthlyWithdrawal(100000000, 0.06)
			expect(result).toBe(500000)
		})

		it('should calculate safe monthly withdrawal from $500,000 at 4% return', () => {
			// 50000000 × 0.04 / 12 = 166666.67 → 166667
			const result = calculateSafeMonthlyWithdrawal(50000000, 0.04)
			expect(result).toBe(166667)
		})

		it('should throw error for zero return rate', () => {
			expect(() => calculateSafeMonthlyWithdrawal(100000000, 0)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should verify round-trip calculation: income → assets → income', () => {
			const monthlyIncome = 500000
			const returnRate = 0.06

			const requiredAssets = calculateRequiredAssets(monthlyIncome, returnRate)
			const withdrawal = calculateSafeMonthlyWithdrawal(requiredAssets, returnRate)

			expect(withdrawal).toBe(monthlyIncome)
		})
	})

	describe('calculateCompoundingProjection', () => {
		it('should calculate single year projection with no contribution', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.05,
				years: 1,
			}

			const result = calculateCompoundingProjection(input)

			expect(result.length).toBe(1)
			expect(result[0].year).toBe(1)
			expect(result[0].startingBalance).toBe(1000000)
			expect(result[0].annualContribution).toBe(0)
			expect(result[0].endingBalance).toBe(1050000)
		})

		it('should calculate multi-year projection with annual contributions', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 120000,
				annualReturnRate: 0.05,
				years: 2,
			}

			const result = calculateCompoundingProjection(input)

			expect(result.length).toBe(2)

			expect(result[0].year).toBe(1)
			expect(result[0].startingBalance).toBe(1000000)
			expect(result[0].annualContribution).toBe(120000)
			expect(result[0].endingBalance).toBe(1170000)

			expect(result[1].year).toBe(2)
			expect(result[1].startingBalance).toBe(1170000)
			expect(result[1].annualContribution).toBe(120000)
			expect(result[1].endingBalance).toBe(1348500)
		})

		it('should return empty array for zero years', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.05,
				years: 0,
			}

			const result = calculateCompoundingProjection(input)

			expect(result.length).toBe(0)
		})

		it('should throw error for zero return rate', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 100000,
				annualReturnRate: 0,
				years: 2,
			}

			expect(() => calculateCompoundingProjection(input)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should throw error for negative return rate', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: -0.05,
				years: 1,
			}

			expect(() => calculateCompoundingProjection(input)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should throw error for negative years', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.05,
				years: -1,
			}

			expect(() => calculateCompoundingProjection(input)).toThrow(
				'Number of years must be non-negative'
			)
		})
	})

	describe('Mathematical Validation - Zero Tolerance', () => {
		it('should pass exact validation: Safe Withdrawal Model formula', () => {
			const input: RetirementInput = {
				monthlyIncome: 400000,
				annualReturnRate: 0.06,
			}

			const result = calculateRetirementRequirement(input)
			expect(result.requiredAssets).toBe(80000000)
		})

		it('should pass exact validation: reverse calculation', () => {
			const result = calculateSafeMonthlyWithdrawal(80000000, 0.06)
			expect(result).toBe(400000)
		})

		it('should pass exact validation: compounding with no contribution', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.1,
				years: 2,
			}

			const result = calculateCompoundingProjection(input)
			expect(result.length).toBe(2)
			expect(result[1].endingBalance).toBe(1210000)
		})

		it('should pass exact validation: compounding with contribution', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 100000,
				annualReturnRate: 0.1,
				years: 2,
			}

			const result = calculateCompoundingProjection(input)
			expect(result.length).toBe(2)
			expect(result[0].endingBalance).toBe(1200000)
			expect(result[1].endingBalance).toBe(1420000)
		})
	})

	describe('Edge Cases - Zero Tolerance for Errors', () => {
		it('should handle very large principal', () => {
			const result = calculateRequiredAssets(1000000000, 0.05)
			expect(result).toBeGreaterThan(0)
		})

		it('should handle very small return rate', () => {
			const result = calculateRequiredAssets(500000, 0.001)
			expect(result).toBe(6000000000)
		})

		it('should handle zero principal in compounding', () => {
			const input: CompoundingInput = {
				principal: 0,
				annualContribution: 100000,
				annualReturnRate: 0.05,
				years: 1,
			}

			const result = calculateCompoundingProjection(input)
			expect(result[0].endingBalance).toBe(100000)
		})

		it('should handle zero contribution in compounding', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.05,
				years: 1,
			}

			const result = calculateCompoundingProjection(input)
			expect(result[0].endingBalance).toBe(1050000)
		})

		it('should throw error for zero return rate in calculateRequiredAssets', () => {
			expect(() => calculateRequiredAssets(500000, 0)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should throw error for negative return rate in calculateRequiredAssets', () => {
			expect(() => calculateRequiredAssets(500000, -0.05)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should throw error for zero return rate in calculateSafeMonthlyWithdrawal', () => {
			expect(() => calculateSafeMonthlyWithdrawal(100000000, 0)).toThrow(
				'Annual return rate must be positive (greater than 0)'
			)
		})

		it('should handle null monthlyIncome in calculateRequiredAssets', () => {
			expect(() => calculateRequiredAssets(null as any, 0.06)).toThrow()
		})

		it('should throw error for NaN in calculateRequiredAssets parameters', () => {
			expect(() => calculateRequiredAssets(Number.NaN, 0.06)).toThrow(
				'Monthly income must be a finite number'
			)
		})

		it('should handle negative monthlyIncome value', () => {
			const result = calculateRequiredAssets(-500000, 0.06)
			expect(result).toBeLessThan(0)
		})

		it('should throw error for very large years parameter (1000 years)', () => {
			const input: CompoundingInput = {
				principal: 1000000,
				annualContribution: 0,
				annualReturnRate: 0.05,
				years: 1000,
			}

			expect(() => calculateCompoundingProjection(input)).toThrow(
				'Number of years must not exceed 100'
			)
		})

		it('should handle negative zero in retirement calculations', () => {
			const result = calculateRequiredAssets(-0, 0.06)
			expect(Object.is(result, -0)).toBe(true)
		})
	})

	// Annual input is divided by 12 at the boundary; the model itself stays monthly.
	describe('toMonthlyIncomeCents (annual/monthly boundary)', () => {
		it.each<[string, { cases: [number, 'monthly' | 'annual', number][] }]>([
			[
				'passes a monthly amount through unchanged (identity)',
				{
					cases: [
						[500000, 'monthly', 500000],
						[0, 'monthly', 0],
					],
				},
			],
			[
				'converts an annual amount to Math.round(annualCents / 12)',
				{
					cases: [
						[6000000, 'annual', 500000],
						[1000000, 'annual', 83333],
					],
				},
			],
			[
				'rounds to the nearest cent (never truncates)',
				{
					cases: [
						[100, 'annual', 8],
						[1000, 'annual', 83],
					],
				},
			],
		])('%s', (_title, { cases }) => {
			for (const [amount, period, expected] of cases) {
				expect(toMonthlyIncomeCents(amount, period)).toBe(expected)
			}
		})

		it('throws for a non-finite amount', () => {
			expect(() => toMonthlyIncomeCents(Number.NaN, 'annual')).toThrow('finite')
			expect(() => toMonthlyIncomeCents(Number.POSITIVE_INFINITY, 'monthly')).toThrow('finite')
		})

		it('is numerically equivalent to entering annual/12 as a monthly amount (end-to-end)', () => {
			const annualCents = 6000000
			const rate = 0.06

			const viaAnnual = calculateRequiredAssets(toMonthlyIncomeCents(annualCents, 'annual'), rate)
			const viaMonthly = calculateRequiredAssets(Math.round(annualCents / 12), rate)

			expect(viaAnnual).toBe(viaMonthly)
			expect(viaAnnual).toBe(100000000)
		})

		it('annual equivalence holds across representative values and rates', () => {
			const cases: Array<{ annualCents: number; rate: number }> = [
				{ annualCents: 12000000, rate: 0.04 },
				{ annualCents: 3000000, rate: 0.05 },
				{ annualCents: 1000000, rate: 0.07 },
				{ annualCents: 999999, rate: 0.06 },
			]

			for (const { annualCents, rate } of cases) {
				const viaHelper = calculateRequiredAssets(toMonthlyIncomeCents(annualCents, 'annual'), rate)
				const viaDivide = calculateRequiredAssets(Math.round(annualCents / 12), rate)
				expect(viaHelper).toBe(viaDivide)
			}
		})
	})
})

describe('Retirement Accumulation Solver', () => {
	describe('projectAccumulatedNestEgg', () => {
		it('reproduces the source-spreadsheet nest egg (~$788,649) at 202 months', () => {
			// i = 0.005, n = 202: 59,541 × 1.005^n + 1,799 × (1.005^n − 1) / 0.005
			// ≈ $788,649 (matches the spreadsheet).
			const result = projectAccumulatedNestEgg(5_954_100, 179_900, 0.06, 202)

			expect(Math.round(result / 100)).toBe(788_649)
			expect(result).toBe(78_864_923)
		})

		it('computes monthly-compounded FV for a small horizon (hand-checked)', () => {
			// i = 0.01, n = 2: 1000 × 1.0201 + 100 × 2.01 = 1221.10.
			const result = projectAccumulatedNestEgg(100_000, 10_000, 0.12, 2)

			expect(result).toBe(122_110)
		})

		it.each([
			[
				'returns the principal unchanged when months = 0',
				{
					args: [5_954_100, 179_900, 0.06, 0],
					expected: 5_954_100,
				},
			],
			[
				'degrades to linear accumulation at zero return',
				{
					args: [200_000, 50_000, 0, 24],
					expected: 1_400_000,
				},
			],
			[
				'treats negative principal and contribution as zero (never negative)',
				{
					args: [-100_000, -5_000, 0.06, 12],
					expected: 0,
				},
			],
			// (1 + i)^months can overflow to Infinity, and 0 × Infinity = NaN.
			[
				'returns 0 for zero principal and zero contribution at any horizon (no false overflow)',
				{
					args: [0, 0, 0.06, 200_000],
					expected: 0,
				},
			],
		] as const)('%s', (_title, { args: [principal, contribution, rate, months], expected }) => {
			expect(projectAccumulatedNestEgg(principal, contribution, rate, months)).toBe(expected)
		})

		it('throws on non-finite, negative, or non-integer inputs', () => {
			expect(() => projectAccumulatedNestEgg(Number.NaN, 0, 0.06, 12)).toThrow('finite')
			expect(() => projectAccumulatedNestEgg(1000, 0, -0.01, 12)).toThrow('non-negative')
			expect(() => projectAccumulatedNestEgg(1000, 0, 0.06, -1)).toThrow('non-negative')
			expect(() => projectAccumulatedNestEgg(1000, 0, 0.06, 12.5)).toThrow('integer')
		})
	})

	describe('calculateRequiredNestEgg', () => {
		it('deplete: required = yearsInRetirement × desiredAnnualIncome (exact cents)', () => {
			expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 65, 80, 'deplete')).toBe(60_000_000)
		})

		it('deplete: works at zero return (growth = discount = 0 collapses the same way)', () => {
			// With both rates 0 the growth/discount cancellation still holds.
			expect(calculateRequiredNestEgg(4_000_000, 0, 0, 65, 80, 'deplete')).toBe(60_000_000)
		})

		it('deplete: retirement age at/after life expectancy needs nothing', () => {
			expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 80, 80, 'deplete')).toBe(0)
			expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 85, 80, 'deplete')).toBe(0)
		})

		it('perpetual: equals the shipped Safe Withdrawal Model, independent of ages', () => {
			const expected = calculateRequiredAssets(toMonthlyIncomeCents(6_000_000, 'annual'), 0.06)
			expect(expected).toBe(100_000_000)

			const required = calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 80, 'perpetual')
			expect(required).toBe(100_000_000)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 40, 120, 'perpetual')).toBe(
				100_000_000
			)
		})

		it('perpetual: throws on a non-positive return rate (shipped contract)', () => {
			expect(() => calculateRequiredNestEgg(6_000_000, 0, 0, 65, 80, 'perpetual')).toThrow(
				'positive'
			)
			expect(() => calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')).toThrow(
				'positive'
			)
		})
	})

	describe('calculateRequiredNestEgg — two-rate model', () => {
		it('deplete: a LOWER post-retirement rate increases the required nest egg', () => {
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'deplete')).toBe(150_000_000)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.05, 65, 90, 'deplete')).toBe(168_462_831)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.04, 65, 90, 'deplete')).toBe(190_305_280)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.03, 65, 90, 'deplete')).toBe(216_263_200)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.02, 65, 90, 'deplete')).toBe(247_252_237)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.01, 65, 90, 'deplete')).toBe(284_415_840)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0, 65, 90, 'deplete')).toBe(329_187_072)
		})

		it('deplete: a HIGHER post-retirement rate lowers the requirement (symmetry)', () => {
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.08, 65, 90, 'deplete')).toBeLessThan(
				calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'deplete')
			)
		})

		it('perpetual: sized by the POST-RETIREMENT rate, not the accumulation rate', () => {
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 90, 'perpetual')).toBe(100_000_000)
			expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.03, 65, 90, 'perpetual')).toBe(200_000_000)
			expect(calculateRequiredNestEgg(6_000_000, 0.12, 0.06, 65, 90, 'perpetual')).toBe(100_000_000)
		})

		// With equal rates, every single-rate expectation must reproduce bit-for-bit.
		describe('equal rates reproduce the pre-35.3 results bit-for-bit', () => {
			it('reproduces all six shipped calculateRequiredNestEgg values', () => {
				expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 65, 80, 'deplete')).toBe(60_000_000)
				expect(calculateRequiredNestEgg(4_000_000, 0, 0, 65, 80, 'deplete')).toBe(60_000_000)
				expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 80, 80, 'deplete')).toBe(0)
				expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.06, 85, 80, 'deplete')).toBe(0)
				expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 65, 80, 'perpetual')).toBe(
					100_000_000
				)
				expect(calculateRequiredNestEgg(6_000_000, 0.06, 0.06, 40, 120, 'perpetual')).toBe(
					100_000_000
				)
			})

			it('reproduces both shipped perpetual THROW contracts', () => {
				expect(() => calculateRequiredNestEgg(6_000_000, 0, 0, 65, 80, 'perpetual')).toThrow(
					'positive'
				)
				expect(() =>
					calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')
				).toThrow('positive')
			})

			it('collapses to yearsInRetirement × income across a rate/horizon matrix', () => {
				for (const rate of [0, 0.001, 0.03, 0.06, 0.07, 0.12]) {
					for (const years of [0, 1, 5, 15, 25, 40, 55]) {
						const retirementAge = 90 - years
						expect(
							calculateRequiredNestEgg(4_000_000, rate, rate, retirementAge, 90, 'deplete')
						).toBe(4_000_000 * years)
					}
				}
			})
		})

		describe('boundaries', () => {
			it('yearsInRetirement === 0 returns +0, never -0, when the post rate is LOWER', () => {
				// Post rate below accumulation makes (1 - k) negative, giving -0; a plain toBe(0) would
				// fail, and the reverse direction can't detect it.
				const result = calculateRequiredNestEgg(4_000_000, 0.06, 0.03, 80, 80, 'deplete')
				expect(Object.is(result, -0)).toBe(false)
				expect(result).toBe(0)
			})

			it('a retirement age past life expectancy clamps to 0 at unequal rates', () => {
				// Without the clamp the factor uses a negative exponent and returns a negative nest egg.
				expect(calculateRequiredNestEgg(4_000_000, 0.06, 0.03, 85, 80, 'deplete')).toBe(0)
			})

			it('a zero desired income returns 0 even on a horizon that overflows the factor', () => {
				// k > 1 with a huge horizon makes the factor Infinity, and 0 × Infinity is NaN.
				expect(calculateRequiredNestEgg(0, 0.06, 0.03, 65, 999_999, 'deplete')).toBe(0)
			})

			it('rejects a non-finite or negative post-retirement rate by name', () => {
				// Unguarded, Infinity gives k = 0 and a plausible 6000000 with no throw.
				expect(() =>
					calculateRequiredNestEgg(6_000_000, 0.06, Number.POSITIVE_INFINITY, 65, 90, 'deplete')
				).toThrow('Post-retirement return rate must be a finite number')
				expect(() =>
					calculateRequiredNestEgg(6_000_000, 0.06, Number.NaN, 65, 90, 'deplete')
				).toThrow('Post-retirement return rate must be a finite number')
				expect(() => calculateRequiredNestEgg(6_000_000, 0.06, -1, 65, 90, 'deplete')).toThrow(
					'Post-retirement return rate must be a non-negative finite number'
				)
			})

			it('rejects a negative accumulation rate under deplete, which it used to ignore', () => {
				expect(() => calculateRequiredNestEgg(6_000_000, -1, 0.06, 65, 90, 'deplete')).toThrow(
					'Annual return rate must be a non-negative finite number'
				)
			})

			it('rejects a negative accumulation rate under PERPETUAL too (review finding)', () => {
				// The non-negative check must not sit after the perpetual early return: model choice
				// must not decide whether garbage is accepted.
				expect(() => calculateRequiredNestEgg(6_000_000, -0.01, 0.06, 65, 80, 'perpetual')).toThrow(
					'Annual return rate must be a non-negative finite number'
				)
			})

			it('still reports a bad POST rate with the shipped wording under perpetual', () => {
				expect(() => calculateRequiredNestEgg(6_000_000, 0.06, 0, 65, 80, 'perpetual')).toThrow(
					'positive'
				)
				expect(() =>
					calculateRequiredNestEgg(6_000_000, -0.01, -0.01, 65, 80, 'perpetual')
				).toThrow('positive')
			})
		})
	})

	describe('solveRetirementAccumulation', () => {
		const baseInput: RetirementAccumulationInput = {
			currentAge: 35,
			currentSavedCents: 5_954_100,
			monthlySavingsCents: 179_900,
			annualReturnRate: 0.06,
			postRetirementReturnRate: 0.06,
			desiredAnnualIncomeCents: 4_000_000,
			lifeExpectancy: 80,
			model: 'deplete',
		}

		it('always reports saved-per-year = monthly × 12', () => {
			const result = solveRetirementAccumulation(baseInput)
			expect(result.savedPerYearCents).toBe(2_158_800)
		})

		it('finds the earliest reachable retirement age (deplete) with consistent outputs', () => {
			const result = solveRetirementAccumulation(baseInput)

			expect(result.reachable).toBe(true)
			expect(result.monthsToRetirement).not.toBeNull()
			const months = result.monthsToRetirement as number
			expect(Number.isInteger(months)).toBe(true)
			expect(months).toBeGreaterThanOrEqual(0)

			expect(result.yearsToRetirement).toBe(months / 12)
			expect(result.earliestRetirementAge).toBe(35 + months / 12)

			const projected = result.projectedNestEggCents as number
			const required = result.requiredNestEggCents as number
			expect(projected).toBeGreaterThanOrEqual(required)
			if (months > 0) {
				const prevAge = 35 + (months - 1) / 12
				const prevProjected = projectAccumulatedNestEgg(5_954_100, 179_900, 0.06, months - 1)
				const prevRequired = calculateRequiredNestEgg(4_000_000, 0.06, 0.06, prevAge, 80, 'deplete')
				expect(prevProjected).toBeLessThan(prevRequired)
			}
		})

		it('is deterministic (same inputs → same result)', () => {
			expect(solveRetirementAccumulation(baseInput)).toEqual(solveRetirementAccumulation(baseInput))
		})

		it('retires immediately when already fully funded (deplete)', () => {
			const result = solveRetirementAccumulation({
				...baseInput,
				currentSavedCents: 100_000_000,
				desiredAnnualIncomeCents: 1_200_000,
			})
			expect(result.reachable).toBe(true)
			expect(result.monthsToRetirement).toBe(0)
			expect(result.earliestRetirementAge).toBe(35)
		})

		it('reports not-reachable when nothing is saved and income is required (deplete)', () => {
			const result = solveRetirementAccumulation({
				...baseInput,
				currentSavedCents: 0,
				monthlySavingsCents: 0,
				desiredAnnualIncomeCents: 4_000_000,
			})
			expect(result.reachable).toBe(false)
			expect(result.monthsToRetirement).toBeNull()
			expect(result.earliestRetirementAge).toBeNull()
			expect(result.projectedNestEggCents).toBeNull()
			expect(result.requiredNestEggCents).toBeNull()
			expect(result.savedPerYearCents).toBe(0)
		})

		it('reports not-reachable when the perpetual target is never met before life expectancy', () => {
			const result = solveRetirementAccumulation({
				currentAge: 60,
				currentSavedCents: 0,
				monthlySavingsCents: 10_000,
				annualReturnRate: 0.06,
				postRetirementReturnRate: 0.06,
				desiredAnnualIncomeCents: 100_000_000,
				lifeExpectancy: 65,
				model: 'perpetual',
			})
			expect(result.reachable).toBe(false)
		})

		it('perpetual with a zero/sub-precision return rate is not reachable (no throw)', () => {
			// Override both rates: the sub-precision pre-check reads the post-retirement rate, so
			// overriding only annualReturnRate leaves the guard unfired.
			const result = solveRetirementAccumulation({
				...baseInput,
				annualReturnRate: 0,
				postRetirementReturnRate: 0,
				model: 'perpetual',
			})
			expect(result.reachable).toBe(false)
		})

		it('perpetual: a sub-precision POST-RETIREMENT rate alone is not reachable', () => {
			const result = solveRetirementAccumulation({
				...baseInput,
				annualReturnRate: 0.06,
				postRetirementReturnRate: 0,
				model: 'perpetual',
			})
			expect(result.reachable).toBe(false)
			expect(result.requiredNestEggCents).toBeNull()
		})

		it('is not reachable when current age is at or past life expectancy', () => {
			expect(
				solveRetirementAccumulation({ ...baseInput, currentAge: 80, lifeExpectancy: 80 }).reachable
			).toBe(false)
			expect(
				solveRetirementAccumulation({ ...baseInput, currentAge: 85, lifeExpectancy: 80 }).reachable
			).toBe(false)
		})

		it('always reports a finite saved-per-year, even on a not-reachable early return', () => {
			const result = solveRetirementAccumulation({
				...baseInput,
				currentAge: 80,
				lifeExpectancy: 80,
			})
			expect(result.reachable).toBe(false)
			expect(Number.isFinite(result.savedPerYearCents)).toBe(true)
		})

		it('throws on non-finite savings or a non-finite/negative rate (both models, no silent swallow)', () => {
			expect(() =>
				solveRetirementAccumulation({ ...baseInput, monthlySavingsCents: Number.NaN })
			).toThrow('finite')
			expect(() =>
				solveRetirementAccumulation({ ...baseInput, currentSavedCents: Number.NaN })
			).toThrow('finite')
			expect(() =>
				solveRetirementAccumulation({ ...baseInput, desiredAnnualIncomeCents: Number.NaN })
			).toThrow('finite')
			expect(() =>
				solveRetirementAccumulation({ ...baseInput, annualReturnRate: Number.NaN })
			).toThrow('non-negative finite')
			expect(() => solveRetirementAccumulation({ ...baseInput, annualReturnRate: -0.01 })).toThrow(
				'non-negative finite'
			)
			expect(() =>
				solveRetirementAccumulation({
					...baseInput,
					model: 'perpetual',
					annualReturnRate: Number.NaN,
				})
			).toThrow('non-negative finite')

			expect(() =>
				solveRetirementAccumulation({ ...baseInput, postRetirementReturnRate: Number.NaN })
			).toThrow('Post-retirement return rate must be a non-negative finite number')
			expect(() =>
				solveRetirementAccumulation({ ...baseInput, postRetirementReturnRate: -0.01 })
			).toThrow('Post-retirement return rate must be a non-negative finite number')
			expect(() =>
				solveRetirementAccumulation({
					...baseInput,
					model: 'perpetual',
					postRetirementReturnRate: Number.NaN,
				})
			).toThrow('Post-retirement return rate must be a non-negative finite number')
		})

		it('terminates on a non-physical life expectancy without hanging (perpetual is age-independent)', () => {
			const perpetualBase: RetirementAccumulationInput = { ...baseInput, model: 'perpetual' }
			const normal = solveRetirementAccumulation(perpetualBase)
			const huge = solveRetirementAccumulation({ ...perpetualBase, lifeExpectancy: 1_000_000 })

			expect(normal.reachable).toBe(true)
			expect(huge.reachable).toBe(true)
			expect(huge.monthsToRetirement).toBe(normal.monthsToRetirement)
		})

		describe('two-rate solving', () => {
			const sweepBase: RetirementAccumulationInput = {
				currentAge: 35,
				currentSavedCents: 5_954_100,
				monthlySavingsCents: 179_900,
				annualReturnRate: 0.06,
				postRetirementReturnRate: 0.06,
				desiredAnnualIncomeCents: 6_000_000,
				lifeExpectancy: 90,
				model: 'deplete',
			}

			it('equal rates reproduce the shipped single-rate solve exactly', () => {
				const result = solveRetirementAccumulation(sweepBase)
				expect(result.reachable).toBe(true)
				expect(result.monthsToRetirement).toBe(320)
				expect(result.earliestRetirementAge).toBe(35 + 320 / 12)
				expect(result.requiredNestEggCents).toBe(170_000_000)
			})

			it('a lower post-retirement rate pushes retirement LATER', () => {
				const months = [0.06, 0.05, 0.04, 0.03].map((postRetirementReturnRate) => {
					const result = solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
					expect(result.reachable).toBe(true)
					expect(Number.isInteger(result.monthsToRetirement)).toBe(true)
					return result.monthsToRetirement as number
				})
				expect(months).toEqual([320, 334, 348, 360])

				const required = [0.06, 0.05, 0.04, 0.03].map(
					(postRetirementReturnRate) =>
						solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
							.requiredNestEggCents as number
				)
				expect(required).toEqual([170_000_000, 185_030_631, 199_964_997, 216_263_200])
			})

			it('the requirement rises strictly as the post-retirement rate falls, both models', () => {
				for (const model of ['deplete', 'perpetual'] as const) {
					let previous = 0
					for (const postRetirementReturnRate of [0.06, 0.05, 0.04, 0.03, 0.02]) {
						const required = calculateRequiredNestEgg(
							sweepBase.desiredAnnualIncomeCents,
							sweepBase.annualReturnRate,
							postRetirementReturnRate,
							65,
							90,
							model
						)
						expect(required).toBeGreaterThan(previous)
						previous = required
					}
				}
			})

			it('the PROJECTION never sees the post-retirement rate', () => {
				// Identity, not constancy: the nest egg is reported at the earliest reachable month,
				// which legitimately differs per post rate.
				for (const postRetirementReturnRate of [0.06, 0.04, 0.03]) {
					const result = solveRetirementAccumulation({ ...sweepBase, postRetirementReturnRate })
					expect(result.reachable).toBe(true)
					expect(result.projectedNestEggCents).toBe(
						projectAccumulatedNestEgg(
							sweepBase.currentSavedCents,
							sweepBase.monthlySavingsCents,
							sweepBase.annualReturnRate,
							result.monthsToRetirement as number
						)
					)
				}
			})

			it('a low enough post-retirement rate alone makes retirement unreachable', () => {
				// Perpetual, because its requirement (annual / rate) grows without bound as the rate
				// falls; deplete stays reachable across the legal range.
				const perpetual: RetirementAccumulationInput = { ...sweepBase, model: 'perpetual' }

				const reachable = solveRetirementAccumulation(perpetual)
				expect(reachable.reachable).toBe(true)
				expect(reachable.monthsToRetirement).toBe(236)
				expect(reachable.requiredNestEggCents).toBe(100_000_000)

				// 0.5% is above the 0.1% precision floor, so this is a real not-reachable result.
				const starved = solveRetirementAccumulation({
					...perpetual,
					postRetirementReturnRate: 0.005,
				})
				expect(starved.reachable).toBe(false)
				expect(starved.monthsToRetirement).toBeNull()

				expect(
					solveRetirementAccumulation({ ...perpetual, postRetirementReturnRate: 0.006 }).reachable
				).toBe(true)
			})
		})
	})
})
