import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useRetirementPlannerStore } from '../../stores/retirementPlannerStore'
import { renderAfterReload } from '../../test/reload-chain'

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => ({
		status: {
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: false,
		},
	}),
}))

const { ExpensesPage } = await import('../ExpensesPage')
const { RetirementAccumulationPlanner } = await import('../RetirementAccumulationPlanner')

const LABEL = 'This expense ends before I retire'

// Figures carry `$`: reset() clears the setup's currency-less pin from storage, so
// the reload chain rehydrates the currency store to its USD default.
function reset(): void {
	useExpenseStore.setState({ expenses: [] })
	useIncomeStore.setState({ incomeSources: [] })
	useRetirementPlannerStore.setState(useRetirementPlannerStore.getInitialState(), true)
	localStorage.clear()
}

async function addExpense(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
	amount: string,
	marked: boolean
): Promise<void> {
	await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
	const dialog = screen.getByRole('dialog')
	await user.type(within(dialog).getByTestId('expense-name-input'), name)
	await user.type(within(dialog).getByTestId('expense-amount-input'), amount)
	if (marked) await user.click(within(dialog).getByRole('checkbox', { name: LABEL }))
	await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))
	await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

const hint = (): string =>
	(screen.getByTestId('desired-income-ending-expenses').textContent ?? '').replace(/\s+/g, ' ')

describe('a marked expense reaches the retirement planner through storage', () => {
	beforeEach(reset)
	afterEach(reset)

	it('is marked on the Expenses page, survives a reload, and drives an adoptable figure (was e2e ends-before-retirement:83)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await addExpense(user, 'Mortgage', '1800', true)
		await addExpense(user, 'Groceries', '2400', false)
		expect(screen.getAllByTestId('expense-row-ends-before-retirement')).toHaveLength(1)

		await renderAfterReload(<ExpensesPage />)
		expect(screen.getAllByTestId('expense-row-ends-before-retirement')).toHaveLength(1)
		expect(screen.getByTestId('expense-row-ends-before-retirement')).toHaveTextContent(
			'Ends before retirement'
		)

		await renderAfterReload(<RetirementAccumulationPlanner />)
		expect(hint()).toContain("You've marked $21,600.00 a year as ending before retirement")
		expect(hint()).toContain('Your expenses today are $50,400.00 a year')

		await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
		expect(hint()).toContain("You've marked $1,800.00 a month as ending before retirement")
		expect(hint()).toContain('Your expenses today are $4,200.00 a month')

		const desired = () => screen.getByLabelText('Desired Retirement Income')
		expect(desired()).toHaveValue('')
		await user.click(screen.getByRole('button', { name: 'Use this figure' }))
		expect(desired()).toHaveValue('2,400.00')

		await renderAfterReload(<RetirementAccumulationPlanner />)
		expect(desired()).toHaveValue('2,400.00')
	})
})
