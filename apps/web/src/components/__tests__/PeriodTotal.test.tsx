/**
 * Income & Expenses headline-total tests (story 32.1, FR58).
 *
 * These are the page-level half of the FR58 fix: the store returns a
 * monthly-normalized figure, and these tests prove the PAGE re-expresses it at
 * the shared duration, labels the period, and agrees with the Overview.
 *
 * ⚠️ Every fixture is MIXED-FREQUENCY. At a single frequency the raw sum and the
 * normalized sum are equal, so a single-frequency fixture cannot tell a fixed
 * page from the broken one. Amounts are asserted as currency-less grouped
 * decimals because `vitest.setup.ts` pins `{ mode: 'none', currency: 'NONE' }`
 * — the product default is `$`/USD, which is what the e2e specs assert.
 */

import { act, fireEvent, renderWithProviders, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'

const base = {
  userId: 0,
  categoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * The epic's example: $200 weekly + $1,500 monthly + $600 annually.
 *   raw sum            = 230000c  (what the defect displayed)
 *   normalized monthly = 241667c  (86667 + 150000 + 5000)
 * Denormalized: weekly 55769 · biweekly 111539 · monthly 241667 · annually 2900004
 */
const MIXED_INCOME = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Side gig',
    amount: 20000,
    frequency: 'weekly' as const,
    ...base,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Salary',
    amount: 150000,
    frequency: 'monthly' as const,
    ...base,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Bonus',
    amount: 60000,
    frequency: 'annually' as const,
    ...base,
  },
]

/**
 * $50 weekly + $900 monthly + $1,200 annually.
 *   raw sum            = 215000c
 *   normalized monthly = 121667c  (21667 + 90000 + 10000)
 * Denormalized: weekly 28077 · biweekly 56154 · monthly 121667 · annually 1460004
 */
const MIXED_EXPENSES = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Groceries',
    amount: 5000,
    frequency: 'weekly' as const,
    ...base,
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    name: 'Rent',
    amount: 90000,
    frequency: 'monthly' as const,
    ...base,
  },
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    name: 'Insurance',
    amount: 120000,
    frequency: 'annually' as const,
    ...base,
  },
]

/** Period word inside each duration's label, so the zero-state loop asserts the
 *  label actually CHANGED rather than matching any period with a wildcard. */
const PERIOD_WORD: Record<'weekly' | 'biweekly' | 'monthly' | 'annually', string> = {
  weekly: 'week',
  biweekly: '2 weeks',
  monthly: 'month',
  annually: 'year',
}

const incomeSelector = () => screen.getByRole('combobox', { name: /show income per/i })
const expenseSelector = () => screen.getByRole('combobox', { name: /show expenses per/i })

/** The total card: the heading's parent, which also holds the amount. */
const totalCard = (labelPattern: RegExp): HTMLElement =>
  screen.getByRole('heading', { name: labelPattern }).parentElement as HTMLElement

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useOverviewDurationStore.setState({ duration: 'annually' })
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useOverviewDurationStore.setState({ duration: 'annually' })
})

describe('IncomePage — Total Income is frequency-correct and period-labelled (story 32.1)', () => {
  it('states the period in the visible label rather than leaving it implicit', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    renderWithProviders(<IncomePage />)

    expect(screen.getByRole('heading', { name: 'Total Income (per year)' })).toBeInTheDocument()
  })

  it('shows the frequency-normalized total, not the raw sum', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    useOverviewDurationStore.setState({ duration: 'monthly' })
    renderWithProviders(<IncomePage />)

    const card = totalCard(/^Total Income \(per month\)$/)
    // Normalized monthly = 241667c. The raw sum would render "2,300.00".
    expect(within(card).getByText('2,416.67')).toBeInTheDocument()
    expect(within(card).queryByText('2,300.00')).not.toBeInTheDocument()
  })

  it('re-expresses the total at every one of the four durations', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    renderWithProviders(<IncomePage />)

    // Annually is the default: 241667 × 12 = 2900004c.
    expect(within(totalCard(/per year/)).getByText('29,000.04')).toBeInTheDocument()

    fireEvent.change(incomeSelector(), { target: { value: 'monthly' } })
    expect(within(totalCard(/per month/)).getByText('2,416.67')).toBeInTheDocument()

    // round(241667 × 12/52) = 55769
    fireEvent.change(incomeSelector(), { target: { value: 'weekly' } })
    expect(within(totalCard(/per week/)).getByText('557.69')).toBeInTheDocument()

    // round(241667 × 12/26) = 111539
    fireEvent.change(incomeSelector(), { target: { value: 'biweekly' } })
    expect(within(totalCard(/per 2 weeks/)).getByText('1,115.39')).toBeInTheDocument()
  })

  it('offers all four entry frequencies as options', () => {
    renderWithProviders(<IncomePage />)

    const options = Array.from((incomeSelector() as HTMLSelectElement).options)
    expect(options.map((o) => o.value)).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
    expect(options.map((o) => o.textContent)).toEqual([
      'Weekly',
      'Bi-weekly',
      'Monthly',
      'Annually',
    ])
  })

  /**
   * ⚠️ Scope note (code review 32.1): zero denormalizes to zero at every duration,
   * so this can only prove "no NaN / no divide-by-zero at any of the four", NOT
   * that the denormalizer works — the four-duration cases in the tests above do
   * that. The `act()` wrapper matters: a bare `setState` on a mounted component
   * leaves the DOM stale, so the later iterations would assert against the first
   * render and pass for the wrong reason.
   */
  it('renders a zero total with no NaN at each of the four durations', () => {
    renderWithProviders(<IncomePage />)

    for (const duration of ['weekly', 'biweekly', 'monthly', 'annually'] as const) {
      act(() => {
        useOverviewDurationStore.setState({ duration })
      })
      const card = totalCard(new RegExp(`^Total Income \\(per ${PERIOD_WORD[duration]}\\)$`))
      expect(within(card).getByText('0.00')).toBeInTheDocument()
      expect(card.textContent).not.toMatch(/NaN/)
    }
  })

  it('discloses the conversion when it changed the figure', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    renderWithProviders(<IncomePage />)

    expect(
      screen.getByRole('button', { name: /more information about the income figure/i })
    ).toBeInTheDocument()
  })

  it('does NOT disclose when every row is already monthly (nothing was converted)', () => {
    useIncomeStore.setState({ incomeSources: [MIXED_INCOME[1]] })
    renderWithProviders(<IncomePage />)

    expect(
      screen.queryByRole('button', { name: /more information about the income figure/i })
    ).not.toBeInTheDocument()
  })

  /**
   * ⚠️ Code review 32.1: the original version of the test above was titled
   * "single-frequency data" but seeded the MONTHLY row — the one frequency where
   * raw and normalized coincide by identity. A weekly-only user is equally
   * "single-frequency" and IS converted, so the disclosure must appear.
   */
  it('DOES disclose for a single-frequency user whose one frequency is not monthly', () => {
    useIncomeStore.setState({ incomeSources: [MIXED_INCOME[0]] })
    renderWithProviders(<IncomePage />)

    expect(
      screen.getByRole('button', { name: /more information about the income figure/i })
    ).toBeInTheDocument()
  })

  /**
   * ⚠️ The false-negative the equality proxy used to have. $330 weekly + $1,200
   * annually normalizes to EXACTLY the raw sum:
   *   round(33000 × 52/12) = 143000, + round(120000/12) = 10000  -> 153000c
   *   raw                  = 33000 + 120000                      -> 153000c
   * Both rows were genuinely converted, so the explanation must still render.
   */
  it('DOES disclose when conversion lands coincidentally on the raw sum', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          ...base,
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Weekly',
          amount: 33000,
          frequency: 'weekly',
        },
        {
          ...base,
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Annual',
          amount: 120000,
          frequency: 'annually',
        },
      ],
    })
    useOverviewDurationStore.setState({ duration: 'monthly' })
    renderWithProviders(<IncomePage />)

    expect(within(totalCard(/per month/)).getByText('1,530.00')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /more information about the income figure/i })
    ).toBeInTheDocument()
  })
})

describe('ExpensesPage — Total Expenses is frequency-correct and period-labelled (story 32.1)', () => {
  it('shows the frequency-normalized total, not the raw sum', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })
    useOverviewDurationStore.setState({ duration: 'monthly' })
    renderWithProviders(<ExpensesPage />)

    const card = totalCard(/^Total Expenses \(per month\)$/)
    // Normalized monthly = 121667c. The raw sum would render "2,150.00".
    expect(within(card).getByText('1,216.67')).toBeInTheDocument()
    expect(within(card).queryByText('2,150.00')).not.toBeInTheDocument()
  })

  it('re-expresses the total at every one of the four durations', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })
    renderWithProviders(<ExpensesPage />)

    expect(within(totalCard(/per year/)).getByText('14,600.04')).toBeInTheDocument()

    fireEvent.change(expenseSelector(), { target: { value: 'monthly' } })
    expect(within(totalCard(/per month/)).getByText('1,216.67')).toBeInTheDocument()

    fireEvent.change(expenseSelector(), { target: { value: 'weekly' } })
    expect(within(totalCard(/per week/)).getByText('280.77')).toBeInTheDocument()

    fireEvent.change(expenseSelector(), { target: { value: 'biweekly' } })
    expect(within(totalCard(/per 2 weeks/)).getByText('561.54')).toBeInTheDocument()
  })
  /**
   * ⚠️ Code review 32.1: the disclosure and unreadable-row tests originally ran
   * against IncomePage only. ExpensesPage has its OWN wiring — a separate
   * `summarizeReadableRows` call and its own props — so a transposed argument
   * there would have shipped with every test green. "Mirror of the income suite"
   * was asserted in a comment; these assert it in code.
   */
  it('renders a zero total with no NaN when there are no rows', () => {
    renderWithProviders(<ExpensesPage />)

    const card = totalCard(/^Total Expenses \(per year\)$/)
    expect(within(card).getByText('0.00')).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/NaN/)
  })

  it('discloses the conversion when it changed the figure', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })
    renderWithProviders(<ExpensesPage />)

    expect(
      screen.getByRole('button', { name: /more information about the expenses figure/i })
    ).toBeInTheDocument()
  })

  it('does NOT disclose when every row is already monthly', () => {
    useExpenseStore.setState({ expenses: [MIXED_EXPENSES[1]] })
    renderWithProviders(<ExpensesPage />)

    expect(
      screen.queryByRole('button', { name: /more information about the expenses figure/i })
    ).not.toBeInTheDocument()
  })

  it('excludes and discloses an unreadable row', () => {
    useExpenseStore.setState({
      expenses: [
        MIXED_EXPENSES[1],
        {
          ...base,
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
        },
      ],
    })
    useOverviewDurationStore.setState({ duration: 'monthly' })
    renderWithProviders(<ExpensesPage />)

    // Only the readable $900 monthly row counts.
    expect(within(totalCard(/per month/)).getByText('900.00')).toBeInTheDocument()
    expect(screen.getByTestId('unreadable-rows-note')).toHaveTextContent(
      /1 entry could not be read and is not included/i
    )
  })
})

describe('the duration selection is one app-wide source of truth (story 32.1 AC-3)', () => {
  it('a change on the Income page is reflected on the Expenses page', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    const { unmount } = renderWithProviders(<IncomePage />)
    fireEvent.change(incomeSelector(), { target: { value: 'weekly' } })
    unmount()

    renderWithProviders(<ExpensesPage />)
    expect(screen.getByRole('heading', { name: 'Total Expenses (per week)' })).toBeInTheDocument()
    expect((expenseSelector() as HTMLSelectElement).value).toBe('weekly')
  })

  it('the selection survives a remount (it lives in the persisted store)', () => {
    const { unmount } = renderWithProviders(<IncomePage />)
    fireEvent.change(incomeSelector(), { target: { value: 'biweekly' } })
    unmount()

    renderWithProviders(<IncomePage />)
    expect((incomeSelector() as HTMLSelectElement).value).toBe('biweekly')
  })
})

describe('unreadable rows are excluded and disclosed, never silently dropped (story 32.1 AC-2)', () => {
  it('discloses the excluded row instead of under-reporting in silence', () => {
    useIncomeStore.setState({
      incomeSources: [
        MIXED_INCOME[1],
        {
          ...base,
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
        },
      ],
    })
    useOverviewDurationStore.setState({ duration: 'monthly' })
    renderWithProviders(<IncomePage />)

    expect(screen.getByTestId('unreadable-rows-note')).toHaveTextContent(
      /1 entry could not be read and is not included/i
    )
  })

  it('renders the page at all with a corrupt row (it used to be able to throw)', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          ...base,
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
        },
      ],
    })

    // Routing the total through core exposed `validateFrequency`, which throws.
    // Without the readable-rows guard this render white-screens the page.
    expect(() => renderWithProviders(<IncomePage />)).not.toThrow()
    expect(screen.getByRole('heading', { level: 1, name: 'Income Sources' })).toBeInTheDocument()
  })

  it('shows no disclosure when every row is readable', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })
    renderWithProviders(<IncomePage />)

    expect(screen.queryByTestId('unreadable-rows-note')).not.toBeInTheDocument()
  })
})
