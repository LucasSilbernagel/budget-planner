import { renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * An expense marked as ending before retirement reaches the planner, through
 * storage (was `e2e/ends-before-retirement.spec.ts:83`, story 65.2 FR101 AC-15;
 * moved by story 84.5, FR137).
 *
 * ⚠️ The claim is the LOOP for a free, signed-out user whose data never leaves
 * the browser: the tick is entered on one page, written through zustand-persist,
 * and a DIFFERENT page reads it back and derives a figure. A plain two-component
 * render shares the module singleton and passes with nothing written at all, so
 * every hop here crosses the reload chain (`test/reload-chain.tsx`).
 *
 * ⚠️ Drives the REAL Add Expense form, as the e2e original did: seeding the store
 * would skip `handleSubmit` and `toClientExpense`, the two places this field can
 * be dropped on the way in.
 *
 * The browser re-reading storage on a real reload is the named D2 loss.
 * ⚠️ Figures carry `$`, and the cause is `reset()`'s `localStorage.clear()`
 * (84.5 code review, MEASURED: without it the figures are currency-less):
 * `vitest.setup.ts` pins the currency store to currency-less with a `setState`,
 * which also writes that pin to storage; the clear deletes it, so the reload
 * chain rehydrates the currency store from NOTHING and it stays at its initial
 * state, the product default `$`/USD (FR38). A reload-chain test that keeps the
 * setup's storage stays currency-less.
 */

const LABEL = 'This expense ends before I retire'

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

describe('a marked expense reaches the retirement planner through storage (was e2e, story 84.5)', () => {
  beforeEach(reset)
  afterEach(reset)

  it('is marked on the Expenses page, survives a reload, and drives an adoptable figure (was e2e ends-before-retirement:83)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await addExpense(user, 'Mortgage', '1800', true)
    await addExpense(user, 'Groceries', '2400', false)
    expect(screen.getAllByTestId('expense-row-ends-before-retirement')).toHaveLength(1)

    // A RELOAD of the Expenses page: storage must be the carrier.
    await renderAfterReload(<ExpensesPage />)
    expect(screen.getAllByTestId('expense-row-ends-before-retirement')).toHaveLength(1)
    expect(screen.getByTestId('expense-row-ends-before-retirement')).toHaveTextContent(
      'Ends before retirement'
    )

    // A DIFFERENT page, reading the flag back out of storage. The default basis
    // is annual: $1,800/mo marked × 12, and $4,200/mo × 12.
    await renderAfterReload(<RetirementAccumulationPlanner />)
    expect(hint()).toContain("You've marked $21,600.00 a year as ending before retirement")
    expect(hint()).toContain('Your expenses today are $50,400.00 a year')

    await user.selectOptions(screen.getByLabelText('Income period'), 'monthly')
    expect(hint()).toContain("You've marked $1,800.00 a month as ending before retirement")
    expect(hint()).toContain('Your expenses today are $4,200.00 a month')

    // SUGGEST, NEVER OVERWRITE: no income rows, so no prefill, so empty until
    // the user acts.
    const desired = () => screen.getByLabelText('Desired Retirement Income')
    expect(desired()).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Use this figure' }))
    expect(desired()).toHaveValue('2,400.00')

    // And the adopted value survives a reload: adopting marks the field authored.
    await renderAfterReload(<RetirementAccumulationPlanner />)
    expect(desired()).toHaveValue('2,400.00')
  })
})
