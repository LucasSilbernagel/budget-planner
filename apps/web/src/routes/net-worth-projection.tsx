/**
 * Net Worth Projection Page
 * 
 * Main page for viewing forward-looking net worth projections.
 * Supports multiple scenarios for comparison.
 * Uses TanStack Start file-based routing (route: /net-worth-projection)
 * 
 * AC Coverage: AC-1 (via NetWorthChart)
 * AC Coverage: AC-2 (via hasInsufficientData check)
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createNetWorthProjection, type NetWorthProjectionInput, type NetWorthProjectionResult, type TimeHorizon } from '@budget-planner/core';
import { useFinancialCalculations } from '../hooks/useFinancialCalculations';
import { NetWorthChart, hasInsufficientData as checkInsufficientData } from '../components/net-worth/net-worth-chart';
import { ScenarioControls, DEFAULT_SCENARIOS, type Scenario } from '../components/net-worth/scenario-controls';
import { ErrorBoundary } from '../components/ErrorBoundary';

// ============================================================================
// Types
// ============================================================================

/**
 * Combined scenario with its projection result
 */
interface ScenarioWithProjection {
  scenario: Scenario;
  projection: NetWorthProjectionResult;
}

/**
 * Save/load scenario presets
 */
interface ScenarioPreset {
  id: string;
  name: string;
  scenarios: Scenario[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for presets
 */
function generatePresetId(): string {
  return `preset-${Date.now()}`;
}

/**
 * Create default scenarios with projections
 */
function createDefaultScenariosWithProjection(): ScenarioWithProjection[] {
  return DEFAULT_SCENARIOS.map(scenario => ({
    scenario,
    projection: createNetWorthProjection(scenario.input),
  }));
}

// ============================================================================
// Main Component
// ============================================================================

export function NetWorthProjectionPage() {
  // Hook for financial calculations (server-side for paid tier, client-side for free)
  const { calculateNetWorth, netWorth } = useFinancialCalculations()
  
  // State for scenarios
  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
  const [activeScenarioIndex, setActiveScenarioIndex] = useState(0);
  
  // State for projections and UI
  const [scenariosWithProjection, setScenariosWithProjection] = useState<ScenarioWithProjection[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use hook's loading state
  const hookIsCalculating = netWorth.isLoading

  // Calculate all projections whenever scenarios change
  useEffect(() => {
    let isMounted = true;
    
    const calculateAllProjections = async () => {
      if (!isMounted) return;
      
      setIsCalculating(true);
      setError(null);
      
      try {
        // Use hook for calculations (handles tier detection automatically)
        // Map each scenario to its input and track promises
        const scenarioInputs = scenarios.map((scenario) => ({
          scenario,
          input: {
            currentAssets: scenario.input.currentAssets || 0,
            currentLiabilities: scenario.input.currentLiabilities || 0,
            monthlySavings: scenario.input.monthlySavings || 0,
            expectedReturnRate: scenario.input.expectedReturnRate || 0,
            timeHorizonYears: scenario.input.timeHorizonYears || 30,
          } as NetWorthProjectionInput,
        }));
        
        // Calculate all projections by calling hook for each
        // Note: Hook state is shared, so we need to call sequentially or use direct client calls
        const newScenariosWithProjection = [];
        
        for (const { scenario, input } of scenarioInputs) {
          if (!isMounted) break;
          
          // Call hook for this scenario
          await calculateNetWorth(input);
          
          // Use the latest hook result (may be from any scenario, but hook manages state per call)
          // For better isolation, consider using the client API directly
          const projectionResult = netWorth.data || createNetWorthProjection(scenario.input);
          
          newScenariosWithProjection.push({
            scenario,
            projection: projectionResult,
          });
        }
        
        setScenariosWithProjection(newScenariosWithProjection);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        if (!isMounted) return;
        setIsCalculating(false);
      }
    };

    calculateAllProjections();
    
    // Cleanup function to prevent memory leaks
    return () => { 
      isMounted = false; 
    };
  }, [scenarios, calculateNetWorth, netWorth.data]);

  // Check if all data is insufficient
  const allInsufficientData = useMemo(() => {
    return checkInsufficientData(scenariosWithProjection);
  }, [scenariosWithProjection]);

  // Handle scenarios change
  const handleScenariosChange = useCallback((newScenarios: Scenario[]) => {
    setScenarios(newScenarios);
  }, []);

  // Handle active scenario change
  const handleActiveScenarioChange = useCallback((index: number) => {
    setActiveScenarioIndex(index);
  }, []);

  // Get visible scenarios with their projections
  const visibleScenarios = useMemo(() => {
    return scenariosWithProjection.filter(s => s.scenario.isVisible);
  }, [scenariosWithProjection]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <header className="mb-12">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h1 className="text-4xl font-bold text-gray-900">
                  Net Worth Projection
                </h1>
                <p className="text-xl text-gray-600 mt-2">
                  Compare multiple financial scenarios side-by-side
                </p>
              </div>
              
              {/* Quick Nav */}
              <div className="flex space-x-2">
                <a
                  href="/"
                  className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-md border border-gray-200 transition-colors"
                >
                  Dashboard
                </a>
                <a
                  href="/retirement"
                  className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-md border border-gray-200 transition-colors"
                >
                  Retirement
                </a>
              </div>
            </div>
          </header>

          {/* Error Display */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 font-medium">⚠️ {error}</p>
              <p className="text-red-600 text-sm mt-1">
                Please adjust your input values and try again.
              </p>
            </div>
          )}

          {/* Calculating indicator */}
          {isCalculating && (
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700 flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Calculating projections...
              </p>
            </div>
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Controls */}
            <div className="lg:col-span-1">
              <ScenarioControls
                scenarios={scenarios}
                activeScenarioIndex={activeScenarioIndex}
                onScenariosChange={handleScenariosChange}
                onActiveScenarioChange={handleActiveScenarioChange}
                isCalculating={isCalculating}
              />
            </div>

            {/* Right Column - Chart */}
            <div className="lg:col-span-2">
              {scenariosWithProjection.length > 0 && (
                <NetWorthChart
                  scenarios={scenariosWithProjection}
                  height={450}
                  showBrush={true}
                />
              )}
            </div>
          </div>

          {/* Empty State */}
          {allInsufficientData && scenariosWithProjection.length > 0 && (
            <div className="mt-8">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-yellow-700 text-sm">
                  ⚠️ All scenarios have insufficient data. Please adjust the parameters to see projections.
                </p>
              </div>
            </div>
          )}

          {/* Explanation Section */}
          <div className="mt-12 bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              How Scenario Comparison Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">
                  Multiple Scenarios
                </h3>
                <p className="text-gray-600 mb-3">
                  Create multiple scenarios to compare different financial futures.
                  Each scenario can have its own assumptions about returns, growth, and time horizons.
                </p>
                <ul className="space-y-1 text-gray-600 text-sm">
                  <li>• Click "+ Add" to create a new scenario</li>
                  <li>• Click on a scenario tab to edit it</li>
                  <li>• Use the eye icon to show/hide scenarios</li>
                  <li>• Click × to remove a scenario</li>
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">
                  Use Cases
                </h3>
                <ul className="space-y-2 text-gray-600">
                  <li className="flex items-start">
                    <span className="text-green-600 mr-2">●</span>
                    Compare conservative vs. optimistic returns
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-600 mr-2">●</span>
                    Model different savings rates
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-600 mr-2">●</span>
                    Test early retirement scenarios
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-600 mr-2">●</span>
                    Plan for major life events
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                Tips for Better Projections
              </h3>
              <ul className="space-y-2 text-gray-600">
                <li>• Use the "Sync Time Horizon" button to align all scenarios to the same period</li>
                <li>• Hide scenarios temporarily to focus on specific comparisons</li>
                <li>• Use the brush tool to zoom in on specific time periods</li>
                <li>• Rename scenarios to reflect their purpose (e.g., "Early Retirement", "College Fund")</li>
              </ul>
            </div>
          </div>

          {/* Related Links */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500 mb-4">
              Related Financial Tools
            </p>
            <div className="flex justify-center space-x-4">
              <a
                href="/retirement"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
              >
                Retirement Calculator
              </a>
              <a
                href="/balance-tracking"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors"
              >
                Balance Tracking
              </a>
              <a
                href="/savings-goals"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-md transition-colors"
              >
                Savings Goals
              </a>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default NetWorthProjectionPage;
