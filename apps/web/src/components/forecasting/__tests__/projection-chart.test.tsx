import type { ForecastingResult } from '@budget-planner/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectionChart } from '../projection-chart'

/**
 * ProjectionChart tests (story bug-3, AC-3).
 *
 * The chart previously fabricated hard-coded sample data. It now renders the
 * result supplied by the page (the user's real scenario), and a neutral empty
 * state when there is none.
 */

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
}))

vi.mock('../../../lib/chartTheme', () => ({
  useChartColors: () => ({
    grid: '#cccccc',
    axis: '#333333',
    tooltipText: '#333333',
  }),
}))

describe('ProjectionChart (bug-3 AC-3)', () => {
  it('shows a neutral empty state, not sample data, when there is no result', () => {
    render(<ProjectionChart result={null} />)
    expect(screen.getByText(/build a scenario/i)).toBeInTheDocument()
    // No summary cards without a result.
    expect(screen.queryByText('Starting Net Worth')).toBeNull()
  })

  it('renders the summary from the supplied result', () => {
    const result: ForecastingResult = {
      scenario: { name: 'Scenario', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
      baseline: [
        {
          year: 1,
          income: 0,
          expenses: 0,
          netIncome: 0,
          savings: 0,
          investments: 0,
          netWorth: 100,
        },
      ],
      projection: [
        {
          year: 1,
          income: 0,
          expenses: 0,
          netIncome: 0,
          savings: 0,
          investments: 0,
          netWorth: 200,
        },
      ],
      summary: {
        startingNetWorth: 1500000,
        endingNetWorth: 9900000,
        totalGrowth: 8400000,
        averageAnnualGrowth: 840000,
      },
    }
    render(<ProjectionChart result={result} />)

    expect(screen.getByText('Starting Net Worth')).toBeInTheDocument()
    // 1500000 cents → 15000.00 via the mock formatter (proves it uses the
    // supplied result, not the old $5,000/mo sample).
    expect(screen.getByText('15000.00')).toBeInTheDocument()
    expect(screen.queryByText(/build a scenario/i)).toBeNull()
  })

  it('does not show summary cards alongside the empty state for an empty-arrays result', () => {
    // Review fix: gate the summary on chartData, not just `result`. A result with
    // empty baseline/projection (no chart data) must show ONLY the empty state,
    // never the four cards with numbers.
    const result: ForecastingResult = {
      scenario: { name: 'Scenario', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
      baseline: [],
      projection: [],
      summary: {
        startingNetWorth: 1500000,
        endingNetWorth: 9900000,
        totalGrowth: 8400000,
        averageAnnualGrowth: 840000,
      },
    }
    render(<ProjectionChart result={result} />)
    expect(screen.getByText(/build a scenario/i)).toBeInTheDocument()
    expect(screen.queryByText('Starting Net Worth')).toBeNull()
  })
})
