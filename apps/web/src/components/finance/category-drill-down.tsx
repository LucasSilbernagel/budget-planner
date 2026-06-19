/**
 * Category Drill-Down Component
 * 
 * Provides interactive drill-down functionality for financial charts.
 * Allows users to click on chart elements to see detailed category breakdowns.
 * 
 * Story: 3-3-enhance-income-vs-expense-visualization
 * Task: 4 - Implement category drill-down
 */

import React, { useState, useCallback, useMemo } from 'react'
import type { CategoryAggregate, DrillDownState, FinancialDataPoint } from '@budget-planner/core/finance/visualization'
import { 
  createDrillDownState, 
  drillDownToCategory, 
  drillUp,
  drillToRoot,
  getDataForDrillDownLevel,
  isDrillDownActive,
  aggregateByCategory,
  toPieChartData,
  toIndividualItemPieChartData,
  generateColorMap,
} from '@budget-planner/core/finance/visualization'
// ============================================================================
// Types
// ============================================================================

/**
 * Props for CategoryDrillDown component
 */
export interface CategoryDrillDownProps {
  /** Financial data to visualize */
  data: FinancialDataPoint[]
  
  /** Initial drill-down state */
  initialState?: DrillDownState
  
  /** Whether to show drill-down controls */
  showControls?: boolean
  
  /** Custom color map for categories */
  colorMap?: Record<string, string>
  
  /** Maximum depth for drill-down */
  maxDepth?: number
}

/**
 * Drill-down context for rendering
 */
export interface DrillDownRenderProps {
  /** Current drill-down state */
  state: DrillDownState
  
  /** Data for current level */
  currentData: FinancialDataPoint[]
  
  /** Aggregated data for charting */
  aggregatedData: CategoryAggregate[]
  
  /** Formatted chart data */
  chartData: any[]
  
  /** Color map for current level */
  colors: Record<string, string>
  
  /** Handler for drill-down */
  onDrillDown: (category: string, type: 'income' | 'expense') => void
  
  /** Handler for drill-up */
  onDrillUp: () => void
  
  /** Handler for reset */
  onReset: () => void
  
  /** Whether drill-down is active */
  isActive: boolean
  
  /** Current breadcrumb path */
  breadcrumb: { name: string; type: 'income' | 'expense' }[]
}

/**
 * Render props function type
 */
export type DrillDownRenderFunction = (props: DrillDownRenderProps) => React.ReactNode

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_DEPTH = 3

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Breadcrumb navigation component
 */
function Breadcrumb({
  items,
  onClick,
}: {
  items: { name: string; type: 'income' | 'expense' }[]
  onClick: (index: number) => void
}) {
  if (items.length === 0) return null
  
  return (
    <nav className="flex items-center mb-4" aria-label="breadcrumb">
      <ol className="flex items-center space-x-2">
        <li>
          <button
            onClick={() => onClick(-1)}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            All Categories
          </button>
        </li>
        {items.map((item, index) => (
          <React.Fragment key={index}>
            <li className="text-gray-400">/</li>
            <li>
              <button
                onClick={() => onClick(index)}
                className={`font-medium ${index === items.length - 1 ? 'text-gray-800' : 'text-blue-600 hover:text-blue-800'}`}
              >
                {item.name}
              </button>
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  )
}

/**
 * Drill-down navigation controls
 */
function DrillDownControls({
  canDrillUp,
  canReset,
  onDrillUp,
  onReset,
}: {
  canDrillUp: boolean
  canReset: boolean
  onDrillUp: () => void
  onReset: () => void
}) {
  return (
    <div className="flex space-x-2 mb-4">
      {canDrillUp && (
        <button
          onClick={onDrillUp}
          className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
          aria-label="Go back"
          title="Go back"
        >
          ← Back
        </button>
      )}
      {canReset && (
        <button
          onClick={onReset}
          className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
          aria-label="Reset view"
          title="Reset view"
        >
          🏠 Home
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Category Drill-Down Component
 * 
 * Provides interactive drill-down functionality for financial charts.
 * Use with render props pattern for maximum flexibility.
 */
export function CategoryDrillDown({
  data,
  initialState,
  showControls = true,
  colorMap: customColorMap = {},
  maxDepth = DEFAULT_MAX_DEPTH,
  children,
}: CategoryDrillDownProps & { children: DrillDownRenderFunction }) {
  // Validate maxDepth to prevent infinite loops or broken navigation
  const validatedMaxDepth = Math.max(0, Math.floor(maxDepth))
  
  const [state, setState] = useState<DrillDownState>(initialState || createDrillDownState())
  
  // Get data for current drill-down level
  const currentData = useMemo(() => {
    return getDataForDrillDownLevel(data, state)
  }, [data, state])
  
  // Determine if we're at the deepest level (show individual items)
  const isDeepestLevel = useMemo(() => {
    return state.level >= validatedMaxDepth
  }, [state.level, validatedMaxDepth])
  
  // Aggregate current data by category (only at intermediate levels)
  const aggregatedData = useMemo(() => {
    if (isDeepestLevel) {
      // At deepest level, return empty array as we'll use individual items
      return []
    }
    return aggregateByCategory(currentData)
  }, [currentData, isDeepestLevel])
  
  // Generate color map for current categories or items
  // Split into separate memos to avoid over-specified dependencies
  const categoryColors = useMemo(() => {
    const categories = aggregatedData.map(d => d.category)
    const generated = generateColorMap(categories)
    return { ...generated, ...customColorMap }
  }, [aggregatedData, customColorMap])
  
  const itemColors = useMemo(() => {
    const validItems = currentData.filter(Boolean) as FinancialDataPoint[]
    const itemIds = validItems.map((d, idx) => String(d.id ?? d.name ?? `item-${idx}`))
    const generated = generateColorMap(itemIds)
    return { ...generated, ...customColorMap }
  }, [currentData, customColorMap])
  
  const colors = isDeepestLevel ? itemColors : categoryColors
  
  // Format data for charting
  const chartData = useMemo(() => {
    if (isDeepestLevel) {
      // At deepest level, show individual items
      return toIndividualItemPieChartData(currentData, colors)
    }
    // At intermediate levels, show aggregated data
    return toPieChartData(aggregatedData, colors)
  }, [currentData, aggregatedData, colors, isDeepestLevel])
  
  // Get breadcrumb path from state
  const breadcrumb = useMemo(() => {
    return state.path.map(entry => {
      const [type, name] = entry.split(':')
      return { name, type: type as 'income' | 'expense' }
    })
  }, [state.path])
  
  // Handle drill-down
  const handleDrillDown = useCallback((category: string, type: 'income' | 'expense') => {
    if (state.level >= validatedMaxDepth) return
    setState(drillDownToCategory(state, category, type))
  }, [state, validatedMaxDepth])
  
  // Handle drill-up
  const handleDrillUp = useCallback(() => {
    setState(drillUp(state))
  }, [state])
  
  // Handle reset
  const handleReset = useCallback(() => {
    setState(drillToRoot())
  }, [])
  
  const isActive = isDrillDownActive(state)
  
  // Render props
  const renderProps: DrillDownRenderProps = {
    state,
    currentData,
    aggregatedData,
    chartData,
    colors,
    onDrillDown: handleDrillDown,
    onDrillUp: handleDrillUp,
    onReset: handleReset,
    isActive,
    breadcrumb,
  }
  
  return (
    <div className="category-drill-down">
      {showControls && (
        <>
          <Breadcrumb 
            items={breadcrumb} 
            onClick={(index) => {
              if (index === -1) {
                handleReset()
              } else {
                // Navigate to specific level - batch all updates into single setState
                setState(prevState => {
                  let newState = drillToRoot()
                  for (let i = 0; i <= index; i++) {
                    const entry = prevState.path[i]
                    const [type, category] = entry.split(':')
                    if (category && type) {
                      newState = drillDownToCategory(newState, category, type as 'income' | 'expense')
                    }
                  }
                  return newState
                })
              }
            }}
          />
          <DrillDownControls
            canDrillUp={isActive}
            canReset={isActive}
            onDrillUp={handleDrillUp}
            onReset={handleReset}
          />
        </>
      )}
      
      {children(renderProps)}
    </div>
  )
}

// ============================================================================
// Hook Version
// ============================================================================

/**
 * useCategoryDrillDown hook for managing drill-down state
 */
export function useCategoryDrillDown(
  data: FinancialDataPoint[],
  options?: {
    maxDepth?: number
    customColorMap?: Record<string, string>
  }
) {
  const { maxDepth = DEFAULT_MAX_DEPTH, customColorMap = {} } = options || {}
  
  // Validate maxDepth to prevent infinite loops or broken navigation
  const validatedMaxDepth = Math.max(0, Math.floor(maxDepth))
  
  const [state, setState] = useState<DrillDownState>(createDrillDownState())
  
  // Get data for current drill-down level
  const currentData = useMemo(() => {
    return getDataForDrillDownLevel(data, state)
  }, [data, state])
  
  // Determine if we're at the deepest level (show individual items)
  const isDeepestLevel = useMemo(() => {
    return state.level >= validatedMaxDepth
  }, [state.level, validatedMaxDepth])
  
  // Aggregate current data by category (only at intermediate levels)
  const aggregatedData = useMemo(() => {
    if (isDeepestLevel) {
      // At deepest level, return empty array as we'll use individual items
      return []
    }
    return aggregateByCategory(currentData)
  }, [currentData, isDeepestLevel])
  
  // Generate color map for current categories or items
  // Split into separate memos to avoid over-specified dependencies
  const categoryColors = useMemo(() => {
    const categories = aggregatedData.map(d => d.category)
    const generated = generateColorMap(categories)
    return { ...generated, ...customColorMap }
  }, [aggregatedData, customColorMap])
  
  const itemColors = useMemo(() => {
    const validItems = currentData.filter(Boolean) as FinancialDataPoint[]
    const itemIds = validItems.map((d, idx) => String(d.id ?? d.name ?? `item-${idx}`))
    const generated = generateColorMap(itemIds)
    return { ...generated, ...customColorMap }
  }, [currentData, customColorMap])
  
  const colors = isDeepestLevel ? itemColors : categoryColors
  
  // Format data for charting
  const chartData = useMemo(() => {
    if (isDeepestLevel) {
      // At deepest level, show individual items
      return toIndividualItemPieChartData(currentData, colors)
    }
    // At intermediate levels, show aggregated data
    return toPieChartData(aggregatedData, colors)
  }, [currentData, aggregatedData, colors, isDeepestLevel])
  
  // Get breadcrumb path from state
  const breadcrumb = useMemo(() => {
    return state.path.map(entry => {
      const [type, name] = entry.split(':')
      return { name, type: type as 'income' | 'expense' }
    })
  }, [state.path])
  
  // Handle drill-down
  const drillDown = useCallback((category: string, type: 'income' | 'expense') => {
    if (state.level >= validatedMaxDepth) return
    setState(drillDownToCategory(state, category, type))
  }, [state, validatedMaxDepth])
  
  // Handle drill-up
  const drillUp = useCallback(() => {
    setState(drillUp(state))
  }, [state])
  
  // Handle reset
  const reset = useCallback(() => {
    setState(drillToRoot())
  }, [])
  
  const isActive = isDrillDownActive(state)
  
  return {
    state,
    currentData,
    aggregatedData,
    chartData,
    colors,
    breadcrumb,
    drillDown,
    drillUp,
    reset,
    isActive,
  }
}

// ============================================================================
// Export
// ============================================================================

export {
  DEFAULT_MAX_DEPTH,
  Breadcrumb,
  DrillDownControls,
}

export type {
  CategoryDrillDownProps,
  DrillDownRenderProps,
  DrillDownRenderFunction,
}
