import { act, renderWithProviders, screen, within } from '@/test/utils'
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
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

/**
 * A column sort that SURVIVES the page (Story 42.1, FR67).
 *
 * These are the claims the existing 34.2 suites cannot make. Every sort test in
 * `IncomePage.test.tsx` and its three siblings starts from an unsorted table and
 * activates a header — none of them begins with a sort already in storage,
 * because before this story none could exist. The paths below are reachable only
 * now:
 *
 *   - a FRESH MOUNT that opens already sorted (AC-1);
 *   - a fresh mount holding a sort for a column this user's tier cannot see,
 *     which before was reachable only by a tier flip WITHIN one mount (AC-6);
 *   - a table's sort leaking into a sibling table (AC-4);
 *   - a first paint that shows manual order and then re-orders (AC-10).
 */

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

/**
 * Four rows whose manual order coincides with NO other ordering in this file.
 *
 * manual:    Zeta, Alpha, Mid, Beta
 * by name:   Alpha, Beta, Mid, Zeta
 * by amount: Beta, Alpha, Mid, Zeta   (normalized; Alpha and Mid tie)
 */
const SEED = [
  { name: 'Zeta', amount: 600_00, frequency: 'annually' as const },
  { name: 'Alpha', amount: 500_00, frequency: 'monthly' as const },
  { name: 'Mid', amount: 500_00, frequency: 'monthly' as const },
  { name: 'Beta', amount: 100_00, frequency: 'weekly' as const },
]
const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']
const BY_NAME_ASC = ['Alpha', 'Beta', 'Mid', 'Zeta']

/** Seed rows with distinct `createdAt`s so the manual tiebreaker cannot make an
 * ordering assertion pass by accident (34.1a M10, 34.1b M6). */
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

/** Rendered row names, top to bottom. */
function renderedOrder(container?: HTMLElement): string[] {
  const scope = container ? within(container) : screen
  return scope
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent?.replace('Name', '').trim() ?? '')
}

/**
 * Move the seeded income rows OUT of memory and into localStorage.
 *
 * ⚠️ Load-bearing for the AC-10 probe. In production the rows and the sort both
 * start in localStorage and rehydrate in the SAME `StoreHydration` pass. A probe
 * that seeds the rows in memory but the sort in storage invents an asymmetry
 * that cannot occur, and measures a "flash" that is an artifact of the fixture.
 */
function persistIncomeToStorage(): void {
  const rows = useIncomeStore.getState().incomeSources
  // ⚠️ ORDER IS LOAD-BEARING: clear memory FIRST, then write the blob.
  // `setState` goes through zustand's persist WRITE path even under
  // `skipHydration` (which skips only the initial READ), so clearing after the
  // write silently overwrites the blob with an empty array — measured here, and
  // the same shape epic 22 recorded.
  useIncomeStore.setState({ incomeSources: [] })
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({ state: { incomeSources: rows }, version: 3 })
  )
}

/** Write a persisted sort blob directly, bypassing the store's own writer. */
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

/**
 * Savings and Balance carry the SAME persistence wiring and, until review, had
 * no rendered-table coverage at any layer — only store-shape tests.
 *
 * ⚠️ That is precisely AC-8's named failure ("not one tested and three
 * assumed"): a wrong `tableId` at `SavingsPage.tsx:222` or `BalancePage.tsx:144`
 * — say `'income'` pasted from its sibling — reddened NO test. The e2e suite
 * covers Income and Expenses; these two close the other half here, where the
 * stores can be seeded directly.
 */
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
    maxContributionLimit: 900_00,
    monthlyContribution: 100_00,
    frequency: 'weekly' as const,
  },
  {
    type: 'debt' as const,
    name: 'Alpha',
    currentBalance: -500_00,
    monthlyContribution: 300_00,
    frequency: 'monthly' as const,
  },
  {
    type: 'investment' as const,
    name: 'Mid',
    currentBalance: 300_00,
    maxContributionLimit: 400_00,
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

/** Row names top to bottom, matched by seeded name — these two pages carry a
 * badge in the name cell, so the whole cell's text is not the name. */
function namedOrder(names: readonly string[]): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => names.find((n) => within(row).queryByText(n)) ?? '')
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
    // The wrong-`tableId` mutation: if SavingsPage read `'income'`, this reddens.
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

    // No header was activated in this test. The order can only come from storage.
    expect(renderedOrder()).toEqual(BY_NAME_ASC)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('opens sorted DESCENDING when that is what was stored', async () => {
    // The direction is half the claim. A guard that only ever stores `asc` is
    // satisfied by an implementation that hard-codes it.
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
    // The positive control for the two above: without it, an implementation that
    // always sorted by name would satisfy them both.
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

    // ⚠️ The scoping claim lives HERE, on the OTHER table. Asserting only that
    // Income is sorted stays green under a single shared storage key.
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

    // The projection is a VIEW. `lib/ordering.ts` still owns the manual order and
    // this story must not have touched a single `sortOrder`.
    const after = useIncomeStore.getState().incomeSources.map((r) => [r.name, r.sortOrder])
    expect(after).toEqual(before)
    expect(after.map(([, order]) => order)).toEqual([0, 1, 2, 3])
  })

  // ⚠️ NOT a persistence test, and deliberately not titled as one. After an
  // explicit `rehydrate()` the sort lives in the module-singleton store, so an
  // unmount/remount never touches storage — this stays GREEN with persistence
  // entirely dead. It pins that the state outlives the COMPONENT; the e2e
  // reload specs are the only layer that can pin storage.
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
    // ⚠️ REGISTERED, not left unregistered — a spy handed to nobody can never be
    // called, so `not.toHaveBeenCalled()` could not fail (the tautology story
    // 34.1b's review caught). And PAID, because that is the tier with a sync path.
    // The live-toggle case is already covered in `IncomePage.test.tsx`; this is
    // the REHYDRATED case, which only exists since sort became persistent.
    // ⚠️ Seed BEFORE registering. `seedIncome()` adds four rows through the real
    // store action, which legitimately enqueues four creates — registering first
    // counts those against the sort and the test fails for the wrong reason
    // (measured: 4 calls).
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
    // The positive control. Without it, "unentitled sees manual order" is also
    // satisfied by a build where the Category sort never works at all.
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

  it('an UNENTITLED user opens in manual order with the arrows live', async () => {
    // ⚠️ The path story 42.1 created. `IncomePage.test.tsx`'s existing degrade
    // test flips entitlement inside ONE mount and is explicitly annotated as
    // unreachable in production; a persisted key reaches this state on a FRESH
    // mount, which is entirely reachable — sort as Premium, lapse, reload.
    free()
    seedIncome()
    seedCategories()
    seedPersistedSort({ income: { key: 'category', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    // ⚠️ The trap this pins: wire `RowMoveControls` to the RAW stored value
    // instead of the effective state and these arrows are dead for a free user,
    // with no way to revive them — the only reset control is `sm:hidden`.
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    // And no "Sorted by undefined" notice: `SORT_COLUMN_LABELS` has no entry for
    // a column this render does not have.
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
  })

  it('leaves the stored Category sort in place so it returns with entitlement', async () => {
    free()
    seedIncome()
    seedCategories()
    seedPersistedSort({ income: { key: 'category', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    const view = renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(MANUAL_ORDER)

    // The degradation is a DERIVATION, not a write. Nothing cleared the value.
    expect(useTableSortStore.getState().sorts.income).toEqual({
      key: 'category',
      direction: 'asc',
    })
    // ⚠️ And in STORAGE, which is what the AC actually names — in-memory state is
    // a proxy, and a clearing write that happened to skip the persist path would
    // satisfy the proxy while losing the user's sort on the next load.
    const raw = JSON.parse(localStorage.getItem(TABLE_SORT_STORAGE_KEY) as string)
    expect(raw.state.sorts.income).toEqual({ key: 'category', direction: 'asc' })

    premium()
    view.rerender(<IncomePage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])
  })
})

describe('a persisted key that names a PROTOTYPE member (AC-5)', () => {
  /**
   * ⚠️ Found in review, and it was a real no-exit crash.
   *
   * `coerceSortState` validates SHAPE and deliberately accepts any non-empty
   * string key — resolving a column is the hook's job. But the hook resolved it
   * with a bare `extractors[key]`, which walks the PROTOTYPE CHAIN: `'toString'`
   * returns `Object.prototype.toString`, a function, not `undefined`. The
   * degradation therefore did not fire. Measured before the fix: the notice
   * rendered, every move arrow went `aria-disabled="true"` with no reset control
   * below `sm`, and React rejected `SORT_COLUMN_LABELS['toString']` with
   * "Functions are not valid as a React child".
   *
   * Unreachable before this story — a header can only emit a real column key.
   * Persisting the key is what made it reachable.
   */
  const PROTOTYPE_KEYS = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']

  it.each(PROTOTYPE_KEYS)('degrades a persisted %s key to manual order', async (key) => {
    seedIncome()
    seedPersistedSort({ income: { key, direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    // The three symptoms of the no-exit state, each asserted separately.
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
  })

  it('still renders a real sort, so the guard is not just rejecting everything', async () => {
    // The positive control. Without it, an implementation that treats EVERY
    // persisted key as unresolvable satisfies all five cases above.
    seedIncome()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })
    await useTableSortStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)

    expect(renderedOrder()).toEqual(BY_NAME_ASC)
  })
})

describe('no first-paint flash from manual order into the persisted sort (AC-10)', () => {
  /**
   * ⚠️ WHY A PROFILER AND NOT A PLAIN ASSERTION.
   *
   * React Testing Library renders inside `act` and every `findBy*` awaits, so by
   * the time any ordinary assertion runs the effects have flushed and the table
   * is already sorted. An RTL test therefore CANNOT distinguish "sorted from the
   * first paint" from "painted manual, then re-ordered" — story 41.3 measured
   * exactly that blindness against a real flash.
   *
   * `Profiler.onRender` fires once per COMMIT, after the DOM is mutated, so it
   * observes the intermediate committed states `act` otherwise hides. We record
   * the row order at every commit and assert the FIRST commit that contains a
   * table is already sorted.
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
    // `persist.rehydrate()` resolves on a MICROTASK even for synchronous
    // storage, so the commit that first shows the table happens after the
    // synchronous render returns. Without this flush the probe records nothing
    // and every assertion below passes vacuously on an empty array — which is
    // why `orders.length` is asserted before its contents.
    await act(async () => {
      await Promise.resolve()
    })
    return orders
  }

  it('never commits the manual order before the persisted sort', async () => {
    seedIncome()
    persistIncomeToStorage()
    seedPersistedSort({ income: { key: 'name', direction: 'asc' } })

    // NOT pre-rehydrated: `StoreHydration` does it in an effect, exactly as the
    // real app does, so the commit sequence here is the real one.
    const orders = await recordCommits(<IncomePage />)

    expect(orders.length).toBeGreaterThan(0)
    expect(orders[0], 'the first commit that shows a table must already be sorted').toEqual(
      BY_NAME_ASC
    )
    // Every commit the probe WITNESSED — which is those up to the single
    // microtask flush above, not every commit for all time. A re-order scheduled
    // in a macrotask would land after recording stops; that window is the honest
    // limit of this probe, and the e2e layer is where a later flash would show.
    for (const order of orders) {
      expect(order).toEqual(BY_NAME_ASC)
    }
  })

  it('the probe can SEE a manual-order commit when there is one', async () => {
    // The positive control. Without it the assertion above is satisfied by a
    // probe that records nothing, or one that only ever sees post-sort commits.
    seedIncome()
    persistIncomeToStorage()

    const orders = await recordCommits(<IncomePage />)

    expect(orders.length).toBeGreaterThan(0)
    expect(orders[0]).toEqual(MANUAL_ORDER)
  })
})
