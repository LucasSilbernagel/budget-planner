import {
	calculateFinancialForecast,
	type ForecastingResult,
	type YearlyForecast,
} from '@budget-planner/core/finance/forecasting'
import { act, fireEvent, renderHook, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { cloneElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useFormattedAmount } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

// The stored baseline is a deliberate marker (net worth 1 every year), so any figure
// derived from it reads wrong at once.

vi.mock('recharts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('recharts')>()
	return {
		...actual,
		ResponsiveContainer: ({ children }: { children: ReactElement }) =>
			cloneElement(children, { width: 600, height: 400 } as never),
	}
})

// Holds the first-pull window open so a forecast can be reopened before today's data is ready.
const syncPending = vi.hoisted(() => ({ value: false }))
vi.mock('../../hooks/useIsInitialSyncPending', () => ({
	useIsInitialSyncPending: () => syncPending.value,
}))

const usePremiumAccess = vi.fn()
vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
vi.mock('../../lib/forecasting/forecast-api', () => ({
	fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
	fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
	saveForecast: vi.fn(),
	updateForecast: vi.fn(),
	deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement
const ISO = '2026-09-28T00:00:00.000Z'
const PROFILE = 'profile-test'
const YEARS = 10
const STORED_ENDING = 50_000_000

const FLAT = { name: 'Today', incomeGrowthRate: 0, expenseGrowthRate: 0, oneTimeEvents: [] }

function seedToday(): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Salary',
				amount: 600_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		] as never,
	})
	useExpenseStore.setState({
		expenses: [
			{
				id: 'exp-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Rent',
				amount: 300_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		] as never,
	})
}

function todayEnding(): number {
	const result = calculateFinancialForecast(
		{
			income: [{ amount: 600_000, frequency: 'monthly' }],
			expenses: [{ amount: 300_000, frequency: 'monthly' }],
			savings: 0,
			investments: 0,
			savingsAccounts: [],
			balanceAccounts: [],
		},
		FLAT,
		YEARS
	)
	return result.baseline.at(-1)?.netWorth ?? Number.NaN
}

function row(year: number, netWorth: number): YearlyForecast {
	return { year, income: 0, expenses: 0, netIncome: 0, savings: netWorth, investments: 0, netWorth }
}

function savedRow(inputs: Record<string, unknown> = {}): Record<string, unknown> {
	const scenario = { name: 'Big plan', incomeGrowthRate: 0, expenseGrowthRate: 0 }
	const result = {
		scenario,
		baseline: Array.from({ length: YEARS }, (_, i) => row(i + 1, 1)),
		projection: Array.from({ length: YEARS }, (_, i) =>
			row(i + 1, Math.round((STORED_ENDING * (i + 1)) / YEARS))
		),
		summary: {
			startingNetWorth: 0,
			endingNetWorth: STORED_ENDING,
			totalGrowth: STORED_ENDING,
			averageAnnualGrowth: STORED_ENDING / YEARS,
		},
	} satisfies ForecastingResult
	return {
		id: 7,
		profileId: PROFILE,
		name: 'Big plan',
		description: null,
		version: 5,
		createdAt: ISO,
		updatedAt: ISO,
		scenarioData: JSON.stringify({
			scenario,
			result,
			inputs: { savings: 0, investments: 0, years: YEARS, ...inputs },
		}),
	}
}

function formatter(): (cents: number) => string {
	return renderHook(() => useFormattedAmount()).result.current
}

beforeEach(() => {
	const status = {
		hasAccess: true,
		subscriptionStatus: 'active',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	} satisfies PremiumAccessStatus
	usePremiumAccess.mockReturnValue({ status })
	useProfileStore.setState({ activeProfileId: PROFILE })
	seedToday()
	fetchProfiles.mockResolvedValue({
		success: true,
		data: [{ id: PROFILE, name: 'Household', isDefault: true }],
	})
	fetchForecasts.mockResolvedValue({ success: true, data: [savedRow()] })
})

afterEach(() => {
	syncPending.value = false
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	vi.clearAllMocks()
})

describe('a saved forecast is compared against today', () => {
	it('My Forecasts shows each row "vs. today" from today\'s data, not the stored baseline', async () => {
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
		const format = formatter()
		const ending = await screen.findByText(format(STORED_ENDING))
		const cell = ending.closest('td') as HTMLElement
		const expected = STORED_ENDING - todayEnding()
		expect(expected).toBe(14_000_000) // 500,000 − 10 × 12 × 3,000
		expect(within(cell).getByText(`+${format(expected)} vs. today`)).toBeInTheDocument()
	})

	it("a reopened forecast's Projections never shows the stored baseline", async () => {
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
		fireEvent.click(await screen.findByRole('button', { name: 'Edit Big plan' }))
		// Inside the builder's 500 ms debounce: this is the page's own lifted result.
		fireEvent.click(screen.getByRole('tab', { name: /projections/i }))
		// Read synchronously: no timer can fire before this line, so the recompute has not replaced the result.
		// The builder stays mounted, CSS-hidden, with its own card: take the visible one.
		expect(screen.getAllByText('vs. today', { selector: 'dt' })).toHaveLength(2)
		const card = screen
			.getAllByText('vs. today', { selector: 'dt' })
			.find((dt) => dt.closest('.hidden') === null) as HTMLElement
		const format = formatter()
		expect(card.nextElementSibling?.textContent).toBe(`+${format(STORED_ENDING - todayEnding())}`)
	})

	it('both summaries are description lists: every term in a <dl>, groups hold only <dt>/<dd>', async () => {
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
		fireEvent.click(await screen.findByRole('button', { name: 'Edit Big plan' }))
		fireEvent.click(screen.getByRole('tab', { name: /projections/i }))

		const lists = Array.from(document.querySelectorAll('dl')).filter((dl) =>
			dl.textContent?.includes('Starting Net Worth')
		)
		expect(lists).toHaveLength(2)
		for (const dl of lists) {
			const groups = Array.from(dl.children)
			// Five cards: Starting / Ending Net Worth, Total Growth, Avg Annual Growth, vs. today.
			expect(groups).toHaveLength(5)
			for (const group of groups) {
				expect(Array.from(group.children).map((child) => child.tagName)).toEqual(['DT', 'DD'])
			}
		}
		const terms = Array.from(document.querySelectorAll('dt'))
		expect(terms.length).toBeGreaterThanOrEqual(10)
		expect(terms.filter((dt) => dt.closest('dl') === null)).toHaveLength(0)

		const ending = screen
			.getAllByText('Ending Net Worth', { selector: 'dt' })
			.find((dt) => dt.closest('.hidden') === null) as HTMLElement
		const change = ending.nextElementSibling?.querySelector('span.block')
		expect(change?.textContent).toMatch(/^[+-]?\S*\d/)
	})

	it("a forecast reopened before today's data is ready shows on Projections once it is, even if it never recomputes (code review 107.1)", async () => {
		// A saved rate outside -100%..100% blocks recompute, so only the baseline fill can reach Projections.
		fetchForecasts.mockResolvedValue({
			success: true,
			data: [
				savedRow({
					balanceAccounts: [
						{
							name: 'Wild fund',
							type: 'investment',
							balance: 0,
							contribution: 0,
							frequency: 'monthly',
							annualReturn: 5,
						},
					],
				}),
			],
		})
		syncPending.value = true
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
		fireEvent.click(await screen.findByRole('button', { name: 'Edit Big plan' }))
		fireEvent.click(screen.getByRole('tab', { name: /projections/i }))
		expect(
			screen.getByText('Build a scenario in the Scenario Builder to see its projection here.')
		).toBeInTheDocument()

		syncPending.value = false
		act(() => seedToday())
		const format = formatter()
		const expected = `+${format(STORED_ENDING - todayEnding())}`
		// The builder stays mounted, CSS-hidden, with its own card: the VISIBLE one is
		// the Projections tab's.
		await waitFor(
			() => {
				const visible = screen
					.getAllByText('vs. today', { selector: 'dt' })
					.filter((dt) => dt.closest('.hidden') === null)
				expect(visible).toHaveLength(1)
				expect(visible[0]?.nextElementSibling?.textContent).toBe(expected)
			},
			{ timeout: 3000 }
		)
	})
})
