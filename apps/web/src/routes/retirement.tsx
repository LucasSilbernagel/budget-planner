import { createFileRoute } from '@tanstack/react-router'
import React from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import RetirementForm from '../components/RetirementForm'
import RetirementTimelineChart from '../components/RetirementTimelineChart'

export const Route = createFileRoute('/retirement')({
  component: RetirementPage,
})

/**
 * Retirement Calculator Page
 *
 * Main page for retirement planning calculations.
 * Uses TanStack Start file-based routing (route: /retirement)
 *
 * Features:
 * - Retirement form for calculating required assets
 * - Age timeline visualization for retirement projections
 * - Clear explanations of the Safe Withdrawal Model
 *
 * AC Coverage: AC-1, AC-2 (via RetirementForm)
 * AC Coverage: AC-3 (via RetirementTimelineChart)
 */
function RetirementPage() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen surface-sunken py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <header className="mb-12">
            <div>
              <h1 className="text-4xl font-bold text-heading mb-4">Retirement Planner</h1>
              <p className="text-xl text-body">
                Calculate if your investment assets can safely yield your desired retirement income.
              </p>
            </div>
          </header>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Form */}
            <div className="lg:col-span-1">
              <div className="surface rounded-2xl shadow-lg p-6 sm:p-8">
                <h2 className="text-2xl font-semibold text-subheading mb-6">
                  Calculate Your Retirement Needs
                </h2>
                <p className="text-body mb-8">
                  Enter your desired retirement income (monthly or annual) and expected return rate
                  to calculate the required future value of your assets using the Safe Withdrawal
                  Model. This is a standalone calculation; its return rate is separate from the one
                  in the Retirement Timeline Projection.
                </p>

                <RetirementForm />

                {/* Explanation */}
                <div className="mt-8 p-4 surface-inset rounded-lg">
                  <h3 className="font-semibold text-subheading mb-2">How It Works</h3>
                  <p className="text-sm text-body">
                    The <strong>Safe Withdrawal Model</strong> calculates the required assets using
                    the formula:
                  </p>
                  <p className="text-sm text-body mt-2">
                    <code className="bg-gray-200 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 rounded">
                      FV = Ir × (12 / r)
                    </code>
                  </p>
                  <ul className="text-sm text-body mt-2 space-y-1">
                    <li>
                      <strong>FV</strong> = Future Value (required retirement assets)
                    </li>
                    <li>
                      <strong>Ir</strong> = Desired monthly retirement income
                    </li>
                    <li>
                      <strong>r</strong> = Annual return rate (as decimal)
                    </li>
                  </ul>
                  <p className="text-xs text-muted mt-2">
                    This ensures you can withdraw your desired income without depleting your
                    principal.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column - Timeline Chart */}
            <div className="lg:col-span-2">
              <div className="surface rounded-2xl shadow-lg p-6 sm:p-8">
                <h2 className="text-2xl font-semibold text-subheading mb-6">
                  Retirement Timeline Projection
                </h2>
                <p className="text-body mb-8">
                  Visualize how your assets will grow over time and when you can safely retire.
                  Adjust the inputs to see how different scenarios affect your retirement timeline.
                  These inputs, including this return rate, are independent of the Retirement Needs
                  calculator.
                </p>

                <RetirementTimelineChart />

                <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
                  <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">
                    About the Projection
                  </h3>
                  <p className="text-sm text-blue-600 dark:text-blue-300">
                    This timeline shows compounding growth of your investments over time. The
                    projection assumes:
                  </p>
                  <ul className="text-sm text-blue-600 dark:text-blue-300 mt-2 space-y-1">
                    <li>Consistent annual return rate</li>
                    <li>Monthly compounding of returns</li>
                    <li>No additional contributions (unless specified)</li>
                    <li>No withdrawals until retirement</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div className="mt-12 surface rounded-2xl shadow-lg p-6 sm:p-8">
            <h2 className="text-2xl font-semibold text-subheading mb-6">
              Understanding Safe Withdrawal
            </h2>
            <div className="prose dark:prose-invert max-w-none text-body">
              <p>
                The Safe Withdrawal Model is based on the principle that if you withdraw only the
                investment earnings (interest/dividends/capital gains) and never touch the
                principal, your money will theoretically last forever.
              </p>
              <p className="mt-4">
                For example, if you have $1,000,000 invested and expect a 6% annual return, you can
                safely withdraw $60,000 per year ($5,000 per month) without ever reducing your
                principal. The formula rearranges this to tell you how much principal you need for
                your desired withdrawal amount.
              </p>
              <p className="mt-4">
                <strong>Note:</strong> This is a simplified model and doesn't account for inflation,
                taxes, market volatility, or changes in spending needs. For comprehensive retirement
                planning, consult with a financial advisor.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
