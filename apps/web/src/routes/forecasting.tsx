/**
 * Forecasting Page Route
 *
 * Premium feature route for advanced financial forecasting tools.
 * Provides scenario modeling, goal tracking, and financial projections.
 *
 * Route: /forecasting
 * Access: Premium users only (paid tier)
 *
 * Architecture: TanStack Start file-based routing with React
 * Data Sovereignty: Server-side calculations, data in DanubeData (Germany - EU)
 */

import type { ForecastingResult, ForecastingScenario } from '@budget-planner/core'
import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useEffect, useCallback } from 'react'
import { PremiumPrompt } from '../components/auth/premium-prompt'
import { ForecastList } from '../components/forecasting/forecast-list'
import { ProjectionChart } from '../components/forecasting/projection-chart'
import { ScenarioBuilder } from '../components/forecasting/scenario-builder'
import { CurrencyToggle } from '../components/settings/currency-toggle'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import type { ForecastingProfileOutput } from '../server/functions/forecastingProfiles'

// ============================================================================
// Route Configuration
// ============================================================================

export const Route = createFileRoute('/forecasting')({
  component: ForecastingPage,
  loader: async ({ request }) => {
    // Server-side authentication check for premium features
    // Import server function dynamically to avoid circular dependencies
    const { checkPremiumAccessServer } = await import('../server/api/data/forecasting')

    const result = await checkPremiumAccessServer(request)

    // If check failed or user doesn't have access, redirect to home
    // Note: We allow the route to load and show the upgrade prompt client-side
    // This is a security measure to prevent unauthorized access to the route itself
    if (result.success && result.data && !result.data.hasAccess) {
      // User is authenticated but doesn't have premium access
      // We still allow the route to load so the upgrade prompt can be shown
      return null
    }

    if (!result.success) {
      // Authentication check failed - redirect to login
      // Note: In TanStack Start, we should use the router's redirect utility
      // For now, we'll just return null and let client-side handle it
      return null
    }

    return null
  },
})

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Tab options for the forecasting page
 */
type ForecastingTab = 'scenarios' | 'projections' | 'saved'

/**
 * Saved forecast with metadata
 */
export interface SavedForecast {
  id: string
  name: string
  description?: string
  scenario: ForecastingScenario
  result: ForecastingResult
  /** Schema/model version from the persisted forecastingProfiles row. */
  version?: number
  createdAt: string
  updatedAt: string
}

/**
 * Map a server-side forecasting profile to the client SavedForecast shape.
 * scenarioData is a JSON string of { scenario, result }; returns null if it
 * cannot be parsed into the expected shape so a corrupt row can't crash the UI.
 */
function mapToSavedForecast(profile: ForecastingProfileOutput): SavedForecast | null {
  try {
    const parsed = JSON.parse(profile.scenarioData) as {
      scenario?: ForecastingScenario
      result?: ForecastingResult
    }
    // Validate the nested shape the saved-list UI actually dereferences
    // (result.summary.endingNetWorth / totalGrowth). A row that parses but is
    // missing scenario/result/summary is treated as corrupt and skipped so it
    // can't crash the list.
    if (!parsed?.scenario || !parsed?.result || !parsed.result.summary) {
      return null
    }
    return {
      id: String(profile.id),
      name: profile.name,
      description: profile.description ?? undefined,
      scenario: parsed.scenario,
      result: parsed.result,
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    }
  } catch {
    return null
  }
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Forecasting Page Component
 *
 * Main page for premium forecasting features.
 * Handles access control and renders appropriate UI based on subscription status.
 */
function ForecastingPage(): React.ReactElement {
  const { status, checkAccess } = usePremiumAccess()
  const [activeTab, setActiveTab] = useState<ForecastingTab>('scenarios')
  const [_savedForecasts, _setSavedForecasts] = useState<SavedForecast[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Check premium access on mount
  useEffect(() => {
    const check = async () => {
      await checkAccess()
      setIsLoading(false)
    }
    check()
  }, [checkAccess])

  // Handle tab change
  const handleTabChange = useCallback((tab: ForecastingTab) => {
    setActiveTab(tab)
  }, [])

  // State for server-side forecasts
  const [_isLoadingForecasts, setIsLoadingForecasts] = useState(false)
  const [serverForecasts, setServerForecasts] = useState<ForecastingProfileOutput[]>([])
  // The user profile that newly-saved forecasts are attached to. Forecasting
  // profiles require a real userProfiles UUID, so resolve the user's default
  // profile up front rather than guessing an ID at save time.
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null)

  // Load the user's default profile and saved forecasts from the server on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoadingForecasts(true)
        // In TanStack Start, the framework supplies the request context; for
        // client-side calls we pass the current location as the request.
        const request = new Request(window.location.href)

        // Resolve the user's default profile (or first profile) so saves have a
        // valid profileId to attach to.
        const { getProfiles } = await import('../server/functions/profiles')
        const profilesResult = await getProfiles(request)
        let resolvedProfileId: string | null = null
        if (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) {
          const defaultProfile =
            profilesResult.data.find((p) => p.isDefault) ?? profilesResult.data[0]
          resolvedProfileId = defaultProfile.id
          setDefaultProfileId(resolvedProfileId)
        }

        // Load saved forecasts scoped to the same profile saves target, so the
        // "My Forecasts" list and the save destination stay consistent.
        const { getForecastingProfiles } = await import('../server/functions/forecastingProfiles')
        const result = await getForecastingProfiles(request, resolvedProfileId ?? undefined)
        if (result.success && result.data) {
          setServerForecasts(result.data)
        }
      } catch (error) {
        console.error('Failed to load forecasting data:', error)
      } finally {
        setIsLoadingForecasts(false)
      }
    }

    if (status.hasAccess && status.isAuthenticated) {
      loadData()
    }
  }, [status.hasAccess, status.isAuthenticated])

  // Handle saving a forecast - uses server function
  const handleSaveForecast = useCallback(
    async (forecast: {
      name: string
      description?: string
      scenario: ForecastingScenario
      result: ForecastingResult
    }): Promise<{ success: boolean; error?: string }> => {
      if (!defaultProfileId) {
        const error = 'No financial profile found. Create a profile before saving forecasts.'
        console.error('Cannot save forecast:', error)
        return { success: false, error }
      }
      try {
        // Import server function dynamically
        const { createForecastingProfile } = await import('../server/functions/forecastingProfiles')

        // Create request
        const request = new Request(window.location.href)

        // Convert forecast to input format
        const input = {
          name: forecast.name,
          description: forecast.description,
          scenarioData: { scenario: forecast.scenario, result: forecast.result },
          profileId: defaultProfileId,
        }

        const result = await createForecastingProfile(request, input)

        if (result.success && result.data) {
          // Reload forecasts (scoped to the same profile) to get the updated list
          const { getForecastingProfiles } = await import('../server/functions/forecastingProfiles')
          const getResult = await getForecastingProfiles(request, defaultProfileId)

          if (getResult.success && getResult.data) {
            setServerForecasts(getResult.data)
          }
          setActiveTab('saved')
          return { success: true }
        }

        // A failed save (e.g. duplicate name hitting the unique constraint) must
        // be surfaced to the user, not silently swallowed.
        const error = result.error || 'Failed to save forecast'
        console.error('Failed to save forecast:', error)
        return { success: false, error }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save forecast'
        console.error('Failed to save forecast:', error)
        return { success: false, error: message }
      }
    },
    [defaultProfileId]
  )

  // Handle deleting a forecast - uses server function
  const handleDeleteForecast = useCallback(
    async (id: string) => {
      try {
        // Import server function dynamically
        const { deleteForecastingProfile } = await import('../server/functions/forecastingProfiles')

        // Create request
        const request = new Request(window.location.href)

        const result = await deleteForecastingProfile(request, parseInt(id))

        if (result.success) {
          // Reload forecasts (scoped to the same profile) to get the updated list
          const { getForecastingProfiles } = await import('../server/functions/forecastingProfiles')
          const getResult = await getForecastingProfiles(request, defaultProfileId ?? undefined)

          if (getResult.success && getResult.data) {
            setServerForecasts(getResult.data)
          }
        } else {
          console.error('Failed to delete forecast:', result.error)
        }
      } catch (error) {
        console.error('Failed to delete forecast:', error)
      }
    },
    [defaultProfileId]
  )

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    )
  }

  // Show premium prompt if user doesn't have access
  if (!status.hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <PremiumPrompt
          featureName="Advanced Forecasting"
          message="Access powerful financial forecasting tools including scenario modeling, goal tracking, and save/load functionality."
          asDialog={false}
        />
      </div>
    )
  }

  // Main premium content
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <PageHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="mb-8">
          <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-8">
          {activeTab === 'scenarios' && <ScenarioBuilder onSave={handleSaveForecast} />}

          {activeTab === 'projections' && <ProjectionChart />}

          {activeTab === 'saved' && (
            <ForecastList
              forecasts={serverForecasts
                .map(mapToSavedForecast)
                .filter((f): f is SavedForecast => f !== null)}
              onDelete={handleDeleteForecast}
            />
          )}
        </div>

        {/* Info Footer */}
        <PageFooter />
      </main>
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Page Header Component
 */
function PageHeader(): React.ReactElement {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Financial Forecasting</h1>
            <p className="text-gray-500 text-sm mt-1">
              Advanced tools for modeling your financial future
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <CurrencyToggle />
            <PremiumBadge />
          </div>
        </div>
      </div>
    </header>
  )
}

/**
 * Premium Badge Component
 */
function PremiumBadge(): React.ReactElement {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      <CrownIcon className="w-3 h-3 mr-1.5" />
      Premium Feature
    </span>
  )
}

/**
 * Tab Navigation Component
 */
interface TabNavigationProps {
  activeTab: ForecastingTab
  onTabChange: (tab: ForecastingTab) => void
}

const tabs: { id: ForecastingTab; label: string; description: string }[] = [
  {
    id: 'scenarios',
    label: 'Scenario Builder',
    description: 'Create and model financial scenarios',
  },
  {
    id: 'projections',
    label: 'Projections',
    description: 'View forecast visualizations',
  },
  {
    id: 'saved',
    label: 'My Forecasts',
    description: 'Saved scenarios and results',
  },
]

function TabNavigation({ activeTab, onTabChange }: TabNavigationProps): React.ReactElement {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              activeTab === tab.id
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center">
              {getTabIcon(tab.id, activeTab === tab.id)}
              <span className="ml-2">{tab.label}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="text-sm text-gray-500 hidden sm:block">
        {tabs.find((t) => t.id === activeTab)?.description}
      </div>
    </div>
  )
}

/**
 * Get tab icon based on tab ID and active state
 */
function getTabIcon(tabId: ForecastingTab, isActive: boolean): React.ReactElement {
  const className = `w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`

  switch (tabId) {
    case 'scenarios':
      return <ScenarioIcon className={className} />
    case 'projections':
      return <ChartIcon className={className} />
    case 'saved':
      return <SaveIcon className={className} />
    default:
      return <div className={className} />
  }
}

/**
 * Page Footer Component
 */
function PageFooter(): React.ReactElement {
  return (
    <footer className="mt-8 pt-6 border-t border-gray-200 text-center">
      <p className="text-xs text-gray-400">
        All forecasting calculations performed server-side • Data stored in Germany (EU)
      </p>
    </footer>
  )
}

/**
 * Loading Spinner Component
 */
function LoadingSpinner(): React.ReactElement {
  return (
    <div className="flex items-center justify-center space-x-2">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      <span className="text-gray-600">Loading...</span>
    </div>
  )
}

// ============================================================================
// Icon Components
// ============================================================================

function CrownIcon({ className }: { className: string }): React.ReactElement {
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
        d="M5 18V6a2 2 0 012-2h10a2 2 0 012 2v12M9 18h6M9 18h6M9 18V8m6 10V8m-6 10a2 2 0 002 2h2a2 2 0 002-2M9 18a2 2 0 00-2-2h2a2 2 0 002 2"
      />
    </svg>
  )
}

function ScenarioIcon({ className }: { className: string }): React.ReactElement {
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
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  )
}

function ChartIcon({ className }: { className: string }): React.ReactElement {
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
        d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
      />
    </svg>
  )
}

function SaveIcon({ className }: { className: string }): React.ReactElement {
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
        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
      />
    </svg>
  )
}
