import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import type { SavedForecast } from '../saved-forecast'
import { ScenarioBuilder } from '../scenario-builder'

// Mocked rather than set: the real persist store binds localStorage at import time.
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

const ISO = '2026-09-22T00:00:00.000Z'
const PROFILE = 'profile-test'

function seedBuilderStartingValues(): void {
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
	useExpenseStore.setState({
		expenses: [
			{
				id: 'exp-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Rent/Mortgage',
				amount: 150_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
			{
				id: 'exp-2',
				profileId: PROFILE,
				userId: 0,
				name: 'Utilities',
				amount: 20_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
			{
				id: 'exp-3',
				profileId: PROFILE,
				userId: 0,
				name: 'Groceries',
				amount: 60_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			{
				id: 'goal-1',
				profileId: PROFILE,
				name: 'Savings',
				targetAmount: 1_000_000,
				currentBalance: 500_000,
				allocationMode: 'manual',
				monthlyAllocation: null,
				sortOrder: 0,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useBalanceStore.setState({
		entries: [
			{
				id: 'entry-1',
				profileId: PROFILE,
				type: 'investment',
				name: 'Investments',
				currentBalance: 1_000_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				sortOrder: 0,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
}

beforeEach(() => {
	mockCurrency.mode = 'none'
	mockCurrency.currency = 'NONE'
	mockCurrency.locale = 'en-US'
	seedBuilderStartingValues()
})

afterEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	vi.clearAllMocks()
})

describe('ScenarioBuilder amount prefix', () => {
	it('shows no currency symbol on amount inputs in currency-less mode', () => {
		mockCurrency.mode = 'none'
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(screen.queryByText('$')).toBeNull()
		expect(screen.queryByText('€')).toBeNull()
	})

	it('uses the selected currency symbol (not a literal $) in symbol mode', () => {
		mockCurrency.mode = 'symbol'
		mockCurrency.currency = 'EUR'
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(screen.getAllByText('€').length).toBeGreaterThan(0)
		expect(screen.queryByText('$')).toBeNull()
	})
})

describe('ScenarioBuilder savings/investments parsing', () => {
	async function inputsAfterTyping(typed: string) {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		fireEvent.change(screen.getByLabelText('Balance for Investments'), {
			target: { value: typed },
		})
		const saveButton = await screen.findByRole(
			'button',
			{ name: /save forecast/i },
			{ timeout: 2000 }
		)
		fireEvent.click(saveButton)
		await waitFor(() => expect(onSave).toHaveBeenCalled())
		return onSave.mock.calls[0][0].inputs
	}

	it('stores a typed investments amount as exact cents, without the double-×100 bug', async () => {
		const inputs = await inputsAfterTyping('7500')
		expect(inputs.investments).toBe(750000)
		expect(inputs.balanceAccounts[0].balance).toBe(750000)
	})

	it('keeps the cents of a typed decimal (replaces the GROUPED-value case)', async () => {
		expect((await inputsAfterTyping('12345.67')).investments).toBe(1234567)
	})

	it('reads a GROUPED value again, now the field is text', async () => {
		expect((await inputsAfterTyping('12,345.67')).investments).toBe(1234567)
	})

	it('keeps the cents in symbol mode, with the symbol outside the field (replaces the symbol case)', async () => {
		mockCurrency.mode = 'symbol'
		mockCurrency.currency = 'EUR'
		expect((await inputsAfterTyping('7500.50')).investments).toBe(750050)
		const input = screen.getByLabelText('Balance for Investments')
		expect(within(input.parentElement as HTMLElement).getByText('€')).toBeInTheDocument()
		expect(input).toHaveValue('7500.50')
	})
})

describe('ScenarioBuilder reload hydration', () => {
	const savedIncome = [{ name: 'Consulting', amount: 800000, frequency: 'monthly' as const }]
	const savedExpenses = [{ name: 'Rent', amount: 250000, frequency: 'monthly' as const }]
	const savedEvents = [{ year: 3, amount: 1000000, name: 'Bonus' }]
	const savedForecast = {
		id: 'saved-1',
		name: 'My Saved Plan',
		description: 'A loaded scenario',
		scenario: {
			name: 'My Saved Plan',
			description: 'A loaded scenario',
			incomeGrowthRate: 0.05,
			expenseGrowthRate: 0.03,
			newIncome: savedIncome,
			newExpenses: savedExpenses,
			oneTimeEvents: savedEvents,
		},
		result: {
			scenario: { name: 'My Saved Plan', incomeGrowthRate: 0.05, expenseGrowthRate: 0.03 },
			baseline: [],
			projection: [],
			summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
		},
		inputs: { savings: 1234500, investments: 6789000, years: 15 },
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	} satisfies SavedForecast

	it('seeds every field from a loaded forecast, including savings/investments/years', () => {
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedForecast} />)

		expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Rent')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Bonus')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Savings')).toHaveValue('12,345.00')
		expect(screen.getByLabelText('Balance for Investments')).toHaveValue('67,890.00')
		expect(screen.getByDisplayValue('15')).toBeInTheDocument()
	})

	it('defaults savings/investments/years for an older saved row with no persisted inputs', () => {
		const olderRow = { ...savedForecast, inputs: undefined } satisfies SavedForecast
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={olderRow} />)

		// A loaded forecast falls back to zero, never the live stores, or an old scenario would re-base to today's figures.
		expect(screen.getByDisplayValue('My Saved Plan')).toBeInTheDocument()
		expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
		expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
		expect(screen.getByDisplayValue('10')).toBeInTheDocument()
		expect(screen.queryByLabelText('Balance for Savings')).toBeNull()
		expect(screen.queryByLabelText('Balance for Investments')).toBeNull()
	})
})

describe('ScenarioBuilder money inputs reject non-numeric characters', () => {
	it('filters the savings row money fields: decimal text inputs that drop a letter', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		for (const label of ['Balance for Savings', 'Monthly Contribution for Savings']) {
			const input = screen.getByLabelText(label)
			expect(input).toHaveAttribute('type', 'text')
			expect(input).toHaveAttribute('inputmode', 'decimal')
			expect(input).not.toHaveAttribute('min')
			fireEvent.change(input, { target: { value: '12a3' } })
			expect(input).toHaveValue('123')
		}
	})

	it('filters the investment/debt row money fields: decimal text inputs that drop a letter', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		for (const label of ['Balance for Investments', 'Contribution for Investments']) {
			const input = screen.getByLabelText(label)
			expect(input).toHaveAttribute('type', 'text')
			expect(input).toHaveAttribute('inputmode', 'decimal')
			expect(input).not.toHaveAttribute('min')
			fireEvent.change(input, { target: { value: '12a3' } })
			expect(input).toHaveValue('123')
		}
	})

	it('persists what the investment row displays, so display and stored cents agree', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)

		const field = screen.getByLabelText('Balance for Investments')
		fireEvent.change(field, { target: { value: '12345.67' } })
		expect(field).toHaveValue('12345.67')
		const saveButton = await screen.findByRole(
			'button',
			{ name: /save forecast/i },
			{ timeout: 2000 }
		)
		fireEvent.click(saveButton)

		await waitFor(() => expect(onSave).toHaveBeenCalled())
		expect(onSave.mock.calls[0][0].inputs.investments).toBe(1234567)
	})

	it('leaves the non-money Scenario Name field accepting letters', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		const nameInput = screen.getByPlaceholderText('My Financial Forecast')
		fireEvent.change(nameInput, { target: { value: 'Early Retirement Plan' } })

		expect(nameInput).toHaveValue('Early Retirement Plan')
	})
})

describe('One-time events can be an outflow', () => {
	function addAnEvent(): void {
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
	}

	function eventRow(): HTMLElement {
		const direction = screen.getByLabelText(/direction/i)
		const row = direction.closest('div.surface')
		if (!row) throw new Error('one-time-event row not found')
		return row as HTMLElement
	}

	const eventAmount = (): HTMLElement => within(eventRow()).getByLabelText(/amount/i)
	const eventDirection = (): HTMLElement => within(eventRow()).getByLabelText(/direction/i)
	const eventName = (): HTMLElement => within(eventRow()).getByLabelText(/event name/i)

	it('sends a NEGATIVE amount once the direction is set to money out', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventAmount(), { target: { value: '5000' } })
		fireEvent.change(eventDirection(), { target: { value: 'out' } })

		expect(eventAmount()).toHaveValue('5000')

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		const { scenario } = onSave.mock.calls[0][0]
		expect(scenario.oneTimeEvents[0].amount).toBe(-500000)
	})

	it('keeps a POSITIVE amount when the direction is money in', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventAmount(), { target: { value: '5000' } })

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(500000)
	})

	it('flipping direction AFTER typing re-signs the existing amount', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventAmount(), { target: { value: '250' } })
		fireEvent.change(eventDirection(), { target: { value: 'out' } })
		fireEvent.change(eventDirection(), { target: { value: 'in' } })
		fireEvent.change(eventDirection(), { target: { value: 'out' } })

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-25000)
	})

	it('flipping BACK to money in re-signs positive (the out -> in path)', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventAmount(), { target: { value: '250' } })
		fireEvent.change(eventDirection(), { target: { value: 'out' } })
		fireEvent.change(eventDirection(), { target: { value: 'in' } })

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(25000)
	})

	it('the persisted event keeps its exact shape — no direction field leaks', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventName(), { target: { value: 'Deposit' } })
		fireEvent.change(eventAmount(), { target: { value: '400' } })
		fireEvent.change(eventDirection(), { target: { value: 'out' } })

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		// toStrictEqual: toEqual ignores undefined keys, so a leaked `direction: undefined` would pass.
		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0]).toStrictEqual({
			year: 1,
			amount: -40000,
			name: 'Deposit',
		})
	})

	it('a direction chosen BEFORE typing still applies (the amount-0 trap)', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		// At amount 0 the sign carries no direction, so it must be remembered separately.
		fireEvent.change(eventDirection(), { target: { value: 'out' } })
		fireEvent.change(eventAmount(), { target: { value: '750' } })

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())

		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-75000)
	})

	it('a saved NEGATIVE event reloads as money out, showing its magnitude', () => {
		const deposit = [{ year: 2, amount: -4000000, name: 'Deposit' }]
		const withCost = {
			id: 'saved-cost',
			name: 'House deposit',
			scenario: {
				name: 'House deposit',
				incomeGrowthRate: 0,
				expenseGrowthRate: 0,
				oneTimeEvents: deposit,
			},
			result: {
				scenario: { name: 'House deposit', incomeGrowthRate: 0, expenseGrowthRate: 0 },
				baseline: [],
				projection: [],
				summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
			},
			inputs: { savings: 0, investments: 0, years: 10 },
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z',
		} satisfies SavedForecast

		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={withCost} />)

		expect(screen.getByLabelText(/direction/i)).toHaveValue('out')
		expect(eventAmount()).toHaveValue('40,000.00')
	})

	it('forecast-2: a typed minus SELECTS money out instead of erasing the entry', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		addAnEvent()

		fireEvent.change(eventAmount(), { target: { value: '-500' } })

		expect(eventAmount()).toHaveValue('500')
		expect(eventDirection()).toHaveValue('out')
		fireEvent.blur(eventAmount())
		expect(eventAmount()).toHaveValue('500.00')

		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 2000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())
		expect(onSave.mock.calls[0][0].scenario.oneTimeEvents[0].amount).toBe(-50000)
	})

	it('forecast-2: a typed minus does NOT flip an already-outgoing row back to money in', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)
		addAnEvent()

		fireEvent.change(eventDirection(), { target: { value: 'out' } })
		fireEvent.change(eventAmount(), { target: { value: '-500' } })

		expect(eventDirection()).toHaveValue('out')
		expect(eventAmount()).toHaveValue('500')
	})

	it('forecast-2: every financial-item control is labelled for assistive tech', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getAllByLabelText(/^amount$/i)).toHaveLength(4)

		expect(screen.getAllByLabelText(/^name$/i).length).toBeGreaterThanOrEqual(4)
		expect(screen.getAllByLabelText(/^frequency$/i).length).toBeGreaterThanOrEqual(4)
	})

	it('income and expense amounts never take a negative (refused on the field since 81.1)', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		const incomeSection = screen
			.getByRole('heading', { name: 'Income Sources' })
			.closest('section') as HTMLElement
		const salaryAmount = within(incomeSection).getByDisplayValue('5,000.00')
		fireEvent.change(salaryAmount, { target: { value: '-500' } })
		expect(salaryAmount).toHaveValue('-500')
		expect(salaryAmount).toHaveAttribute('aria-invalid', 'true')
		expect(screen.getByText('Enter an amount of 0 or more.')).toBeInTheDocument()

		fireEvent.change(salaryAmount, { target: { value: '6000' } })
		expect(salaryAmount).toHaveValue('6000')
		expect(salaryAmount).not.toHaveAttribute('aria-invalid')
	})

	it('the one-time-event row does NOT give income rows a direction control', () => {
		const { container } = render(<ScenarioBuilder onSave={vi.fn()} />)
		addAnEvent()

		// Counted as raw <select> elements so the check does not depend on labelling.
		const selects = [...container.querySelectorAll('select')]
		const isDirection = (s: HTMLSelectElement) =>
			[...s.options].some((o) => /money out/i.test(o.textContent ?? ''))
		const isFrequency = (s: HTMLSelectElement) =>
			[...s.options].some((o) => /monthly/i.test(o.textContent ?? ''))

		const isBalanceType = (s: HTMLSelectElement) =>
			[...s.options].some((o) => o.textContent === 'Debt')

		expect(selects.filter(isDirection)).toHaveLength(1)
		expect(selects.filter(isFrequency).length).toBeGreaterThan(0)
		expect(selects.filter(isBalanceType).length).toBeGreaterThan(0)
		expect(
			selects.every(
				(s) => [isDirection(s), isFrequency(s), isBalanceType(s)].filter(Boolean).length === 1
			)
		).toBe(true)
	})
})
