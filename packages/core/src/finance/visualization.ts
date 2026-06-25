/**
 * Financial Visualization Utilities
 *
 * Provides data transformation and aggregation utilities for financial charts.
 * Supports category breakdowns, time period filtering, and drill-down functionality.
 *
 * Architecture Requirement: Story 3-3 - Enhanced income vs. expense visualization
 */

import type { Frequency } from './normalization'

// ============================================================================
// Types
// ============================================================================

/**
 * Time period filter preset options
 */
type TimePeriodPreset =
  | 'last-month'
  | 'last-3-months'
  | 'last-6-months'
  | 'year-to-date'
  | 'last-year'
  | 'custom'

/**
 * Date range for filtering
 */
interface DateRange {
  startDate: Date
  endDate: Date
}

/**
 * Financial data point with category and time information
 */
interface FinancialDataPoint {
  id: string | number
  name: string
  amount: number // in cents
  frequency: Frequency
  category?: string
  date?: Date
  type: 'income' | 'expense'
}

/**
 * Aggregated category data for charting
 */
interface CategoryAggregate {
  category: string
  amount: number // in cents
  type: 'income' | 'expense'
  count: number
  color?: string
}

/**
 * Recharts-compatible data format
 */
interface RechartsDataItem {
  name: string
  value: number // in cents
  type?: 'income' | 'expense'
  category?: string
  fill?: string
  id?: string | number
  frequency?: Frequency
  count?: number
  originalAmount?: number
}

/**
 * Drill-down state for navigation
 */
interface DrillDownState {
  level: number
  path: string[]
  currentCategory?: string
  currentType?: 'income' | 'expense'
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Time period preset configurations (in days)
 */
const TIME_PERIOD_PRESETS: Record<TimePeriodPreset, { label: string; days: number }> = {
  'last-month': { label: 'Last Month', days: 30 },
  'last-3-months': { label: 'Last 3 Months', days: 90 },
  'last-6-months': { label: 'Last 6 Months', days: 180 },
  'year-to-date': { label: 'Year to Date', days: 0 }, // Special handling
  'last-year': { label: 'Last Year', days: 365 },
  custom: { label: 'Custom Range', days: 0 }, // Special handling
}

/**
 * Default color palette for categories
 * Expanded to 16 colors to support users with many categories
 */
const CATEGORY_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#F59E0B', // Orange
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#6366F1', // Indigo
  '#22C55E', // Emerald
  '#F97316', // Amber
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#EAB308', // Yellow
  '#A855F7', // Violet
  '#F43F5E', // Rose
  '#1E40AF', // Dark Blue
  '#059669', // Dark Green
] as const

/**
 * Default colors for income and expenses
 */
const DEFAULT_COLORS = {
  income: '#10B981',
  expense: '#EF4444',
  savings: '#8B5CF6',
  investment: '#3B82F6',
  debt: '#DC2626',
}

// ============================================================================
// Time Period Filtering
// ============================================================================

/**
 * Get date range for a time period preset
 * Uses UTC to ensure consistent timezone handling across browsers
 */
function getDateRangeForPreset(preset: TimePeriodPreset, customRange?: DateRange): DateRange {
  // Use the current time as-is to preserve the time component (for tests with mocked dates)
  const now = new Date()

  // Helper to create a Date with UTC components preserving time
  const createUTCDateWithTime = (
    year: number,
    month: number,
    date: number,
    hours = 0,
    minutes = 0,
    seconds = 0,
    ms = 0
  ) => new Date(Date.UTC(year, month, date, hours, minutes, seconds, ms))

  const nowTime = now.getTime()
  const nowUTCComponents = {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
    date: now.getUTCDate(),
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    seconds: now.getUTCSeconds(),
    ms: now.getUTCMilliseconds(),
  }

  switch (preset) {
    case 'last-month':
      return {
        startDate: createUTCDateWithTime(
          nowUTCComponents.year,
          nowUTCComponents.month - 1,
          nowUTCComponents.date,
          nowUTCComponents.hours,
          nowUTCComponents.minutes,
          nowUTCComponents.seconds,
          nowUTCComponents.ms
        ),
        endDate: new Date(nowTime), // Clone to prevent mutation
      }

    case 'last-3-months':
      return {
        startDate: createUTCDateWithTime(
          nowUTCComponents.year,
          nowUTCComponents.month - 3,
          nowUTCComponents.date,
          nowUTCComponents.hours,
          nowUTCComponents.minutes,
          nowUTCComponents.seconds,
          nowUTCComponents.ms
        ),
        endDate: new Date(nowTime), // Clone to prevent mutation
      }

    case 'last-6-months':
      return {
        startDate: createUTCDateWithTime(
          nowUTCComponents.year,
          nowUTCComponents.month - 6,
          nowUTCComponents.date,
          nowUTCComponents.hours,
          nowUTCComponents.minutes,
          nowUTCComponents.seconds,
          nowUTCComponents.ms
        ),
        endDate: new Date(nowTime), // Clone to prevent mutation
      }

    case 'year-to-date':
      return {
        startDate: new Date(Date.UTC(nowUTCComponents.year, 0, 1)),
        endDate: new Date(nowTime), // Clone to prevent mutation
      }

    case 'last-year':
      return {
        startDate: createUTCDateWithTime(
          nowUTCComponents.year - 1,
          nowUTCComponents.month,
          nowUTCComponents.date,
          nowUTCComponents.hours,
          nowUTCComponents.minutes,
          nowUTCComponents.seconds,
          nowUTCComponents.ms
        ),
        endDate: new Date(nowTime), // Clone to prevent mutation
      }

    case 'custom':
      if (customRange) {
        // Return a copy to ensure immutability
        return {
          startDate: new Date(customRange.startDate.getTime()),
          endDate: new Date(customRange.endDate.getTime()),
        }
      }
      // Fallback to last month
      return {
        startDate: createUTCDateWithTime(
          nowUTCComponents.year,
          nowUTCComponents.month - 1,
          nowUTCComponents.date,
          nowUTCComponents.hours,
          nowUTCComponents.minutes,
          nowUTCComponents.seconds,
          nowUTCComponents.ms
        ),
        endDate: new Date(nowTime),
      }
  }
}

/**
 * Check if a date falls within a date range
 */
function isDateInRange(date: Date, range: DateRange): boolean {
  return date >= range.startDate && date <= range.endDate
}

/**
 * Filter financial data by date range
 */
function filterByDateRange(data: FinancialDataPoint[], range: DateRange): FinancialDataPoint[] {
  return data.filter((item) => {
    if (!item.date) return true // Include items without dates
    return isDateInRange(item.date, range)
  })
}

// ============================================================================
// Category Aggregation
// ============================================================================

/**
 * Aggregate financial data by category
 * Validates input per project context (zero tolerance for errors in financial calculations)
 */
function aggregateByCategory(data: FinancialDataPoint[]): CategoryAggregate[] {
  // Sanitize input data first
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

/**
 * Aggregate financial data by category and type (income vs expense)
 * Validates input per project context (zero tolerance for errors in financial calculations)
 */
function aggregateByCategoryAndType(
  data: FinancialDataPoint[]
): Map<'income' | 'expense', CategoryAggregate[]> {
  const result = new Map<'income' | 'expense', CategoryAggregate[]>()
  result.set('income', [])
  result.set('expense', [])

  // Sanitize input data first
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

  // Separate by type
  for (const aggregate of categoryMap.values()) {
    result.get(aggregate.type)?.push(aggregate)
  }

  return result
}

/**
 * Get top N categories by amount
 */
function getTopCategories(aggregates: CategoryAggregate[], limit = 10): CategoryAggregate[] {
  return [...aggregates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, limit)
}

/**
 * Group small categories into "Other"
 */
function groupSmallCategories(
  aggregates: CategoryAggregate[],
  topLimit = 8,
  otherThreshold = 0.05 // 5% of total
): CategoryAggregate[] {
  if (aggregates.length <= topLimit) {
    return aggregates
  }

  const sorted = [...aggregates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const topItems = sorted.slice(0, topLimit)
  const otherItems = sorted.slice(topLimit)

  // Calculate total amount
  const totalAmount = aggregates.reduce((sum, item) => sum + Math.abs(item.amount), 0)

  // Check if other items are significant
  const otherTotal = otherItems.reduce((sum, item) => sum + Math.abs(item.amount), 0)

  if (otherTotal > 0 && otherTotal / totalAmount >= otherThreshold) {
    // Find the first expense category to determine type for "Other"
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

// ============================================================================
// Recharts Data Transformation
// ============================================================================

/**
 * Transform aggregated data to Recharts pie chart format
 */
function toPieChartData(
  aggregates: CategoryAggregate[],
  colorMap: Record<string, string> = {}
): RechartsDataItem[] {
  return aggregates.map((agg, index) => ({
    name: agg.category,
    value: Math.abs(agg.amount), // Use absolute value for charting
    type: agg.type,
    category: agg.category,
    fill: colorMap[agg.category] || CATEGORY_COLORS[index % CATEGORY_COLORS.length], // CATEGORY_COLORS is a const array with 16 colors
    // Store original amount for tooltip
    originalAmount: agg.amount,
    count: agg.count,
  }))
}

/**
 * Transform financial data points to Recharts pie chart format for individual items
 * Used at deepest drill-down level to show transaction-level details
 */
function toIndividualItemPieChartData(
  items: FinancialDataPoint[],
  colorMap: Record<string, string> = {}
): RechartsDataItem[] {
  if (!items) {
    return []
  }

  // Filter out null/undefined items first for efficiency
  const validItems = items.filter(Boolean) as FinancialDataPoint[]

  return validItems.map((item, index) => {
    const name = item.name || `Item ${index}`
    const amount = typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : 0
    const category = item.category || ''
    const type = item.type || 'expense'
    const id = item.id
    const frequency = item.frequency

    // Look up color: use stable identifier (id) for consistent coloring across renders
    // Try: item.id -> item.name -> item.category (non-empty) -> fallback to index
    let fill = item.id !== undefined && item.id !== null ? colorMap[String(item.id)] : undefined
    if (!fill) {
      fill = colorMap[name]
    }
    if (!fill && category) {
      fill = colorMap[category]
    }
    if (!fill) {
      // Use consistent hash based on id for stable color assignment
      const colorIndex = typeof item.id === 'number' ? item.id : index
      fill = CATEGORY_COLORS[Math.abs(colorIndex) % CATEGORY_COLORS.length]
    }

    return {
      name,
      value: Math.abs(amount),
      type,
      category: category || undefined,
      fill,
      originalAmount: amount,
      id,
      frequency,
      count: 1,
    }
  })
}

/**
 * Transform financial data to Recharts bar chart format
 */
function toBarChartData(data: FinancialDataPoint[], categoryOrder?: string[]): RechartsDataItem[] {
  // Group by category
  const categoryMap = new Map<string, RechartsDataItem>()

  for (const item of data) {
    const category = item.category ?? item.name

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        name: category,
        value: 0,
        type: item.type,
        category,
        fill: CATEGORY_COLORS[categoryMap.size % CATEGORY_COLORS.length], // CATEGORY_COLORS is a const array with 16 colors
      })
    }

    const chartItem = categoryMap.get(category)
    if (chartItem) {
      chartItem.value += Math.abs(item.amount)
    }
  }

  const result = Array.from(categoryMap.values())

  // Sort by category order if provided, otherwise by value
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

/**
 * Transform to stacked bar chart data (income vs expense by category)
 */
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
  // `cat` is a key obtained from categoryMap.keys(), so get() is guaranteed to
  // return a value — the non-null assertion is safe and keeps the element type
  // `number` (an optional chain here would wrongly widen it to `undefined`).
  // biome-ignore lint/style/noNonNullAssertion: cat comes from categoryMap.keys(); get() cannot be undefined and ?. would widen the element type to undefined.
  const incomeData = categories.map((cat) => categoryMap.get(cat)!.income)
  // biome-ignore lint/style/noNonNullAssertion: cat comes from categoryMap.keys(); get() cannot be undefined and ?. would widen the element type to undefined.
  const expenseData = categories.map((cat) => categoryMap.get(cat)!.expense)

  return { categories, incomeData, expenseData }
}

// ============================================================================
// Drill-Down Functionality
// ============================================================================

/**
 * Create drill-down navigation state
 */
function createDrillDownState(): DrillDownState {
  return {
    level: 0,
    path: [],
  }
}

/**
 * Navigate to a category in drill-down
 */
function drillDownToCategory(
  state: DrillDownState,
  category: string,
  type: 'income' | 'expense'
): DrillDownState {
  return {
    level: state.level + 1,
    path: [...state.path, `${type}:${category}`],
    currentCategory: category,
    currentType: type,
  }
}

/**
 * Navigate up one level in drill-down
 */
function drillUp(state: DrillDownState): DrillDownState {
  if (state.level === 0) {
    return state
  }

  const newPath = state.path.slice(0, -1)
  const lastEntry = newPath[newPath.length - 1]

  return {
    level: state.level - 1,
    path: newPath,
    currentCategory: lastEntry?.split(':')[1],
    currentType: lastEntry?.split(':')[0] as 'income' | 'expense' | undefined,
  }
}

/**
 * Navigate to root level (reset drill-down)
 */
function drillToRoot(): DrillDownState {
  return {
    level: 0,
    path: [],
  }
}

/**
 * Get data for current drill-down level
 */
function getDataForDrillDownLevel(
  allData: FinancialDataPoint[],
  state: DrillDownState
): FinancialDataPoint[] {
  if (state.level === 0) {
    return allData
  }

  // Filter by path entries
  let filteredData = [...allData]

  for (const pathEntry of state.path) {
    const [type, category] = pathEntry.split(':')
    filteredData = filteredData.filter(
      (item) => item.type === type && (item.category ?? item.name) === category
    )
  }

  return filteredData
}

/**
 * Check if drill-down is active
 */
function isDrillDownActive(state: DrillDownState): boolean {
  return state.level > 0
}

// ============================================================================
// Data Formatting Utilities
// ============================================================================

/**
 * Get percentage of total for a category
 */
function getPercentageOfTotal(categoryAmount: number, totalAmount: number): number {
  if (totalAmount === 0) return 0
  return (Math.abs(categoryAmount) / Math.abs(totalAmount)) * 100
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Get color for a financial type
 * Note: This function currently uses type-based colors only
 */
function getColorForCategory(
  _category: string,
  type: 'income' | 'expense',
  _index: number
): string {
  // Use type-based colors (category-specific colors handled by generateColorMap)
  return DEFAULT_COLORS[type]
}

/**
 * Generate color map for categories
 */
function generateColorMap(categories: string[]): Record<string, string> {
  const colorMap: Record<string, string> = {}

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i]
    // Ensure category is a valid non-empty string for use as index
    if (
      typeof category !== 'string' ||
      category === '' ||
      category === undefined ||
      category === null
    ) {
      continue
    }
    // Get color using modulo to cycle through the palette
    // CATEGORY_COLORS is a const array with 16 colors, modulo guarantees valid index
    const colorIndex = i % CATEGORY_COLORS.length
    // biome-ignore lint/style/noNonNullAssertion: colorIndex = i % CATEGORY_COLORS.length is always a valid index; ?. would widen to string | undefined and break the Record<string, string> assignment.
    colorMap[category] = CATEGORY_COLORS[colorIndex]!
  }

  return colorMap
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate financial data
 */
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

/**
 * Sanitize financial data (remove invalid entries)
 */
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

// ============================================================================
// Export
// ============================================================================

export type {
  TimePeriodPreset,
  DateRange,
  FinancialDataPoint,
  CategoryAggregate,
  RechartsDataItem,
  DrillDownState,
}

export {
  TIME_PERIOD_PRESETS,
  CATEGORY_COLORS,
  DEFAULT_COLORS,
  getDateRangeForPreset,
  isDateInRange,
  filterByDateRange,
  aggregateByCategory,
  aggregateByCategoryAndType,
  getTopCategories,
  groupSmallCategories,
  toPieChartData,
  toIndividualItemPieChartData,
  toBarChartData,
  toStackedBarChartData,
  createDrillDownState,
  drillDownToCategory,
  drillUp,
  drillToRoot,
  getDataForDrillDownLevel,
  isDrillDownActive,
  getPercentageOfTotal,
  getColorForCategory,
  generateColorMap,
  validateFinancialData,
  sanitizeFinancialData,
}
