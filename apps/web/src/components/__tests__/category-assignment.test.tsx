/**
 * Category assignment on the income and expense pages (story 30.4b, AC-1/AC-3/AC-5).
 *
 * These are the wiring assertions the picker's own suite cannot make: that the
 * selection reaches the STORE, comes back when the row is re-opened for edit,
 * and shows up in the row's table listing — and that the locked picker inside
 * the real Add/Edit `<Modal>` opens no second dialog (AC-5, the one that is the
 * DEFAULT experience for every non-premium visitor).
 */

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
      ...overrides,
    } satisfies PremiumAccessStatus,
  })
}

const premium = () =>
  mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
const free = () =>
  mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
  return {
    userId: 0,
    profileId: null,
    name: 'Groceries',
    kind: 'expense',
    isDeleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function resetStores(): void {
  useCategoryStore.setState({ categories: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStores()
})

afterEach(() => {
  act(() => {
    resetStores()
  })
})

describe('IncomePage category assignment (AC-1)', () => {
  it('persists the chosen category to the row and shows it in the table', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
    await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    // The STORE holds the id...
    const [row] = useIncomeStore.getState().incomeSources
    expect(row?.categoryId).toBe('i1')
    // ...and the table shows the NAME, never the uuid.
    expect(screen.getByTestId('income-row-category')).toHaveTextContent('Employment')
    expect(screen.queryByText('i1')).not.toBeInTheDocument()
  })

  it('re-opens an edit form on the row’s existing category', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [
        category({ id: 'i1', name: 'Employment', kind: 'income' }),
        category({ id: 'i2', name: 'Dividends', kind: 'income' }),
      ],
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          categoryId: 'i2',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('i2')
  })

  it('does not carry the previous entry’s category into the next Add (found by mutation M32)', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    render(<IncomePage />)

    // First add: categorized.
    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    let dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
    await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    // Second add: the form must open back on Uncategorized. Without the reset the
    // picker still shows "Employment" and the next row silently inherits it —
    // the classic sticky-form-state defect, and invisible to every other test
    // here because they each add only ONE row.
    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')

    await user.type(within(dialog).getByTestId('income-name-input'), 'Bonus')
    await user.type(within(dialog).getByTestId('income-amount-input'), '100')
    await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

    const rows = useIncomeStore.getState().incomeSources
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.name === 'Bonus')?.categoryId).toBeNull()
  })

  it('clearing the category writes null, not the empty-string sentinel', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          categoryId: 'i1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    render(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Category'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBeNull()
    expect(screen.getByTestId('income-row-uncategorized')).toBeInTheDocument()
  })
})

describe('ExpensesPage category assignment (AC-1)', () => {
  it('persists the chosen category to the row and shows it in the table', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe('e1')
    expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
  })
})

describe('ExpensesPage EDIT round-trip — the sibling the first pass never tested', () => {
  // ⚠️ ADDED BY CODE REVIEW 30.4b. All three review layers independently found
  // that `ExpensesPage.openEditModal` never seeded `categoryId`, so every expense
  // edit silently wrote `null` over the row's category. The whole suite was green
  // because the edit round-trip was tested on IncomePage ONLY — the same
  // sibling-asymmetry axis that mutation M34 caught in the two pie charts, hit a
  // second time in one story. These mirror the income tests exactly.

  function seedCategorizedExpense(categoryId: string): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Tesco run',
          amount: 8000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  it('re-opens an edit form on the row’s existing category', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [
        category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
        category({ id: 'e2', name: 'Housing', kind: 'expense' }),
      ],
    })
    seedCategorizedExpense('e2')
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('e2')
  })

  it('an UNRELATED edit preserves the category — the HIGH defect this review caught', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    seedCategorizedExpense('e1')
    render(<ExpensesPage />)

    // Change ONLY the amount, never touching the picker, and save.
    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByTestId('expense-amount-input'))
    await user.type(within(dialog).getByTestId('expense-amount-input'), '95')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    const [row] = useExpenseStore.getState().expenses
    expect(row?.amount).toBe(9500)
    // The category MUST survive. Before the fix this was null.
    expect(row?.categoryId).toBe('e1')
    expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
  })

  it('clearing the category writes null, not the empty-string sentinel', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    seedCategorizedExpense('e1')
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Category'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBeNull()
    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
  })

  it('does not carry the previous entry’s category into the next Add', async () => {
    const user = userEvent.setup()
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    let dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')
  })
})

describe('a dangling reference in the table (AC-3)', () => {
  function seedExpenseRow(categoryId: string | null): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'row-1',
          userId: 0,
          name: 'Tesco run',
          amount: 8000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  it('CAUSE 1 (pull pagination): an id not yet on this device renders uncategorized', () => {
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e-other', name: 'Rent', kind: 'expense' })],
    })
    seedExpenseRow('e-not-yet-pulled')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toHaveTextContent('—')
    expect(screen.queryByText('e-not-yet-pulled')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-row-category')).not.toBeInTheDocument()
  })

  it('CAUSE 2 (deleted on another device): a removed category renders uncategorized', () => {
    premium()
    useCategoryStore.setState({ categories: [] })
    seedExpenseRow('e1')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
    expect(screen.queryByText('e1')).not.toBeInTheDocument()
  })

  it('CAUSE 3 (soft-deleted locally): a tombstoned category renders uncategorized', () => {
    premium()
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense', isDeleted: true })],
    })
    seedExpenseRow('e1')
    render(<ExpensesPage />)

    expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
    // The deleted category's NAME must not surface either.
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  })
})

describe('the free tier: a locked picker, and CRUD that still works (AC-4, AC-5)', () => {
  // ⚠️ Story 33.3 (FR57) REVERSED story 30.4b's decision here. 30.4b deliberately
  // let free users' income and expense tables carry a Category column that could
  // only ever render the "—" placeholder, and pinned that choice in a code-review
  // ruling. FR57 called it what it was — a feature advertised as a permanently
  // empty column — so the column is now absent entirely for the free tier.
  //
  // What AC-4 still promises is unchanged: their CRUD keeps working
  // uncategorized. The page is NOT byte-identical to the premium one.
  it('AC-5: clicking the locked picker inside the Add Expense modal opens NO second dialog', async () => {
    const user = userEvent.setup()
    free()
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    const locked = screen.getByTestId('expense-category-locked')
    await user.click(locked)

    // Modal.tsx assumes ONE modal at a time; a nested one breaks Escape handling
    // and restores the scroll lock out of order.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: /go premium/i })).not.toBeInTheDocument()
  })

  it('a free user can still add an expense, uncategorized, with no required field added', async () => {
    const user = userEvent.setup()
    free()
    render(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByTestId('expense-name-input'), 'Rent')
    await user.type(within(dialog).getByTestId('expense-amount-input'), '1200')
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

    const [row] = useExpenseStore.getState().expenses
    expect(row?.name).toBe('Rent')
    expect(row?.categoryId).toBeNull()
    // FR57 changes what the free tier SEES, never what is STORED — the row above
    // still round-trips a null categoryId. What changes is that neither category
    // rendering reaches the table.
    expect(screen.queryByTestId('expense-row-uncategorized')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-row-category')).not.toBeInTheDocument()
  })
})

/**
 * The Category column is Premium-only (story 33.3, FR57).
 *
 * ⚠️ Two coverage holes this suite exists to close, both measured during story
 * creation:
 *
 * 1. NOTHING in the repo asserted the `<th>` at all. The mobile card-label
 *    tests are scoped `within(row)`, so they only ever reached the per-cell
 *    <FieldLabel> span — never the header. A half-applied gate that dropped the
 *    header but kept the cell (or the reverse) skewed every column at >= 640px
 *    while staying green across all 1500 unit tests AND all 191 e2e tests.
 *    `expectColumnParity` is the fix.
 *
 * 2. The free tier's ABSENCE had no coverage: 30.4b's tests all ran under
 *    `premium()`, so only the positive was ever pinned.
 *
 * ⚠️ This is also the ONLY layer where the entitled branch can be proved at
 * all. The whole e2e suite is unauthenticated with no session seeding, so after
 * FR57 no Playwright run can render the 5-column table.
 *
 * ⚠️ Every assertion here is DOM presence/absence, never visibility. jsdom
 * applies no media queries, so every `max-sm:`/`sm:hidden` class is inert and a
 * width claim is meaningless at this layer — width lives in Playwright. Absence
 * is also the honest claim for a gate implemented as conditional JSX, and it is
 * what stops a CSS-class implementation (which would leak onto printed output)
 * from passing.
 */
describe('the Category column is Premium-only (story 33.3, FR57)', () => {
  function seedIncomeRow(categoryId: string | null): void {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  function seedExpenseRow(categoryId: string | null): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-1',
          userId: 0,
          name: 'Rent',
          amount: 150000,
          frequency: 'monthly',
          categoryId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  }

  /**
   * A table's header labels and every row's cell count.
   *
   * Returned together so the parity assertion cannot drift from the header
   * assertion — they are two readings of the same render.
   */
  function readTable(container: HTMLElement): { headers: string[]; cellCounts: number[] } {
    const table = container.querySelector('table')
    if (!table) throw new Error('no <table> rendered')
    return {
      headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? ''),
      cellCounts: [...table.querySelectorAll('tbody tr')].map(
        (tr) => tr.querySelectorAll('td').length
      ),
    }
  }

  function expectColumnParity(container: HTMLElement): void {
    const { headers, cellCounts } = readTable(container)
    expect(cellCounts.length).toBeGreaterThan(0)
    for (const count of cellCounts) {
      expect(count).toBe(headers.length)
    }
  }

  // Both pages, seeded identically, so a gate applied to one file and not the
  // other cannot hide. The `kind` differs only to keep the seeds realistic.
  const PAGES = [
    {
      name: 'IncomePage',
      render: () => render(<IncomePage />),
      seed: seedIncomeRow,
      readStoreRow: () => useIncomeStore.getState().incomeSources[0],
      rowName: 'Salary',
      prefix: 'income',
      categoryName: 'Employment',
      kind: 'income' as const,
      categoryId: 'i1',
    },
    {
      name: 'ExpensesPage',
      render: () => render(<ExpensesPage />),
      seed: seedExpenseRow,
      readStoreRow: () => useExpenseStore.getState().expenses[0],
      rowName: 'Rent',
      prefix: 'expense',
      categoryName: 'Groceries',
      kind: 'expense' as const,
      categoryId: 'e1',
    },
  ]

  // Every state the hook can be in.
  //
  // ⚠️ SCOPE OF WHAT THIS TABLE PROVES, stated precisely (code review 33.3
  // corrected an earlier comment here that overclaimed it). The hook is MOCKED,
  // so these rows prove one half of the chain: that the PAGE keys on
  // `hasAccess` alone and renders no column whenever it is false — which is why
  // `unresolved` and `errored` need no separate branch in the implementation.
  // They do NOT prove the other half, that the real hook actually yields
  // `hasAccess: false` in each of these states; mocking a hook cannot prove
  // anything about the hook.
  //
  // That half is pinned separately in `src/hooks/__tests__/usePremiumAccess.test.tsx`
  // for active / free / past_due / canceled / not-authenticated / signed-out /
  // no-seed. ⚠️ Two derivations are pinned in NEITHER place and rest on source
  // reading alone: the **errored** path and the **`lifetime`** mapping. Both are
  // currently correct (`usePremiumAccess.ts:68-85`, `:151-178`); both are a
  // pre-existing gap logged in `deferred-work.md`, not something this table
  // covers.
  const NOT_ENTITLED: { label: string; status: Partial<PremiumAccessStatus> }[] = [
    { label: 'free', status: { subscriptionStatus: 'free', isAuthenticated: true } },
    { label: 'past_due', status: { subscriptionStatus: 'past_due', isAuthenticated: true } },
    { label: 'canceled', status: { subscriptionStatus: 'canceled', isAuthenticated: true } },
    { label: 'unauthenticated', status: { subscriptionStatus: null, isAuthenticated: false } },
    { label: 'unresolved (isLoading)', status: { isLoading: true, subscriptionStatus: null } },
    {
      label: 'errored',
      status: { error: 'premium check failed', subscriptionStatus: null, isAuthenticated: false },
    },
  ]

  const ENTITLED: { label: string; status: Partial<PremiumAccessStatus> }[] = [
    { label: 'active', status: { hasAccess: true, subscriptionStatus: 'active' } },
    // `lifetime` is a real entitled state (story 25-2) and is easy to drop when
    // someone "simplifies" the gate to `status === 'active'`.
    { label: 'lifetime', status: { hasAccess: true, subscriptionStatus: 'lifetime' } },
  ]

  for (const page of PAGES) {
    describe(page.name, () => {
      for (const { label, status } of NOT_ENTITLED) {
        it(`renders no Category column for a ${label} user`, () => {
          mockStatus({ ...status, isAuthenticated: status.isAuthenticated ?? false })
          useCategoryStore.setState({
            categories: [
              category({ id: page.categoryId, name: page.categoryName, kind: page.kind }),
            ],
          })
          // Seeded WITH a resolvable category, so this cannot pass merely
          // because there was nothing to show.
          page.seed(page.categoryId)
          const { container } = page.render()

          const { headers } = readTable(container)
          expect(headers).toEqual(['Name', 'Amount', 'Frequency', 'Actions'])
          expect(screen.queryByTestId(`${page.prefix}-row-category`)).not.toBeInTheDocument()
          expect(screen.queryByTestId(`${page.prefix}-row-uncategorized`)).not.toBeInTheDocument()
          // The category NAME must not reach the page by any other route either.
          expect(screen.queryByText(page.categoryName)).not.toBeInTheDocument()
          expectColumnParity(container)
        })
      }

      for (const { label, status } of ENTITLED) {
        it(`renders the Category column for a ${label} user`, () => {
          mockStatus({ ...status, isAuthenticated: true })
          useCategoryStore.setState({
            categories: [
              category({ id: page.categoryId, name: page.categoryName, kind: page.kind }),
            ],
          })
          page.seed(page.categoryId)
          const { container } = page.render()

          const { headers } = readTable(container)
          expect(headers).toEqual(['Name', 'Amount', 'Frequency', 'Category', 'Actions'])
          expect(screen.getByTestId(`${page.prefix}-row-category`)).toHaveTextContent(
            page.categoryName
          )
          expectColumnParity(container)
        })
      }

      it('shows the em-dash placeholder to an entitled user with an uncategorized row', () => {
        premium()
        page.seed(null)
        const { container } = page.render()

        expect(screen.getByTestId(`${page.prefix}-row-uncategorized`)).toHaveTextContent('—')
        expectColumnParity(container)
      })

      it('keeps header and cell counts in lockstep across a tier change', () => {
        // The half-applied gate this guards against: gate the <th> but not the
        // <td> (or the reverse). Both renders below are parity-checked, so
        // either half-fix fails here even though every other test in the repo
        // stays green.
        page.seed(page.categoryId)

        free()
        const freeRender = page.render()
        const freeTable = readTable(freeRender.container)
        expectColumnParity(freeRender.container)
        freeRender.unmount()

        premium()
        const premiumRender = page.render()
        const premiumTable = readTable(premiumRender.container)
        expectColumnParity(premiumRender.container)

        // And the difference between the tiers is EXACTLY one column.
        expect(premiumTable.headers.length).toBe(freeTable.headers.length + 1)
      })
    })
  }

  // Named for what it actually checks. It is NOT the only test a one-file gate
  // fails — each page's own matrix catches that too, and more strictly (code
  // review 33.3 corrected an earlier name claiming exclusivity). What this adds
  // is both pages asserted in a SINGLE render pass under one tier, so a future
  // refactor that makes the two pages read tier differently shows up as one
  // obvious failure rather than two unrelated-looking ones.
  it('renders both pages under one tier state with neither showing a Category column', () => {
    free()
    // Seeded WITH resolvable categories, so this cannot pass on emptiness.
    useCategoryStore.setState({
      categories: [
        category({ id: 'i1', name: 'Employment', kind: 'income' }),
        category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
      ],
    })
    seedIncomeRow('i1')
    seedExpenseRow('e1')

    const income = render(<IncomePage />)
    expect(readTable(income.container).headers).not.toContain('Category')
    income.unmount()

    const expenses = render(<ExpensesPage />)
    expect(readTable(expenses.container).headers).not.toContain('Category')
  })

  /**
   * ⚠️⚠️ THE HIGHEST-CONSEQUENCE PROPERTY IN THIS STORY, AND IT WAS PINNED
   * NOWHERE UNTIL NOW (code review 33.3).
   *
   * A user who was premium, categorized their rows, then lapsed to
   * `canceled`/`past_due` keeps their `categoryId`s — they simply cannot see or
   * change them. Editing any other field on such a row MUST round-trip the
   * category untouched. Story 33.3 makes this strictly more dangerous than it
   * was before: the free user can no longer SEE the category, so a regression
   * that silently drops it is invisible to them.
   *
   * ⚠️ Every pre-existing test of this round-trip runs under `premium()`, where
   * a TIER-CONDITIONAL regression is inert. The code review measured the exact
   * hole: mutating `handleSubmit` to write
   * `categoryId: showCategoryColumn ? categoryId : null` — i.e. destroy the
   * assignment for precisely the users who cannot see it — passed the FULL
   * 1525-test suite GREEN, and is invisible to the unauthenticated e2e layer
   * too. These two tests are what close it. Do not delete them, and do not
   * "simplify" them to the premium tier.
   */
  for (const page of PAGES) {
    it(`preserves a lapsed user's category when they edit a ${page.name} row`, async () => {
      const user = userEvent.setup()
      // `canceled`, not `free`: this is the state that actually holds orphaned
      // assignments. A never-premium user has none to lose.
      mockStatus({ subscriptionStatus: 'canceled', isAuthenticated: true })
      useCategoryStore.setState({
        categories: [category({ id: page.categoryId, name: page.categoryName, kind: page.kind })],
      })
      page.seed(page.categoryId)
      const { container } = page.render()

      // Precondition: they genuinely cannot see the category they are about to
      // edit around. If this ever fails, the rest of the test is meaningless.
      expect(readTable(container).headers).not.toContain('Category')
      expect(screen.queryByTestId(`${page.prefix}-row-category`)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: `Edit ${page.rowName}` }))
      const dialog = screen.getByRole('dialog')
      // Edit an UNRELATED field, the way a lapsed user actually would.
      const amountInput = within(dialog).getByTestId(`${page.prefix}-amount-input`)
      await user.clear(amountInput)
      await user.type(amountInput, '4321')
      await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

      // The edit landed...
      const row = page.readStoreRow()
      expect(row?.amount).toBe(432100)
      // ...and the category they could not see survived it.
      expect(row?.categoryId).toBe(page.categoryId)
    })
  }
})
