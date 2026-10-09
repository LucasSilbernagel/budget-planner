import type { ForecastingResult } from '@budget-planner/core/finance/forecasting'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHasFocusRing } from '@/test/responsive-table-tokens'
import { ProjectionChart } from '../projection-chart'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
}))

vi.mock('../../../lib/chartTheme', () => ({
	useChartColors: () => ({
		grid: '#cccccc',
		axis: '#333333',
		tooltipText: '#333333',
	}),
}))

describe('ProjectionChart', () => {
	it('shows a neutral empty state, not sample data, when there is no result', () => {
		render(<ProjectionChart result={null} />)
		expect(screen.getByText(/build a scenario/i)).toBeInTheDocument()
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
		expect(screen.getByText('15000.00')).toBeInTheDocument()
		expect(screen.queryByText(/build a scenario/i)).toBeNull()
	})

	it('does not show summary cards alongside the empty state for an empty-arrays result', () => {
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

describe('chart layer toggles report on/off', () => {
	it.each(['Grid', 'Legend', 'Tooltips'])('%s starts pressed and flips on each click', (name) => {
		render(<ProjectionChart result={null} />)
		const toggle = screen.getByRole('button', { name })
		expect(toggle).toHaveAttribute('aria-pressed', 'true')
		fireEvent.click(toggle)
		expect(toggle).toHaveAttribute('aria-pressed', 'false')
		fireEvent.click(toggle)
		expect(toggle).toHaveAttribute('aria-pressed', 'true')
	})

	it.each(['Grid', 'Legend', 'Tooltips'])(
		'%s shows a visible keyboard focus indicator, including in forced colours',
		(name) => {
			// ring-* is a box-shadow, which Windows High Contrast discards; the forced-colors outline keeps focus visible.
			render(<ProjectionChart result={null} />)
			const toggle = screen.getByRole('button', { name })
			assertHasFocusRing(toggle, name)
			const tokens = toggle.className.split(/\s+/)
			expect(tokens).toEqual(
				expect.arrayContaining([
					'focus:outline-none',
					'forced-colors:focus:outline',
					'forced-colors:focus:outline-2',
				])
			)
			expect(tokens.filter((token) => token.includes('ring-offset'))).toEqual([])
		}
	)
})
