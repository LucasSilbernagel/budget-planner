import { fireEvent, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { Route } from '../forecasting'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

const fetchProfiles = vi.fn()
const fetchForecasts = vi.fn()
const saveForecast = vi.fn()

vi.mock('../../lib/forecasting/forecast-api', () => ({
	fetchProfiles: (...args: unknown[]) => fetchProfiles(...args),
	fetchForecasts: (...args: unknown[]) => fetchForecasts(...args),
	saveForecast: (...args: unknown[]) => saveForecast(...args),
	deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

const ISO = '2026-09-23T00:00:00.000Z'
const PROFILE = 'profile-test'

const NO_PROFILE_NOTICE =
	'Saving a forecast needs a financial profile, and this account does not have one yet.'
const PROFILE_ERROR_NOTICE =
	'We could not check your financial profiles, so saving is unavailable right now.'

function aProfile(): Record<string, unknown> {
	return { id: 'prof-1', name: 'Household', isDefault: true }
}

function mockPaidUser(): void {
	const status = {
		hasAccess: true,
		subscriptionStatus: 'active',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	} satisfies PremiumAccessStatus
	usePremiumAccess.mockReturnValue({ status })
}

function seedOwnFinances(): void {
	useProfileStore.setState({ activeProfileId: PROFILE })
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Salary',
				amount: 500_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
}

async function findSaveButton(): Promise<HTMLElement> {
	return screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

beforeEach(() => {
	mockPaidUser()
	seedOwnFinances()
	fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
	fetchForecasts.mockResolvedValue({ success: true, data: [] })
	saveForecast.mockResolvedValue({ success: true, data: { id: 1 } })
})

afterEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	vi.clearAllMocks()
})

describe('an account with no financial profile is told BEFORE it builds anything', () => {
	it('explains the missing profile and links to /profiles', async () => {
		fetchProfiles.mockResolvedValue({ success: true, data: [] })
		renderWithRouter(<ForecastingPage />)

		const notice = await screen.findByTestId('save-blocked-notice')
		expect(notice).toHaveTextContent(NO_PROFILE_NOTICE)
		expect(screen.getByRole('link', { name: /create a profile/i })).toHaveAttribute(
			'href',
			'/profiles'
		)
	})

	it('says nothing of the sort once a profile exists', async () => {
		fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
		renderWithRouter(<ForecastingPage />)

		// Positive control: a queryBy/toBeNull pair also passes on a blank render.
		await findSaveButton()
		await waitFor(() => expect(fetchProfiles).toHaveBeenCalled())

		expect(screen.queryByTestId('save-blocked-notice')).toBeNull()

		// Absence alone cannot tell `ready` from `loading`; a successful save proves the arm resolved.
		fireEvent.click(screen.getByRole('button', { name: /save forecast/i }))
		expect(await screen.findByTestId('save-success')).toBeInTheDocument()
		expect(saveForecast).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-1' }))
	})

	it('keeps a resolved profile when the SAVED-FORECAST LIST fetch fails', async () => {
		// A failing forecast list must not demote an already-resolved `ready` arm.
		fetchProfiles.mockResolvedValue({ success: true, data: [aProfile()] })
		fetchForecasts.mockRejectedValue(new Error('list fetch exploded'))
		renderWithRouter(<ForecastingPage />)

		const saveButton = await findSaveButton()
		await waitFor(() => expect(fetchForecasts).toHaveBeenCalled())

		expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
		expect(saveButton).not.toBeDisabled()
	})

	it('treats a malformed success (no data array) as an error, not as "no profiles"', async () => {
		// Only the catch logs, so console.error separates deliberate classification from a caught crash.
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			fetchProfiles.mockResolvedValue({ success: true })
			renderWithRouter(<ForecastingPage />)

			expect(await screen.findByTestId('save-blocked-notice')).toHaveTextContent(
				PROFILE_ERROR_NOTICE
			)
			expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
			expect(consoleError).not.toHaveBeenCalledWith(
				'Failed to load forecasting data:',
				expect.anything()
			)
		} finally {
			consoleError.mockRestore()
		}
	})

	it('treats a profile carrying an empty id as an error, not as ready', async () => {
		fetchProfiles.mockResolvedValue({ success: true, data: [{ id: '', isDefault: true }] })
		renderWithRouter(<ForecastingPage />)

		expect(await screen.findByTestId('save-blocked-notice')).toHaveTextContent(PROFILE_ERROR_NOTICE)
	})

	it('locks the tab strip while a save is in flight, and releases it afterwards', async () => {
		// Hidden, the builder's failure alert reaches nobody, so tabs lock during a save. The deferred
		// promise holds the save in flight so the lock itself is observable.
		let release: (v: { success: boolean; error?: string }) => void = () => {}
		saveForecast.mockReturnValue(
			new Promise<{ success: boolean; error?: string }>((resolve) => {
				release = resolve
			})
		)
		renderWithRouter(<ForecastingPage />)

		const saveButton = await findSaveButton()
		const projectionsTab = screen.getByRole('tab', { name: /projections/i })
		expect(projectionsTab).not.toBeDisabled()

		fireEvent.click(saveButton)

		await waitFor(() => expect(projectionsTab).toBeDisabled())

		// The key goes to the tablist: a disabled tab cannot hold focus.
		const builderTab = screen.getByRole('tab', { name: /scenario builder/i })
		fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
		fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' })
		fireEvent.click(projectionsTab)
		expect(builderTab).toHaveAttribute('aria-selected', 'true')
		expect(projectionsTab).toHaveAttribute('aria-selected', 'false')

		release({ success: false, error: 'Name already in use' })

		await screen.findByTestId('save-outcome')
		await waitFor(() => expect(projectionsTab).not.toBeDisabled())
	})

	it('does not flash the prompt while the profile check is still in flight', async () => {
		fetchProfiles.mockReturnValue(new Promise(() => {}))
		renderWithRouter(<ForecastingPage />)

		await findSaveButton()
		expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
	})

	it('does not tell a user whose profile check FAILED to create a profile', async () => {
		fetchProfiles.mockResolvedValue({ success: false, error: 'Authentication required' })
		renderWithRouter(<ForecastingPage />)

		const notice = await screen.findByTestId('save-blocked-notice')
		expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
		expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
	})

	it('treats a THROWN profile fetch as an error, not as "you have no profiles"', async () => {
		fetchProfiles.mockRejectedValue(new TypeError('Failed to fetch'))
		renderWithRouter(<ForecastingPage />)

		const notice = await screen.findByTestId('save-blocked-notice')
		expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
		expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
	})
})

describe('a save reports its outcome where the user is looking', () => {
	it('confirms a successful save OUTSIDE the builder, which the tab switch hides', async () => {
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await findSaveButton())

		const confirmation = await screen.findByTestId('save-success')
		expect(confirmation).toHaveTextContent(/My Financial Forecast/)
		expect(confirmation).toHaveAttribute('role', 'status')

		const savedTab = screen.getByRole('tab', { name: /my forecasts/i })
		expect(savedTab).toHaveAttribute('aria-selected', 'true')
		expect(savedTab.tabIndex).toBe(0)
		expect(screen.getByRole('tab', { name: /scenario builder/i })).toHaveAttribute(
			'aria-selected',
			'false'
		)

		// The builder is CSS-hidden, not unmounted, so jsdom would still find a confirmation inside it.
		const builderPanel = screen
			.getByRole('heading', { name: 'Scenario Builder' })
			.closest('.hidden')
		expect(builderPanel).not.toBeNull()
		expect(builderPanel).not.toContainElement(confirmation)
	})

	it('surfaces a rejected save (duplicate name) at the button', async () => {
		saveForecast.mockResolvedValue({ success: false, error: 'Name already in use' })
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await findSaveButton())

		expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Name already in use')
		expect(screen.queryByTestId('save-success')).toBeNull()
	})

	it('surfaces a THROWN save (network failure) at the button', async () => {
		saveForecast.mockRejectedValue(new Error('Failed to fetch'))
		renderWithRouter(<ForecastingPage />)
		fireEvent.click(await findSaveButton())

		expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Failed to fetch')
	})

	it('does not attempt a save at all when there is no profile to save to', async () => {
		fetchProfiles.mockResolvedValue({ success: true, data: [] })
		renderWithRouter(<ForecastingPage />)

		const saveButton = await findSaveButton()
		await waitFor(() => expect(saveButton).toBeDisabled())
		fireEvent.click(saveButton)

		expect(saveForecast).not.toHaveBeenCalled()
	})
})
