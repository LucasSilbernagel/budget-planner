import { act, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { StoreHydration } from '../../lib/store-hydration'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../../stores/balanceStore'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import {
  TABLE_SORT_STORAGE_KEY,
  TABLE_SORT_VERSION,
  useTableSortStore,
} from '../../stores/tableSortStore'
import { renderAfterReload } from '../../test/reload-chain'
import { sortLiveRegion } from '../../test/sort-announcements'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

const premiumTier = vi.hoisted(() => ({
  status: {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  } as PremiumAccessStatus,
}))

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({ status: premiumTier.status }),
}))

function setTier(overrides: Partial<PremiumAccessStatus>): void {
  premiumTier.status = {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: true,
    ...overrides,
  }
}
const premium = () =>
  setTier({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
const free = () => setTier({})

/** Manual order (Zeta, Alpha, Mid, Beta) coincides with no other ordering in this file. */
const SEED = [
  { name: 'Zeta', amount: 600_00, frequency: 'annually' as const },
  { name: 'Alpha', amount: 500_00, frequency: 'monthly' as const },
  { name: 'Mid', amount: 500_00, frequency: 'monthly' as const },
  { name: 'Beta', amount: 100_00, frequency: 'weekly' as const },
]
const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']
const BY_NAME_ASC = ['Alpha', 'Beta', 'Mid', 'Zeta']

/** Distinct `createdAt`s so the manual tiebreaker cannot make an ordering assertion pass by accident. */
function seedIncome(): void {
  useIncomeStore.setState({ incomeSources: [] })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  for (const row of SEED) {
    useIncomeStore.getState().addIncomeSource(row)
    vi.advanceTimersByTime(1000)
  }
  vi.useRealTimers()
}

function seedExpenses(): void {
  useExpenseStore.setState({ expenses: [] })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  for (const row of SEED) {
    useExpenseStore.getState().addExpense(row)
    vi.advanceTimersByTime(1000)
  }
  vi.useRealTimers()
}

function renderedOrder(container?: HTMLElement): string[] {
  const scope = container ? within(container) : screen
  return scope
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent?.replace('Name', '').trim() ?? '')
}

/** Rows and sort must both start in localStorage, as in production, or the probe measures a fixture artifact. */
function persistIncomeToStorage(): void {
  const rows = useIncomeStore.getState().incomeSources
  // Order matters: `setState` writes through persist even under `skipHydration`, so clearing
  // after writing the blob would overwrite it with an empty array.
  useIncomeStore.setState({ incomeSources: [] })
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({ state: { incomeSources: rows }, version: 3 })
  )
}

function seedPersistedSort(sorts: Record<string, unknown>): void {
  localStorage.setItem(
    TABLE_SORT_STORAGE_KEY,
    JSON.stringify({
      state: { sorts: { income: null, expenses: null, savings: null, balance: null, ...sorts } },
      version: TABLE_SORT_VERSION,
    })
  )
}

beforeEach(() => {
  free()
  localStorage.clear()
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
})

const SAVINGS_SEED = [
  { name: 'Zeta', targetAmount: 900_00, currentBalance: 300_00 },
  { name: 'Alpha', targetAmount: null, currentBalance: 500_00 },
  { name: 'Mid', targetAmount: 400_00, currentBalance: 300_00 },
]

const BALANCE_SEED = [
  {
    type: 'investment' as const,
    name: 'Zeta',
    currentBalance: 300_00,
    monthlyContribution: 100_00,
    frequency: 'weekly' as const,
  },
  {
    type: 'debt' as const,
    name: 'Alpha',
    currentBalance: 500_00,
    monthlyContribution: 300_00,
    frequency: 'monthly' as const,
  },
  {
    type: 'investment' as const,
    name: 'Mid',
    currentBalance: 300_00,
    monthlyContribution: 50_00,
    frequency: 'annually' as const,
  },
]

function seedSavings(): void {
  useSavingsStore.setState({ savingsGoals: [] })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  for (const goal of SAVINGS_SEED) {
    useSavingsStore.getState().addSavingsGoal(goal)
    vi.advanceTimersByTime(1000)
  }
  vi.useRealTimers()
}

function seedBalance(): void {
  useBalanceStore.setState({ entries: [] })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  for (const entry of BALANCE_SEED) {
    useBalanceStore.getState().addBalanceEntry(entry)
    vi.advanceTimersByTime(1000)
  }
  vi.useRealTimers()
}

function namedOrder(names: readonly string[]): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => names.find((n) => within(row).queryByText(n)) ?? '')
}

/** If `effectiveState` were bypassed, the select would get an unmatched value and read `''`. */
function incomeSortControlValue(): string {
  return (screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement).value
}

describe('Savings and Balance persist their own sorts (AC-8)', () => {
  const NAMES = ['Zeta', 'Alpha', 'Mid']
  const MANUAL = ['Zeta', 'Alpha', 'Mid']
  const BY_NAME = ['Alpha', 'Mid', 'Zeta']

  it('Savings opens sorted by its OWN persisted slice', async () => {
    seedSavings()
    seedPersistedSort({ savings: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<SavingsPage />)
    expect(namedOrder(NAMES)).toEqual(BY_NAME)
  })

  it('Savings ignores a sort stored for another table', async () => {
    seedSavings()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<SavingsPage />)
    expect(namedOrder(NAMES)).toEqual(MANUAL)
  })

  it('Balance opens sorted by its OWN persisted slice', async () => {
    seedBalance()
    seedPersistedSort({ balance: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<BalancePage />)
    expect(namedOrder(NAMES)).toEqual(BY_NAME)
  })

  it('Balance ignores a sort stored for another table', async () => {
    seedBalance()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<BalancePage />)
    expect(namedOrder(NAMES)).toEqual(MANUAL)
  })
})

describe('a persisted sort is applied on a fresh mount (AC-1)', () => {
  it('opens sorted by the persisted column and direction', async () => {
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('opens sorted DESCENDING when that is what was stored', async () => {
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'desc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual([...BY_NAME_ASC].reverse())
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
  })

  it('opens in manual order when nothing is stored', async () => {
    seedIncome()
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })
})

describe('the sort is scoped to one table (AC-4)', () => {
  it('a stored Income sort does not reorder Expenses', async () => {
    seedIncome()
    seedExpenses()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    const income = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    income.unmount()

    renderWithProviders(<ExpensesPage />)

    // The scoping claim lives on the OTHER table: asserting only Income stays green under a shared key.
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })

  it('two tables hold two different sorts at once', async () => {
    seedIncome()
    seedExpenses()
    seedPersistedSort({
      income: { key: 'name', direction: 'asc' },
      expenses: { key: 'name', direction: 'desc' },
    })
    await useTableSortStore.persist.rehydrate()

    const income = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    income.unmount()

    renderWithProviders(<ExpensesPage />)
    expect(renderedOrder()).toEqual([...BY_NAME_ASC].reverse())
  })
})

describe('clearing returns to manual order, and the manual order survives (AC-2, AC-3)', () => {
  it('clearing a persisted sort restores the manual order', async () => {
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    const view = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)

    useTableSortStore.getState().clearTableSort('income')
    view.rerender(<IncomePage />)

    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })

  it('a persisted sort NEVER rewrites sortOrder (AC-2)', async () => {
    seedIncome()
    const before = useIncomeStore.getState().incomeSources.map((r) => [r.name, r.sortOrder])

    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()
    renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)

    const after = useIncomeStore.getState().incomeSources.map((r) => [r.name, r.sortOrder])
    expect(after).toEqual(before)
    expect(after.map(([, order]) => order)).toEqual([0, 1, 2, 3])
  })

  // Not a persistence test: after `rehydrate()` the sort lives in the singleton store, so a
  // remount never touches storage.
  it('the sort outlives the component (state is not component-local)', async () => {
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    const first = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    first.unmount()

    renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)
  })
})

describe('a rehydrated sort enqueues no sync operation (AC-2)', () => {
  it('is inert on a PAID session', async () => {
    // Seed BEFORE registering: `seedIncome()` legitimately enqueues four creates.
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })

    const spies = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(spies)
    try {
      await useTableSortStore.persist.rehydrate()

      renderWithProviders(<IncomePage />)
      expect(renderedOrder()).toEqual(BY_NAME_ASC)

      expect(spies.queueCreate).not.toHaveBeenCalled()
      expect(spies.queueUpdate).not.toHaveBeenCalled()
      expect(spies.queueDelete).not.toHaveBeenCalled()
    } finally {
      clearSyncBridge()
    }
  })
})

describe('a persisted sort on the Premium-only Category column (AC-6)', () => {
  function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
    return {
      userId: 0,
      profileId: null,
      name: 'Groceries',
      kind: 'income',
      isDeleted: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  function seedCategories(): void {
    useCategoryStore.setState({
      categories: [
        category({ id: 'cat-1', name: 'Zulu' }),
        category({ id: 'cat-2', name: 'Alfa' }),
      ],
    })
    const rows = useIncomeStore.getState().incomeSources
    useIncomeStore.setState({
      incomeSources: rows.map((row, i) => ({
        ...row,
        categoryId: i % 2 === 0 ? 'cat-1' : 'cat-2',
      })),
    })
  }

  it('an ENTITLED user opens sorted by Category', async () => {
    premium()
    seedIncome()
    seedCategories()
    seedPersistedSort({ income: { key: 'category', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])
    expect(screen.getByRole('columnheader', { name: 'Category' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('an UNENTITLED user opens in manual order with a live way out', async () => {
    // A persisted key reaches this on a fresh mount: sort as Premium, lapse, reload.
    free()
    seedIncome()
    seedCategories()
    seedPersistedSort({ income: { key: 'category', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    // Drive the UI from the effective state, not the raw stored value, or a free user is stranded
    // in a sort they cannot see.
    expect(incomeSortControlValue()).toBe('manual')
  })

  it('leaves the stored Category sort in place so it returns with entitlement', async () => {
    free()
    seedIncome()
    seedCategories()
    seedPersistedSort({ income: { key: 'category', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    const view = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(MANUAL_ORDER)

    expect(useTableSortStore.getState().sorts.income).toEqual({
      key: 'category',
      direction: 'asc',
    })
    // Check storage too: a clearing write that skipped persist would lose the sort on the next load.
    const raw = JSON.parse(localStorage.getItem(TABLE_SORT_STORAGE_KEY) as string)
    expect(raw.state.sorts.income).toEqual({ key: 'category', direction: 'asc' })

    premium()
    view.rerender(<IncomePage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])
  })
})

describe('a persisted key that names a PROTOTYPE member (AC-5)', () => {
  /** `extractors[key]` walks the prototype chain, so a persisted `'toString'` must still degrade. */
  const PROTOTYPE_KEYS = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']

  it.each(PROTOTYPE_KEYS)('degrades a persisted %s key to manual order', async (key) => {
    seedIncome()
    seedPersistedSort({ income: { key, direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    expect(incomeSortControlValue()).toBe('manual')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
  })

  it('still renders a real sort, so the guard is not just rejecting everything', async () => {
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(BY_NAME_ASC)
  })
})

describe('no first-paint flash from manual order into the persisted sort (AC-10)', () => {
  /**
   * RTL flushes effects before any assertion, hiding a flash. `Profiler.onRender` fires per commit,
   * so the first commit containing a table must already be sorted.
   */
  async function recordCommits(ui: React.ReactElement): Promise<string[][]> {
    const orders: string[][] = []
    const onRender: ProfilerOnRenderCallback = () => {
      const table = document.querySelector('table')
      if (table === null) {
        return
      }
      orders.push(
        [...table.querySelectorAll('tbody tr')].map(
          (row) => row.querySelector('td')?.textContent?.replace('Name', '').trim() ?? ''
        )
      )
    }
    renderWithProviders(
      <Profiler id="table-sort-flash" onRender={onRender}>
        <StoreHydration />
        {ui}
      </Profiler>
    )
    // `persist.rehydrate()` resolves on a microtask; without this flush the probe records nothing.
    await act(async () => {
      await Promise.resolve()
    })
    return orders
  }

  it('never commits the manual order before the persisted sort', async () => {
    seedIncome()
    persistIncomeToStorage()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })

    const orders = await recordCommits(<IncomePage />)

    expect(orders.length).toBeGreaterThan(0)
    expect(orders[0], 'the first commit that shows a table must already be sorted').toEqual(
      BY_NAME_ASC
    )
    // Only commits up to the microtask flush are witnessed; a macrotask re-order would be missed.
    for (const order of orders) {
      expect(order).toEqual(BY_NAME_ASC)
    }
  })

  it('the probe can SEE a manual-order commit when there is one', async () => {
    seedIncome()
    persistIncomeToStorage()

    const orders = await recordCommits(<IncomePage />)

    expect(orders.length).toBeGreaterThan(0)
    expect(orders[0]).toEqual(MANUAL_ORDER)
  })
})

/** These start from a real click or choice and cross the reload chain, so they cover the write half. */
describe('a sort survives the reload chain (was e2e, story 84.5)', () => {
  function nameHeader(): HTMLElement {
    return screen.getByRole('columnheader', { name: 'Name' })
  }
  async function clickName(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(within(nameHeader()).getByRole('button', { name: 'Name' }))
  }

  it('a header sort survives (was e2e table-sort-persistence:120, :161)', async () => {
    const user = userEvent.setup()
    seedIncome()
    renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(MANUAL_ORDER)

    await clickName(user)
    expect(renderedOrder()).toEqual(BY_NAME_ASC)

    await renderAfterReload(<IncomePage />)

    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('a restored sort is DESCRIBED on the header but never ANNOUNCED (story 120.1, D2)', async () => {
    // The live region speaks only for a header click in this mount; a restored sort stays silent.
    const user = userEvent.setup()
    seedIncome()
    renderWithProviders(<IncomePage />)
    await clickName(user)
    expect(sortLiveRegion().textContent).toBe('Sorted by Name, ascending')

    await renderAfterReload(<IncomePage />)

    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')
    expect(within(nameHeader()).getByRole('button', { name: 'Name' })).toHaveAccessibleDescription(
      'Sortable column, sorted ascending'
    )
    expect(sortLiveRegion().textContent).toBe('')
  })

  it('the DIRECTION survives, not just the column (was e2e table-sort-persistence:141)', async () => {
    const user = userEvent.setup()
    seedIncome()
    renderWithProviders(<IncomePage />)
    await clickName(user)
    await clickName(user)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'descending')

    await renderAfterReload(<IncomePage />)

    expect(nameHeader()).toHaveAttribute('aria-sort', 'descending')
    expect(renderedOrder()).toEqual([...BY_NAME_ASC].reverse())
  })

  it('a CLEARED sort stays cleared while a sibling table keeps its sort (was e2e table-sort-persistence:176)', async () => {
    // The sibling is the falsifier: on Income alone, "cleared" and "never stored" look identical.
    const user = userEvent.setup()
    seedIncome()
    seedExpenses()
    const income = renderWithProviders(<IncomePage />)
    await clickName(user)
    await clickName(user)
    await clickName(user)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'none')
    income.unmount()

    renderWithProviders(<ExpensesPage />)
    await clickName(user)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')

    await renderAfterReload(<ExpensesPage />)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')

    await renderAfterReload(<IncomePage />)
    expect(nameHeader()).toHaveAttribute('aria-sort', 'none')
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
  })

  it('a sort chosen from the MOBILE control survives (was e2e mobile-table-sort:260)', async () => {
    const user = userEvent.setup()
    seedIncome()
    renderWithProviders(<IncomePage />)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort income sources' }),
      'amount:desc'
    )
    const sorted = renderedOrder()
    expect(sorted).not.toEqual(MANUAL_ORDER)

    await renderAfterReload(<IncomePage />)

    expect(incomeSortControlValue()).toBe('amount:desc')
    expect(renderedOrder()).toEqual(sorted)
  })

  it('a stored payload that is not a sort at all opens in manual order (was e2e table-sort-persistence:252)', async () => {
    // A bare string where a `{ key, direction }` object belongs, at the current version so `migrate`
    // never sees it.
    seedIncome()
    localStorage.setItem(
      TABLE_SORT_STORAGE_KEY,
      JSON.stringify({ state: { sorts: { income: 'amount' } }, version: TABLE_SORT_VERSION })
    )

    await renderAfterReload(<IncomePage />)

    expect(nameHeader()).toHaveAttribute('aria-sort', 'none')
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    expect(screen.getAllByRole('button', { name: /^Edit / }).length).toBeGreaterThan(0)
  })
})
