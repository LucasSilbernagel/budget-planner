import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
/**
 * Story 106.1 (FR174): a money amount too large to sync is refused where it is
 * typed.
 *
 * Every synced money column is a Postgres `integer` (int32 cents), and core's
 * `syncOperationDataSchema` bounds each money field to 2,147,483,647. Before this
 * story no form capped the value, so 21,474,836.48 was SAVED on this device and
 * then refused at enqueue (`validateOperationData` throws, `syncBridge`'s
 * `onQueueError` only logs it): the row never reached the server, silently.
 *
 * Each page's form is the only production writer of its store (grep in the
 * story record), so refusing here means nothing over the limit is ever queued.
 */
import { MAX_MONEY_CENTS } from '@budget-planner/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** One cent over the limit, typed the way a user would. */
const OVER = '21474836.48'
/** Exactly the limit: accepted. */
const AT = '21474836.47'
/** The message in the default currency (USD, symbol mode). */
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
    // The page formats yen in its yen locale, which renders the FULLWIDTH yen
    // sign (U+FFE5); measured, not assumed.
    expect(screen.getByTestId('income-amount-error')).toHaveTextContent(
      'Enter an amount up to \uffe521,474,836'
    )
    expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
  })
})

describe('/expenses', () => {
  it('refuses one cent over the limit with a field error, and saves nothing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    await typeInto(user, 'expense-name-input', 'Mortgage')
    await typeInto(user, 'expense-amount-input', OVER)
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expense' })
    )
    expect(screen.getByTestId('expense-amount-error')).toHaveTextContent(USD_MESSAGE)
    expect(useExpenseStore.getState().expenses).toHaveLength(0)
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
})
