/**
 * Store-rehydration loading states (story 38.2, UX-DR43).
 *
 * ## What this file proves
 *
 * Three renders of the same surface must be three DIFFERENT things:
 *   - **pending**  — the store has not rehydrated; a skeleton, never a figure
 *                    and never "you have nothing yet"
 *   - **resolved with data** — the user's real figure
 *   - **resolved empty**     — the genuine empty state
 *
 * ## ⚠️ Why the pending arm uses `renderToString`, not `render`
 *
 * The gate is a mount gate (`useStoresHydrated`), so RTL's `render()` — which
 * flushes effects inside `act` — resolves it before any assertion can see it.
 * That is a FEATURE (it is why the other ~28 page test files still pass), but it
 * means the pending state is unobservable through `render()`.
 *
 * `renderToString` is the honest observer: it is literally what the server emits,
 * it runs no effects, and React resolves every `useSyncExternalStore` through
 * `getServerSnapshot` — i.e. each store's `getInitialState`. That last part
 * matters: the pending arm CANNOT be faked by seeding a store, because the seed
 * is invisible to it. Measured at `d66c821` before this story: the server HTML
 * for `/` carried `$0.00` in all three cards plus "Let's set up your budget",
 * for a user with five years of data.
 */

import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { __resetStoresHydratedForTests } from '../../hooks/useStoresHydrated'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { HomePage } from '../HomePage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'

function resolvedFreeTier(): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      isLoading: false,
      error: null,
      subscriptionStatus: null,
    } satisfies Partial<PremiumAccessStatus> as PremiumAccessStatus,
    checkAccess: vi.fn(),
    refresh: vi.fn(),
  })
}

function seedSavings(): void {
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 300_000,
        allocationMode: 'manual',
        monthlyAllocation: 20_000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
}

function clearStores(): void {
  useSavingsStore.setState({ savingsGoals: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
}

describe('Overview loading state (story 38.2)', () => {
  beforeEach(() => {
    // ⚠️ MANDATORY when a file mixes `render()` with `renderToString()`.
    // `render()` flushes effects and so sets the hook's module-level
    // "already hydrated on this client" flag; without this reset a later
    // `renderToString()` starts RESOLVED and every pending assertion fails for a
    // reason unrelated to the code under test. Order-dependent, so prevented
    // rather than debugged.
    __resetStoresHydratedForTests()
    resolvedFreeTier()
    clearStores()
  })

  it('PENDING: the server render shows a skeleton, not a figure and not the onboarding copy', () => {
    // Seeded on purpose: the assertion must hold for a user WITH data, and the
    // seed is invisible to `getServerSnapshot` either way.
    seedSavings()

    const html = renderToString(<HomePage />)

    expect(html).toContain('overview-net-worth-skeleton')
    expect(html).toContain('overview-total-income-skeleton')
    expect(html).toContain('overview-total-expenses-skeleton')
    // The confident zero, in both its forms.
    expect(html).not.toContain('$0.00')
    expect(html).not.toContain('set up your budget')
  })

  it('RESOLVED WITH DATA: the real figure, no skeleton', () => {
    seedSavings()

    render(<HomePage />)

    // vitest.setup pins the currency-less baseline, so no symbol here.
    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('3,000.00')
    expect(screen.queryByTestId('overview-net-worth-skeleton')).not.toBeInTheDocument()
  })

  it('RESOLVED EMPTY: the genuine empty state, no skeleton — this is the arm that catches "skeleton forever"', () => {
    render(<HomePage />)

    expect(screen.getByText(/set up your budget/i)).toBeInTheDocument()
    expect(screen.queryByTestId('overview-net-worth-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('0.00')
  })
})

describe('the announced region (AC-8)', () => {
  beforeEach(() => {
    // ⚠️ MANDATORY when a file mixes `render()` with `renderToString()`.
    // `render()` flushes effects and so sets the hook's module-level
    // "already hydrated on this client" flag; without this reset a later
    // `renderToString()` starts RESOLVED and every pending assertion fails for a
    // reason unrelated to the code under test. Order-dependent, so prevented
    // rather than debugged.
    __resetStoresHydratedForTests()
    resolvedFreeTier()
    clearStores()
  })

  it('PENDING: exactly ONE live region for the whole page, not one per skeleton', () => {
    const html = renderToString(<HomePage />)

    // Counted, not merely asserted present. N regions announce N times, which is
    // the failure mode on the other side of the one `deferred-work.md` records
    // (an all-`aria-hidden` pending page that announces nothing at all).
    expect(html.split('data-testid="page-loading-status"').length - 1).toBe(1)
    // Text content, not an `aria-label` on an empty element: a live region
    // announces content CHANGES, and an empty region present at first paint and
    // then removed is silent in most screen-reader/browser pairs.
    const region = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector('[data-testid="page-loading-status"]')
    expect(region?.getAttribute('role')).toBe('status')
    expect(region?.textContent).toBe('Loading your figures')
  })

  it('RESOLVED: the live region is gone', () => {
    render(<HomePage />)

    expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
  })

  it('every skeleton stays out of the accessibility tree', () => {
    const html = renderToString(<HomePage />)
    // ⚠️ PARSED, not string-sliced. The first version walked back from the
    // testid to the previous `<` and looked for `aria-hidden` in the slice — a
    // reviewer EXECUTED it and showed it rejects `<span data-testid="x"
    // aria-hidden="true">` (same element, attributes reordered) and rejects an
    // `aria-hidden` ANCESTOR wrapping the testid. It passed only because the
    // primitive happens to emit `aria-hidden` first in JSX, so it was pinning
    // attribute serialization order, not accessibility.
    const doc = new DOMParser().parseFromString(html, 'text/html')

    for (const testid of [
      'overview-total-income-skeleton',
      'overview-total-expenses-skeleton',
      'overview-net-worth-skeleton',
      'overview-sections-skeleton',
    ]) {
      const element = doc.querySelector(`[data-testid="${testid}"]`)
      expect(element, `${testid} is not in the server render`).not.toBeNull()
      expect(
        element?.closest('[aria-hidden="true"]'),
        `${testid} is not hidden from assistive technology (itself or an ancestor)`
      ).not.toBeNull()
    }
  })
})

describe('Income page loading state (a second surface, AC-5)', () => {
  beforeEach(() => {
    // ⚠️ MANDATORY when a file mixes `render()` with `renderToString()`.
    // `render()` flushes effects and so sets the hook's module-level
    // "already hydrated on this client" flag; without this reset a later
    // `renderToString()` starts RESOLVED and every pending assertion fails for a
    // reason unrelated to the code under test. Order-dependent, so prevented
    // rather than debugged.
    __resetStoresHydratedForTests()
    resolvedFreeTier()
    clearStores()
  })

  it('PENDING: a skeleton for the figure and for the list, and no "No income sources yet"', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          categoryId: null,
          sortOrder: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const html = renderToString(<IncomePage />)

    expect(html).toContain('period-total-amount-skeleton')
    expect(html).toContain('income-list-skeleton')
    expect(html).not.toContain('No income sources yet')
    expect(html).not.toContain('$0.00')
  })

  it('RESOLVED WITH DATA: the real figure and the real row, no skeleton', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          categoryId: null,
          sortOrder: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    render(<IncomePage />)

    // Currency-less baseline (vitest.setup) and the default `annually` period:
    // 500,000c/month × 12 = 60,000.00.
    expect(screen.getByTestId('period-total-amount')).toHaveTextContent('60,000.00')
    expect(screen.queryByTestId('period-total-amount-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('income-list-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
  })

  it('RESOLVED EMPTY: the real empty state, no skeleton', () => {
    render(<IncomePage />)

    expect(screen.getByText('No income sources yet')).toBeInTheDocument()
    expect(screen.queryByTestId('income-list-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('period-total-amount-skeleton')).not.toBeInTheDocument()
  })
})

/**
 * The three pages the first version of this file never rendered.
 *
 * ⚠️ Raised in code review: `ExpensesPage`, `SavingsPage` and `BalancePage` had
 * only server-HTML string checks in the e2e fence, so an INVERTED `!hydrated`
 * on any of them — skeleton when resolved, content when pending — would keep the
 * entire suite green. These arms are cheap and they close that hole: each page
 * gets a pending render (skeleton present, empty copy absent) and a resolved
 * render (empty copy present, skeleton gone), so the gate has to point the right
 * way on every page, not just the two that happened to be covered.
 */
describe('the remaining gated pages, pending → resolved (AC-5)', () => {
  beforeEach(() => {
    __resetStoresHydratedForTests()
    resolvedFreeTier()
    clearStores()
  })

  const PAGES = [
    {
      name: 'Expenses',
      Page: ExpensesPage,
      skeletons: ['period-total-amount-skeleton', 'expenses-list-skeleton'],
      emptyCopy: 'No expenses recorded yet',
    },
    {
      name: 'Savings',
      Page: SavingsPage,
      skeletons: [
        'savings-total-skeleton',
        'savings-leftover-summary-skeleton',
        'savings-chart-skeleton',
        'savings-list-skeleton',
      ],
      emptyCopy: 'No savings goals recorded yet',
    },
    {
      name: 'Balance',
      Page: BalancePage,
      skeletons: [
        'stat-total-investments-skeleton',
        'stat-total-savings-skeleton',
        'stat-total-debts-skeleton',
        'stat-net-worth-skeleton',
        'balance-entries-skeleton',
      ],
      emptyCopy: 'No balance entries recorded yet',
    },
  ] as const

  for (const { name, Page, skeletons, emptyCopy } of PAGES) {
    it(`${name}: PENDING renders every skeleton and none of the empty copy`, () => {
      const html = renderToString(<Page />)

      for (const testid of skeletons) {
        expect(html, `${name} is missing ${testid}`).toContain(testid)
      }
      expect(html, `${name} still serves "${emptyCopy}" while pending`).not.toContain(emptyCopy)
      expect(html.split('data-testid="page-loading-status"').length - 1).toBe(1)
    })

    it(`${name}: RESOLVED EMPTY renders the real empty state and no skeleton`, () => {
      render(<Page />)

      expect(screen.getByText(emptyCopy)).toBeInTheDocument()
      for (const testid of skeletons) {
        expect(
          screen.queryByTestId(testid),
          `${name} still shows ${testid}`
        ).not.toBeInTheDocument()
      }
      expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
    })
  }
})

/**
 * The two chart sections a code reviewer found still serving a confident empty
 * sentence, on routes the acceptance audit had just rated clean.
 *
 * ⚠️ These phrases are the point. The story's `absent` fences listed `$0.00` and
 * the LIST sections' empty copy, so a value-shaped sweep AND a testid-shaped
 * sweep both missed them — they are neither a zero nor a known testid, just a
 * sentence telling a returning user to add data they already have.
 */
describe('the savings chart must not preach the empty state while pending', () => {
  beforeEach(() => {
    __resetStoresHydratedForTests()
    resolvedFreeTier()
    clearStores()
  })

  it('/savings does not serve "Add a savings goal to see it charted here" while pending', () => {
    seedSavings()

    const html = renderToString(<SavingsPage />)

    expect(html).toContain('savings-chart-skeleton')
    expect(html).not.toContain('Add a savings goal to see it charted here')
    expect(html).not.toContain('savings-chart-empty')
  })

  it('the savings chart resolves to its genuine empty state', () => {
    render(<SavingsPage />)
    expect(screen.getByTestId('savings-chart-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('savings-chart-skeleton')).not.toBeInTheDocument()
  })
})
