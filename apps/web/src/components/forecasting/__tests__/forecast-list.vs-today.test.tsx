import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { ForecastList } from '../forecast-list'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
}))

function forecast(id: string, name: string): SavedForecast {
	return {
		id,
		name,
		scenario: { name, incomeGrowthRate: 0, expenseGrowthRate: 0 },
		result: {
			scenario: { name, incomeGrowthRate: 0, expenseGrowthRate: 0 },
			baseline: [],
			projection: [],
			summary: {
				startingNetWorth: 0,
				endingNetWorth: 5_000_000,
				totalGrowth: 5_000_000,
				averageAnnualGrowth: 500_000,
			},
		},
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	}
}

describe('My Forecasts "vs. today"', () => {
	it('signs each figure once and leaves a forecast without one blank', () => {
		render(
			<ForecastList
				forecasts={[forecast('a', 'Ahead'), forecast('b', 'Behind'), forecast('c', 'Unknown')]}
				vsToday={
					new Map([
						['a', 1_234_500],
						['b', -400_000],
					])
				}
				onDelete={vi.fn()}
			/>
		)
		expect(screen.getByText('+12345.00 vs. today')).toBeInTheDocument()
		expect(screen.getByText('-4000.00 vs. today')).toBeInTheDocument()
		expect(screen.getAllByText(/vs\. today$/)).toHaveLength(2)
		expect(screen.getByText('Unknown')).toBeInTheDocument()
	})

	it('shows no line at all without the prop', () => {
		render(<ForecastList forecasts={[forecast('a', 'Ahead')]} onDelete={vi.fn()} />)
		expect(screen.getByText('Ahead')).toBeInTheDocument()
		expect(screen.queryByText(/vs\. today/)).toBeNull()
	})
})
