import type { NormalizableFinancialItem } from './normalization'
import { calculateTotalMonthlyNormalized } from './normalization'

// Re-exported, not redeclared: a second declaration made the name ambiguous across barrels.
export type { NormalizableFinancialItem } from './normalization'

export function calculateNetPeriodIncome(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): number {
	const sources = incomeSources || []
	const expensesArray = expenses || []
	const totalNormalizedIncome = calculateTotalMonthlyNormalized(sources)
	const totalNormalizedExpenses = calculateTotalMonthlyNormalized(expensesArray)

	return totalNormalizedIncome - totalNormalizedExpenses
}

export function calculateGrossPeriodIncome(incomeSources: NormalizableFinancialItem[]): number {
	return calculateTotalMonthlyNormalized(incomeSources || [])
}

export function calculateTotalPeriodExpenses(expenses: NormalizableFinancialItem[]): number {
	return calculateTotalMonthlyNormalized(expenses || [])
}

export type NetIncomeResult = {
	grossIncome: number
	totalExpenses: number
	netIncome: number
	isSurplus: boolean
}

export function calculateNetIncomeResult(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): NetIncomeResult {
	const grossIncome = calculateGrossPeriodIncome(incomeSources)
	const totalExpenses = calculateTotalPeriodExpenses(expenses)
	const netIncome = grossIncome - totalExpenses

	return {
		grossIncome,
		totalExpenses,
		netIncome,
		isSurplus: netIncome > 0,
	}
}
