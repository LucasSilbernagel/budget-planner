import type { ForecastingResult } from '@budget-planner/core'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNetWorth } from '../../../hooks/useNetWorth'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { ASSET_WHAT_IF_NOTE, NO_ASSET_ACCOUNTS, ScenarioBuilder } from '../scenario-builder'

const gate = vi.hoisted(() => ({ pending: false, calls: [] as boolean[] }))
vi.mock('../../../hooks/useIsInitialSyncPending', () => ({
	useIsInitialSyncPending: (isCollectionEmpty: boolean) => {
		gate.calls.push(isCollectionEmpty)
		return gate.pending
	},
}))

const ISO = '2026-10-06T00:00:00.000Z'
const PROFILE = 'profile-asset-rows'
const BALANCE_STORAGE_KEY = 'budget-planner:balance-tracking'

type EntryType = 'investment' | 'debt' | 'asset'

function entry(over: {
	id: string
	name: unknown
	type?: EntryType
	currentBalance?: number
	monthlyContribution?: number
	profileId?: string
	sortOrder?: number
}) {
	return {
		profileId: PROFILE,
		type: 'asset' as EntryType,
		currentBalance: 0,
		monthlyContribution: 0,
		frequency: 'monthly',
		sortOrder: 0,
		createdAt: ISO,
		updatedAt: ISO,
		...over,
	}
}

function setEntries(entries: ReturnType<typeof entry>[]): void {
	useBalanceStore.setState({ entries: entries as never })
}

function income(amount: number) {
	return {
		id: 'inc-1',
		profileId: PROFILE,
		userId: 0,
		name: 'Salary',
		amount,
		frequency: 'monthly' as const,
		categoryId: null,
		createdAt: ISO,
		updatedAt: ISO,
	}
}

function savingsGoal(currentBalance: number) {
	return {
		id: 'g-1',
		profileId: PROFILE,
		name: 'Emergency fund',
		targetAmount: null,
		currentBalance,
		allocationMode: 'manual' as const,
		monthlyAllocation: 0,
		sortOrder: 0,
		createdAt: ISO,
		updatedAt: ISO,
	}
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
}

const onResult = vi.fn()

beforeEach(() => {
	onResult.mockReset()
	clearStores()
	gate.pending = false
	gate.calls.length = 0
	useProfileStore.setState({ activeProfileId: PROFILE })
})

afterEach(() => {
	clearStores()
	vi.restoreAllMocks()
})

function formatter(): (cents: number) => string {
	return renderHook(() => useFormattedAmount()).result.current
}

function section(): HTMLElement {
	return screen.getByRole('region', { name: 'Assets' })
}

function assetNames(): string[] {
	return within(section())
		.queryAllByLabelText(/^Asset Name, row \d+$/)
		.map((input) => (input as HTMLInputElement).value)
}

function balanceNames(): string[] {
	return within(screen.getByRole('region', { name: 'Investments & Debts' }))
		.queryAllByLabelText(/^Balance Name, row \d+$/)
		.map((input) => (input as HTMLInputElement).value)
}

function card(label: string): string {
	return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? ''
}

function lastResult(): ForecastingResult {
	const result = onResult.mock.calls.at(-1)?.[0] as ForecastingResult | null | undefined
	if (!result) throw new Error('no result lifted yet')
	return result
}

async function waitForResult() {
	await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
}

describe('the Assets section', () => {
	it('sits between Investments & Debts and Income Sources, with its note and empty state', () => {
		render(<ScenarioBuilder onSave={vi.fn()} />)
		const headings = screen
			.getAllByRole('heading', { level: 3 })
			.map((heading) => heading.textContent)
		const at = (name: string) => headings.indexOf(name)
		expect(at('Assets')).toBe(at('Investments & Debts') + 1)
		expect(at('Income Sources')).toBe(at('Assets') + 1)
		expect(within(section()).getByText(ASSET_WHAT_IF_NOTE)).toBeInTheDocument()
		expect(within(section()).getByText(NO_ASSET_ACCOUNTS)).toBeInTheDocument()
	})

	it('pins the copy (Lucas may tweak)', () => {
		expect(ASSET_WHAT_IF_NOTE).toBe(
			"What-if only: changes here don't change your Balance Tracking page. An asset keeps the value you enter every year."
		)
		expect(NO_ASSET_ACCOUNTS).toBe('No assets in this scenario')
	})

	it('names every control after its row, turns autofill off and stacks at 320 px', () => {
		setEntries([
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'House', currentBalance: 1_000_000, sortOrder: 1 }),
		])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(screen.getByLabelText('Asset Name, row 1')).toHaveValue('House')
		expect(screen.getByLabelText('Asset Name, row 2')).toHaveValue('House')
		const values = within(section()).getAllByLabelText('Value for House')
		expect(values).toHaveLength(2)
		expect(values.map((input) => (input as HTMLInputElement).value)).toEqual([
			'300,000.00',
			'10,000.00',
		])
		for (const control of within(section()).getAllByRole('textbox')) {
			expect(control).toHaveAttribute('autocomplete', 'off')
		}
		expect(within(section()).getAllByRole('textbox')).toHaveLength(4)
		expect(within(section()).queryByLabelText(/Contribution/)).toBeNull()
		expect(within(section()).queryByLabelText(/Frequency/)).toBeNull()
		expect(within(section()).queryByLabelText(/Annual return/)).toBeNull()
		expect(within(section()).queryByRole('checkbox')).toBeNull()
		const grid = values[0]?.closest('.surface')?.querySelector('.grid') as HTMLElement
		expect(grid.className).toContain('grid-cols-1')
		expect(grid.className).toMatch(/\bmd:grid-cols-\d\b/)
	})
})

describe('the seed', () => {
	it('lists the active profile assets in store order, and only in the Assets section', () => {
		setEntries([
			entry({ id: 'e-1', name: 'Pension', type: 'investment', currentBalance: 1_000_000 }),
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'Other profile car', profileId: 'someone-else' }),
			entry({ id: 'e-2', name: 'Loan', type: 'debt', currentBalance: 400_000 }),
			entry({ id: 'a-3', name: 'Car', currentBalance: 1_234_567 }),
		])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(assetNames()).toEqual(['House', 'Car'])
		expect(balanceNames()).toEqual(['Pension', 'Loan'])
		expect(screen.getByLabelText('Value for House')).toHaveValue('300,000.00')
		expect(screen.getByLabelText('Value for Car')).toHaveValue('12,345.67')
	})

	it('seeds a negative or non-finite stored value as 0, and a non-string name as blank', () => {
		setEntries([
			entry({ id: 'a-1', name: 'Legacy', currentBalance: -500_000 }),
			entry({ id: 'a-2', name: 'Broken', currentBalance: Number.NaN }),
			entry({ id: 'a-3', name: 42 }),
		])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(assetNames()).toEqual(['Legacy', 'Broken', ''])
		expect(screen.getByLabelText('Value for Legacy')).toHaveValue('0.00')
		expect(screen.getByLabelText('Value for Legacy')).not.toHaveAttribute('aria-invalid')
		expect(screen.getByLabelText('Value for Broken')).toHaveValue('0.00')
		expect(screen.getByLabelText('Value for unnamed asset')).toHaveValue('0.00')
	})

	it('counts an asset-only user as something to seed', () => {
		setEntries([entry({ id: 'a-1', name: 'House', currentBalance: 100_000 })])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(gate.calls.length).toBeGreaterThan(0)
		expect(gate.calls.every((empty) => empty === false)).toBe(true)
		expect(assetNames()).toEqual(['House'])
		gate.calls.length = 0
		document.body.innerHTML = ''
		setEntries([])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(gate.calls.at(-1)).toBe(true)
	})

	it('keeps an asset row added before the seed, and does not add the store rows on top', () => {
		gate.pending = true
		setEntries([
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'e-1', name: 'Pension', type: 'investment', currentBalance: 100_000 }),
		])
		const onSave = vi.fn()
		const { rerender } = render(<ScenarioBuilder onSave={onSave} />)

		fireEvent.click(within(section()).getByRole('button', { name: '+ Add Asset' }))
		const field = screen.getByLabelText('Value for New Asset') as HTMLInputElement
		field.focus()
		fireEvent.change(field, { target: { value: '250' } })

		gate.pending = false
		rerender(<ScenarioBuilder onSave={onSave} />)

		expect(balanceNames()).toEqual(['Pension'])
		expect(screen.getByLabelText('Value for New Asset')).toBe(field)
		expect(document.activeElement).toBe(field)
		expect(field).toHaveValue('250')
		expect(assetNames()).toEqual(['New Asset'])
	})

	it('positive control for the race: untouched, the seed fills the assets', () => {
		gate.pending = true
		setEntries([entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 })])
		const { rerender } = render(<ScenarioBuilder onSave={vi.fn()} />)
		expect(assetNames()).toEqual([])
		gate.pending = false
		rerender(<ScenarioBuilder onSave={vi.fn()} />)
		expect(assetNames()).toEqual(['House'])
	})
})

describe('add, remove and the Value field', () => {
	it('adds a New Asset row at 0, names each remove button after its row, and can empty the list', () => {
		setEntries([entry({ id: 'a-1', name: 'House', currentBalance: 100_000 })])
		render(<ScenarioBuilder onSave={vi.fn()} />)

		fireEvent.click(within(section()).getByRole('button', { name: '+ Add Asset' }))
		expect(assetNames()).toEqual(['House', 'New Asset'])
		expect(screen.getByLabelText('Value for New Asset')).toHaveValue('0.00')

		fireEvent.change(screen.getByLabelText('Asset Name, row 2'), { target: { value: '  ' } })
		expect(screen.getByRole('button', { name: 'Remove asset' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Remove House' }))
		fireEvent.click(screen.getByRole('button', { name: 'Remove asset' }))
		expect(assetNames()).toEqual([])
		expect(within(section()).getByText(NO_ASSET_ACCOUNTS)).toBeInTheDocument()
	})

	it('a refused value holds Save under the field key, and removing the row withdraws it', async () => {
		useIncomeStore.setState({ incomeSources: [income(500_000)] })
		setEntries([entry({ id: 'a-1', name: 'House', currentBalance: 100_000 })])
		render(<ScenarioBuilder onSave={vi.fn()} />)
		await waitForResult()
		const save = () => screen.getByRole('button', { name: /save forecast/i })
		expect(save()).toBeEnabled()

		fireEvent.change(screen.getByLabelText('Value for House'), { target: { value: '1.2.3' } })
		expect(screen.getByLabelText('Value for House')).toHaveAttribute('aria-invalid', 'true')
		expect(save()).toBeDisabled()

		fireEvent.click(screen.getByRole('button', { name: 'Remove House' }))
		await waitFor(() => expect(save()).toBeEnabled())
	})
})

describe('what-if only: nothing reaches the balance store', () => {
	it('a full asset edit sequence calls no balance-store action and leaves the persisted bytes unchanged', async () => {
		useIncomeStore.setState({ incomeSources: [income(500_000)] })
		setEntries([
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'Car', currentBalance: 1_000_000 }),
		])
		const before = localStorage.getItem(BALANCE_STORAGE_KEY)
		const stateBefore = useBalanceStore.getState().entries
		expect(before).toContain('House')

		const state = useBalanceStore.getState() as unknown as Record<string, unknown>
		const actions = Object.keys(state)
			.filter((key) => typeof state[key] === 'function')
			.map((key) => vi.spyOn(state as Record<string, () => unknown>, key))
		expect(actions.length).toBeGreaterThan(3)
		const setState = vi.spyOn(useBalanceStore, 'setState')

		render(<ScenarioBuilder onSave={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Asset Name, row 1'), { target: { value: 'Flat' } })
		fireEvent.change(screen.getByLabelText('Value for Flat'), { target: { value: '9999' } })
		fireEvent.click(within(section()).getByRole('button', { name: '+ Add Asset' }))
		fireEvent.click(screen.getByRole('button', { name: 'Remove Car' }))
		await waitForResult()

		for (const spy of actions) expect(spy).not.toHaveBeenCalled()
		expect(setState).not.toHaveBeenCalled()
		expect(localStorage.getItem(BALANCE_STORAGE_KEY)).toBe(before)
		expect(useBalanceStore.getState().entries).toBe(stateBefore)
	})
})

describe('Starting Net Worth is the Overview’s', () => {
	function seedParityStores(debtBalance: number): void {
		useSavingsStore.setState({ savingsGoals: [savingsGoal(1_234_500)] as never })
		setEntries([
			entry({ id: 'e-1', name: 'Pension', type: 'investment', currentBalance: 5_000_001 }),
			entry({ id: 'e-2', name: 'Mortgage', type: 'debt', currentBalance: debtBalance }),
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'Car', currentBalance: 1_250_099 }),
		])
	}

	it('equals useNetWorth() for a savings goal, an investment, a debt and two assets', async () => {
		seedParityStores(20_000_000)
		render(<ScenarioBuilder onSave={vi.fn()} />)
		await waitForResult()
		const overview = renderHook(() => useNetWorth()).result.current
		expect(overview).toBe(1_234_500 + 5_000_001 + 30_000_000 + 1_250_099 - 20_000_000)
		expect(card('Starting Net Worth')).toBe(formatter()(overview))
	})

	it('still agrees with a LEGACY negative debt (debtOwedCents on both sides)', async () => {
		seedParityStores(-20_000_000)
		render(<ScenarioBuilder onSave={vi.fn()} />)
		await waitForResult()
		const overview = renderHook(() => useNetWorth()).result.current
		expect(card('Starting Net Worth')).toBe(formatter()(overview))
	})
})

describe('baseline and "vs. today" with assets', () => {
	function comparable(rows: ForecastingResult['baseline']) {
		return rows.map(
			({
				year,
				income: rowIncome,
				expenses,
				netIncome,
				savings,
				investments,
				netWorth,
				debts,
				balanceAccounts,
				assets,
			}) => ({
				year,
				income: rowIncome,
				expenses,
				netIncome,
				savings,
				investments,
				netWorth,
				debts,
				balanceAccounts,
				assets,
			})
		)
	}

	function seed(): void {
		useIncomeStore.setState({ incomeSources: [income(500_000)] })
		useSavingsStore.setState({ savingsGoals: [savingsGoal(100_000)] as never })
		setEntries([
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'Car', currentBalance: 1_000_000, sortOrder: 1 }),
		])
	}

	it('an unedited scenario with assets coincides with the baseline', async () => {
		seed()
		render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
		await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
		const result = lastResult()
		expect(comparable(result.baseline)).toEqual(comparable(result.projection))
		expect(result.baseline.at(-1)?.assets).toBe(31_000_000)
		expect(result.summary.startingNetWorth).toBe(100_000 + 31_000_000)
		expect(card('vs. today')).toBe(`+${formatter()(0)}`)
	})

	it('raising one asset by X moves every projection year by exactly X, and only the projection', async () => {
		seed()
		render(<ScenarioBuilder onSave={vi.fn()} onResultChange={onResult} />)
		await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
		const before = lastResult()
		onResult.mockClear()

		fireEvent.change(screen.getByLabelText('Value for House'), { target: { value: '300500' } })
		await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 3000 })
		const after = lastResult()

		expect(after.baseline).toEqual(before.baseline)
		after.projection.forEach((row, i) => {
			expect(row.netWorth - (before.projection[i]?.netWorth ?? 0)).toBe(50_000)
		})
		expect(card('vs. today')).toBe(`+${formatter()(50_000)}`)
	})
})

describe('save', () => {
	it('writes the asset rows as name and value, and [] when there are none', async () => {
		useIncomeStore.setState({ incomeSources: [income(500_000)] })
		setEntries([
			entry({ id: 'a-1', name: 'House', currentBalance: 30_000_000 }),
			entry({ id: 'a-2', name: 'Car', currentBalance: 1_250_099, sortOrder: 1 }),
		])
		const onSave = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSave} />)
		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
		)
		await waitFor(() => expect(onSave).toHaveBeenCalled())
		expect(onSave.mock.calls[0]?.[0].inputs.assetAccounts).toEqual([
			{ name: 'House', balance: 30_000_000 },
			{ name: 'Car', balance: 1_250_099 },
		])

		document.body.innerHTML = ''
		setEntries([])
		const onSaveEmpty = vi.fn().mockResolvedValue({ success: true })
		render(<ScenarioBuilder onSave={onSaveEmpty} />)
		fireEvent.click(
			await screen.findByRole('button', { name: /save forecast/i }, { timeout: 3000 })
		)
		await waitFor(() => expect(onSaveEmpty).toHaveBeenCalled())
		expect(onSaveEmpty.mock.calls[0]?.[0].inputs.assetAccounts).toEqual([])
	})
})

describe('reload, the builder’s own coercion', () => {
	const forecast = (inputs: unknown) =>
		({
			id: 'saved-1',
			name: 'Plan',
			scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
			result: {
				scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
				baseline: [],
				projection: [],
				summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
			},
			inputs,
			version: 6,
			createdAt: ISO,
			updatedAt: ISO,
		}) as never

	function renderLoaded(inputs: unknown): void {
		document.body.innerHTML = ''
		render(
			<ScenarioBuilder
				onSave={vi.fn()}
				initialForecast={
					forecast(inputs) as React.ComponentProps<typeof ScenarioBuilder>['initialForecast']
				}
			/>
		)
	}

	it('reloads saved rows, never the live store', () => {
		setEntries([entry({ id: 'a-1', name: 'Live house', currentBalance: 1 })])
		renderLoaded({
			savings: 0,
			investments: 0,
			years: 10,
			assetAccounts: [
				{ name: 'House', balance: 30_000_000 },
				{ name: 'Boat', balance: 5 },
			],
		})
		expect(assetNames()).toEqual(['House', 'Boat'])
		expect(screen.getByLabelText('Value for Boat')).toHaveValue('0.05')
	})

	it('a forecast without assetAccounts (version 5) reloads with no asset rows', () => {
		setEntries([entry({ id: 'a-1', name: 'Live house', currentBalance: 1 })])
		renderLoaded({ savings: 0, investments: 0, years: 10 })
		expect(assetNames()).toEqual([])
		expect(within(section()).getByText(NO_ASSET_ACCOUNTS)).toBeInTheDocument()
	})

	it('coerces bad entries itself: non-array → none; null, a bad name or value → blank and 0', () => {
		renderLoaded({ savings: 0, investments: 0, years: 10, assetAccounts: 'oops' })
		expect(assetNames()).toEqual([])

		renderLoaded({
			savings: 0,
			investments: 0,
			years: 10,
			assetAccounts: [
				null,
				{ name: 7, balance: -1 },
				{ name: 'Inf', balance: Number.POSITIVE_INFINITY },
				{ name: 'Ok', balance: 1_000 },
			],
		})
		expect(assetNames()).toEqual(['', '', 'Inf', 'Ok'])
		expect(within(section()).getAllByLabelText('Value for unnamed asset')).toHaveLength(2)
		expect(screen.getByLabelText('Value for Inf')).toHaveValue('0.00')
		expect(screen.getByLabelText('Value for Ok')).toHaveValue('10.00')
	})
})
