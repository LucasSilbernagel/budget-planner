/**
 * Financial Visualization Utilities Tests
 *
 * Comprehensive test coverage for visualization data transformation functions.
 * Tests all functions in packages/core/src/finance/visualization.ts
 *
 * Story: 3-3 - Enhance income vs. expense visualization
 * NFR3: All financial calculations must pass validation
 * NFR4: Maintain 100% TypeScript type safety
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATEGORY_COLORS,
  type CategoryAggregate,
  DEFAULT_COLORS,
  type DateRange,
  type DrillDownState,
  type FinancialDataPoint,
  type RechartsDataItem,
  // Constants
  TIME_PERIOD_PRESETS,
  // Types
  type TimePeriodPreset,
  // Category Aggregation
  aggregateByCategory,
  aggregateByCategoryAndType,
  // Drill-Down Functionality
  createDrillDownState,
  drillDownToCategory,
  drillToRoot,
  drillUp,
  filterByDateRange,
  generateColorMap,
  // Color Utilities
  getColorForCategory,
  getDataForDrillDownLevel,
  // Time Period Filtering
  getDateRangeForPreset,
  // Data Formatting Utilities
  getPercentageOfTotal,
  getTopCategories,
  groupSmallCategories,
  isDateInRange,
  isDrillDownActive,
  sanitizeFinancialData,
  toBarChartData,
  // Recharts Data Transformation
  toPieChartData,
  toStackedBarChartData,
  // Validation Utilities
  validateFinancialData,
} from '../visualization.js'

// ============================================================================
// Timer Mocks for Consistent Date-Based Tests
// ============================================================================

// Use fixed timestamp for all date-based tests to ensure consistent results
const FIXED_TEST_TIMESTAMP = '2026-06-18T12:00:00Z'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_TEST_TIMESTAMP))
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================================
// Test Data
// ============================================================================

const mockDate = new Date(FIXED_TEST_TIMESTAMP)

const mockFinancialData: FinancialDataPoint[] = [
  {
    id: 'inc-1',
    name: 'Salary',
    amount: 500000, // $5000/month
    frequency: 'monthly',
    category: 'Salary',
    type: 'income',
    date: new Date('2026-06-01'),
  },
  {
    id: 'inc-2',
    name: 'Freelance',
    amount: 200000, // $2000/month
    frequency: 'monthly',
    category: 'Freelance',
    type: 'income',
    date: new Date('2026-06-15'),
  },
  {
    id: 'exp-1',
    name: 'Rent',
    amount: -150000, // -$1500/month
    frequency: 'monthly',
    category: 'Housing',
    type: 'expense',
    date: new Date('2026-06-01'),
  },
  {
    id: 'exp-2',
    name: 'Groceries',
    amount: -60000, // -$600/month
    frequency: 'monthly',
    category: 'Food',
    type: 'expense',
    date: new Date('2026-06-10'),
  },
  {
    id: 'exp-3',
    name: 'Utilities',
    amount: -20000, // -$200/month
    frequency: 'monthly',
    category: 'Housing',
    type: 'expense',
    date: new Date('2026-05-01'),
  },
  {
    id: 'inc-3',
    name: 'Bonus',
    amount: 100000, // $1000 (one-time)
    frequency: 'annually',
    category: 'Bonus',
    type: 'income',
    date: new Date('2026-01-01'),
  },
]

const mockFinancialDataNoDates: FinancialDataPoint[] = [
  {
    id: 'inc-1',
    name: 'Salary',
    amount: 500000,
    frequency: 'monthly',
    category: 'Salary',
    type: 'income',
  },
  {
    id: 'exp-1',
    name: 'Rent',
    amount: -150000,
    frequency: 'monthly',
    category: 'Housing',
    type: 'expense',
  },
]

// ============================================================================
// Constants Tests
// ============================================================================

describe('TIME_PERIOD_PRESETS', () => {
  it('should have all required presets with correct labels and days', () => {
    expect(TIME_PERIOD_PRESETS).toHaveProperty('last-month')
    expect(TIME_PERIOD_PRESETS['last-month'].label).toBe('Last Month')
    expect(TIME_PERIOD_PRESETS['last-month'].days).toBe(30)

    expect(TIME_PERIOD_PRESETS).toHaveProperty('last-3-months')
    expect(TIME_PERIOD_PRESETS['last-3-months'].label).toBe('Last 3 Months')
    expect(TIME_PERIOD_PRESETS['last-3-months'].days).toBe(90)

    expect(TIME_PERIOD_PRESETS).toHaveProperty('last-6-months')
    expect(TIME_PERIOD_PRESETS['last-6-months'].label).toBe('Last 6 Months')
    expect(TIME_PERIOD_PRESETS['last-6-months'].days).toBe(180)

    expect(TIME_PERIOD_PRESETS).toHaveProperty('year-to-date')
    expect(TIME_PERIOD_PRESETS['year-to-date'].label).toBe('Year to Date')
    expect(TIME_PERIOD_PRESETS['year-to-date'].days).toBe(0) // Special handling

    expect(TIME_PERIOD_PRESETS).toHaveProperty('last-year')
    expect(TIME_PERIOD_PRESETS['last-year'].label).toBe('Last Year')
    expect(TIME_PERIOD_PRESETS['last-year'].days).toBe(365)

    expect(TIME_PERIOD_PRESETS).toHaveProperty('custom')
    expect(TIME_PERIOD_PRESETS.custom.label).toBe('Custom Range')
    expect(TIME_PERIOD_PRESETS.custom.days).toBe(0) // Special handling
  })
})

describe('CATEGORY_COLORS', () => {
  it('should have at least 10 color options', () => {
    expect(CATEGORY_COLORS.length).toBeGreaterThanOrEqual(10)
  })

  it('should contain valid hex color codes', () => {
    CATEGORY_COLORS.forEach((color) => {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })
  })
})

describe('DEFAULT_COLORS', () => {
  it('should have colors for all financial types', () => {
    expect(DEFAULT_COLORS).toHaveProperty('income')
    expect(DEFAULT_COLORS).toHaveProperty('expense')
    expect(DEFAULT_COLORS).toHaveProperty('savings')
    expect(DEFAULT_COLORS).toHaveProperty('investment')
    expect(DEFAULT_COLORS).toHaveProperty('debt')
  })

  it('should use green for income and red for expense', () => {
    expect(DEFAULT_COLORS.income).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(DEFAULT_COLORS.expense).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

// ============================================================================
// Time Period Filtering Tests
// ============================================================================

describe('getDateRangeForPreset', () => {
  beforeEach(() => {
    // Mock Date to have consistent test results
    vi.setSystemTime(mockDate)
  })

  it('should return correct date range for last-month preset', () => {
    const range = getDateRangeForPreset('last-month')
    expect(range.endDate).toEqual(mockDate)
    expect(range.startDate.getTime()).toBe(new Date('2026-05-18T12:00:00Z').getTime())
  })

  it('should return correct date range for last-3-months preset', () => {
    const range = getDateRangeForPreset('last-3-months')
    expect(range.endDate).toEqual(mockDate)
    expect(range.startDate.getTime()).toBe(new Date('2026-03-18T12:00:00Z').getTime())
  })

  it('should return correct date range for last-6-months preset', () => {
    const range = getDateRangeForPreset('last-6-months')
    expect(range.endDate).toEqual(mockDate)
    expect(range.startDate.getTime()).toBe(new Date('2025-12-18T12:00:00Z').getTime())
  })

  it('should return correct date range for year-to-date preset', () => {
    const range = getDateRangeForPreset('year-to-date')
    expect(range.endDate).toEqual(mockDate)
    expect(range.startDate).toEqual(new Date('2026-01-01T00:00:00Z'))
  })

  it('should return correct date range for last-year preset', () => {
    const range = getDateRangeForPreset('last-year')
    expect(range.endDate).toEqual(new Date('2026-06-18T12:00:00Z'))
    expect(range.startDate).toEqual(new Date('2025-06-18T12:00:00Z'))
  })

  it('should return default last-month range for custom preset without customRange', () => {
    const range = getDateRangeForPreset('custom')
    expect(range).toEqual(getDateRangeForPreset('last-month'))
  })

  it('should return custom range when provided for custom preset', () => {
    const customRange: DateRange = {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-06-30'),
    }
    const range = getDateRangeForPreset('custom', customRange)
    expect(range).toEqual(customRange)
  })
})

describe('isDateInRange', () => {
  const range: DateRange = {
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-30'),
  }

  it('should return true for date within range', () => {
    const testDate = new Date('2026-06-15')
    expect(isDateInRange(testDate, range)).toBe(true)
  })

  it('should return true for date equal to start date', () => {
    const testDate = new Date('2026-06-01')
    expect(isDateInRange(testDate, range)).toBe(true)
  })

  it('should return true for date equal to end date', () => {
    const testDate = new Date('2026-06-30')
    expect(isDateInRange(testDate, range)).toBe(true)
  })

  it('should return false for date before range', () => {
    const testDate = new Date('2026-05-31')
    expect(isDateInRange(testDate, range)).toBe(false)
  })

  it('should return false for date after range', () => {
    const testDate = new Date('2026-07-01')
    expect(isDateInRange(testDate, range)).toBe(false)
  })
})

describe('filterByDateRange', () => {
  const range: DateRange = {
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-30'),
  }

  it('should filter data to include only items within date range', () => {
    const filtered = filterByDateRange(mockFinancialData, range)

    // Should include items from June 2026
    expect(filtered.some((item) => item.id === 'inc-1')).toBe(true) // 2026-06-01
    expect(filtered.some((item) => item.id === 'inc-2')).toBe(true) // 2026-06-15
    expect(filtered.some((item) => item.id === 'exp-1')).toBe(true) // 2026-06-01
    expect(filtered.some((item) => item.id === 'exp-2')).toBe(true) // 2026-06-10

    // Should exclude items from May 2026 and January 2026
    expect(filtered.some((item) => item.id === 'exp-3')).toBe(false) // 2026-05-01
    expect(filtered.some((item) => item.id === 'inc-3')).toBe(false) // 2026-01-01
  })

  it('should include items without dates', () => {
    const filtered = filterByDateRange(mockFinancialDataNoDates, range)
    expect(filtered.length).toBe(mockFinancialDataNoDates.length)
  })

  it('should return empty array for empty input', () => {
    const filtered = filterByDateRange([], range)
    expect(filtered).toEqual([])
  })
})

// ============================================================================
// Category Aggregation Tests
// ============================================================================

describe('aggregateByCategory', () => {
  it('should aggregate data by category', () => {
    const result = aggregateByCategory(mockFinancialData)

    expect(result.length).toBeGreaterThanOrEqual(4)

    // Check that Salary category exists with correct amount
    const salaryAggregate = result.find((a) => a.category === 'Salary')
    expect(salaryAggregate).toBeDefined()
    expect(salaryAggregate?.amount).toBe(500000)
    expect(salaryAggregate?.type).toBe('income')
    expect(salaryAggregate?.count).toBe(1)
  })

  it('should group multiple items with same category', () => {
    const result = aggregateByCategory(mockFinancialData)

    // Housing should have Rent + Utilities = -150000 + -20000 = -170000
    const housingAggregate = result.find((a) => a.category === 'Housing')
    expect(housingAggregate).toBeDefined()
    expect(housingAggregate?.amount).toBe(-170000)
    expect(housingAggregate?.type).toBe('expense')
    expect(housingAggregate?.count).toBe(2)
  })

  it('should use name as category when category is not provided', () => {
    const dataWithoutCategory: FinancialDataPoint[] = [
      {
        id: '1',
        name: 'Test Item',
        amount: 10000,
        frequency: 'monthly',
        type: 'income',
      },
    ]

    const result = aggregateByCategory(dataWithoutCategory)
    expect(result[0].category).toBe('Test Item')
  })

  it('should handle empty array', () => {
    const result = aggregateByCategory([])
    expect(result).toEqual([])
  })
})

describe('aggregateByCategoryAndType', () => {
  it('should separate aggregates by type (income vs expense)', () => {
    const result = aggregateByCategoryAndType(mockFinancialData)

    expect(result.has('income')).toBe(true)
    expect(result.has('expense')).toBe(true)

    const incomeAggregates = result.get('income')!
    const expenseAggregates = result.get('expense')!

    // Check income categories
    expect(incomeAggregates.some((a) => a.category === 'Salary')).toBe(true)
    expect(incomeAggregates.some((a) => a.category === 'Freelance')).toBe(true)
    expect(incomeAggregates.some((a) => a.category === 'Bonus')).toBe(true)

    // Check expense categories
    expect(expenseAggregates.some((a) => a.category === 'Housing')).toBe(true)
    expect(expenseAggregates.some((a) => a.category === 'Food')).toBe(true)
  })

  it('should return empty arrays for types with no data', () => {
    const incomeOnly: FinancialDataPoint[] = [
      {
        id: '1',
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
        category: 'Salary',
        type: 'income',
      },
    ]

    const result = aggregateByCategoryAndType(incomeOnly)
    expect(result.get('income')?.length).toBeGreaterThan(0)
    expect(result.get('expense')).toEqual([])
  })
})

describe('getTopCategories', () => {
  it('should return top N categories by absolute amount', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'Small', amount: 1000, type: 'income', count: 1 },
      { category: 'Medium', amount: 10000, type: 'income', count: 1 },
      { category: 'Large', amount: 100000, type: 'income', count: 1 },
    ]

    const result = getTopCategories(aggregates, 2)
    expect(result.length).toBe(2)
    expect(result[0].category).toBe('Large')
    expect(result[1].category).toBe('Medium')
  })

  it('should default to top 10 when limit not specified', () => {
    const aggregates: CategoryAggregate[] = Array.from({ length: 15 }, (_, i) => ({
      category: `Category ${i}`,
      amount: (i + 1) * 1000,
      type: 'income',
      count: 1,
    }))

    const result = getTopCategories(aggregates)
    expect(result.length).toBe(10)
  })

  it('should return all categories when there are fewer than limit', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'A', amount: 1000, type: 'income', count: 1 },
      { category: 'B', amount: 2000, type: 'income', count: 1 },
    ]

    const result = getTopCategories(aggregates, 10)
    expect(result.length).toBe(2)
  })

  it('should handle negative amounts correctly (absolute value)', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'Small', amount: -1000, type: 'expense', count: 1 },
      { category: 'Large', amount: -100000, type: 'expense', count: 1 },
    ]

    const result = getTopCategories(aggregates, 1)
    expect(result.length).toBe(1)
    expect(result[0].category).toBe('Large')
  })
})

describe('groupSmallCategories', () => {
  it('should not group when categories are fewer than limit', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'A', amount: 1000, type: 'income', count: 1 },
      { category: 'B', amount: 2000, type: 'income', count: 1 },
    ]

    const result = groupSmallCategories(aggregates, 10)
    expect(result.length).toBe(2)
    expect(result.some((a) => a.category === 'Other')).toBe(false)
  })

  it('should group small categories when they exceed threshold', () => {
    // Create 10 categories: 1 large (9000) and 9 small (100 each)
    // With topLimit=1, we keep 1 top and group 9 small
    // Total = 9000 + 900 = 9900
    // Small categories total = 900
    // Percentage = 900/9900 = ~9.09% > 5% threshold
    const aggregates: CategoryAggregate[] = Array.from({ length: 10 }, (_, i) => ({
      category: `Category ${i}`,
      amount: i === 0 ? 9000 : 100,
      type: 'income' as const,
      count: 1,
    }))

    const result = groupSmallCategories(aggregates, 1, 0.05) // topLimit=1 to get 9 other items

    expect(result.length).toBe(2) // 1 top + 1 Other
    expect(result.some((a) => a.category === 'Other')).toBe(true)
  })

  it('should not group small categories when below threshold', () => {
    const aggregates: CategoryAggregate[] = Array.from({ length: 10 }, (_, i) => ({
      category: `Category ${i}`,
      amount: i === 0 ? 9900 : 10, // One large (99%), nine tiny (0.1% each)
      type: 'income' as const,
      count: 1,
    }))

    // Total = 9900 + (9 * 10) = 9990
    // Small categories total = 90
    // Percentage = 90/9990 = ~0.9% < 5% threshold
    const result = groupSmallCategories(aggregates, 8, 0.05)

    // Should not create Other group since small items are below threshold
    expect(result.some((a) => a.category === 'Other')).toBe(false)
  })
})

// ============================================================================
// Recharts Data Transformation Tests
// ============================================================================

describe('toPieChartData', () => {
  it('should transform category aggregates to pie chart data', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'Salary', amount: 500000, type: 'income', count: 1 },
      { category: 'Rent', amount: -150000, type: 'expense', count: 1 },
    ]

    const result = toPieChartData(aggregates)

    expect(result.length).toBe(2)
    expect(result[0].name).toBe('Salary')
    expect(result[0].value).toBe(500000) // Absolute value for charting
    expect(result[0].type).toBe('income')
    expect(result[0].category).toBe('Salary')
    expect(result[0].fill).toBeDefined()
    expect(result[0].originalAmount).toBe(500000)
    expect(result[0].count).toBe(1)

    expect(result[1].name).toBe('Rent')
    expect(result[1].value).toBe(150000) // Absolute value for charting
    expect(result[1].type).toBe('expense')
  })

  it('should use provided color map for category colors', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'Salary', amount: 500000, type: 'income', count: 1 },
    ]

    const colorMap = { Salary: '#FF0000' }
    const result = toPieChartData(aggregates, colorMap)

    expect(result[0].fill).toBe('#FF0000')
  })

  it('should use CATEGORY_COLORS when no color map provided', () => {
    const aggregates: CategoryAggregate[] = [
      { category: 'A', amount: 1000, type: 'income', count: 1 },
      { category: 'B', amount: 2000, type: 'income', count: 1 },
    ]

    const result = toPieChartData(aggregates)
    expect(result[0].fill).toBe(CATEGORY_COLORS[0])
    expect(result[1].fill).toBe(CATEGORY_COLORS[1])
  })

  it('should handle empty aggregates', () => {
    const result = toPieChartData([])
    expect(result).toEqual([])
  })
})

describe('toBarChartData', () => {
  it('should transform financial data to bar chart data', () => {
    const data: FinancialDataPoint[] = [
      {
        id: '1',
        name: 'A',
        amount: 1000,
        frequency: 'monthly',
        type: 'income',
        category: 'Category A',
      },
      {
        id: '2',
        name: 'B',
        amount: 2000,
        frequency: 'monthly',
        type: 'income',
        category: 'Category A',
      },
      {
        id: '3',
        name: 'C',
        amount: 3000,
        frequency: 'monthly',
        type: 'expense',
        category: 'Category B',
      },
    ]

    const result = toBarChartData(data)

    expect(result.length).toBe(2)
    expect(result[0].name).toBe('Category A')
    expect(result[0].value).toBe(3000) // 1000 + 2000
    expect(result[1].name).toBe('Category B')
    expect(result[1].value).toBe(3000)
  })

  it('should sort by value when no category order provided', () => {
    const data: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: 1000, frequency: 'monthly', type: 'income', category: 'Small' },
      {
        id: '2',
        name: 'B',
        amount: 10000,
        frequency: 'monthly',
        type: 'income',
        category: 'Large',
      },
    ]

    const result = toBarChartData(data)
    expect(result[0].name).toBe('Large')
    expect(result[1].name).toBe('Small')
  })

  it('should respect category order when provided', () => {
    const data: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: 1000, frequency: 'monthly', type: 'income', category: 'B' },
      { id: '2', name: 'B', amount: 10000, frequency: 'monthly', type: 'income', category: 'A' },
    ]

    const result = toBarChartData(data, ['A', 'B'])
    expect(result[0].name).toBe('A')
    expect(result[1].name).toBe('B')
  })

  it('should handle empty data', () => {
    const result = toBarChartData([])
    expect(result).toEqual([])
  })
})

describe('toStackedBarChartData', () => {
  it('should transform data to stacked bar chart format', () => {
    const data: FinancialDataPoint[] = [
      {
        id: '1',
        name: 'Salary',
        amount: 5000,
        frequency: 'monthly',
        type: 'income',
        category: 'Work',
      },
      {
        id: '2',
        name: 'Bonus',
        amount: 1000,
        frequency: 'monthly',
        type: 'income',
        category: 'Work',
      },
      {
        id: '3',
        name: 'Rent',
        amount: -2000,
        frequency: 'monthly',
        type: 'expense',
        category: 'Work',
      },
      {
        id: '4',
        name: 'Groceries',
        amount: -500,
        frequency: 'monthly',
        type: 'expense',
        category: 'Personal',
      },
    ]

    const result = toStackedBarChartData(data)

    expect(result.categories).toEqual(['Work', 'Personal'])
    expect(result.incomeData).toEqual([6000, 0]) // Work: 5000+1000, Personal: 0
    expect(result.expenseData).toEqual([2000, 500]) // Work: 2000, Personal: 500
  })

  it('should handle empty data', () => {
    const result = toStackedBarChartData([])
    expect(result.categories).toEqual([])
    expect(result.incomeData).toEqual([])
    expect(result.expenseData).toEqual([])
  })
})

// ============================================================================
// Drill-Down Functionality Tests
// ============================================================================

describe('createDrillDownState', () => {
  it('should create initial drill-down state', () => {
    const state = createDrillDownState()

    expect(state.level).toBe(0)
    expect(state.path).toEqual([])
    expect(state.currentCategory).toBeUndefined()
    expect(state.currentType).toBeUndefined()
  })
})

describe('drillDownToCategory', () => {
  it('should navigate to a category', () => {
    const initialState = createDrillDownState()
    const newState = drillDownToCategory(initialState, 'Salary', 'income')

    expect(newState.level).toBe(1)
    expect(newState.path).toEqual(['income:Salary'])
    expect(newState.currentCategory).toBe('Salary')
    expect(newState.currentType).toBe('income')
  })

  it('should navigate to nested category', () => {
    const initialState: DrillDownState = {
      level: 1,
      path: ['income:Salary'],
      currentCategory: 'Salary',
      currentType: 'income',
    }

    const newState = drillDownToCategory(initialState, 'Bonus', 'income')

    expect(newState.level).toBe(2)
    expect(newState.path).toEqual(['income:Salary', 'income:Bonus'])
    expect(newState.currentCategory).toBe('Bonus')
    expect(newState.currentType).toBe('income')
  })
})

describe('drillUp', () => {
  it('should navigate up one level', () => {
    const state: DrillDownState = {
      level: 2,
      path: ['income:Salary', 'expense:Rent'],
      currentCategory: 'Rent',
      currentType: 'expense',
    }

    const newState = drillUp(state)

    expect(newState.level).toBe(1)
    expect(newState.path).toEqual(['income:Salary'])
    expect(newState.currentCategory).toBe('Salary')
    expect(newState.currentType).toBe('income')
  })

  it('should not navigate up from root level', () => {
    const state = createDrillDownState()
    const newState = drillUp(state)

    expect(newState.level).toBe(0)
    expect(newState.path).toEqual([])
  })
})

describe('drillToRoot', () => {
  it('should reset to root level', () => {
    const _state: DrillDownState = {
      level: 3,
      path: ['a', 'b', 'c'],
      currentCategory: 'C',
      currentType: 'income',
    }

    const newState = drillToRoot()

    expect(newState.level).toBe(0)
    expect(newState.path).toEqual([])
    expect(newState.currentCategory).toBeUndefined()
    expect(newState.currentType).toBeUndefined()
  })
})

describe('getDataForDrillDownLevel', () => {
  it('should return all data for root level', () => {
    const state = createDrillDownState()
    const result = getDataForDrillDownLevel(mockFinancialData, state)

    expect(result).toEqual(mockFinancialData)
  })

  it('should filter data for drill-down level', () => {
    const state: DrillDownState = {
      level: 1,
      path: ['income:Salary'],
    }

    const result = getDataForDrillDownLevel(mockFinancialData, state)

    // Should only include Salary income
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('inc-1')
    expect(result[0].category).toBe('Salary')
    expect(result[0].type).toBe('income')
  })

  it('should filter data for nested drill-down level', () => {
    const state: DrillDownState = {
      level: 1,
      path: ['expense:Housing'],
    }

    const result = getDataForDrillDownLevel(mockFinancialData, state)

    // Should include both Rent and Utilities (both are Housing expenses)
    expect(result.length).toBe(2)
    expect(result.every((item) => item.type === 'expense')).toBe(true)
    expect(result.every((item) => item.category === 'Housing')).toBe(true)
  })
})

describe('isDrillDownActive', () => {
  it('should return false for root level', () => {
    const state = createDrillDownState()
    expect(isDrillDownActive(state)).toBe(false)
  })

  it('should return true for any non-root level', () => {
    const state: DrillDownState = {
      level: 1,
      path: ['income:Salary'],
    }
    expect(isDrillDownActive(state)).toBe(true)
  })
})

// ============================================================================
// Data Formatting Utilities Tests
// ============================================================================

// Note: formatChartAmount was removed as it violated the project's Currency Control System
// Currency formatting should use useFormattedAmount() hook instead

describe('getPercentageOfTotal', () => {
  it('should calculate percentage correctly', () => {
    expect(getPercentageOfTotal(500, 1000)).toBe(50)
    expect(getPercentageOfTotal(250, 1000)).toBe(25)
  })

  it('should handle negative values correctly', () => {
    expect(getPercentageOfTotal(-500, -1000)).toBe(50)
    expect(getPercentageOfTotal(-500, 1000)).toBe(50)
  })

  it('should return 0 when total is 0', () => {
    expect(getPercentageOfTotal(500, 0)).toBe(0)
  })
})

// ============================================================================
// Color Utilities Tests
// ============================================================================

describe('getColorForCategory', () => {
  it('should return income color for income type', () => {
    const color = getColorForCategory('Any', 'income', 0)
    expect(color).toBe(DEFAULT_COLORS.income)
  })

  it('should return expense color for expense type', () => {
    const color = getColorForCategory('Any', 'expense', 0)
    expect(color).toBe(DEFAULT_COLORS.expense)
  })
})

describe('generateColorMap', () => {
  it('should generate color map for categories', () => {
    const categories = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']
    const colorMap = generateColorMap(categories)

    expect(Object.keys(colorMap)).toEqual(categories)
    expect(colorMap.A).toBe(CATEGORY_COLORS[0])
    expect(colorMap.B).toBe(CATEGORY_COLORS[1])
    // 11th category (index 10) maps to 10th color in the 16-color palette
    expect(colorMap.K).toBe(CATEGORY_COLORS[10])
  })

  it('should handle empty categories array', () => {
    const colorMap = generateColorMap([])
    expect(Object.keys(colorMap)).toEqual([])
  })
})

// ============================================================================
// Validation Utilities Tests
// ============================================================================

describe('validateFinancialData', () => {
  it('should return true for valid data', () => {
    const validData: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: 1000, frequency: 'monthly', type: 'income' },
      { id: '2', name: 'B', amount: -500, frequency: 'monthly', type: 'expense' },
    ]

    expect(validateFinancialData(validData)).toBe(true)
  })

  it('should return false for data with NaN amount', () => {
    const invalidData: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: NaN, frequency: 'monthly', type: 'income' },
    ]

    expect(validateFinancialData(invalidData)).toBe(false)
  })

  it('should return false for data with Infinity amount', () => {
    const invalidData: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: Infinity, frequency: 'monthly', type: 'income' },
    ]

    expect(validateFinancialData(invalidData)).toBe(false)
  })

  it('should return false for invalid type', () => {
    const invalidData: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: 1000, frequency: 'monthly', type: 'invalid' as any },
    ]

    expect(validateFinancialData(invalidData)).toBe(false)
  })

  it('should return true for empty array', () => {
    expect(validateFinancialData([])).toBe(true)
  })
})

describe('sanitizeFinancialData', () => {
  it('should remove invalid entries', () => {
    const mixedData: FinancialDataPoint[] = [
      { id: '1', name: 'Valid', amount: 1000, frequency: 'monthly', type: 'income' },
      { id: '2', name: 'Invalid', amount: NaN, frequency: 'monthly', type: 'income' },
      { id: '3', name: 'Valid Expense', amount: -500, frequency: 'monthly', type: 'expense' },
    ]

    const result = sanitizeFinancialData(mixedData)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('1')
    expect(result[1].id).toBe('3')
  })

  it('should return empty array for all invalid data', () => {
    const invalidData: FinancialDataPoint[] = [
      { id: '1', name: 'Invalid', amount: NaN, frequency: 'monthly', type: 'income' },
    ]

    const result = sanitizeFinancialData(invalidData)
    expect(result).toEqual([])
  })

  it('should return same array for all valid data', () => {
    const validData: FinancialDataPoint[] = [
      { id: '1', name: 'A', amount: 1000, frequency: 'monthly', type: 'income' },
      { id: '2', name: 'B', amount: -500, frequency: 'monthly', type: 'expense' },
    ]

    const result = sanitizeFinancialData(validData)
    expect(result).toEqual(validData)
  })
})
