import {
	calculateGrossPeriodIncome,
	calculateNetPeriodIncome,
	type NormalizableFinancialItem,
} from './netIncome'

// Equals expenses / income, as specified, despite the name.
export function calculateSavingsCapacityPercentage(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): number {
	const sources = incomeSources || []
	const expensesArray = expenses || []
	const grossIncome = calculateGrossPeriodIncome(sources)
	const netPeriodIncome = calculateNetPeriodIncome(sources, expensesArray)

	if (grossIncome === 0) {
		return 0
	}

	const savingsCapacity = grossIncome - netPeriodIncome
	const percentage = (savingsCapacity / grossIncome) * 100

	return Math.round(percentage)
}

export function calculateMaxAllocableSavings(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): number {
	return calculateNetPeriodIncome(incomeSources || [], expenses || [])
}

export function calculateMaxDynamicallyAllocableSavings(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): number {
	const maxAllocable = calculateMaxAllocableSavings(incomeSources, expenses)
	return Math.max(0, maxAllocable)
}

export type SavingsCapacityResult = {
	grossIncome: number
	netPeriodIncome: number
	savingsCapacityPercentage: number
	maxAllocableSavings: number
}

export function calculateSavingsCapacityResult(
	incomeSources: NormalizableFinancialItem[],
	expenses: NormalizableFinancialItem[]
): SavingsCapacityResult {
	const sources = incomeSources || []
	const expensesArray = expenses || []
	const grossIncome = calculateGrossPeriodIncome(sources)
	const netPeriodIncome = calculateNetPeriodIncome(sources, expensesArray)
	const savingsCapacityPercentage = calculateSavingsCapacityPercentage(incomeSources, expenses)
	const maxAllocableSavings = netPeriodIncome

	return {
		grossIncome,
		netPeriodIncome,
		savingsCapacityPercentage,
		maxAllocableSavings,
	}
}
