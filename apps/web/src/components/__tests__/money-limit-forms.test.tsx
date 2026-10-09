import { MAX_MONEY_CENTS } from '@budget-planner/core/finance/money-limits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => ({
		status: {
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: true,
		} satisfies PremiumAccessStatus,
	}),
}))

const OVER = '21474836.48'
const AT = '21474836.47'
const USD_MESSAGE = 'Enter an amount up to $21,474,836.47'

function resetStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
}

beforeEach(resetStores)
afterEach(resetStores)

async function typeInto(user: ReturnType<typeof userEvent.setup>, testId: string, value: string) {
	const input = screen.getByTestId(testId)
	await user.clear(input)
	await user.type(input, value)
}

describe('the limit itself', () => {
	it('is the int32 column limit, 2,147,483,647 cents', () => {
		expect(MAX_MONEY_CENTS).toBe(2_147_483_647)
	})
})

describe('/income', () => {
	async function submitIncome(amount: string) {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		await typeInto(user, 'income-name-input', 'Salary')
		await typeInto(user, 'income-amount-input', amount)
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Income Source' })
		)
	}

	it('refuses one cent over the limit with a field error, and saves nothing', async () => {
		await submitIncome(OVER)
		expect(screen.getByTestId('income-amount-error')).toHaveTextContent(USD_MESSAGE)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('accepts exactly the limit', async () => {
		await submitIncome(AT)
		expect(useIncomeStore.getState().incomeSources.map((s) => s.amount)).toEqual([MAX_MONEY_CENTS])
	})

	it('names the limit in the user currency (JPY: a mortgage-sized yen amount)', async () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'JPY' })
		await submitIncome('21474837')
		// The yen locale renders the fullwidth yen sign (U+FFE5).
		expect(screen.getByTestId('income-amount-error')).toHaveTextContent(
			'Enter an amount up to \uffe521,474,836'
		)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('refuses an edit to one cent over the limit, and keeps the saved amount', async () => {
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500_000, frequency: 'monthly' })
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		await user.click(screen.getAllByRole('button', { name: 'Edit Salary' })[0] as HTMLElement)
		await typeInto(user, 'income-amount-input', OVER)
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Save Changes' })
		)
		expect(screen.getByTestId('income-amount-error')).toHaveTextContent(USD_MESSAGE)
		expect(useIncomeStore.getState().incomeSources.map((s) => s.amount)).toEqual([500_000])
	})
})

describe('/expenses', () => {
	async function submitExpense(amount: string) {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		await typeInto(user, 'expense-name-input', 'Mortgage')
		await typeInto(user, 'expense-amount-input', amount)
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expense' })
		)
	}

	it('refuses one cent over the limit with a field error, and saves nothing', async () => {
		await submitExpense(OVER)
		expect(screen.getByTestId('expense-amount-error')).toHaveTextContent(USD_MESSAGE)
		expect(useExpenseStore.getState().expenses).toHaveLength(0)
	})

	it('accepts exactly the limit', async () => {
		await submitExpense(AT)
		expect(useExpenseStore.getState().expenses.map((e) => e.amount)).toEqual([MAX_MONEY_CENTS])
	})
})

describe('/savings', () => {
	async function openSavingsForm() {
		const user = userEvent.setup()
		renderWithProviders(<SavingsPage />)
		await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
		await typeInto(user, 'savings-name-input', 'House')
		return user
	}
	const submit = (user: ReturnType<typeof userEvent.setup>) =>
		user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Savings Goal' }))

	it('refuses a target over the limit', async () => {
		const user = await openSavingsForm()
		await typeInto(user, 'savings-target-amount-input', OVER)
		await typeInto(user, 'savings-current-balance-input', '0')
		await submit(user)
		expect(screen.getByTestId('savings-target-amount-error')).toHaveTextContent(USD_MESSAGE)
		expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
	})

	it('refuses a current balance over the limit', async () => {
		const user = await openSavingsForm()
		await typeInto(user, 'savings-target-amount-input', AT)
		await typeInto(user, 'savings-current-balance-input', OVER)
		await submit(user)
		expect(screen.getByTestId('savings-current-balance-error')).toHaveTextContent(USD_MESSAGE)
		expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
	})

	it('refuses a manual monthly allocation over the limit', async () => {
		const user = await openSavingsForm()
		await typeInto(user, 'savings-target-amount-input', '1000')
		await typeInto(user, 'savings-current-balance-input', '0')
		await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
		await typeInto(user, 'savings-monthly-allocation-input', OVER)
		await submit(user)
		expect(screen.getByTestId('savings-monthly-allocation-error')).toHaveTextContent(USD_MESSAGE)
		expect(useSavingsStore.getState().savingsGoals).toHaveLength(0)
	})

	it('accepts exactly the limit as target, current balance and manual allocation', async () => {
		const user = await openSavingsForm()
		await typeInto(user, 'savings-target-amount-input', AT)
		await typeInto(user, 'savings-current-balance-input', AT)
		await user.selectOptions(screen.getByTestId('savings-allocation-mode-select'), 'manual')
		await typeInto(user, 'savings-monthly-allocation-input', AT)
		await submit(user)
		const goal = useSavingsStore.getState().savingsGoals[0]
		expect([goal?.targetAmount, goal?.currentBalance, goal?.monthlyAllocation]).toEqual([
			MAX_MONEY_CENTS,
			MAX_MONEY_CENTS,
			MAX_MONEY_CENTS,
		])
	})
})

describe('/balance', () => {
	async function openBalanceForm() {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))
		await typeInto(user, 'balance-name-input', 'Brokerage')
		return user
	}
	const submit = (user: ReturnType<typeof userEvent.setup>) =>
		user.click(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Balance Entry' })
		)

	it('refuses a current balance over the limit', async () => {
		const user = await openBalanceForm()
		await typeInto(user, 'balance-current-balance-input', OVER)
		await submit(user)
		expect(screen.getByTestId('balance-current-balance-error')).toHaveTextContent(USD_MESSAGE)
		expect(useBalanceStore.getState().entries).toHaveLength(0)
	})

	it('refuses an investment contribution over the limit', async () => {
		const user = await openBalanceForm()
		await typeInto(user, 'balance-current-balance-input', '1000')
		await typeInto(user, 'balance-monthly-contribution-input', OVER)
		await submit(user)
		expect(screen.getByTestId('balance-monthly-contribution-error')).toHaveTextContent(USD_MESSAGE)
		expect(useBalanceStore.getState().entries).toHaveLength(0)
	})

	it('accepts exactly the limit as a current balance', async () => {
		const user = await openBalanceForm()
		await typeInto(user, 'balance-current-balance-input', AT)
		await submit(user)
		expect(useBalanceStore.getState().entries.map((e) => e.currentBalance)).toEqual([
			MAX_MONEY_CENTS,
		])
	})

	it('accepts exactly the limit as an investment contribution', async () => {
		const user = await openBalanceForm()
		await typeInto(user, 'balance-current-balance-input', '1000')
		await typeInto(user, 'balance-monthly-contribution-input', AT)
		await submit(user)
		expect(useBalanceStore.getState().entries.map((e) => e.monthlyContribution)).toEqual([
			MAX_MONEY_CENTS,
		])
	})
})
