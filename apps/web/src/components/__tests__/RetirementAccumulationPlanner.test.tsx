import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import type { FinanceType, Frequency } from '@budget-planner/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useRetirementPlannerStore } from '../../stores/retirementPlannerStore'
import {
	describeSolverError,
	RetirementAccumulationPlanner,
} from '../RetirementAccumulationPlanner'

function resetStores() {
	useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	useBalanceStore.setState({ entries: [] })
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
}

const ISO = '2026-08-06T00:00:00.000Z'

const incomeRow = (amount: number, frequency: Frequency = 'monthly', id = 'inc-1') => ({
	id,
	userId: 0,
	categoryId: null,
	name: 'Salary',
	amount,
	frequency,
	createdAt: ISO,
	updatedAt: ISO,
})

const expenseRow = (amount: number, frequency: Frequency = 'monthly', id = 'exp-1') => ({
	id,
	userId: 0,
	categoryId: null,
	name: 'Rent',
	amount,
	frequency,
	createdAt: ISO,
	updatedAt: ISO,
})

const investmentRow = (
	currentBalance: number,
	id = 'inv-1',
	contribution: { amount?: number; frequency?: 'weekly' | 'biweekly' | 'monthly' | 'annually' } = {}
) => ({
	id,
	type: 'investment' as const,
	name: 'RRSP',
	currentBalance,
	monthlyContribution: contribution.amount ?? 0,
	frequency: contribution.frequency ?? ('monthly' as const),
	createdAt: ISO,
	updatedAt: ISO,
})

const debtRow = (currentBalance: number, id = 'debt-1') => ({
	...investmentRow(currentBalance, id),
	type: 'debt' as const,
	name: 'Card',
})

function seedReachableStores() {
	useBalanceStore.setState({
		entries: [investmentRow(1_000_000_00, 'inv-1', { amount: 150_000 })],
	})
	useIncomeStore.setState({ incomeSources: [incomeRow(200_000)] })
	useExpenseStore.setState({ expenses: [expenseRow(50_000)] })
}

// toHaveTextContent with a string is a substring match: '-2,000.00' contains '0.00'.
function derivedValueOf(testId: string): string {
	return screen.getByTestId(testId).querySelector('dd > span')?.textContent ?? ''
}

// Keeps the sign: stripping /[^\d.]/g would turn -48,000.00 into 48000.
function toMoney(text: string | null | undefined): number {
	return Number((text ?? '').replace(/[^\d.-]/g, ''))
}

async function fillReachableCase(user: ReturnType<typeof userEvent.setup>) {
	act(seedReachableStores)
	await user.clear(screen.getByLabelText('Current Age'))
	await user.type(screen.getByLabelText('Current Age'), '40')
	await user.clear(screen.getByLabelText('Life Expectancy'))
	await user.type(screen.getByLabelText('Life Expectancy'), '85')
	await user.clear(screen.getByLabelText('Expected Annual Return'))
	await user.type(screen.getByLabelText('Expected Annual Return'), '5')
}

describe('RetirementAccumulationPlanner', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('prompts for input before all fields are provided', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)
		expect(
			screen.getByText('Enter all the details above to see your retirement outlook.')
		).toBeInTheDocument()
		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
	})

	it('renders the full output set for a reachable solve', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		expect(outputs.getByText('Saved per year').nextElementSibling).toHaveTextContent('18,000.00')
		expect(outputs.getByText('Total saved').nextElementSibling).toHaveTextContent('1,000,000.00')
		expect(outputs.getByText('Months to retirement').nextElementSibling).toHaveTextContent('0')
		expect(outputs.getByText('Years to retirement').nextElementSibling).toHaveTextContent('0.0')
		expect(outputs.getByText('Earliest retirement age').nextElementSibling).toHaveTextContent('40')
		expect(outputs.getByText('Nest egg at retirement').nextElementSibling).toHaveTextContent(
			'1,000,000.00'
		)
		expect(outputs.getByText('Required nest egg').nextElementSibling).toHaveTextContent(
			'540,000.00'
		)
	})

	it('every outlook value can break only after a group separator, with its text unchanged', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const values = [...screen.getByTestId('accumulation-outputs').querySelectorAll('dl dd')]
		expect(values.map((dd) => dd.textContent)).toEqual([
			'18,000.00',
			'1,000,000.00',
			'0',
			'0.0',
			'40',
			'1,000,000.00',
			'540,000.00',
			'Already covered',
		])
		for (const dd of values) {
			const text = dd.textContent ?? ''
			const separators = text.match(/\d,(?=\d)/g)?.length ?? 0
			const breaks = [...dd.querySelectorAll('wbr')]
			expect(breaks, text).toHaveLength(separators)
			for (const wbr of breaks) {
				expect(wbr.previousSibling?.textContent, text).toMatch(/\d,$/)
				expect(wbr.nextSibling?.textContent, text).toMatch(/^\d/)
			}
		}
	})

	it('every outlook row lets the label shrink first and right-aligns the value', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const rows = [...screen.getByTestId('accumulation-outputs').querySelectorAll('dl dd')].map(
			(dd) => dd.parentElement as HTMLElement
		)
		expect(rows).toHaveLength(8)
		for (const row of rows) {
			const dt = row.querySelector('dt') as HTMLElement
			const dd = row.querySelector('dd') as HTMLElement
			expect(row.className.split(/\s+/)).toEqual(
				expect.arrayContaining(['flex', 'justify-between'])
			)
			expect(dt.className.split(/\s+/), dt.textContent ?? '').toContain('shrink-[1000]')
			expect(dd.className.split(/\s+/), dt.textContent ?? '').toContain('text-right')
		}
	})

	it('in EUR only the money values get break opportunities, after the "." group separator', async () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		const dd = (label: string) => outputs.getByText(label).nextElementSibling as HTMLElement
		for (const label of [
			'Months to retirement',
			'Years to retirement',
			'Earliest retirement age',
		]) {
			expect(dd(label).querySelectorAll('wbr'), label).toHaveLength(0)
		}
		expect(dd('Years to retirement').textContent).toBe('0.0')
		const total = dd('Total saved')
		expect(total.textContent).toMatch(/^1\.000\.000,00\s€$/)
		const breaks = [...total.querySelectorAll('wbr')]
		expect(breaks).toHaveLength(2)
		for (const wbr of breaks) {
			expect(wbr.previousSibling?.textContent).toMatch(/\d\.$/)
		}
	})

	it('recomputes the required nest egg when the model toggles', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const requiredRow = () =>
			within(screen.getByTestId('accumulation-outputs')).getByText('Required nest egg')
				.nextElementSibling

		expect(requiredRow()).toHaveTextContent('540,000.00')

		await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))
		expect(requiredRow()).toHaveTextContent('240,000.00')
	})

	it('shows the calm not-reachable state with levers, no error', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(() => {
			useBalanceStore.setState({
				entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
			})
			useIncomeStore.setState({ incomeSources: [incomeRow(5_000)] })
		})
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '60')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '65')
		const desired = screen.getByLabelText('Desired Retirement Income')
		await user.clear(desired)
		await user.type(desired, '5000000')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '4')

		const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
		expect(
			notReachable.getByText(/Retirement isn.t reachable with these numbers/)
		).toBeInTheDocument()
		expect(
			notReachable.getByText('Put more into your investment accounts on the Balance Tracking page')
		).toBeInTheDocument()
		expect(notReachable.queryByText(/Raise your income or cut expenses/)).not.toBeInTheDocument()
		expect(notReachable.queryByText(/We don.t have your savings data yet/)).not.toBeInTheDocument()
		expect(notReachable.getByText('Retire on a lower annual income')).toBeInTheDocument()

		expect(notReachable.getByText('Assume a higher return after you retire')).toBeInTheDocument()
		expect(notReachable.queryByText(/higher return while saving/)).not.toBeInTheDocument()
		expect(notReachable.queryByText(/higher annual return/)).not.toBeInTheDocument()
		expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
	})

	it('shows a targeted message (not the generic levers) when age is past life expectancy', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(() => {
			useBalanceStore.setState({
				entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
			})
			useIncomeStore.setState({ incomeSources: [incomeRow(5_000)] })
		})
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '70')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '65')
		const desired = screen.getByLabelText('Desired Retirement Income')
		await user.clear(desired)
		await user.type(desired, '12000')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '4')

		const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
		expect(
			notReachable.getByText(/current age is at or past your life expectancy/)
		).toBeInTheDocument()
		expect(notReachable.getByText(/600\.00/)).toBeInTheDocument()
		expect(
			notReachable.queryByText(
				'Put more into your investment accounts on the Balance Tracking page'
			)
		).not.toBeInTheDocument()
	})

	it('shows an explicit "too large" message instead of a blank void when the solver overflows', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(seedReachableStores)
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '40')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '5')

		expect(screen.getByTestId('accumulation-solve-failed')).toBeInTheDocument()
		expect(screen.getByText(/Those numbers are too large to compute/)).toBeInTheDocument()
		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
		expect(screen.queryByTestId('accumulation-not-reachable')).not.toBeInTheDocument()
	})

	it('derives current amount saved from investments only, never netting debts against them', () => {
		useBalanceStore.setState({
			entries: [investmentRow(5_000_00), investmentRow(2_500_00, 'inv-2'), debtRow(9_000_00)],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-current-saved')).toBe('7,500.00')
	})
})

describe('RetirementAccumulationPlanner — one shared input set', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('collects each shared input exactly once', async () => {
		const user = userEvent.setup()
		const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		for (const label of [
			'Current Age',
			'Life Expectancy',
			'Desired Retirement Income',
			'Expected Annual Return',
		]) {
			expect(screen.getByLabelText(label)).toBeInTheDocument()
		}

		for (const label of ['Current Amount Saved', 'Monthly Savings']) {
			expect(screen.getAllByText(label)).toHaveLength(1)
			expect(screen.queryByRole('textbox', { name: label })).not.toBeInTheDocument()
		}

		for (const gone of [
			'Current Savings',
			'Annual Contribution',
			'Return Rate',
			'Retirement Age',
		]) {
			expect(screen.queryByLabelText(gone)).not.toBeInTheDocument()
		}

		expect(container.ownerDocument.querySelectorAll('#currentAge')).toHaveLength(1)
		expect(container.ownerDocument.querySelectorAll('#annualReturn')).toHaveLength(1)
		expect(container.ownerDocument.querySelectorAll('#postRetirementReturn')).toHaveLength(1)
	})

	it('renders one required-nest-egg figure, not a second standalone one', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)
		await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

		expect(screen.getAllByText(/^240,000\.00$/)).toHaveLength(1)
		expect(screen.queryByText('Required Retirement Assets')).not.toBeInTheDocument()
		expect(screen.getByText(/uses the Safe Withdrawal Model/)).toBeInTheDocument()
		expect(screen.queryByText(/FV = Ir × \(12 \/ r\)/)).not.toBeInTheDocument()
	})

	it('states the selected model’s explanation once, not twice', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		for (const explanation of [
			/Draw your savings down to zero by your life expectancy/,
			/Live off the investment returns forever/,
		]) {
			expect(screen.getAllByText(explanation)).toHaveLength(1)
		}
	})

	it('the growth chart agrees with the solver to the cent', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(() => {
			useBalanceStore.setState({
				entries: [investmentRow(100_000_00, 'inv-1', { amount: 100_000 })],
			})
			useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
		})
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '40')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '50')
		const desiredIncome = screen.getByLabelText('Desired Retirement Income')
		await user.clear(desiredIncome)
		await user.type(desiredIncome, '12000')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '6')

		const summary = screen.getByText('Projection Summary:').closest('p')
		expect(summary).not.toBeNull()

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		const yearsToRetirement = Number(
			outputs.getByText('Years to retirement').nextElementSibling?.textContent
		)
		const horizonYears = Math.max(1, Math.ceil(yearsToRetirement))
		const expectedCents = projectAccumulatedNestEgg(100_000_00, 1_000_00, 0.06, horizonYears * 12)
		const expectedDisplay = new Intl.NumberFormat('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(expectedCents / 100)

		expect(summary?.textContent).toContain(expectedDisplay)
		expect(summary?.textContent).toContain('at age 40')
		expect(summary?.textContent).toContain('6.0% return while saving')
	})

	it('stops the curve at retirement rather than running to life expectancy', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		const earliestAge = Number(
			outputs.getByText('Earliest retirement age').nextElementSibling?.textContent
		)
		const summary = screen.getByText('Projection Summary:').closest('p')

		expect(summary?.textContent).toContain(`at age ${earliestAge}`)
		expect(summary?.textContent).not.toContain('at age 85')
	})

	it('reports the gap between today’s savings and the required nest egg', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		expect(outputs.getByText('Still to accumulate').nextElementSibling).toHaveTextContent(
			'Already covered'
		)
	})

	it('shows a placeholder instead of a chart when a field is missing, never a stale default curve', () => {
		act(() => {
			useBalanceStore.setState({ entries: [investmentRow(1_000_000_00)] })
			useExpenseStore.setState({ expenses: [expenseRow(50_000)] })
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('')
		expect(
			screen.getByText('Fill in the details above to see how your savings grow.')
		).toBeInTheDocument()
		expect(screen.queryByText('Projection Summary:')).not.toBeInTheDocument()
	})

	it('opens on a solved plan for a user who already has income', () => {
		act(seedReachableStores)
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByLabelText('Current Age')).toHaveValue(35)
		expect(screen.getByLabelText('Life Expectancy')).toHaveValue(90)
		expect(screen.getByText('Projection Summary:')).toBeInTheDocument()
		expect(
			screen.queryByText('Fill in the details above to see how your savings grow.')
		).not.toBeInTheDocument()
	})

	it('does not tell the user to fill in details when the solve failed', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(seedReachableStores)
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '40')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '5')

		expect(screen.getByTestId('accumulation-solve-failed')).toBeInTheDocument()
		expect(
			screen.queryByText('Fill in the details above to see how your savings grow.')
		).not.toBeInTheDocument()
		expect(
			screen.getByText(/No projection — the numbers above are out of range/)
		).toBeInTheDocument()
	})

	it('explains the deplete-model overflow instead of falling back to the generic message', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		act(seedReachableStores)
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '40')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '9999999999')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '5')

		const failed = within(screen.getByTestId('accumulation-solve-failed'))
		expect(failed.getByText(/too large to plan for/)).toBeInTheDocument()
	})
})

describe('RetirementAccumulationPlanner — desired-income prefill', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('prefills half of annual income in whole units, not raw cents', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 1_000_000,
					frequency: 'monthly',
					createdAt: '2026-07-11T00:00:00.000Z',
					updatedAt: '2026-07-11T00:00:00.000Z',
				},
			],
		})

		renderWithProviders(<RetirementAccumulationPlanner />)

		const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		expect(income).toHaveValue('60,000.00')
		expect(income.value).not.toBe('6000000')
		expect(income).not.toHaveValue('6,000,000.00')
	})

	it('normalizes a weekly income instead of counting it as monthly', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Shifts',
					amount: 50_000,
					frequency: 'weekly',
					createdAt: '2026-07-11T00:00:00.000Z',
					updatedAt: '2026-07-11T00:00:00.000Z',
				},
			],
		})

		renderWithProviders(<RetirementAccumulationPlanner />)

		const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		expect(income).toHaveValue('13,000.02')
		expect(income).not.toHaveValue('3,000.00')
	})

	it('seeds the desired income in the SELECTED basis, not always annual', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

		act(() => {
			useIncomeStore.setState({
				incomeSources: [
					{
						id: 'inc-1',
						userId: 0,
						categoryId: null,
						name: 'Salary',
						amount: 1_000_000,
						frequency: 'monthly',
						createdAt: '2026-07-11T00:00:00.000Z',
						updatedAt: '2026-07-11T00:00:00.000Z',
					},
				],
			})
		})

		const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		expect(income).toHaveValue('5,000.00')
		expect(income).not.toHaveValue('60,000.00')
	})

	it('leaves a typed number untouched when the basis is switched', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 1_000_000,
					frequency: 'monthly',
					createdAt: '2026-07-11T00:00:00.000Z',
					updatedAt: '2026-07-11T00:00:00.000Z',
				},
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		expect(income).toHaveValue('60,000.00')

		await user.clear(income)
		await user.type(income, '60000')

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(income).toHaveValue('60,000.00')
	})
})

describe('RetirementAccumulationPlanner — income period basis', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('interprets the same number as annual or monthly without rewriting it', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)
		const incomeField = screen.getByLabelText('Desired Retirement Income')
		await user.clear(incomeField)
		await user.type(incomeField, '12000')
		await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

		const requiredRow = () =>
			within(screen.getByTestId('accumulation-outputs')).getByText('Required nest egg')
				.nextElementSibling

		expect(requiredRow()).toHaveTextContent('240,000.00')

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(requiredRow()).toHaveTextContent('2,880,000.00')

		expect(
			(screen.getByLabelText('Desired Retirement Income') as HTMLInputElement).value
		).toContain('12,000')
		expect(screen.getByText('The monthly income you want in retirement')).toBeInTheDocument()
	})
})

describe('RetirementAccumulationPlanner money inputs reject non-numeric characters', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('strips garbage pasted into "Desired Retirement Income"', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		fireEvent.change(input, { target: { value: 'approx $2,500.00 each' } })

		expect(input).toHaveValue('2,500.00')
	})

	it('never lets a typed letter into a money field', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		await user.clear(input)
		await user.type(input, '15abc00')

		expect(input).toHaveValue('1500')
	})

	it('keeps the money field as text/decimal so caret correction stays enabled', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		// setSelectionRange throws on type="number", silently disabling the caret correction.
		expect(input.type).toBe('text')
		expect(input.inputMode).toBe('decimal')
	})

	it('keeps a half-typed "-" visible instead of echoing it to 0.00 on blur', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		await user.clear(input)
		await user.type(input, '-')
		fireEvent.blur(input)

		expect(input).toHaveValue('-')
	})

	it('leaves an untouched money field empty on blur, never "0.00"', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		fireEvent.blur(input)

		expect(input).toHaveValue('')
		expect(
			screen.getByText('Enter all the details above to see your retirement outlook.')
		).toBeInTheDocument()
	})

	it('keeps focus in the field while typing (the render-helper guarantee)', async () => {
		// currencyField must stay a called helper, not a component defined in render, or
		// the input remounts on every keystroke and loses focus.
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		await user.clear(input)
		await user.type(input, '12345')

		expect(input).toHaveFocus()
		expect(input).toHaveValue('12345')
	})
})

describe('RetirementAccumulationPlanner — mobile a11y', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('the Income period select keeps a visible focus ring and a ≥44px target', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		const basis = screen.getByLabelText('Income period') as HTMLSelectElement
		expect(basis.classList.contains('focus:ring-2')).toBe(true)
		expect(basis.classList.contains('focus:outline-none')).toBe(true)
		expect(basis.classList.contains('min-h-[44px]')).toBe(true)
	})

	it('every text and number input keeps a visible focus ring and a ≥44px target', () => {
		const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

		const fields = container.querySelectorAll<HTMLInputElement>(
			'input[type="text"], input[type="number"]'
		)
		expect(fields).toHaveLength(5)
		for (const field of fields) {
			expect(field.classList.contains('focus:ring-2')).toBe(true)
			expect(field.classList.contains('focus:outline-none')).toBe(true)
			expect(field.classList.contains('min-h-[44px]')).toBe(true)
		}
	})

	it('every model radio keeps a visible focus ring', () => {
		const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

		const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
		expect(radios).toHaveLength(2)
		for (const radio of radios) {
			expect(radio.classList.contains('focus:ring-2')).toBe(true)
			expect(radio.classList.contains('focus:outline-none')).toBe(true)
		}
	})
})

describe('RetirementAccumulationPlanner survives a currency switch mid-edit', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('re-formats the derived figure with the new locale separators', () => {
		useBalanceStore.setState({ entries: [investmentRow(123456789)] })

		const { rerender } = renderWithProviders(<RetirementAccumulationPlanner />)
		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('1,234,567.89')

		act(() => {
			useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		})
		rerender(<RetirementAccumulationPlanner />)

		// Substring: Intl puts a narrow no-break space (U+202F) before the € symbol.
		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('1.234.567,89')
	})

	it('re-seeds the money field with the new locale separators and keeps typing working', async () => {
		const user = userEvent.setup()
		// Income must be seeded: without a prefill the re-seed effect early-returns and this passes vacuously.
		useIncomeStore.setState({ incomeSources: [incomeRow(1_000_000)] })
		const { rerender } = renderWithProviders(<RetirementAccumulationPlanner />)

		const input = screen.getByLabelText('Desired Retirement Income')
		expect(input).toHaveValue('60,000.00')

		act(() => {
			useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		})
		rerender(<RetirementAccumulationPlanner />)

		const switched = screen.getByLabelText('Desired Retirement Income')
		expect(switched).toHaveValue('60.000,00')

		await user.type(switched, '1')
		expect(switched).toHaveValue('60.000,001')
	})

	it('renders the currency-symbol prefix on the money field in symbol mode', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		useBalanceStore.setState({ entries: [investmentRow(5_000_00)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getAllByText('$')).toHaveLength(1)

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('$5,000.00')
	})
})

describe('RetirementAccumulationPlanner — derived figures', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	async function fillEditableFields(
		user: ReturnType<typeof userEvent.setup>,
		{ age = '40', life = '85', income = '12000', rate = '5' } = {}
	) {
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), age)
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), life)
		const incomeField = screen.getByLabelText('Desired Retirement Income')
		await user.clear(incomeField)
		await user.type(incomeField, income)
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), rate)
	}

	it('derives current amount saved from the investment-accounts total', () => {
		useBalanceStore.setState({ entries: [investmentRow(5_000_00)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('5,000.00')
	})

	it('derives monthly savings from investment CONTRIBUTIONS at mixed cadences', () => {
		// Per-row rounding then sum (290834c) differs from sum then round (290833c).
		useBalanceStore.setState({
			entries: [
				investmentRow(0, 'inv-1', { amount: 50_000, frequency: 'weekly' }),
				investmentRow(0, 'inv-2', { amount: 120_000, frequency: 'annually' }),
				investmentRow(0, 'inv-3', { amount: 25_000, frequency: 'biweekly' }),
				investmentRow(0, 'inv-4', { amount: 10_000, frequency: 'monthly' }),
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-monthly-savings')).toBe('2,908.34')
		expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('2,050.00')
	})

	it('clamps each ROW at zero, never the total', () => {
		// Per-row clamping: one clamp on the total would let a negative row eat another account's contribution.
		useBalanceStore.setState({
			entries: [
				investmentRow(0, 'inv-1', { amount: 150_000 }),
				investmentRow(0, 'inv-2', { amount: -40_000 }),
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-monthly-savings')).toBe('1,500.00')
		expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('1,100.00')
	})

	it('discloses a clamped row WITHOUT claiming the figure was zeroed', async () => {
		const user = userEvent.setup()
		// Fill the editable fields: resultsCaveat renders only inside a results branch.
		useBalanceStore.setState({
			entries: [
				investmentRow(100_000_00, 'inv-1', { amount: 150_000 }),
				investmentRow(0, 'inv-2', { amount: -40_000 }),
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user)

		const card = screen.getByTestId('derived-monthly-savings')
		expect(derivedValueOf('derived-monthly-savings')).toBe('1,500.00')
		expect(card).toHaveTextContent(
			'One or more accounts have a negative monthly contribution, which this plan counts as nothing.'
		)
		expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()
		expect(screen.queryByTestId('derived-floor-disclosure')).not.toBeInTheDocument()
	})

	it('tells a negative-only contributor the truth, not "add one"', () => {
		useBalanceStore.setState({
			entries: [investmentRow(50_000_00, 'inv-1', { amount: -200_000 })],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		const card = screen.getByTestId('derived-monthly-savings')
		expect(derivedValueOf('derived-monthly-savings')).toBe('0.00')
		expect(card).toHaveTextContent(
			'Your investment account contributions currently come to less than nothing'
		)
		expect(card).not.toHaveTextContent('have no monthly contribution set yet')
	})

	it('counts a contribution the user marked as already accounted for', () => {
		// contributionRecordedAsExpense only affects the savings pool; the money is still
		// invested, so it must count here.
		useBalanceStore.setState({
			entries: [
				{ ...investmentRow(0, 'inv-1', { amount: 40_000 }), contributionRecordedAsExpense: true },
				investmentRow(0, 'inv-2', { amount: 60_000 }),
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-monthly-savings')).toBe('1,000.00')
		expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('600.00')
	})

	it('no longer moves when income or expenses change', () => {
		useBalanceStore.setState({
			entries: [investmentRow(0, 'inv-1', { amount: 75_000 })],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		expect(derivedValueOf('derived-monthly-savings')).toBe('750.00')

		act(() => {
			useIncomeStore.setState({ incomeSources: [incomeRow(900_000)] })
			useExpenseStore.setState({ expenses: [expenseRow(400_000)] })
		})

		expect(derivedValueOf('derived-monthly-savings')).toBe('750.00')
		expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent('5,000.00')
	})

	it('renders neither derived figure as an editable control', () => {
		useBalanceStore.setState({
			entries: [investmentRow(5_000_00, 'inv-1', { amount: 300_000 })],
		})
		useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-current-saved')).toBe('5,000.00')
		expect(derivedValueOf('derived-monthly-savings')).toBe('3,000.00')

		expect(screen.queryByRole('textbox', { name: /Current Amount Saved/ })).not.toBeInTheDocument()
		expect(screen.queryByRole('textbox', { name: /Monthly Savings/ })).not.toBeInTheDocument()
	})

	it('updates both figures live when the underlying store changes', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)
		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('0.00')

		act(() => {
			useBalanceStore.setState({
				entries: [investmentRow(7_500_00, 'inv-1', { amount: 250_000 })],
			})
		})

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('7,500.00')
		expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent('2,500.00')
	})

	it('distinguishes no accounts from accounts with nothing going in', () => {
		const { unmount } = renderWithProviders(<RetirementAccumulationPlanner />)
		expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent(
			'Add an investment account on the Balance Tracking page, and say what you put in each month.'
		)
		unmount()

		useBalanceStore.setState({ entries: [investmentRow(50_000_00, 'inv-1')] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		const derived = screen.getByTestId('derived-monthly-savings')
		expect(derived).toHaveTextContent(
			'Your investment accounts have no monthly contribution set yet — add one on the Balance Tracking page.'
		)
		expect(derived).not.toHaveTextContent('Add an investment account')
	})

	it('reports unreadable CONTRIBUTIONS, and names the page that holds them', () => {
		useBalanceStore.setState({
			entries: [
				{
					...investmentRow(50_000_00, 'inv-1'),
					monthlyContribution: Number.NaN,
				} as unknown as never,
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		const derived = screen.getByTestId('derived-monthly-savings')
		expect(derived).toHaveTextContent("We couldn't read your investment account contributions.")
		expect(derived).not.toHaveTextContent('investment account balances')
		expect(screen.getByLabelText('Current Age')).toBeInTheDocument()
	})

	it('COERCES a corrupt contribution cadence to monthly rather than failing', () => {
		// monthlyContributionCents coerces an unknown cadence to monthly, matching the savings pool.
		useBalanceStore.setState({
			entries: [
				{
					...investmentRow(50_000_00, 'inv-1', { amount: 30_000 }),
					frequency: 'daily',
				} as unknown as never,
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-monthly-savings')).toBe('300.00')
		expect(screen.getByTestId('derived-monthly-savings')).not.toHaveTextContent(
			"We couldn't read your investment account contributions."
		)
	})

	it('distinguishes investment accounts that hold nothing from having none at all', () => {
		useBalanceStore.setState({ entries: [investmentRow(0)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		const derived = screen.getByTestId('derived-current-saved')
		expect(derived).toHaveTextContent('Your investment accounts currently hold nothing.')
		expect(derived).not.toHaveTextContent('Only investment accounts count toward your nest egg')
	})

	it('survives a corrupt persisted income row without reaching the ErrorBoundary', () => {
		useBalanceStore.setState({
			entries: [investmentRow(0, 'inv-1', { amount: 120_000 })],
		})
		useIncomeStore.setState({
			incomeSources: [{ ...incomeRow(100_000), frequency: 'daily' } as unknown as never],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByLabelText('Current Age')).toBeInTheDocument()
		expect(derivedValueOf('derived-monthly-savings')).toBe('1,200.00')
	})

	it('shows the FLOORED monthly savings, never a negative figure', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [investmentRow(100_000_00, 'inv-1', { amount: -200_000 })],
		})
		useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
		useExpenseStore.setState({ expenses: [expenseRow(300_000)] })

		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-monthly-savings')).toBe('0.00')

		await fillEditableFields(user)

		const outputs = within(screen.getByTestId('accumulation-outputs'))
		expect(outputs.getByText('Saved per year').nextElementSibling?.textContent).toBe('0.00')

		expect(toMoney(outputs.getByText('Total saved').nextElementSibling?.textContent)).toBe(100_000)
		expect(
			toMoney(outputs.getByText('Nest egg at retirement').nextElementSibling?.textContent)
		).toBeGreaterThanOrEqual(100_000)
	})

	it('floors a NEGATIVE investment total the same way, and says so', () => {
		useBalanceStore.setState({ entries: [investmentRow(-5_000_00)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(derivedValueOf('derived-current-saved')).toBe('0.00')
		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
			'Your investment accounts currently net below zero'
		)
	})

	it('reports an unreadable balance instead of rendering a confident zero', () => {
		useBalanceStore.setState({
			entries: [{ ...investmentRow(0), currentBalance: Number.NaN } as unknown as never],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		const derived = screen.getByTestId('derived-current-saved')
		expect(derived).toHaveTextContent("We couldn't read your investment account balances.")
		expect(derived).not.toHaveTextContent('From your investment accounts')
	})

	it('treats a fractional-cent balance as unreadable rather than solving from it', () => {
		useBalanceStore.setState({
			entries: [{ ...investmentRow(0), currentBalance: 500_050.5 } as unknown as never],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
			"We couldn't read your investment account balances."
		)
		expect(derivedValueOf('derived-current-saved')).toBe('0.00')
	})

	it('warns in the results when a figure could not be read at all', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [
				{
					...investmentRow(100_000_00, 'inv-1'),
					monthlyContribution: Number.NaN,
				} as unknown as never,
			],
		})
		useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user)

		expect(screen.getByTestId('derived-floor-disclosure')).toHaveTextContent(
			'Some of your saved data could not be read'
		)
	})

	it('leaves the results caveat OFF when both figures are honestly zero', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({ entries: [investmentRow(100_000_00, 'inv-1')] })
		useIncomeStore.setState({ incomeSources: [incomeRow(300_000)] })
		useExpenseStore.setState({ expenses: [expenseRow(300_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user)

		expect(screen.getByTestId('derived-monthly-savings')).toHaveTextContent(
			'no monthly contribution set yet'
		)
		expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()
		expect(screen.queryByTestId('derived-floor-disclosure')).not.toBeInTheDocument()
	})

	it('does not claim "no savings data" when the data exists but nets to zero', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [investmentRow(-5_000_00, 'inv-1', { amount: -200_000 })],
		})
		useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
		useExpenseStore.setState({ expenses: [expenseRow(300_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user)

		const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
		expect(notReachable.queryByText(/We don.t have your savings data yet/)).not.toBeInTheDocument()
		expect(
			notReachable.getByText(/Retirement isn.t reachable with these numbers/)
		).toBeInTheDocument()
		expect(screen.getByTestId('derived-floor-disclosure')).toBeInTheDocument()
	})

	it('draws no chart, and claims no figures, for a user with no source data at all', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user, { age: '30', life: '85', income: '40000', rate: '6' })

		expect(screen.queryByText('Projection Summary:')).not.toBeInTheDocument()
		expect(
			screen.getByText(/add your investment accounts to see how your savings grow/i)
		).toBeInTheDocument()
		expect(screen.queryByText(/income and expenses to see how your savings grow/i)).toBeNull()
	})

	it('gives a user with no data the add-your-data branch, not "unreachable"', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user, { age: '30', life: '85', income: '40000', rate: '6' })

		const notReachable = within(screen.getByTestId('accumulation-not-reachable'))
		expect(notReachable.getByText(/We don.t have your savings data yet/)).toBeInTheDocument()
		expect(
			notReachable.getByText(/Add your investment accounts on the Balance/)
		).toBeInTheDocument()
		expect(notReachable.getByText(/what you put into them each month/)).toBeInTheDocument()
		expect(
			notReachable.queryByText(/Retirement isn.t reachable with these numbers/)
		).not.toBeInTheDocument()
		expect(
			notReachable.queryByText(
				'Put more into your investment accounts on the Balance Tracking page'
			)
		).not.toBeInTheDocument()
	})

	it('does not show a confident all-zero outlook to a user with no data (47.2)', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({ incomeSources: [incomeRow(500_000)] })
		useExpenseStore.setState({ expenses: [expenseRow(200_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user, { age: '30', life: '85', income: '0', rate: '6' })

		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
		expect(
			within(screen.getByTestId('accumulation-not-reachable')).getByText(
				/We don.t have your savings data yet/
			)
		).toBeInTheDocument()
	})

	it('discloses in the results that a floored figure was assumed to be zero', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [investmentRow(100_000_00, 'inv-1', { amount: -200_000 })],
		})
		useIncomeStore.setState({ incomeSources: [incomeRow(100_000)] })
		useExpenseStore.setState({ expenses: [expenseRow(300_000)] })

		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillEditableFields(user)

		expect(screen.getByTestId('derived-floor-disclosure')).toBeInTheDocument()
	})
})

describe('RetirementAccumulationPlanner — the monthly figure stops blaming income', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	it('never ties the Monthly Savings card to income or expenses, in any state', () => {
		const states: [string, () => void][] = [
			['no investment accounts', () => undefined],
			[
				'accounts with no contribution set',
				() => useBalanceStore.setState({ entries: [investmentRow(50_000_00, 'inv-1')] }),
			],
			[
				'a real contribution',
				() =>
					useBalanceStore.setState({
						entries: [investmentRow(50_000_00, 'inv-1', { amount: 120_000 })],
					}),
			],
			[
				'an unreadable contribution',
				() =>
					useBalanceStore.setState({
						entries: [
							{
								...investmentRow(50_000_00, 'inv-1'),
								monthlyContribution: Number.NaN,
							} as unknown as never,
						],
					}),
			],
		]

		for (const [label, seed] of states) {
			resetStores()
			useIncomeStore.setState({ incomeSources: [incomeRow(500_000)] })
			useExpenseStore.setState({ expenses: [expenseRow(200_000)] })
			seed()

			const { unmount } = renderWithProviders(<RetirementAccumulationPlanner />)
			const card = screen.getByTestId('derived-monthly-savings')
			expect(card.textContent, label).toContain('Monthly Savings')
			expect(card.textContent, label).not.toMatch(/income|expense/i)
			unmount()
		}
	})

	it('sends an unreadable monthly figure to the page that holds it', () => {
		const copy = describeSolverError(new Error('Monthly savings must be a finite number'))
		expect(copy).toMatch(/monthly\s+contributions\s+on\s+your\s+Balance\s+Tracking\s+page/i)
		expect(copy).not.toMatch(/income|expenses/i)
	})

	it('offers a lever that can actually move the outcome', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [investmentRow(1_000_00, 'inv-1', { amount: 5_000 })],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.clear(screen.getByLabelText('Current Age'))
		await user.type(screen.getByLabelText('Current Age'), '60')
		await user.clear(screen.getByLabelText('Life Expectancy'))
		await user.type(screen.getByLabelText('Life Expectancy'), '65')
		const desired = screen.getByLabelText('Desired Retirement Income')
		await user.clear(desired)
		await user.type(desired, '5000000')
		await user.clear(screen.getByLabelText('Expected Annual Return'))
		await user.type(screen.getByLabelText('Expected Annual Return'), '4')

		const levers = within(screen.getByTestId('accumulation-not-reachable')).getByRole('list')
		expect(levers.textContent).toContain(
			'Put more into your investment accounts on the Balance Tracking page'
		)
		expect(levers.textContent).not.toMatch(/income\s+or\s+cut\s+expenses/i)
		expect(levers.textContent).not.toMatch(/Income\s+and\s+Expenses\s+pages/i)
	})
})

describe('RetirementAccumulationPlanner — post-retirement return rate', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	const accumulationField = () => screen.getByLabelText('Expected Annual Return')
	const postRetirementField = () => screen.getByLabelText('Post-Retirement Annual Return')

	async function setField(
		user: ReturnType<typeof userEvent.setup>,
		field: HTMLElement,
		value: string
	) {
		await user.clear(field)
		await user.type(field, value)
	}

	it('mirrors the accumulation rate until the user edits it', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(postRetirementField()).toHaveValue('6.0')

		await setField(user, accumulationField(), '8')

		expect(accumulationField()).toHaveValue('8')
		expect(postRetirementField()).toHaveValue('8')
	})

	it('stops mirroring once edited, and the two then move independently', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(postRetirementField()).toHaveValue('6.0')

		await setField(user, postRetirementField(), '3')
		expect(postRetirementField()).toHaveValue('3')

		await setField(user, accumulationField(), '8')
		expect(accumulationField()).toHaveValue('8')
		expect(postRetirementField()).toHaveValue('3')
	})

	it('a lower post-retirement rate raises the requirement and delays retirement', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		await fillReachableCase(user)

		const outputValue = (label: string): string =>
			within(screen.getByTestId('accumulation-outputs')).getByText(label).nextElementSibling
				?.textContent ?? ''

		const requiredBefore = toMoney(outputValue('Required nest egg'))
		const ageBefore = outputValue('Earliest retirement age')
		expect(requiredBefore).toBeGreaterThan(0)

		await setField(user, postRetirementField(), '2')

		const requiredAfter = toMoney(outputValue('Required nest egg'))
		expect(requiredAfter).toBeGreaterThan(requiredBefore)

		expect(Number(outputValue('Earliest retirement age'))).toBeGreaterThan(Number(ageBefore))
	})

	it('a blank post-retirement rate is incomplete, not a silent 0% (Trap B)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillReachableCase(user)

		expect(screen.getByTestId('accumulation-outputs')).toBeInTheDocument()

		await user.clear(postRetirementField())

		// parsePercentageToDecimal returns 0 for an empty string rather than throwing.
		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
		expect(
			screen.getByText('Enter all the details above to see your retirement outlook.')
		).toBeInTheDocument()
	})

	it('both rate fields explain which phase they govern', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(
			screen.getByText(
				/Expected yearly return while you are still saving — under this model it also sets how fast your retirement income is assumed to rise/
			)
		).toBeInTheDocument()
		expect(
			screen.getByText(
				/What your savings earn once you retire — lower it to model a safer allocation\. Follows the rate above until you change it/
			)
		).toBeInTheDocument()
	})

	it('drops the income-growth clause on the perpetual model, where it is false', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByText(/under this model it also sets how fast/)).toBeInTheDocument()

		await user.click(screen.getByRole('radio', { name: /Perpetual safe-withdrawal/ }))

		expect(screen.queryByText(/under this model it also sets how fast/)).not.toBeInTheDocument()
		expect(
			screen.getByText('Expected yearly return while you are still saving')
		).toBeInTheDocument()
	})

	it('stops promising to follow the rate above once that has stopped being true', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByText(/Follows the rate above until you change it/)).toBeInTheDocument()

		await setField(user, postRetirementField(), '3')

		expect(screen.queryByText(/Follows the rate above until you change it/)).not.toBeInTheDocument()
		expect(
			screen.getByText(
				'What your savings earn once you retire — lower it to model a safer allocation'
			)
		).toBeInTheDocument()
	})

	it('names the real cause when the two rates overflow the requirement', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillReachableCase(user)

		await setField(user, screen.getByLabelText('Life Expectancy'), '900')
		await setField(user, postRetirementField(), '0')

		const panel = screen.getByTestId('accumulation-solve-failed')
		expect(panel).toHaveTextContent(/gap between your two return rates/)
	})

	it('keeps the growth chart on the accumulation rate only', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillReachableCase(user)

		const summaryText = () => screen.getByText('Projection Summary:').closest('p')?.textContent
		expect(summaryText()).toContain('5.0% return while saving')

		await setField(user, postRetirementField(), '2')

		expect(summaryText()).toContain('5.0% return while saving')
	})
})

describe('RetirementAccumulationPlanner — assets stay OUT of the nest egg', () => {
	const balanceRow = (id: string, type: FinanceType, currentBalance: number) => ({
		id,
		type,
		name: id,
		currentBalance,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	})

	it('does not count an asset row toward the RENDERED nest-egg base', () => {
		useBalanceStore.setState({
			entries: [
				balanceRow('inv-1', 'investment', 5_000_000),
				balanceRow('asset-1', 'asset', 40_000_000),
			],
		})

		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent('50,000.00')
		expect(screen.getByTestId('derived-current-saved')).not.toHaveTextContent('450,000.00')
	})

	it('shows the nest-egg empty state for a user holding ONLY assets', () => {
		useBalanceStore.setState({ entries: [balanceRow('asset-1', 'asset', 40_000_000)] })

		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByTestId('derived-current-saved')).toHaveTextContent(
			'Only investment accounts count toward your nest egg'
		)
		expect(screen.getByTestId('derived-current-saved')).not.toHaveTextContent('400,000.00')
	})
})

describe('RetirementAccumulationPlanner — what not to count toward desired income', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	const NOTE = /^Don't include expenses that will no longer be relevant in retirement\.$/
	const PERIOD_HELP = /^The annual income you want in retirement$/

	it('tells the user to leave out costs that will have ended by retirement', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByTestId('desiredIncome-note')).toHaveTextContent(NOTE)
	})

	it('wires aria-describedby to the period help and the note, help first', () => {
		renderWithProviders(<RetirementAccumulationPlanner />)
		const input = screen.getByLabelText('Desired Retirement Income')

		const describedBy = input.getAttribute('aria-describedby')
		expect(describedBy).toBeTruthy()

		const described = (describedBy ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.map((elementId) => document.getElementById(elementId))

		expect(described).toHaveLength(2)
		for (const element of described) {
			expect(element).not.toBeNull()
		}

		for (const element of described) {
			expect(element?.tagName).toBe('P')
		}

		// incomeBasis is annual here because the global setup resets the plan around every test.
		expect(described[0]).toHaveTextContent(PERIOD_HELP)
		expect(described[1]).toHaveTextContent(NOTE)
	})
})

describe('RetirementAccumulationPlanner — expenses that end before retirement', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	const hint = (): string =>
		(screen.getByTestId('desired-income-ending-expenses').textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim()

	const marked = (amount: number, frequency: Frequency = 'monthly', id = 'exp-m') => ({
		...expenseRow(amount, frequency, id),
		endsBeforeRetirement: true,
	})

	it('shows nothing at all when no expense is marked', () => {
		useExpenseStore.setState({ expenses: [expenseRow(420_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)
		expect(screen.queryByTestId('desired-income-ending-expenses')).not.toBeInTheDocument()
	})

	it('states both figures and the remainder, in the MONTHLY basis', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

		expect(hint()).toBe(
			"Your expenses today are 4,200.00 a month. You've marked 1,800.00 a month as ending before retirement, leaving 2,400.00. Use this figure"
		)
	})

	it('⚠️ converts BOTH figures to the ANNUAL basis when that is selected', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'annual')

		expect(hint()).toBe(
			"Your expenses today are 50,400.00 a year. You've marked 21,600.00 a year as ending before retirement, leaving 28,800.00. Use this figure"
		)
	})

	it('⚠️ NORMALIZES a non-monthly marked expense rather than counting it as monthly', async () => {
		const user = userEvent.setup()
		// Core uses the exact 52/12 fraction: 10_000c weekly -> 43_333c monthly.
		useExpenseStore.setState({
			expenses: [marked(10_000, 'weekly'), expenseRow(56_667, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

		expect(hint()).toContain("You've marked 433.33 a month")
		expect(hint()).not.toContain("You've marked 100.00")
	})

	it('⚠️⚠️ renders the suggestion WITHOUT touching the desired-income field', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({ incomeSources: [incomeRow(1_000_000)] })
		useExpenseStore.setState({ expenses: [marked(180_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		const income = screen.getByLabelText('Desired Retirement Income') as HTMLInputElement
		expect(income).toHaveValue('60,000.00')
		expect(screen.getByTestId('desired-income-ending-expenses')).toBeInTheDocument()
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(income).toHaveValue('5,000.00')
		expect(income).not.toHaveValue('2,400.00')
	})

	it('adopts the remainder on request, under the MONTHLY basis', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')

		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('2,400.00')
	})

	it('adopts the remainder on request, under the ANNUAL basis', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'annual')

		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('28,800.00')
	})

	it('⚠️⚠️ adopting MARKS THE FIELD AUTHORED, so the income seed cannot overwrite it', async () => {
		// Without markDesiredIncomeAuthored the seed effect re-fires when the prefill
		// changes (null -> real on hydration) and replaces the adopted number.
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('2,400.00')

		act(() => {
			useIncomeStore.setState({ incomeSources: [incomeRow(1_000_000)] })
		})

		expect(useRetirementPlannerStore.getState().plan.desiredIncomeTouched).toBe(true)
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('2,400.00')
	})

	it('⚠️⚠️ REGRESSION (code review 65.2): a huge ticked expense does not crash the page', () => {
		useExpenseStore.setState({ expenses: [marked(800_000_000_000_000)] })
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(screen.getByLabelText('Desired Retirement Income')).toBeInTheDocument()
		expect(hint()).toBe("We can't total your expenses, so we can't suggest a figure.")
	})

	it('⚠️⚠️ REGRESSION (code review 65.2): an ADOPTED figure follows a later basis switch', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		const field = screen.getByLabelText('Desired Retirement Income')
		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(field).toHaveValue('28,800.00')

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(field).toHaveValue('2,400.00')

		await user.selectOptions(screen.getByLabelText('Income period'), 'annual')
		expect(field).toHaveValue('28,800.00')
	})

	it('⚠️⚠️ REGRESSION (second review round): the adopted figure still follows the basis AFTER A REMOUNT', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		const first = renderWithProviders(<RetirementAccumulationPlanner />)
		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('28,800.00')

		expect(useRetirementPlannerStore.getState().plan.adoptedMonthlyCents).toBe(240_000)

		first.unmount()
		renderWithProviders(<RetirementAccumulationPlanner />)
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('28,800.00')

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(screen.getByLabelText('Desired Retirement Income')).toHaveValue('2,400.00')
	})

	it('⚠️ but a value the user TYPES is theirs — the adopted figure stops following', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [marked(180_000), expenseRow(240_000, 'monthly', 'exp-u')],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		const field = screen.getByLabelText('Desired Retirement Income')
		await user.clear(field)
		await user.type(field, '5000')
		expect(useRetirementPlannerStore.getState().plan.adoptedMonthlyCents).toBeNull()
		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(field).toHaveValue('5,000.00')
		expect(field).not.toHaveValue('2,400.00')
	})

	it('⚠️ REFUSES rather than showing a confident wrong number when a row is corrupt', () => {
		useExpenseStore.setState({
			expenses: [
				marked(180_000),
				// A persisted string amount makes + concatenate into a plausible finite number.
				{ ...expenseRow(0, 'monthly', 'exp-bad'), amount: '240000' as unknown as number },
			],
		})
		renderWithProviders(<RetirementAccumulationPlanner />)

		expect(hint()).toBe("We can't total your expenses, so we can't suggest a figure.")
		expect(screen.queryByRole('button', { name: 'Use this figure' })).not.toBeInTheDocument()
	})

	it('⚠️ the nest-egg figures are untouched by a marked expense (the epic’s boundary)', () => {
		useBalanceStore.setState({ entries: [investmentRow(5_000_000, 'inv-1', { amount: 50_000 })] })
		useExpenseStore.setState({ expenses: [marked(180_000)] })
		const { container } = renderWithProviders(<RetirementAccumulationPlanner />)

		const savingsSection = (): string =>
			(container.querySelector('[data-testid="retirement-savings-position"]') ?? container)
				.textContent ?? ''
		const withFlag = savingsSection()
		expect(withFlag).toContain('50,000.00')

		act(() => {
			useExpenseStore.setState({ expenses: [expenseRow(180_000)] })
		})

		expect(screen.queryByTestId('desired-income-ending-expenses')).not.toBeInTheDocument()
		expect(savingsSection()).toBe(withFlag)
		expect(withFlag).not.toContain('51,800.00')
	})
})

// A number input drops the ',' keystroke, so both rate fields are type="text".
describe('a decimal comma in the rate fields', () => {
	beforeEach(resetStores)
	afterEach(resetStores)

	const outlook = () => screen.getByTestId('accumulation-outputs').textContent

	async function fillYearsAwayCase(user: ReturnType<typeof userEvent.setup>): Promise<void> {
		await fillReachableCase(user)
		const desired = screen.getByLabelText('Desired Retirement Income')
		await user.clear(desired)
		await user.type(desired, '60000')
	}

	async function setRate(
		user: ReturnType<typeof userEvent.setup>,
		label: string,
		typed: string
	): Promise<void> {
		await user.clear(screen.getByLabelText(label))
		await user.type(screen.getByLabelText(label), typed)
	}

	for (const label of ['Expected Annual Return', 'Post-Retirement Annual Return']) {
		it(`${label}: 2,5 keeps its comma and solves exactly as 2.5`, async () => {
			const user = userEvent.setup()
			renderWithProviders(<RetirementAccumulationPlanner />)
			await fillYearsAwayCase(user)

			await setRate(user, label, '2.5')
			const atPoint = outlook()
			await setRate(user, label, '25')
			expect(outlook()).not.toBe(atPoint)

			await setRate(user, label, '2,5')
			expect(screen.getByLabelText(label)).toHaveValue('2,5')
			expect(screen.getByLabelText(label)).toHaveAttribute('type', 'text')
			expect(screen.getByLabelText(label)).toHaveAttribute('inputmode', 'decimal')
			expect(outlook()).toBe(atPoint)
		})
	}

	it('an ambiguous comma form shows the invalid-input note, not a plan', async () => {
		const user = userEvent.setup()
		renderWithProviders(<RetirementAccumulationPlanner />)
		await fillReachableCase(user)

		await setRate(user, 'Expected Annual Return', '1.000,5')

		expect(screen.getByLabelText('Expected Annual Return')).toHaveValue('1.000,5')
		expect(
			screen.getByText('Please check your inputs — one of the values is not a valid number.')
		).toBeInTheDocument()
		expect(screen.queryByTestId('accumulation-outputs')).not.toBeInTheDocument()
	})
})
