/**
 * Expected figures are hand-computed. Core normalizes weekly with exact 52/12 and rounds per row
 * (10000c weekly → 43333, not 43330).
 */

import { describe, expect, it } from 'vitest'
import { netWorthFromTotals } from '../../net-worth'
import { type BuildFinancialSummaryInput, buildFinancialSummary } from '../build-financial-summary'

const GENERATED_AT = new Date('2026-08-08T12:34:56.000Z')

function buildInput(overrides: Partial<BuildFinancialSummaryInput> = {}) {
	return buildFinancialSummary({
		income: [],
		expenses: [],
		balances: [],
		savings: [],
		generatedAt: GENERATED_AT,
		...overrides,
	})
}

describe('buildFinancialSummary — budget section', () => {
	it('normalizes each frequency to a monthly basis with core, rounding PER ROW', () => {
		const model = buildInput({
			income: [
				{ id: 'i1', name: 'Salary', amount: 500_000, frequency: 'monthly' },
				{ id: 'i2', name: 'Freelance', amount: 10_000, frequency: 'weekly' },
			],
			expenses: [
				{ id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' },
				{ id: 'e2', name: 'Groceries', amount: 20_000, frequency: 'weekly' },
				{ id: 'e3', name: 'Insurance', amount: 120_000, frequency: 'annually' },
			],
		})

		// 500000×1 = 500000; round(10000 × 52/12) = round(43333.33…) = 43333
		expect(model.budget.monthlyIncomeCents).toBe(543_333)
		// 150000×1 = 150000; round(20000 × 52/12) = round(86666.66…) = 86667;
		// round(120000 × 1/12) = 10000
		expect(model.budget.monthlyExpensesCents).toBe(246_667)
		expect(model.budget.monthlyNetCents).toBe(296_666)
		expect(model.budget.status).toBe('surplus')

		expect(model.budget.income[1].monthlyCents).toBe(43_333)
		expect(model.budget.expenses[2].monthlyCents).toBe(10_000)
	})

	it('normalizes a biweekly row at 26/12, rounding the half-cent up', () => {
		const model = buildInput({
			income: [{ id: 'i1', name: 'Stipend', amount: 10_000, frequency: 'biweekly' }],
		})
		// round(10000 × 26/12) = round(21666.66…) = 21667
		expect(model.budget.monthlyIncomeCents).toBe(21_667)
	})

	it('preserves the row as entered alongside its normalized figure', () => {
		const model = buildInput({
			income: [{ id: 'i1', name: 'Freelance', amount: 10_000, frequency: 'weekly' }],
		})
		expect(model.budget.income[0]).toEqual({
			id: 'i1',
			name: 'Freelance',
			amountCents: 10_000,
			frequency: 'weekly',
			monthlyCents: 43_333,
		})
	})

	it('reports a deficit when expenses exceed income', () => {
		const model = buildInput({
			income: [{ id: 'i1', name: 'Salary', amount: 100_000, frequency: 'monthly' }],
			expenses: [{ id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' }],
		})
		expect(model.budget.monthlyNetCents).toBe(-50_000)
		expect(model.budget.status).toBe('deficit')
	})

	it('reports EXACT break-even as break-even, not as a deficit', () => {
		// Core's `isSurplus` is `> 0`, so break-even would read as a deficit; pinned so the builder never adopts it.
		const model = buildInput({
			income: [{ id: 'i1', name: 'Salary', amount: 200_000, frequency: 'monthly' }],
			expenses: [{ id: 'e1', name: 'Rent', amount: 200_000, frequency: 'monthly' }],
		})
		expect(model.budget.monthlyNetCents).toBe(0)
		expect(model.budget.status).toBe('break-even')
	})
})

describe('buildFinancialSummary — net worth section', () => {
	it('totals investments and debts separately and nets them', () => {
		const model = buildInput({
			balances: [
				{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 },
				{ id: 'b2', name: 'Pension', type: 'investment', currentBalance: 1_200_000 },
				{ id: 'b3', name: 'Mortgage', type: 'debt', currentBalance: 15_000_000 },
			],
		})
		expect(model.netWorth.totalInvestmentsCents).toBe(2_000_000)
		expect(model.netWorth.totalDebtsCents).toBe(15_000_000)
		expect(model.netWorth.netCents).toBe(-13_000_000)
		expect(model.netWorth.investments).toHaveLength(2)
		expect(model.netWorth.debts).toHaveLength(1)
	})

	it('nets to zero when investments exactly offset debts', () => {
		const model = buildInput({
			balances: [
				{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 500_000 },
				{ id: 'b2', name: 'Loan', type: 'debt', currentBalance: 500_000 },
			],
		})
		expect(model.netWorth.netCents).toBe(0)
	})
})

describe('buildFinancialSummary — savings section', () => {
	it('measures overall progress across TARGETED GOALS ONLY, matching the app', () => {
		const model = buildInput({
			savings: [
				{ id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
				{ id: 's2', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 },
			],
		})
		expect(model.savings.goals[0].progressPercent).toBe(25)
		expect(model.savings.totalCurrentCents).toBe(300_000)
		expect(model.savings.totalTargetCents).toBe(1_000_000)
		// Untargeted account excluded from both sides: 25%, not 30%, matching getOverallProgress.
		expect(model.savings.overallProgressPercent).toBe(25)
	})

	it('returns null progress for an account with no target, never NaN', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 }],
		})
		expect(model.savings.goals[0].progressPercent).toBeNull()
		expect(model.savings.overallProgressPercent).toBeNull()
	})

	it('treats a missing targetAmount key exactly like an explicit null', () => {
		// A row without the key is an account (the store uses `== null`), not a corrupt row.
		const model = buildInput({
			savings: [{ id: 's1', name: 'Legacy account', currentBalance: 50_000 } as never],
		})
		expect(model.savings.unreadableCount).toBe(0)
		expect(model.savings.totalCurrentCents).toBe(50_000)
		expect(model.savings.goals[0].targetCents).toBeNull()
		expect(model.savings.goals[0].progressPercent).toBeNull()
	})

	it('caps an overfunded goal at 100%, as every other surface does', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Holiday', targetAmount: 100_000, currentBalance: 150_000 }],
		})
		expect(model.savings.goals[0].progressPercent).toBe(100)
	})

	it('rounds progress to a whole percent, as every other surface does', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Thirds', targetAmount: 300_000, currentBalance: 100_000 }],
		})
		expect(model.savings.goals[0].progressPercent).toBe(33)
	})

	it('keeps a non-positive target out of the aggregate WITHOUT poisoning it', () => {
		const model = buildInput({
			savings: [
				{ id: 's1', name: 'Emergency fund', targetAmount: 100_000, currentBalance: 50_000 },
				{ id: 's2', name: 'Corrupt', targetAmount: -100_000, currentBalance: 0 },
			],
		})
		expect(model.savings.unreadableCount).toBe(0)
		expect(model.savings.unreadableTargetCount).toBe(1)
		expect(model.savings.goals).toHaveLength(2)
		expect(model.savings.goals[1].targetCents).toBeNull()
		expect(model.savings.totalTargetCents).toBe(100_000)
		expect(model.savings.overallProgressPercent).toBe(50)
	})

	it('never divides by a zero target, and still counts the balance behind it', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Zeroed goal', targetAmount: 0, currentBalance: 50_000 }],
		})
		expect(model.savings.overallProgressPercent).toBeNull()
		expect(model.savings.isEmpty).toBe(false)
		expect(model.savings.totalCurrentCents).toBe(50_000)
		expect(model.savings.unreadableTargetCount).toBe(1)
	})
})

describe('buildFinancialSummary — corrupt rows are partitioned, never thrown on', () => {
	it('excludes a row with an unrecognised frequency and counts it', () => {
		const model = buildInput({
			income: [
				{ id: 'i1', name: 'Salary', amount: 500_000, frequency: 'monthly' },
				{ id: 'i2', name: 'Corrupt', amount: 100_000, frequency: 'fortnightly' },
			],
		})
		expect(model.budget.monthlyIncomeCents).toBe(500_000)
		expect(model.budget.income).toHaveLength(1)
		expect(model.budget.unreadableCount).toBe(1)
		expect(model.totalUnreadableCount).toBe(1)
	})

	it('excludes a NaN amount rather than rendering NaN', () => {
		const model = buildInput({
			expenses: [
				{ id: 'e1', name: 'Rent', amount: 150_000, frequency: 'monthly' },
				{ id: 'e2', name: 'Corrupt', amount: Number.NaN, frequency: 'monthly' },
			],
		})
		expect(model.budget.monthlyExpensesCents).toBe(150_000)
		expect(model.budget.unreadableCount).toBe(1)
	})

	it('excludes a non-finite balance and a non-finite savings figure', () => {
		const model = buildInput({
			balances: [
				{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
				{ id: 'b2', name: 'Corrupt', type: 'investment', currentBalance: Number.POSITIVE_INFINITY },
			],
			savings: [{ id: 's1', name: 'Corrupt', targetAmount: 100_000, currentBalance: Number.NaN }],
		})
		expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
		expect(model.netWorth.unreadableCount).toBe(1)
		expect(model.savings.unreadableCount).toBe(1)
		expect(model.savings.isEmpty).toBe(true)
		expect(model.totalUnreadableCount).toBe(2)
	})

	it('does not throw when EVERY row is corrupt', () => {
		expect(() =>
			buildInput({
				income: [{ id: 'i1', name: 'Bad', amount: Number.NaN, frequency: 'weekly' }],
				balances: [{ id: 'b1', name: 'Bad', type: 'investment', currentBalance: Number.NaN }],
				savings: [{ id: 's1', name: 'Bad', targetAmount: null, currentBalance: Number.NaN }],
			})
		).not.toThrow()
	})
})

describe('buildFinancialSummary — empty and large states', () => {
	it('marks every section empty and the whole report empty with no data', () => {
		const model = buildInput()
		expect(model.budget.isEmpty).toBe(true)
		expect(model.netWorth.isEmpty).toBe(true)
		expect(model.savings.isEmpty).toBe(true)
		expect(model.isEmpty).toBe(true)
		expect(model.budget.monthlyNetCents).toBe(0)
		expect(model.netWorth.netCents).toBe(0)
		expect(model.savings.overallProgressPercent).toBeNull()
	})

	it('is NOT empty when only one section has data', () => {
		const model = buildInput({
			balances: [{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 1 }],
		})
		expect(model.isEmpty).toBe(false)
		expect(model.budget.isEmpty).toBe(true)
		expect(model.netWorth.isEmpty).toBe(false)
	})

	it('handles a large multi-page data set without loss of precision', () => {
		const income = Array.from({ length: 120 }, (_, index) => ({
			id: `i${index}`,
			name: `Source ${index}`,
			amount: 1_000,
			frequency: 'monthly',
		}))
		const model = buildInput({ income })
		expect(model.budget.income).toHaveLength(120)
		expect(model.budget.monthlyIncomeCents).toBe(120_000)
		expect(model.budget.unreadableCount).toBe(0)
	})
})

describe('buildFinancialSummary — header', () => {
	it('renders the generated-at date as a locale-neutral ISO day', () => {
		expect(buildInput().generatedAtISO).toBe('2026-08-08')
	})
})

describe('buildFinancialSummary — corrupt balance CATEGORY', () => {
	it('excludes a row whose type is neither investment nor debt, AND counts it', () => {
		const model = buildInput({
			balances: [
				{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
				{ id: 'b2', name: 'Mystery', type: 'crypto', currentBalance: 999_999 },
			],
		})
		expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
		expect(model.netWorth.netCents).toBe(100_000)
		expect(model.netWorth.investments).toHaveLength(1)
		expect(model.netWorth.unreadableCount).toBe(1)
		expect(model.totalUnreadableCount).toBe(1)
	})
})

describe('buildFinancialSummary — a fully unreadable section is not "empty"', () => {
	it('reports unreadable rows even when NOTHING readable survives', () => {
		const model = buildInput({
			income: [{ id: 'i1', name: 'Salary', amount: 500_000, frequency: 'fortnightly' }],
		})
		expect(model.isEmpty).toBe(true)
		expect(model.totalUnreadableCount).toBe(1)
	})
})

describe('buildFinancialSummary — PARITY with the app’s own selectors', () => {
	// The builder replicates these formulas (store selectors NaN on corrupt rows); these tests are the parity guard.

	/** Verbatim copy of savingsStore's getOverallProgress. */
	const canonicalOverallProgress = (
		goals: { targetAmount: number | null; currentBalance: number }[]
	): number => {
		const targeted = goals.filter((g) => g.targetAmount != null)
		const totalBalance = targeted.reduce((sum, g) => sum + g.currentBalance, 0)
		const totalTarget = targeted.reduce((sum, g) => sum + (g.targetAmount ?? 0), 0)
		if (totalTarget <= 0) return 0
		return Math.min(100, Math.round((totalBalance / totalTarget) * 100))
	}

	/** Verbatim copy of savingsStore's getSavingsProgress. */
	const canonicalGoalProgress = (target: number | null, balance: number): number | null => {
		if (target == null) return null
		if (target === 0) return 0
		return Math.min(100, Math.round((balance / target) * 100))
	}

	/** netWorthFromTotals is imported, never copied: a copied formula can't detect a change to the original. */
	const canonicalNetWorth = (
		rows: { type: string; currentBalance: number }[],
		savingsRows: { currentBalance: number }[] = []
	) => {
		const investments = rows
			.filter((r) => r.type === 'investment')
			.reduce((s, r) => s + r.currentBalance, 0)
		const debts = rows.filter((r) => r.type === 'debt').reduce((s, r) => s + r.currentBalance, 0)
		const assets = rows.filter((r) => r.type === 'asset').reduce((s, r) => s + r.currentBalance, 0)
		const savings = savingsRows.reduce((s, r) => s + r.currentBalance, 0)
		return {
			investments,
			debts,
			assets,
			savings,
			net: netWorthFromTotals({
				investmentsCents: investments,
				savingsCents: savings,
				assetsCents: assets,
				debtsCents: debts,
			}),
		}
	}

	const cleanSavings = [
		{ id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
		{ id: 's2', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 },
		{ id: 's3', name: 'Holiday', targetAmount: 100_000, currentBalance: 150_000 },
		{ id: 's4', name: 'Thirds', targetAmount: 300_000, currentBalance: 100_000 },
	]
	const cleanBalances = [
		{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 },
		{ id: 'b2', name: 'Pension', type: 'investment', currentBalance: 1_200_000 },
		{ id: 'b3', name: 'Mortgage', type: 'debt', currentBalance: 15_000_000 },
		// Distinct from every other total so a parity assertion can't pass by coincidence.
		{ id: 'b4', name: 'Condo', type: 'asset', currentBalance: 40_000_000 },
	]

	it('overall savings progress equals getOverallProgress for clean data', () => {
		const model = buildInput({ savings: cleanSavings })
		expect(model.savings.overallProgressPercent).toBe(canonicalOverallProgress(cleanSavings))
	})

	it('per-goal savings progress equals getSavingsProgress for every clean row', () => {
		const model = buildInput({ savings: cleanSavings })
		for (const [index, goal] of model.savings.goals.entries()) {
			const source = cleanSavings[index]
			expect(goal.progressPercent).toBe(
				canonicalGoalProgress(source.targetAmount, source.currentBalance)
			)
		}
	})

	it('net worth totals equal the balance-store selectors for clean data', () => {
		const model = buildInput({ balances: cleanBalances })
		const canonical = canonicalNetWorth(cleanBalances)
		expect(model.netWorth.totalInvestmentsCents).toBe(canonical.investments)
		expect(model.netWorth.totalDebtsCents).toBe(canonical.debts)
		expect(model.netWorth.totalAssetsCents).toBe(canonical.assets)
		expect(model.netWorth.netCents).toBe(canonical.net)
		// Assert components: net is invariant under misclassifying an asset as an investment.
		expect(model.netWorth.totalAssetsCents).toBe(40_000_000)
		expect(model.netWorth.totalInvestmentsCents).toBe(2_000_000)
	})

	it('net worth matches the app definition once savings are in play too (story 32.2)', () => {
		const model = buildInput({ balances: cleanBalances, savings: cleanSavings })
		const canonical = canonicalNetWorth(cleanBalances, cleanSavings)
		expect(model.netWorth.totalSavingsCents).toBe(canonical.savings)
		expect(model.netWorth.netCents).toBe(canonical.net)
	})

	it('DIVERGES from the selectors only where they are not corruption-safe', () => {
		// The one deliberate difference: selectors return NaN; the report drops and discloses.
		const corrupt = [
			{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 100_000 },
			{ id: 'b2', name: 'Bad', type: 'investment', currentBalance: Number.NaN },
		]
		expect(canonicalNetWorth(corrupt).investments).toBeNaN()
		const model = buildInput({ balances: corrupt })
		expect(model.netWorth.totalInvestmentsCents).toBe(100_000)
		expect(model.netWorth.unreadableCount).toBe(1)
	})
})

describe('buildFinancialSummary — net worth includes savings (story 32.2)', () => {
	const BALANCES = [
		{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 },
		{ id: 'b2', name: 'Pension', type: 'investment', currentBalance: 1_200_000 },
		{ id: 'b3', name: 'Mortgage', type: 'debt', currentBalance: 15_000_000 },
	]
	const SAVINGS = [
		{ id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
		{ id: 's2', name: 'Rainy day', targetAmount: null, currentBalance: 50_000 },
	]

	it('adds the savings total into netCents', () => {
		const model = buildInput({ balances: BALANCES, savings: SAVINGS })
		// 2,000,000 + 300,000 − 15,000,000, hand-computed.
		expect(model.netWorth.totalSavingsCents).toBe(300_000)
		expect(model.netWorth.netCents).toBe(-12_700_000)
		expect(model.netWorth.netCents).not.toBe(-13_000_000)
	})

	it('is NOT empty for a user who has only savings', () => {
		const model = buildInput({ savings: SAVINGS })
		expect(model.netWorth.isEmpty).toBe(false)
		expect(model.netWorth.netCents).toBe(300_000)
	})

	it('is still empty when there are no balances AND no savings', () => {
		const model = buildInput({})
		expect(model.netWorth.isEmpty).toBe(true)
		expect(model.netWorth.netCents).toBe(0)
	})

	it('counts an unreadable savings row EXACTLY ONCE across the whole document', () => {
		// Net worth must consume the savings section's total, or corrupt rows are counted twice.
		const model = buildInput({
			savings: [
				{ id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
				{ id: 's2', name: 'Corrupt', targetAmount: null, currentBalance: Number.NaN },
			],
		})
		expect(model.savings.unreadableCount).toBe(1)
		expect(model.totalUnreadableCount).toBe(1)
		expect(model.netWorth.netCents).toBe(250_000)
	})

	it('excludes an unreadable savings row from netCents without inventing a number', () => {
		const model = buildInput({
			balances: [{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 }],
			savings: [{ id: 's1', name: 'Corrupt', targetAmount: null, currentBalance: Number.NaN }],
		})
		expect(model.netWorth.netCents).toBe(800_000)
		expect(Number.isNaN(model.netWorth.netCents)).toBe(false)
	})
})

describe('buildFinancialSummary — unreadable savings and the net-worth section (32.2 review)', () => {
	const CORRUPT = { id: 's1', name: 'Corrupt', targetAmount: null, currentBalance: Number.NaN }

	it('is NOT "empty" when the only savings rows are unreadable', () => {
		const model = buildInput({ savings: [CORRUPT] })
		expect(model.savings.unreadableCount).toBe(1)
		expect(model.netWorth.isEmpty).toBe(false)
	})

	it('carries the excluded savings count for disclosure without double-counting it', () => {
		const model = buildInput({
			balances: [{ id: 'b1', name: 'ISA', type: 'investment', currentBalance: 800_000 }],
			savings: [CORRUPT],
		})
		expect(model.netWorth.excludedSavingsCount).toBe(1)
		expect(model.netWorth.unreadableCount).toBe(0)
		expect(model.totalUnreadableCount).toBe(1)
	})

	it('stays empty when there are genuinely no rows of any kind', () => {
		const model = buildInput({})
		expect(model.netWorth.isEmpty).toBe(true)
		expect(model.netWorth.excludedSavingsCount).toBe(0)
	})
})

describe('buildFinancialSummary — a corrupt TARGET must not cost a row its BALANCE', () => {
	const CORRUPT_TARGET = { id: 's1', name: 'Legacy goal', targetAmount: 0, currentBalance: 100_000 }

	it('counts the balance toward savings and net worth', () => {
		const model = buildInput({ savings: [CORRUPT_TARGET] })
		expect(model.savings.totalCurrentCents).toBe(100_000)
		expect(model.netWorth.netCents).toBe(100_000)
		expect(model.netWorth.totalSavingsCents).toBe(100_000)
	})

	it('shows no progress and no target figure for that row, and discloses why', () => {
		const model = buildInput({ savings: [CORRUPT_TARGET] })
		expect(model.savings.goals).toHaveLength(1)
		expect(model.savings.goals[0].targetCents).toBeNull()
		expect(model.savings.goals[0].progressPercent).toBeNull()
		expect(model.savings.unreadableTargetCount).toBe(1)
		expect(model.savings.unreadableCount).toBe(0)
		expect(model.totalUnreadableCount).toBe(0)
	})

	it('keeps a corrupt target out of the overall progress aggregate', () => {
		const model = buildInput({
			savings: [
				{ id: 's1', name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 },
				{ id: 's2', name: 'Legacy', targetAmount: -100_000, currentBalance: 500_000 },
			],
		})
		expect(model.savings.overallProgressPercent).toBe(25)
		expect(model.savings.totalCurrentCents).toBe(750_000)
	})

	it('never divides into a non-finite target (NaN <= 0 is false)', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Bad', targetAmount: Number.NaN, currentBalance: 100_000 }],
		})
		expect(model.savings.goals[0].progressPercent).toBeNull()
		expect(model.savings.overallProgressPercent).toBeNull()
		expect(model.savings.totalCurrentCents).toBe(100_000)
	})

	it('still excludes a row whose BALANCE cannot be read', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Bad', targetAmount: 1_000_000, currentBalance: Number.NaN }],
		})
		expect(model.savings.unreadableCount).toBe(1)
		expect(model.savings.totalCurrentCents).toBe(0)
	})

	it('rejects a STRING balance rather than coercing it', () => {
		const model = buildInput({
			savings: [{ id: 's1', name: 'Str', targetAmount: null, currentBalance: '300000' as never }],
		})
		expect(model.savings.unreadableCount).toBe(1)
		expect(model.netWorth.netCents).toBe(0)
	})
})
