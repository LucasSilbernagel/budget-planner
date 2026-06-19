/**
 * Net Worth Projection Page
 * 
 * Main page for viewing forward-looking net worth projections.
 * Uses TanStack Start file-based routing (route: /net-worth-projection)
 * 
 * AC Coverage: AC-1 (via NetWorthChart)
 * AC Coverage: AC-2 (via hasInsufficientData check)
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createNetWorthProjection, type NetWorthProjectionInput, type NetWorthProjectionResult } from '@budget-planner/core';
import { NetWorthChart, hasInsufficientData } from '../components/net-worth/net-worth-chart';
import { ScenarioControls } from '../components/net-worth/scenario-controls';
import { ErrorBoundary } from '../components/ErrorBoundary';

// ============================================================================
// Types
// ============================================================================

/**
 * Default input values for the projection
 */
const DEFAULT_INPUT: NetWorthProjectionInput = {
  currentAssetsCents: 10000000, // $100,000
  currentLiabilitiesCents: 0,
  monthlyNetIncomeCents: 500000, // $5,000
  assetReturnRate: 0.07, // 7% annual return
  incomeGrowthRate: 0.03, // 3% annual income growth
  timeHorizon: '10y',
  customYears: undefined,
};

// ============================================================================
// Main Component
// ============================================================================

export function NetWorthProjectionPage() {
  const [input, setInput] = useState<NetWorthProjectionInput>(DEFAULT_INPUT);
  const [projection, setProjection] = useState<NetWorthProjectionResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate projection whenever input changes
  useEffect(() => {
    const calculateProjection = async () => {
      setIsCalculating(true);
      setError(null);
      
      try {
        // Small delay to prevent rapid recalculations during slider adjustments
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const result = createNetWorthProjection(input);
        setProjection(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setProjection(null);
      } finally {
        setIsCalculating(false);
      }
    };

    calculateProjection();
  }, [input]);

  // Check if data is insufficient
  const showInsufficientData = useMemo(() => {
    if (!projection) return false;
    return hasInsufficientData(projection);
  }, [projection]);

  const handleInputChange = (updatedInput: NetWorthProjectionInput) => {
    setInput(updatedInput);
  };

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
                  Visualize your financial future based on your current data
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

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Controls */}
            <div className="lg:col-span-1">
              <ScenarioControls
                input={input}
                onInputChange={handleInputChange}
                isCalculating={isCalculating}
              />
            </div>

            {/* Right Column - Chart */}
            <div className="lg:col-span-2">
              {projection && (
                <NetWorthChart
                  projection={projection}
                  height={450}
                  showBrush={true}
                />
              )}
            </div>
          </div>

          {/* Explanation Section */}
          <div className="mt-12 bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              How It Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">
                  The Projection Formula
                </h3>
                <p className="text-gray-600 mb-3">
                  Your net worth is projected month-by-month using compound interest calculations.
                  Each month, your assets grow by the specified return rate, and new income is added.
                </p>
                <p className="text-gray-600">
                  <strong>Formula:</strong> Future Value = Present Value × (1 + rate)<sup>periods</sup>
                </p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">
                  Key Assumptions
                </h3>
                <ul className="space-y-2 text-gray-600">
                  <li>• Monthly compounding of returns</li>
                  <li>• Net income grows at the specified rate each year</li>
                  <li>• Liabilities remain constant (not growing)</li>
                  <li>• All values in today's dollars (no inflation adjustment)</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                Tips for Better Projections
              </h3>
              <ul className="space-y-2 text-gray-600">
                <li>• Use realistic return rates based on your investment mix</li>
                <li>• Consider your expected career income growth</li>
                <li>• Include all assets: investments, savings, real estate, etc.</li>
                <li>• Include all liabilities: mortgages, loans, credit cards, etc.</li>
                <li>• Adjust parameters to model different life scenarios</li>
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
