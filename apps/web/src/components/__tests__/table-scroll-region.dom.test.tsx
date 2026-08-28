import { renderWithProviders, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'
import { RESPONSIVE_SCROLL_SHADOW_CLASS, RESPONSIVE_WRAPPER_CLASS } from '../ui/ResponsiveTable'

/**
 * The table scroll region, on EVERY page that has one (story 42.2, UX-DR46).
 *
 * ⚠️ THIS FILE EXISTS BECAUSE "ONE TESTED AND THREE ASSUMED" HAS ALREADY SHIPPED
 * HERE. Story 42.1's review found its AC-8 violated with the guard task ticked:
 * Savings and Balance had no rendered-table coverage at any layer, so a wrong
 * `tableId` on those pages reddened nothing. The affordance in this story is
 * wired at four separate call sites and a forgotten one fails SILENTLY — the
 * table renders correctly, just unsignposted, and no other test notices.
 *
 * ⚠️ Structural only. jsdom computes no layout and applies no media queries, so
 * nothing here proves the shadow is painted, that it hides on a table that
 * fits, or that arrow keys scroll anything. Those are geometry and behaviour
 * claims and `e2e/table-scroll-affordance.spec.ts` makes them against real
 * pixels. Read a case below as "this page declares what the AC needs".
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

const FLOW_SEED = [{ name: 'Alpha', amount: 100_00, frequency: 'monthly' as const }]

function seedAll(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  for (const row of FLOW_SEED) {
    useIncomeStore.getState().addIncomeSource(row)
    useExpenseStore.getState().addExpense(row)
  }
  useSavingsStore.getState().addSavingsGoal({
    name: 'Alpha',
    targetAmount: 900_00,
    currentBalance: 300_00,
  })
  useBalanceStore.getState().addBalanceEntry({
    type: 'investment',
    name: 'Alpha',
    currentBalance: 300_00,
    maxContributionLimit: 900_00,
    monthlyContribution: 100_00,
    frequency: 'monthly',
  })
  vi.useRealTimers()
}

beforeEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  localStorage.clear()
  seedAll()
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
})

/** Every page carrying a shared-layer table. Enumerated, never counted — story
 *  43.1 removed one of these and the epic text still says "five tables". */
const PAGES = [
  { name: 'Income', render: () => renderWithProviders(<IncomePage />) },
  { name: 'Expenses', render: () => renderWithProviders(<ExpensesPage />) },
  { name: 'Savings', render: () => renderWithProviders(<SavingsPage />) },
  { name: 'Balance', render: () => renderWithProviders(<BalancePage />) },
] as const

describe('table scroll region', () => {
  for (const page of PAGES) {
    describe(page.name, () => {
      it('wraps EVERY table it renders in a named, focusable region (AC-5)', () => {
        // ⚠️ Checks every table-bearing region, not `getAllByRole('region')[0]`.
        // Taking only the first would let a page that grows a SECOND shared-layer
        // table ship it with no tabindex, no label and no affordance — the exact
        // "one tested and three assumed" hole this file exists to close.
        const { container } = page.render()
        const regions = [...container.querySelectorAll('div.overflow-x-auto')].filter((el) =>
          el.querySelector('table')
        )
        expect(regions.length, `${page.name} renders no table scroll wrapper`).toBeGreaterThan(0)
        for (const region of regions) {
          expect(region.getAttribute('role'), `${page.name} wrapper is not a region`).toBe('region')
          expect(region.getAttribute('tabindex'), `${page.name} wrapper is not focusable`).toBe('0')
          // A region with no accessible name is announced as an unlabelled
          // landmark — the "meaningless content" the AC forbids.
          expect(region.getAttribute('aria-label')?.trim()).toBeTruthy()
        }
      })

      it('declares the scroll affordance alongside the wrapper class (AC-1, AC-7)', () => {
        page.render()
        const region = screen.getAllByRole('region')[0]
        const classes = [...region.classList]
        // Both, on the same element: the affordance is inert without the scroll
        // container, and the container is unsignposted without the affordance.
        for (const token of RESPONSIVE_WRAPPER_CLASS.split(/\s+/)) {
          expect(classes, `${page.name} lost ${token}`).toContain(token)
        }
        for (const token of RESPONSIVE_SCROLL_SHADOW_CLASS.split(/\s+/)) {
          expect(classes, `${page.name} is missing ${token}`).toContain(token)
        }
      })

      it('nests no second scroll container (AC-7)', () => {
        // A nested `overflow-x-auto` double-counts in `responsive-320.spec.ts`'s
        // wrapper sweep and silently redirects `categories-premium.spec.ts`'s
        // bare `document.querySelector`.
        const { container } = page.render()
        const wrappers = container.querySelectorAll('div.overflow-x-auto')
        for (const w of wrappers) {
          expect(
            w.querySelector('div.overflow-x-auto'),
            `${page.name} nests a second scroll container`
          ).toBeNull()
        }
      })
    })
  }

  it('every shared-layer table on every page is inside a scroll region', () => {
    // The cross-page claim the per-page cases cannot make on their own: a table
    // that lost its wrapper entirely would still pass a per-page case that only
    // looks at the region it does find.
    for (const page of PAGES) {
      const { container, unmount } = page.render()
      const tables = [...container.querySelectorAll('table')]
      expect(tables.length, `${page.name} rendered no table to check`).toBeGreaterThan(0)
      for (const table of tables) {
        const region = table.closest('div.overflow-x-auto')
        expect(region, `${page.name} has a table outside a scroll wrapper`).not.toBeNull()
        expect(region?.getAttribute('role'), `${page.name} wrapper is not a region`).toBe('region')
      }
      unmount()
    }
  })
})
