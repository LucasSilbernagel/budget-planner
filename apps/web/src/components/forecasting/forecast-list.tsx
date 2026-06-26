/**
 * Forecast List Component
 *
 * Displays a list of saved forecasting scenarios with management capabilities.
 * Allows users to view, load, edit, and delete saved forecasts.
 *
 * Architecture: React Component with Tailwind CSS
 * Data Sovereignty: Saved forecasts stored server-side for paid tier
 */

import React, { useState, useCallback, useMemo } from 'react'
import type { SavedForecast } from '../../routes/forecasting'
import { useFormattedAmount } from '../../stores/currencyStore'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for ForecastList component
 */
export interface ForecastListProps {
  /** Array of saved forecasts */
  forecasts: SavedForecast[]
  /** Callback when user deletes a forecast */
  onDelete: (id: string) => void
  /** Callback when user selects a forecast to load */
  onLoad?: (forecast: SavedForecast) => void
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Truncate text for display
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Forecast List Component
 *
 * Displays and manages saved forecasting scenarios.
 * Provides search, filter, and bulk action capabilities.
 */
export function ForecastList({
  forecasts,
  onDelete,
  onLoad,
}: ForecastListProps): React.ReactElement {
  // Display amounts respect the user's currency mode (currency-less vs symbols).
  const formatCurrency = useFormattedAmount()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'netWorth'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Filter and sort forecasts
  const filteredForecasts = useMemo(() => {
    let result = [...forecasts]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.description?.toLowerCase().includes(query) ||
          f.scenario.name?.toLowerCase().includes(query)
      )
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'date':
          comparison = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          break
        case 'netWorth': {
          const aWorth = a.result.summary.endingNetWorth
          const bWorth = b.result.summary.endingNetWorth
          comparison = bWorth - aWorth
          break
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return result
  }, [forecasts, searchQuery, sortBy, sortDirection])

  // Calculate selection statistics
  const selectedCount = selectedIds.size
  const totalCount = filteredForecasts.length

  // Toggle selection for a single forecast
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }, [])

  // Toggle selection for all forecasts
  const toggleAllSelection = useCallback(() => {
    if (selectedCount === totalCount && totalCount > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredForecasts.map((f) => f.id)))
    }
  }, [selectedCount, totalCount, filteredForecasts])

  // Handle delete for a single forecast
  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (window.confirm('Are you sure you want to delete this forecast?')) {
        onDelete(id)
        setSelectedIds((prev) => {
          const newSet = new Set(prev)
          newSet.delete(id)
          return newSet
        })
      }
    },
    [onDelete]
  )

  // Handle delete for selected forecasts
  const handleBulkDelete = useCallback(() => {
    if (selectedCount === 0) return
    if (window.confirm(`Are you sure you want to delete ${selectedCount} selected forecast(s)?`)) {
      for (const id of selectedIds) {
        onDelete(id)
      }
      setSelectedIds(new Set())
    }
  }, [selectedIds, selectedCount, onDelete])

  // Handle load forecast
  const handleLoad = useCallback(
    (forecast: SavedForecast) => {
      onLoad?.(forecast)
    },
    [onLoad]
  )

  // Toggle sort direction
  const toggleSortDirection = useCallback(
    (field: 'name' | 'date' | 'netWorth') => {
      if (sortBy === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortBy(field)
        setSortDirection('desc')
      }
    },
    [sortBy]
  )

  // Get sort indicator
  const getSortIndicator = (field: 'name' | 'date' | 'netWorth'): React.ReactElement => {
    if (sortBy !== field) {
      return <span className="text-gray-400">↕</span>
    }
    return sortDirection === 'asc' ? (
      <span className="text-blue-600">↑</span>
    ) : (
      <span className="text-blue-600">↓</span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-800">My Saved Forecasts</h2>
        <p className="text-gray-500 mt-1">Manage your saved forecasting scenarios</p>
      </div>

      {/* Empty State */}
      {forecasts.length === 0 && <EmptyState />}

      {/* Toolbar */}
      {forecasts.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="search" className="sr-only">
              Search forecasts
            </label>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="search"
                type="search"
                placeholder="Search forecasts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Selection Info */}
          <div className="flex items-center gap-4">
            {selectedCount > 0 && (
              <span className="text-sm text-gray-600">{selectedCount} selected</span>
            )}

            {/* Bulk Actions */}
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedCount === 0}
              className="px-4 py-2 bg-red-100 text-red-600 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {filteredForecasts.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          {/* Table Header */}
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={selectedCount === totalCount && totalCount > 0}
                    onChange={toggleAllSelection}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <button
                    type="button"
                    className="flex items-center uppercase cursor-pointer hover:text-gray-700"
                    onClick={() => toggleSortDirection('name')}
                  >
                    Name
                    <span className="ml-1">{getSortIndicator('name')}</span>
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <button
                    type="button"
                    className="flex items-center uppercase cursor-pointer hover:text-gray-700"
                    onClick={() => toggleSortDirection('date')}
                  >
                    Created
                    <span className="ml-1">{getSortIndicator('date')}</span>
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <button
                    type="button"
                    className="flex items-center uppercase cursor-pointer hover:text-gray-700"
                    onClick={() => toggleSortDirection('netWorth')}
                  >
                    Ending Net Worth
                    <span className="ml-1">{getSortIndicator('netWorth')}</span>
                  </button>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredForecasts.map((forecast) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: row click is a pointer convenience; keyboard users select via the per-row aria-labeled checkbox in the first cell.
                <tr
                  key={forecast.id}
                  onClick={() => toggleSelection(forecast.id)}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedIds.has(forecast.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  {/* Selection */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(forecast.id)}
                      onChange={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      aria-label={`Select ${forecast.name}`}
                    />
                  </td>

                  {/* Name */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-800">
                      {truncate(forecast.name, 40)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">v{forecast.version ?? 1}</div>
                  </td>

                  {/* Description */}
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-600">
                      {truncate(forecast.description || 'No description', 60)}
                    </div>
                  </td>

                  {/* Created Date */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{formatDate(forecast.createdAt)}</div>
                  </td>

                  {/* Ending Net Worth */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-800">
                      {formatCurrency(forecast.result.summary.endingNetWorth)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      +{formatCurrency(forecast.result.summary.totalGrowth)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onLoad && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleLoad(forecast)
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Load"
                        >
                          <LoadIcon className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(forecast.id, e)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <DeleteIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Results Count */}
      {forecasts.length > 0 && (
        <p className="text-sm text-gray-500">
          Showing {filteredForecasts.length} of {forecasts.length} forecasts
          {searchQuery && ` (filtered by "${searchQuery}")`}
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Empty State Component
 */
function EmptyState(): React.ReactElement {
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <FolderIcon className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-800 mb-2">No Saved Forecasts</h3>
      <p className="text-gray-500 text-sm mb-4">
        Create and save your first forecasting scenario to get started.
      </p>
      <p className="text-gray-400 text-xs">
        Saved forecasts are stored securely in DanubeData (Germany - EU)
      </p>
    </div>
  )
}

// ============================================================================
// Icon Components
// ============================================================================

function SearchIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}

function FolderIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  )
}

function LoadIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}

function DeleteIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}
