import { act, fireEvent, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useProfileStore } from '../../stores/profileStore'
import { Route } from '../forecasting'

// Overlapping per-id reloads answer out of order; a slow early one must not resurrect deleted rows.

const usePremiumAccess = vi.fn()
vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
const deleteForecast = vi.fn()
vi.mock('../../lib/forecasting/forecast-api', () => ({
	fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
	fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
	saveForecast: vi.fn(),
	deleteForecast: (...args: unknown[]) => deleteForecast(...args),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement
const ISO = '2026-10-07T00:00:00.000Z'
const PROFILE = 'profile-test'

function savedRow(id: number, name: string): Record<string, unknown> {
	const scenario = { name, incomeGrowthRate: 0, expenseGrowthRate: 0 }
	return {
		id,
		profileId: PROFILE,
		name,
		description: null,
		version: 1,
		createdAt: ISO,
		updatedAt: ISO,
		scenarioData: JSON.stringify({
			scenario,
			result: {
				scenario,
				baseline: [],
				projection: [],
				summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
			},
			inputs: { savings: 0, investments: 0, years: 5 },
		}),
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
	fetchProfiles.mockResolvedValue({
		success: true,
		data: [{ id: PROFILE, name: 'Household', isDefault: true }],
	})
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('bulk delete list reloads', () => {
	it('keeps the newest reload when an older one answers last', async () => {
		let server = [savedRow(1, 'One'), savedRow(2, 'Two'), savedRow(3, 'Three')]
		let gets = 0
		fetchForecasts.mockImplementation(async () => {
			const call = gets++
			const rows = [...server]
			// GET 0 is the page's first load. GET 1 is the first delete's reload,
			// taken while Two and Three still exist: it answers last.
			await sleep(call === 1 ? 300 : 5)
			return { success: true, data: rows }
		})
		deleteForecast.mockImplementation(async (id: string) => {
			await sleep(10 * Number(id))
			server = server.filter((row) => String(row.id) !== String(id))
			return { success: true }
		})
		const rowBoxes = () => screen.queryAllByRole('checkbox', { name: /^Select (One|Two|Three)$/ })

		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await screen.findByRole('tab', { name: /my forecasts/i }))
		fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }))
		expect(rowBoxes()).toHaveLength(3)
		fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }))
		fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

		await act(() => sleep(150))
		expect(gets).toBe(4)
		expect(rowBoxes()).toHaveLength(0)

		await act(() => sleep(300))
		expect(server).toEqual([])
		expect(rowBoxes()).toHaveLength(0)
	})
})
