import { fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter, screen } from '@/test/utils'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

// renderWithRouter, not render: the blocked-save notice contains a Link, which needs a router.

const mockCurrency = vi.hoisted(() => ({
	mode: 'none' as 'none' | 'symbol',
	currency: 'NONE',
	locale: 'en-US',
}))

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ ...mockCurrency }),
	useCurrencyMode: () => mockCurrency.mode,
	useCurrencyCode: () => mockCurrency.currency,
}))

const ISO = '2026-09-23T00:00:00.000Z'
const PROFILE = 'profile-test'

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

const NO_PROFILE_NOTICE =
	'Saving a forecast needs a financial profile, and this account does not have one yet.'
const PROFILE_ERROR_NOTICE =
	'We could not check your financial profiles, so saving is unavailable right now.'
const NO_PROFILE_SHORT = 'Needs a financial profile'
const PROFILE_ERROR_SHORT = 'Profile check failed'

async function findSaveButton(): Promise<HTMLElement> {
	return screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

beforeEach(() => {
	mockCurrency.mode = 'none'
	mockCurrency.currency = 'NONE'
	mockCurrency.locale = 'en-US'
	seedOwnFinances()
})

afterEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	vi.clearAllMocks()
})

describe('a failed save reports itself at the button (AC-3, AC-4)', () => {
	it('renders the outcome in the same block as the Save button, not only at the top of the form', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		const saveButton = await findSaveButton()
		expect(screen.queryByTestId('save-outcome')).toBeNull()

		fireEvent.click(saveButton)

		const outcome = await screen.findByTestId('save-outcome')
		expect(outcome).toHaveTextContent('Name already in use')
		expect(outcome.parentElement).toContainElement(saveButton)
		const buttonFollowsMessage = Boolean(
			outcome.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING
		)
		expect(buttonFollowsMessage).toBe(true)
	})

	it('re-announces and re-focuses when a RETRY fails with the IDENTICAL message', async () => {
		// Retrying with the same message is an Object.is bail-out unless the outcome is cleared first, so nothing would re-mount.
		const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		const saveButton = await findSaveButton()
		fireEvent.click(saveButton)
		const first = await screen.findByTestId('save-outcome')
		await waitFor(() => expect(document.activeElement).toBe(first))

		saveButton.focus()
		expect(document.activeElement).toBe(saveButton)
		fireEvent.click(saveButton)

		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
		const second = await screen.findByTestId('save-outcome')
		await waitFor(() => expect(document.activeElement).toBe(second))
	})

	it('reports a REJECTED onSave, not only a resolved failure', async () => {
		const onSave = vi.fn().mockRejectedValue(new Error('Boom from the caller'))
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(await findSaveButton())

		expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Boom from the caller')
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /save forecast/i })).not.toBeDisabled()
		)
	})

	it('falls back to a generic message when a rejection carries an EMPTY message', async () => {
		const onSave = vi.fn().mockRejectedValue(new Error(''))
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(await findSaveButton())

		expect(await screen.findByTestId('save-outcome')).toHaveTextContent('Failed to save forecast')
	})

	it('reports the in-flight save upward so the page can lock its tabs', async () => {
		const onSavingChange = vi.fn()
		const onSave = vi.fn().mockRejectedValue(new Error('Boom'))
		renderWithRouter(<ScenarioBuilder onSave={onSave} onSavingChange={onSavingChange} />)

		fireEvent.click(await findSaveButton())
		await screen.findByTestId('save-outcome')

		// The false arm runs in the same `finally` as setIsSaving(false), so a rejection cannot latch the tab lock.
		expect(onSavingChange).toHaveBeenCalledWith(true)
		expect(onSavingChange).toHaveBeenLastCalledWith(false)
	})

	it('retires a stale save outcome when the availability arm changes', async () => {
		// renderWithRouter's rerender re-renders the router root, so the arm is flipped from a stateful wrapper.
		function Harness(): React.ReactElement {
			const [kind, setKind] = React.useState<'loading' | 'none'>('loading')
			return (
				<>
					<button type="button" onClick={() => setKind('none')}>
						resolve to none
					</button>
					<ScenarioBuilder
						onSave={vi.fn().mockResolvedValue({ success: false, error: 'Try again in a moment' })}
						saveAvailability={{ kind }}
					/>
				</>
			)
		}
		renderWithRouter(<Harness />)

		const saveButton = await findSaveButton()
		expect(saveButton).not.toBeDisabled()
		fireEvent.click(saveButton)
		await screen.findByTestId('save-outcome')

		fireEvent.click(screen.getByRole('button', { name: /resolve to none/i }))

		await waitFor(() => expect(screen.queryByTestId('save-outcome')).toBeNull())
		expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument()
	})

	it('announces the failure and moves focus onto it, leaving Save as the next tab stop', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Network unreachable' })
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		const saveButton = await findSaveButton()
		fireEvent.click(saveButton)

		const outcome = await screen.findByTestId('save-outcome')
		expect(outcome).toHaveAttribute('role', 'alert')
		await waitFor(() => expect(document.activeElement).toBe(outcome))
		expect(outcome).toHaveAttribute('tabindex', '-1')
	})

	it('keeps the save outcome out of the calculation-error block (AC-9)', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(await findSaveButton())
		await screen.findByTestId('save-outcome')

		expect(screen.queryByTestId('calculation-error')).toBeNull()
	})

	it('clears the failure once the user edits a field to act on it (AC-9)', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Name already in use' })
		renderWithRouter(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(await findSaveButton())
		await screen.findByTestId('save-outcome')

		fireEvent.change(screen.getByDisplayValue('My Financial Forecast'), {
			target: { value: 'Renamed forecast' },
		})

		await waitFor(() => expect(screen.queryByTestId('save-outcome')).toBeNull(), { timeout: 3000 })
	})
})

describe('the Save affordance explains itself when saving cannot work (AC-1, AC-2)', () => {
	it('names the missing profile and links to /profiles', async () => {
		renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'none' }} />)

		const notice = await screen.findByTestId('save-blocked-notice')
		expect(notice).toHaveTextContent(NO_PROFILE_NOTICE)
		expect(screen.getByRole('link', { name: /create a profile/i })).toHaveAttribute(
			'href',
			'/profiles'
		)
	})

	it('disables Save and says why beside it', async () => {
		renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'none' }} />)

		const saveButton = await findSaveButton()
		expect(saveButton).toBeDisabled()
		expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(NO_PROFILE_SHORT)
	})

	it('does NOT tell a user whose profile check failed to create a profile', async () => {
		renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'error' }} />)

		await findSaveButton()
		const notice = await screen.findByTestId('save-blocked-notice')
		expect(notice).toHaveTextContent(PROFILE_ERROR_NOTICE)
		expect(screen.queryByText(new RegExp(NO_PROFILE_NOTICE, 'i'))).toBeNull()
		expect(screen.queryByRole('link', { name: /create a profile/i })).toBeNull()
		expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(PROFILE_ERROR_SHORT)
	})

	it('shows nothing at all while the profile check is still in flight', async () => {
		renderWithRouter(<ScenarioBuilder onSave={vi.fn()} saveAvailability={{ kind: 'loading' }} />)

		const saveButton = await findSaveButton()
		expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
		expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
		expect(saveButton).not.toBeDisabled()
	})

	it('refuses the save on a blocked arm even when the disabled attribute is bypassed', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		renderWithRouter(<ScenarioBuilder onSave={onSave} saveAvailability={{ kind: 'none' }} />)

		const saveButton = (await findSaveButton()) as HTMLButtonElement
		expect(saveButton).toBeDisabled()
		saveButton.disabled = false
		fireEvent.click(saveButton)

		await waitFor(() => expect(screen.getByTestId('save-blocked-reason')).toBeInTheDocument())
		expect(onSave).not.toHaveBeenCalled()
	})

	it('stays out of the way when the prop is omitted, so the sibling suites keep their meaning', async () => {
		renderWithRouter(<ScenarioBuilder onSave={vi.fn()} />)

		const saveButton = await findSaveButton()
		expect(screen.queryByTestId('save-blocked-notice')).toBeNull()
		expect(saveButton).not.toBeDisabled()
	})
})
