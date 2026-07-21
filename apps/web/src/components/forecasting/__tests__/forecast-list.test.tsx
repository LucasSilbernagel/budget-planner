import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { ForecastList } from '../forecast-list'

/**
 * ForecastList reload-affordance tests (story bug-3, AC-4).
 *
 * The Load button only renders when the route passes `onLoad`. Before bug-3 the
 * route never passed it, so saved forecasts could not be reopened. These lock the
 * wiring contract: the Load action appears and fires when `onLoad` is provided.
 */

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
}))

const sampleForecast: SavedForecast = {
  id: 'saved-1',
  name: 'Retirement Plan',
  scenario: {
    name: 'Retirement Plan',
    incomeGrowthRate: 0.03,
    expenseGrowthRate: 0.02,
  },
  result: {
    scenario: { name: 'Retirement Plan', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
    baseline: [],
    projection: [],
    summary: {
      startingNetWorth: 1000000,
      endingNetWorth: 5000000,
      totalGrowth: 4000000,
      averageAnnualGrowth: 400000,
    },
  },
  inputs: { savings: 500000, investments: 1000000, years: 10 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('ForecastList reload affordance (bug-3 AC-4)', () => {
  it('renders a Load action and calls onLoad with the forecast when provided', () => {
    const onLoad = vi.fn()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={onLoad} />)

    const loadButton = screen.getByRole('button', { name: 'Load' })
    fireEvent.click(loadButton)

    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad).toHaveBeenCalledWith(sampleForecast)
  })

  it('omits the Load action when onLoad is not provided', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull()
  })
})
