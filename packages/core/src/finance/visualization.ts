import type { CategoryKind } from './categoryKind'
import type { Frequency } from './normalization'

type FinancialDataPoint = {
	id: string | number
	name: string
	amount: number
	frequency: Frequency
	category?: string
	date?: Date
	type: CategoryKind
}

type CategoryAggregate = {
	category: string
	amount: number
	type: CategoryKind
	count: number
	color?: string
}

type RechartsDataItem = {
	name: string
	value: number
	type?: CategoryKind
	category?: string
	fill?: string
	id?: string | number
	frequency?: Frequency
	count?: number
	originalAmount?: number
}

type DrillDownState = {
	level: number
	path: string[]
	currentCategory?: string
	currentType?: CategoryKind
}

const CATEGORY_COLORS = [
	'#3B82F6',
	'#10B981',
	'#EF4444',
	'#8B5CF6',
	'#F59E0B',
	'#EC4899',
	'#14B8A6',
	'#6366F1',
	'#22C55E',
	'#F97316',
	'#06B6D4',
	'#84CC16',
	'#EAB308',
	'#A855F7',
	'#F43F5E',
	'#1E40AF',
	'#059669',
] as const

const DEFAULT_COLORS = {
	income: '#10B981',
	expense: '#EF4444',
	savings: '#8B5CF6',
	investment: '#3B82F6',
	debt: '#DC2626',
}

function aggregateByCategory(data: FinancialDataPoint[]): CategoryAggregate[] {
	const validatedData = sanitizeFinancialData(data)
	const categoryMap = new Map<string, CategoryAggregate>()

	for (const item of validatedData) {
		const category = item.category ?? item.name
		const key = `${item.type}:${category}`

		if (!categoryMap.has(key)) {
			categoryMap.set(key, {
				category,
				amount: 0,
				type: item.type,
				count: 0,
			})
		}

		const aggregate = categoryMap.get(key)
		if (aggregate) {
			aggregate.amount += item.amount
			aggregate.count += 1
		}
	}

	return Array.from(categoryMap.values())
}

function aggregateByCategoryAndType(
	data: FinancialDataPoint[]
): Map<CategoryKind, CategoryAggregate[]> {
	const result = new Map<CategoryKind, CategoryAggregate[]>()
	result.set('income', [])
	result.set('expense', [])

	const validatedData = sanitizeFinancialData(data)
	const categoryMap = new Map<string, CategoryAggregate>()

	for (const item of validatedData) {
		const category = item.category ?? item.name
		const mapKey = `${item.type}:${category}`

		if (!categoryMap.has(mapKey)) {
			categoryMap.set(mapKey, {
				category,
				amount: 0,
				type: item.type,
				count: 0,
			})
		}

		const aggregate = categoryMap.get(mapKey)
		if (aggregate) {
			aggregate.amount += item.amount
			aggregate.count += 1
		}
	}

	for (const aggregate of categoryMap.values()) {
		result.get(aggregate.type)?.push(aggregate)
	}

	return result
}

function getTopCategories(aggregates: CategoryAggregate[], limit = 10): CategoryAggregate[] {
	return [...aggregates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, limit)
}

function groupSmallCategories(
	aggregates: CategoryAggregate[],
	topLimit = 8,
	otherThreshold = 0.05
): CategoryAggregate[] {
	if (aggregates.length <= topLimit) {
		return aggregates
	}

	const sorted = [...aggregates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
	const topItems = sorted.slice(0, topLimit)
	const otherItems = sorted.slice(topLimit)

	const totalAmount = aggregates.reduce((sum, item) => sum + Math.abs(item.amount), 0)

	const otherTotal = otherItems.reduce((sum, item) => sum + Math.abs(item.amount), 0)

	if (otherTotal > 0 && otherTotal / totalAmount >= otherThreshold) {
		const firstOtherType = otherItems[0]?.type ?? 'expense'
		topItems.push({
			category: 'Other',
			amount: firstOtherType === 'income' ? otherTotal : -otherTotal,
			type: firstOtherType,
			count: otherItems.reduce((sum, item) => sum + item.count, 0),
		})
	}

	return topItems
}

function toPieChartData(
	aggregates: CategoryAggregate[],
	colorMap: Record<string, string> = {}
): RechartsDataItem[] {
	return aggregates.map((agg, index) => ({
		name: agg.category,
		value: Math.abs(agg.amount),
		type: agg.type,
		category: agg.category,
		fill: colorMap[agg.category] || CATEGORY_COLORS[index % CATEGORY_COLORS.length],
		originalAmount: agg.amount,
		count: agg.count,
	}))
}

function toBarChartData(data: FinancialDataPoint[], categoryOrder?: string[]): RechartsDataItem[] {
	const categoryMap = new Map<string, RechartsDataItem>()

	for (const item of data) {
		const category = item.category ?? item.name

		if (!categoryMap.has(category)) {
			categoryMap.set(category, {
				name: category,
				value: 0,
				type: item.type,
				category,
				fill: CATEGORY_COLORS[categoryMap.size % CATEGORY_COLORS.length],
			})
		}

		const chartItem = categoryMap.get(category)
		if (chartItem) {
			chartItem.value += Math.abs(item.amount)
		}
	}

	const result = Array.from(categoryMap.values())

	if (categoryOrder) {
		result.sort((a, b) => {
			const aIndex = categoryOrder.indexOf(a.name)
			const bIndex = categoryOrder.indexOf(b.name)
			if (aIndex === -1 && bIndex === -1) return b.value - a.value
			if (aIndex === -1) return 1
			if (bIndex === -1) return -1
			return aIndex - bIndex
		})
	} else {
		result.sort((a, b) => b.value - a.value)
	}

	return result
}

function toStackedBarChartData(data: FinancialDataPoint[]): {
	categories: string[]
	incomeData: number[]
	expenseData: number[]
} {
	const categoryMap = new Map<string, { income: number; expense: number }>()

	for (const item of data) {
		const category = item.category ?? item.name

		if (!categoryMap.has(category)) {
			categoryMap.set(category, { income: 0, expense: 0 })
		}

		const categoryData = categoryMap.get(category)
		if (categoryData) {
			if (item.type === 'income') {
				categoryData.income += Math.abs(item.amount)
			} else {
				categoryData.expense += Math.abs(item.amount)
			}
		}
	}

	const categories = Array.from(categoryMap.keys())
	// biome-ignore lint/style/noNonNullAssertion: cat comes from categoryMap.keys(); get() cannot be undefined and ?. would widen the element type to undefined.
	const incomeData = categories.map((cat) => categoryMap.get(cat)!.income)
	// biome-ignore lint/style/noNonNullAssertion: cat comes from categoryMap.keys(); get() cannot be undefined and ?. would widen the element type to undefined.
	const expenseData = categories.map((cat) => categoryMap.get(cat)!.expense)

	return { categories, incomeData, expenseData }
}

function createDrillDownState(): DrillDownState {
	return {
		level: 0,
		path: [],
	}
}

function drillDownToCategory(
	state: DrillDownState,
	category: string,
	type: CategoryKind
): DrillDownState {
	return {
		level: state.level + 1,
		path: [...state.path, `${type}:${category}`],
		currentCategory: category,
		currentType: type,
	}
}

function drillUp(state: DrillDownState): DrillDownState {
	if (state.level === 0) {
		return state
	}

	const newPath = state.path.slice(0, -1)
	const lastEntry = newPath.at(-1)

	return {
		level: state.level - 1,
		path: newPath,
		currentCategory: lastEntry?.split(':')[1],
		currentType: lastEntry?.split(':')[0] as CategoryKind | undefined,
	}
}

function drillToRoot(): DrillDownState {
	return {
		level: 0,
		path: [],
	}
}

function getDataForDrillDownLevel(
	allData: FinancialDataPoint[],
	state: DrillDownState
): FinancialDataPoint[] {
	if (state.level === 0) {
		return allData
	}

	let filteredData = [...allData]

	for (const pathEntry of state.path) {
		const [type, category] = pathEntry.split(':')
		filteredData = filteredData.filter(
			(item) => item.type === type && (item.category ?? item.name) === category
		)
	}

	return filteredData
}

function isDrillDownActive(state: DrillDownState): boolean {
	return state.level > 0
}

function getPercentageOfTotal(categoryAmount: number, totalAmount: number): number {
	if (totalAmount === 0) return 0
	return (Math.abs(categoryAmount) / Math.abs(totalAmount)) * 100
}

function getColorForCategory(_category: string, type: CategoryKind, _index: number): string {
	return DEFAULT_COLORS[type]
}

function generateColorMap(categories: string[]): Record<string, string> {
	const colorMap: Record<string, string> = {}

	for (let i = 0; i < categories.length; i++) {
		const category = categories[i]
		if (
			typeof category !== 'string' ||
			category === '' ||
			category === undefined ||
			category === null
		) {
			continue
		}
		const colorIndex = i % CATEGORY_COLORS.length
		// biome-ignore lint/style/noNonNullAssertion: colorIndex = i % CATEGORY_COLORS.length is always a valid index; ?. would widen to string | undefined and break the Record<string, string> assignment.
		colorMap[category] = CATEGORY_COLORS[colorIndex]!
	}

	return colorMap
}

function validateFinancialData(data: FinancialDataPoint[]): boolean {
	return data.every(
		(item) =>
			typeof item?.id === 'string' &&
			typeof item?.name === 'string' &&
			typeof item?.amount === 'number' &&
			Number.isFinite(item?.amount) &&
			typeof item?.frequency === 'string' &&
			(item.type === 'income' || item.type === 'expense')
	)
}

function sanitizeFinancialData(data: FinancialDataPoint[]): FinancialDataPoint[] {
	return data.filter(
		(item) =>
			typeof item?.id === 'string' &&
			typeof item?.name === 'string' &&
			typeof item?.amount === 'number' &&
			Number.isFinite(item?.amount) &&
			typeof item?.frequency === 'string' &&
			(item.type === 'income' || item.type === 'expense')
	)
}

export type { CategoryAggregate, DrillDownState, FinancialDataPoint, RechartsDataItem }

export {
	aggregateByCategory,
	aggregateByCategoryAndType,
	CATEGORY_COLORS,
	createDrillDownState,
	DEFAULT_COLORS,
	drillDownToCategory,
	drillToRoot,
	drillUp,
	generateColorMap,
	getColorForCategory,
	getDataForDrillDownLevel,
	getPercentageOfTotal,
	getTopCategories,
	groupSmallCategories,
	isDrillDownActive,
	sanitizeFinancialData,
	toBarChartData,
	toPieChartData,
	toStackedBarChartData,
	validateFinancialData,
}
