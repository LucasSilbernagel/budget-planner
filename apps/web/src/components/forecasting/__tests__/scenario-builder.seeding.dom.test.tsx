// zustand passes getInitialState as the server snapshot, so selectors read empty during hydration and a lazy
// useState seed never recovers. Only renderToString + hydrateRoot can tell the two apart: RTL has no hydration pass.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetStoresHydratedForTests } from '../../../hooks/useStoresHydrated'
import type { SavedForecast } from '../../../routes/forecasting'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ScenarioBuilder } from '../scenario-builder'

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
	useCurrencyMode: () => 'none',
	useCurrencyCode: () => 'NONE',
}))

const NOW = '2026-09-22T00:00:00.000Z'
const PROFILE_A = 'profile-a'
const PROFILE_B = 'profile-b'

function incomeRow(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'inc-1',
		profileId: PROFILE_A,
		userId: 0,
		name: 'Consulting',
		amount: 720_000,
		frequency: 'monthly' as const,
		categoryId: null,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	}
}

function expenseRow(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'exp-1',
		profileId: PROFILE_A,
		userId: 0,
		name: 'Mortgage',
		amount: 210_000,
		frequency: 'monthly' as const,
		categoryId: null,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	}
}

function savingsGoal(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'goal-1',
		profileId: PROFILE_A,
		name: 'Emergency fund',
		targetAmount: 1_000_000,
		currentBalance: 345_600,
		allocationMode: 'manual' as const,
		monthlyAllocation: null,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	}
}

function investmentEntry(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'entry-1',
		profileId: PROFILE_A,
		type: 'investment' as const,
		name: 'Index fund',
		currentBalance: 987_600,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	}
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
}

function fillStores(): void {
	useIncomeStore.setState({ incomeSources: [incomeRow()] })
	useExpenseStore.setState({ expenses: [expenseRow()] })
	useSavingsStore.setState({ savingsGoals: [savingsGoal()] })
	useBalanceStore.setState({ entries: [investmentEntry()] })
}

beforeEach(() => {
	clearStores()
	useProfileStore.setState({ activeProfileId: PROFILE_A })
	// Required: an earlier render() in this module sets the gate's flag, so the hydration case would start resolved.
	__resetStoresHydratedForTests()
})

afterEach(() => {
	clearStores()
	vi.clearAllMocks()
})

describe('a fresh scenario seeds from the user own finances (62.1)', () => {
	it('seeds the savings rows and investments from the user own data, not from demo constants', () => {
		fillStores()
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('Emergency fund')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('3,456.00')
		expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('9,876.00')
		expect(screen.queryByDisplayValue('5000')).toBeNull()
		expect(screen.queryByDisplayValue('10000')).toBeNull()
	})

	it('seeds income and expense rows with their real name, amount and frequency', () => {
		fillStores()
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('Consulting')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Mortgage')).toBeInTheDocument()
		expect(screen.getByDisplayValue('7,200.00')).toBeInTheDocument()
		expect(screen.getByDisplayValue('2,100.00')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('Salary')).toBeNull()
		expect(screen.queryByDisplayValue('Rent/Mortgage')).toBeNull()
		expect(screen.queryByDisplayValue('Groceries')).toBeNull()
	})

	it('carries a non-monthly frequency through rather than flattening it', () => {
		useIncomeStore.setState({
			incomeSources: [incomeRow({ name: 'Freelance', amount: 50_000, frequency: 'weekly' })],
		})
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('500.00')).toBeInTheDocument()
		const frequency = screen.getAllByRole('combobox').find((el) => el.closest('div'))
		expect(frequency).toBeDefined()
		expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('weekly')
	})

	it('falls back to monthly for a frequency the engine does not know', () => {
		useIncomeStore.setState({
			incomeSources: [incomeRow({ name: 'Odd', amount: 50_000, frequency: 'quarterly' as never })],
		})
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('Odd')).toBeInTheDocument()
		expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('monthly')
	})

	it('seeds 0 rather than NaN when a stored balance is not finite', () => {
		useSavingsStore.setState({
			savingsGoals: [savingsGoal({ currentBalance: Number.NaN as number })],
		})
		useBalanceStore.setState({
			entries: [investmentEntry({ currentBalance: undefined as unknown as number })],
		})
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('My Financial Forecast')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Emergency fund')).toHaveValue('0.00')
		expect(screen.getByLabelText('Balance for Index fund')).toHaveValue('0.00')
		expect(screen.queryByDisplayValue('NaN')).toBeNull()
	})

	it('defaults both growth rates to zero', () => {
		fillStores()
		render(<ScenarioBuilder onSave={vi.fn()} />)

		const income = screen.getByLabelText('Income Growth Rate')
		const expense = screen.getByLabelText('Expense Growth Rate')

		expect((income as HTMLInputElement).value).toBe('0.00%')
		expect((expense as HTMLInputElement).value).toBe('0.00%')
	})

	it('hands a zero growth rate to onSave, not the retired 3%/2%', async () => {
		const onSave = vi.fn().mockResolvedValue({ success: true })
		fillStores()
		render(<ScenarioBuilder onSave={onSave} />)

		const saveButton = await screen.findByRole(
			'button',
			{ name: /save forecast/i },
			{ timeout: 2000 }
		)
		saveButton.click()

		await vi.waitFor(() => expect(onSave).toHaveBeenCalled())
		const saved = onSave.mock.calls[0][0]
		expect(saved.scenario.incomeGrowthRate).toBe(0)
		expect(saved.scenario.expenseGrowthRate).toBe(0)
	})
})

describe('a seeded scenario counts each source exactly once', () => {
	it('reports the hand-computed year-1 figures', async () => {
		fillStores()
		const onResultChange = vi.fn()
		render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResultChange} />)

		await vi.waitFor(
			() =>
				expect(onResultChange).toHaveBeenCalledWith(
					expect.objectContaining({ baseline: expect.any(Array) })
				),
			{ timeout: 2000 }
		)
		const result = onResultChange.mock.calls.at(-1)?.[0]
		const yearOne = result.baseline[0]

		expect(yearOne.income, 'one $7,200/mo source ⇒ 720000 × 12; a double count ⇒ 17280000').toBe(
			8_640_000
		)
		expect(yearOne.expenses, 'one $2,100/mo expense ⇒ 210000 × 12').toBe(2_520_000)
		expect(yearOne.netIncome, '(720000 − 210000) × 12').toBe(6_120_000)
	})

	it('doubles when a second identical source is seeded, rather than quadrupling', async () => {
		useIncomeStore.setState({
			incomeSources: [
				incomeRow({ id: 'inc-1', name: 'Consulting A' }),
				incomeRow({ id: 'inc-2', name: 'Consulting B' }),
			],
		})
		const onResultChange = vi.fn()
		render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResultChange} />)

		await vi.waitFor(() => expect(onResultChange).toHaveBeenCalled(), { timeout: 2000 })
		const result = onResultChange.mock.calls.at(-1)?.[0]

		expect(result.baseline[0].income, 'two $7,200/mo sources ⇒ 1440000 × 12').toBe(17_280_000)
	})
})

describe('the seed happens once and never overwrites the user', () => {
	it('does not re-seed over an edit when the stores change afterwards', async () => {
		fillStores()
		render(<ScenarioBuilder onSave={vi.fn()} />)

		const nameInput = screen.getByDisplayValue('Consulting')
		fireEvent.change(nameInput, { target: { value: 'My own edit' } })
		expect(screen.getByDisplayValue('My own edit')).toBeInTheDocument()

		await act(async () => {
			useIncomeStore.setState({
				incomeSources: [incomeRow({ id: 'inc-late', name: 'Arrived Later' })],
			})
		})

		expect(screen.getByDisplayValue('My own edit')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('Arrived Later')).toBeNull()
	})
})

describe('the seed respects the active profile', () => {
	it('seeds only the active profile rows and totals', () => {
		useIncomeStore.setState({
			incomeSources: [
				incomeRow({ id: 'inc-a', name: 'A Salary', profileId: PROFILE_A }),
				incomeRow({ id: 'inc-b', name: 'B Salary', profileId: PROFILE_B }),
			],
		})
		useSavingsStore.setState({
			savingsGoals: [
				savingsGoal({ id: 'g-a', currentBalance: 100_000, profileId: PROFILE_A }),
				savingsGoal({ id: 'g-b', currentBalance: 900_000, profileId: PROFILE_B }),
			],
		})
		useBalanceStore.setState({
			entries: [
				investmentEntry({ id: 'e-a', name: 'A fund', currentBalance: 200_000 }),
				investmentEntry({
					id: 'e-b',
					name: 'B fund',
					currentBalance: 800_000,
					profileId: PROFILE_B,
				}),
				investmentEntry({
					id: 'e-b2',
					name: 'B loan',
					type: 'debt',
					currentBalance: 700_000,
					profileId: PROFILE_B,
				}),
			] as never,
		})

		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('A Salary')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('B Salary')).toBeNull()
		const savingsSection = screen.getByRole('region', { name: 'Savings Accounts' })
		const balances = within(savingsSection).getAllByLabelText(/^Balance for /)
		expect(balances).toHaveLength(1)
		expect(balances[0]).toHaveValue('1,000.00')
		const balanceSection = screen.getByRole('region', { name: 'Investments & Debts' })
		const names = within(balanceSection)
			.getAllByLabelText(/^Balance Name, row \d+$/)
			.map((input) => (input as HTMLInputElement).value)
		expect(names).toEqual(['A fund'])
		expect(screen.getByLabelText('Balance for A fund')).toHaveValue('2,000.00')
	})

	it('seeds from whichever profile is active at mount', () => {
		useIncomeStore.setState({
			incomeSources: [
				incomeRow({ id: 'inc-a', name: 'A Salary', profileId: PROFILE_A }),
				incomeRow({ id: 'inc-b', name: 'B Salary', profileId: PROFILE_B }),
			],
		})
		useProfileStore.setState({ activeProfileId: PROFILE_B })

		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('B Salary')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('A Salary')).toBeNull()
	})
})

describe('a user with nothing recorded gets an empty builder', () => {
	it('renders empty income and expense lists, never the demo rows', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByDisplayValue('My Financial Forecast')).toBeInTheDocument()

		expect(screen.queryByDisplayValue('Salary')).toBeNull()
		expect(screen.queryByDisplayValue('Rent/Mortgage')).toBeNull()
		expect(screen.queryByDisplayValue('Utilities')).toBeNull()
		expect(screen.queryByDisplayValue('Groceries')).toBeNull()
		expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
		expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('5000')).toBeNull()
		expect(screen.queryByDisplayValue('10000')).toBeNull()
	})

	it('still offers the add-row affordances', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)

		expect(screen.getByRole('button', { name: /add income/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /add expense/i })).toBeInTheDocument()
	})
})

describe('a loaded forecast still seeds from the saved scenario', () => {
	const savedIncome = [{ name: 'Saved Income', amount: 111_100, frequency: 'monthly' as const }]
	const savedExpenses = [{ name: 'Saved Expense', amount: 222_200, frequency: 'monthly' as const }]
	const savedForecast = {
		id: 'saved-1',
		name: 'March Plan',
		description: 'Saved months ago',
		scenario: {
			name: 'March Plan',
			description: 'Saved months ago',
			incomeGrowthRate: 0.05,
			expenseGrowthRate: 0.03,
			newIncome: savedIncome,
			newExpenses: savedExpenses,
			oneTimeEvents: [],
		},
		result: {
			scenario: { name: 'March Plan', incomeGrowthRate: 0.05, expenseGrowthRate: 0.03 },
			baseline: [],
			projection: [],
			summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
		},
		inputs: { savings: 333_300, investments: 444_400, years: 15 },
		createdAt: '2026-03-01T00:00:00Z',
		updatedAt: '2026-03-01T00:00:00Z',
	} satisfies SavedForecast

	it('does NOT re-baseline to the live stores', () => {
		fillStores()

		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedForecast} />)

		expect(screen.getByDisplayValue('Saved Income')).toBeInTheDocument()
		expect(screen.getByDisplayValue('Saved Expense')).toBeInTheDocument()
		expect(screen.getByLabelText('Balance for Savings')).toHaveValue('3,333.00')
		expect(screen.getByLabelText('Balance for Investments')).toHaveValue('4,444.00')
		expect(screen.getByLabelText('Income Growth Rate').getAttribute('value')).toBe('5.00%')

		expect(screen.queryByDisplayValue('Consulting')).toBeNull()
		expect(screen.queryByDisplayValue('Mortgage')).toBeNull()
		expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
		expect(screen.queryByDisplayValue('Index fund')).toBeNull()
	})

	it('falls back to zero, not to the live stores, for an older row with no saved inputs', () => {
		fillStores()
		const olderRow = { ...savedForecast, inputs: undefined } satisfies SavedForecast

		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={olderRow} />)

		expect(screen.getByDisplayValue('March Plan')).toBeInTheDocument()
		expect(screen.getByText('No savings accounts in this scenario')).toBeInTheDocument()
		expect(screen.getByText('No investments or debts in this scenario')).toBeInTheDocument()
		expect(screen.getByDisplayValue('10')).toBeInTheDocument()
		expect(screen.queryByDisplayValue('Emergency fund')).toBeNull()
		expect(screen.queryByDisplayValue('Index fund')).toBeNull()
	})
})

async function hydrateAfterStoresFill(element: React.ReactElement) {
	const container = document.createElement('div')
	container.innerHTML = renderToString(element)
	document.body.appendChild(container)
	const serverHtml = container.innerHTML

	fillStores()

	const recoverable: string[] = []
	let root: ReturnType<typeof hydrateRoot> | undefined
	await act(async () => {
		root = hydrateRoot(container, element, {
			onRecoverableError: (error) => recoverable.push(String(error)),
		})
	})

	const clientHtml = container.innerHTML

	await act(async () => {
		root?.unmount()
	})
	container.remove()
	return { recoverable, serverHtml, clientHtml }
}

describe('the seed survives the rehydration race', () => {
	it('fills from the stores even though the hydration pass saw them empty', async () => {
		const { serverHtml, clientHtml } = await hydrateAfterStoresFill(
			<ScenarioBuilder onSave={vi.fn()} />
		)

		expect(serverHtml).not.toContain('Consulting')
		expect(
			clientHtml,
			'builder seeded empty and never recovered — the lazy-initializer failure mode'
		).toContain('Consulting')
		expect(clientHtml).toContain('Emergency fund')
		expect(clientHtml).toContain('Index fund')
	})

	it('raises no recoverable hydration error', async () => {
		const { recoverable, serverHtml, clientHtml } = await hydrateAfterStoresFill(
			<ScenarioBuilder onSave={vi.fn()} />
		)

		expect(
			recoverable,
			`server html length ${serverHtml.length}, client html length ${clientHtml.length}`
		).toEqual([])
	})

	// Designed-red control: React 19 reports no error for a mismatch directly under the hydration root,
	// so this proves the harness hears a nested one.
	it('CONTROL: the same harness reports a nested mismatch when one exists', async () => {
		function MismatchProbe() {
			return (
				<section>
					<div>
						<span>{useIncomeStore.getState().incomeSources.length} rows</span>
					</div>
					<ScenarioBuilder onSave={vi.fn()} />
				</section>
			)
		}
		const { recoverable } = await hydrateAfterStoresFill(<MismatchProbe />)
		expect(recoverable.length, 'the harness could not hear a designed mismatch').toBeGreaterThan(0)
	})
})
