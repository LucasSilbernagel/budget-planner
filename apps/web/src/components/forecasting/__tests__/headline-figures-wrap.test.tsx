// jsdom has no layout: this pins the wiring (a <wbr> after each digit-flanked separator), not that it fits.

import type { ForecastingResult } from '@budget-planner/core/finance/forecasting'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { useProfileStore } from '../../../stores/profileStore'
import { ProjectionChart } from '../projection-chart'
import { ScenarioBuilder } from '../scenario-builder'

const SUMMARY = {
	startingNetWorth: 2_556_790_080,
	endingNetWorth: 31_010_048_369,
	totalGrowth: 28_453_258_289,
	averageAnnualGrowth: 2_845_325_829,
}

const point = (netWorth: number) => ({
	year: 1,
	income: 0,
	expenses: 0,
	netIncome: 0,
	savings: 0,
	investments: 0,
	netWorth,
})

const RESULT = {
	scenario: { name: 'Scenario', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
	baseline: [point(SUMMARY.startingNetWorth)],
	projection: [point(SUMMARY.endingNetWorth)],
	summary: SUMMARY,
} satisfies ForecastingResult

vi.mock('@budget-planner/core/finance/forecasting', async (importOriginal) => {
	const real = await importOriginal<typeof import('@budget-planner/core/finance/forecasting')>()
	return { ...real, calculateFinancialForecast: () => RESULT }
})

vi.mock('../../../lib/chartTheme', () => ({
	useChartColors: () => ({ grid: '#cccccc', axis: '#333333', tooltipText: '#333333' }),
}))

function runsOf(el: Element): string[] {
	const out = ['']
	for (const node of Array.from(el.childNodes)) {
		if (node instanceof HTMLElement && node.matches('dd > span.block')) continue
		if (node.nodeName === 'WBR') out.push('')
		else out[out.length - 1] += node.textContent ?? ''
	}
	return out
}

function figureOf(label: string): HTMLElement {
	return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
}

const EXPECTED = [
	['Starting Net Worth', ['$25,', '567,', '900.80']],
	['Ending Net Worth', ['$310,', '100,', '483.69']],
	['Total Growth', ['$284,', '532,', '582.89']],
	['Avg Annual Growth', ['$28,', '453,', '258.29']],
	['vs. today', ['+$284,', '532,', '582.89']],
] satisfies [string, string[]][]

beforeEach(() => {
	useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
	useProfileStore.setState({ activeProfileId: 'profile-test' })
})

const initialActiveProfileId = useProfileStore.getState().activeProfileId

afterEach(() => {
	useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	useProfileStore.setState({ activeProfileId: initialActiveProfileId })
})

describe('forecasting headline figures break only between digit groups', () => {
	it('the Scenario Builder: the Forecast Summary stat cards (five)', async () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)
		await waitFor(() => expect(figureOf('Ending Net Worth').textContent).toBe('$310,100,483.69'))
		for (const [label, runs] of EXPECTED) {
			expect(runsOf(figureOf(label)), label).toEqual(runs)
		}
		for (const [label] of EXPECTED) {
			const term = screen.getByText(label, { selector: 'dt' })
			expect([...term.classList], label).toContain('text-body')
			expect([...term.classList], label).not.toContain('text-muted')
		}
	})

	it('the Projections tab: the summary cards (five)', () => {
		render(<ProjectionChart result={RESULT} />)
		for (const [label, runs] of EXPECTED) {
			expect(runsOf(figureOf(label)), label).toEqual(runs)
		}
	})
})
