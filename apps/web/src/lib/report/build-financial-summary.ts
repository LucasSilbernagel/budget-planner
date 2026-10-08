/**
 * Core throws on a corrupt frequency and synced rows are unvalidated, so every row is checked first;
 * unreadable ones are excluded and counted for disclosure.
 */

import type { Frequency } from '@budget-planner/core'
import { calculateNetIncomeResult, debtOwedCents, normalizeToMonthly } from '@budget-planner/core'
import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import { netWorthFromTotals } from '../net-worth'

/** `frequency` is `string`, not `Frequency`, so a corrupt persisted value is representable and can be rejected. */
interface ReportCashflowInput {
	id: string
	name: string
	amount: number
	frequency: string
}

interface ReportBalanceInput {
	id: string
	name: string
	type: string
	currentBalance: number
}

interface ReportSavingsInput {
	id: string
	name: string
	/** `null` means a savings account with no target, not a zero target. */
	targetAmount: number | null
	currentBalance: number
}

export interface BuildFinancialSummaryInput {
	income: readonly ReportCashflowInput[]
	expenses: readonly ReportCashflowInput[]
	balances: readonly ReportBalanceInput[]
	savings: readonly ReportSavingsInput[]
	generatedAt: Date
}

export interface ReportCashflowRow {
	id: string
	name: string
	amountCents: number
	frequency: string
	monthlyCents: number
}

interface ReportBalanceRow {
	id: string
	name: string
	balanceCents: number
}

interface ReportSavingsRow {
	id: string
	name: string
	targetCents: number | null
	currentCents: number
	progressPercent: number | null
}

type BudgetStatus = 'surplus' | 'deficit' | 'break-even'

interface ReportBudgetSection {
	income: ReportCashflowRow[]
	expenses: ReportCashflowRow[]
	monthlyIncomeCents: number
	monthlyExpensesCents: number
	monthlyNetCents: number
	status: BudgetStatus
	unreadableCount: number
	isEmpty: boolean
}

interface ReportNetWorthSection {
	investments: ReportBalanceRow[]
	debts: ReportBalanceRow[]
	assets: ReportBalanceRow[]
	totalInvestmentsCents: number
	totalDebtsCents: number
	totalAssetsCents: number
	totalSavingsCents: number
	netCents: number
	/** Balance rows only; savings rows are counted in their own section. */
	unreadableCount: number
	/** Disclosure only: not added to unreadableCount, which feeds the document-wide total. */
	excludedSavingsCount: number
	isEmpty: boolean
}

interface ReportSavingsSection {
	goals: ReportSavingsRow[]
	totalCurrentCents: number
	totalTargetCents: number
	overallProgressPercent: number | null
	unreadableCount: number
	/** Balance counted but target unreadable; not added to unreadableCount, which counts exclusions only. */
	unreadableTargetCount: number
	isEmpty: boolean
}

export interface FinancialSummaryReportModel {
	generatedAtISO: string
	budget: ReportBudgetSection
	netWorth: ReportNetWorthSection
	savings: ReportSavingsSection
	isEmpty: boolean
	totalUnreadableCount: number
}

const KNOWN_FREQUENCIES: ReadonlySet<string> = new Set<Frequency>([
	'weekly',
	'biweekly',
	'monthly',
	'annually',
])

/** Derived from FINANCE_TYPES: a type missing here would drop the row from both totals while counting it readable. */
const KNOWN_FINANCE_TYPES: ReadonlySet<string> = new Set<string>(FINANCE_TYPES)

type ReadableCashflow = ReportCashflowInput & { frequency: Frequency }

function isReadableCashflow(row: ReportCashflowInput): row is ReadableCashflow {
	return Number.isFinite(row.amount) && KNOWN_FREQUENCIES.has(row.frequency)
}

function isReadableBalance(row: ReportBalanceInput): boolean {
	return Number.isFinite(row.currentBalance) && KNOWN_FINANCE_TYPES.has(row.type)
}

/** Number.isFinite doesn't coerce, so a string balance is rejected (elsewhere it would concatenate). */
function hasReadableBalance(row: ReportSavingsInput): boolean {
	return Number.isFinite(row.currentBalance)
}

/**
 * `== null` on purpose: an absent targetAmount means no target, like null.
 * A non-positive target can only come from legacy data, so it is corrupt.
 */
function hasUsableTarget(row: ReportSavingsInput): boolean {
	if (row.targetAmount == null) {
		return false
	}
	return Number.isFinite(row.targetAmount) && row.targetAmount > 0
}

function hasCorruptTarget(row: ReportSavingsInput): boolean {
	return row.targetAmount != null && !hasUsableTarget(row)
}

function toCashflowRow(row: ReadableCashflow): ReportCashflowRow {
	return {
		id: row.id,
		name: row.name,
		amountCents: row.amount,
		frequency: row.frequency,
		monthlyCents: normalizeToMonthly(row.amount, row.frequency),
	}
}

function buildBudget(
	income: readonly ReportCashflowInput[],
	expenses: readonly ReportCashflowInput[]
): ReportBudgetSection {
	const readableIncome = income.filter(isReadableCashflow)
	const readableExpenses = expenses.filter(isReadableCashflow)
	const unreadableCount =
		income.length - readableIncome.length + (expenses.length - readableExpenses.length)

	const totals = calculateNetIncomeResult(
		readableIncome.map((row) => ({ amount: row.amount, frequency: row.frequency })),
		readableExpenses.map((row) => ({ amount: row.amount, frequency: row.frequency }))
	)

	// Not core's `isSurplus`, which reports a deficit at exact break-even.
	let status: BudgetStatus = 'break-even'
	if (totals.netIncome > 0) {
		status = 'surplus'
	} else if (totals.netIncome < 0) {
		status = 'deficit'
	}

	return {
		income: readableIncome.map(toCashflowRow),
		expenses: readableExpenses.map(toCashflowRow),
		monthlyIncomeCents: totals.grossIncome,
		monthlyExpensesCents: totals.totalExpenses,
		monthlyNetCents: totals.netIncome,
		status,
		unreadableCount,
		isEmpty: readableIncome.length === 0 && readableExpenses.length === 0,
	}
}

/**
 * Sums re-derived over readable rows because the store selectors return NaN on one corrupt row.
 * `savings` is the built section so corrupt savings rows aren't counted twice.
 */
function buildNetWorth(
	balances: readonly ReportBalanceInput[],
	savings: ReportSavingsSection
): ReportNetWorthSection {
	const readableSavingsCents = savings.totalCurrentCents
	const readable = balances.filter(isReadableBalance)
	const investments = readable.filter((row) => row.type === 'investment')
	const debts = readable.filter((row) => row.type === 'debt')
	const assets = readable.filter((row) => row.type === 'asset')

	// A debt counts as the amount owed, matching the Overview and /balance.
	const balanceOf = (row: ReportBalanceInput): number =>
		row.type === 'debt' ? debtOwedCents(row.currentBalance) : row.currentBalance
	const sum = (rows: readonly ReportBalanceInput[]): number =>
		rows.reduce((total, row) => total + balanceOf(row), 0)

	const totalInvestmentsCents = sum(investments)
	const totalDebtsCents = sum(debts)
	const totalAssetsCents = sum(assets)

	const toRow = (row: ReportBalanceInput): ReportBalanceRow => ({
		id: row.id,
		name: row.name,
		balanceCents: balanceOf(row),
	})

	return {
		investments: investments.map(toRow),
		debts: debts.map(toRow),
		assets: assets.map(toRow),
		totalInvestmentsCents,
		totalDebtsCents,
		totalAssetsCents,
		totalSavingsCents: readableSavingsCents,
		netCents: netWorthFromTotals({
			investmentsCents: totalInvestmentsCents,
			savingsCents: readableSavingsCents,
			assetsCents: totalAssetsCents,
			debtsCents: totalDebtsCents,
		}),
		unreadableCount: balances.length - readable.length,
		excludedSavingsCount: savings.unreadableCount,
		// Keyed on the savings section, not balance rows: savings alone is a net worth,
		// and corrupt-only savings must not read as "nothing added".
		isEmpty: readable.length === 0 && savings.isEmpty && savings.unreadableCount === 0,
	}
}

/**
 * Must match the app's savings selectors (cap at 100, whole percent). Replicated because those
 * aren't corruption-safe; a parity test guards it.
 */
function toProgressPercent(currentCents: number, targetCents: number | null): number | null {
	// isFinite first: `NaN <= 0` is false.
	if (targetCents == null || !Number.isFinite(targetCents) || targetCents <= 0) {
		return null
	}
	return Math.min(100, Math.round((currentCents / targetCents) * 100))
}

/** A finite balance always counts; a corrupt target only costs the row its progress (disclosed separately). */
function buildSavings(savings: readonly ReportSavingsInput[]): ReportSavingsSection {
	const readable = savings.filter(hasReadableBalance)

	const totalCurrentCents = readable.reduce((total, row) => total + row.currentBalance, 0)

	// Progress uses rows with a usable target on both sides, matching the app's getOverallProgress.
	const targeted = readable.filter(hasUsableTarget)
	const targetedBalanceCents = targeted.reduce((total, row) => total + row.currentBalance, 0)
	const totalTargetCents = targeted.reduce((total, row) => total + (row.targetAmount ?? 0), 0)

	return {
		goals: readable.map((row) => ({
			id: row.id,
			name: row.name,
			// A corrupt target prints as absent, never as a figure.
			targetCents: hasUsableTarget(row) ? (row.targetAmount ?? null) : null,
			currentCents: row.currentBalance,
			progressPercent: toProgressPercent(row.currentBalance, row.targetAmount),
		})),
		totalCurrentCents,
		totalTargetCents,
		overallProgressPercent: toProgressPercent(targetedBalanceCents, totalTargetCents),
		unreadableCount: savings.length - readable.length,
		unreadableTargetCount: readable.filter(hasCorruptTarget).length,
		isEmpty: readable.length === 0,
	}
}

export function buildFinancialSummary(
	input: BuildFinancialSummaryInput
): FinancialSummaryReportModel {
	const budget = buildBudget(input.income, input.expenses)
	// Savings first: net worth consumes its filtered total, so a corrupt row is counted once.
	const savings = buildSavings(input.savings)
	const netWorth = buildNetWorth(input.balances, savings)

	return {
		generatedAtISO: input.generatedAt.toISOString().slice(0, 10),
		budget,
		netWorth,
		savings,
		isEmpty: budget.isEmpty && netWorth.isEmpty && savings.isEmpty,
		totalUnreadableCount:
			budget.unreadableCount + netWorth.unreadableCount + savings.unreadableCount,
	}
}
