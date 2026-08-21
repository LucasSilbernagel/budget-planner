/**
 * SavingsPage → SavingsChart contract (story 37.1, AC-3).
 *
 * ⚠️ WHY THIS FILE EXISTS. The chart itself renders nothing in jsdom
 * (`ResponsiveContainer` measures 0×0), so what the PAGE hands the CHART is
 * unobservable through the DOM. The single most likely wiring mistake in this
 * story — feeding the chart `savingsGoals` instead of the sorted `sortedRows` —
 * would leave every DOM assertion green. So `SavingsChart` is replaced with a
 * capturing stub and the assertions are made on its props.
 *
 * ⚠️ Kept out of `SavingsPage.test.tsx` because `vi.mock` is module-scoped: the
 * stub would apply to all 53 tests there.
 *
 * ⚠️ The stub renders NO row labels, deliberately. `SavingsPage.test.tsx:641`
 * pins `getAllByText('Vacation')).toHaveLength(1)` and `:640` pins exactly one
 * `<table>`; a stub that echoed names would turn both red, and so would any
 * "sr-only data list" added to the real chart. The table is the text path.
 */

import { cleanup, renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavingsChartRow } from '../../lib/savings-chart-data'
import { useSavingsStore } from '../../stores/savingsStore'

const captured = vi.hoisted(() => ({ rows: null as SavingsChartRow[] | null, renders: 0 }))

vi.mock('../SavingsChart', () => ({
  SAVINGS_CHART_ARIA_LABEL: 'stubbed',
  SavingsChart: ({ rows }: { rows: SavingsChartRow[] }) => {
    captured.rows = rows
    captured.renders += 1
    return <div data-testid="savings-chart-stub" />
  },
}))

const { SavingsPage } = await import('../SavingsPage')

const NOW = '2026-01-01T00:00:00.000Z'

function goal(id: string, name: string, currentBalance: number, targetAmount: number | null) {
  return { id, name, targetAmount, currentBalance, createdAt: NOW, updatedAt: NOW }
}

const GOALS = [
  goal('a', 'Vacation', 300_00, 900_00),
  goal('b', 'Emergency Fund', 900_00, 2_000_00),
  goal('c', 'TFSA', 150_00, null),
]

beforeEach(() => {
  captured.rows = null
  captured.renders = 0
  useSavingsStore.setState({ savingsGoals: GOALS })
})

afterEach(() => {
  // Unmount before resetting the store, or the reset re-renders a live page
  // outside `act()`.
  cleanup()
  useSavingsStore.setState({ savingsGoals: [] })
})

describe('SavingsPage → SavingsChart contract', () => {
  it('hands the chart one row per savings entry', () => {
    renderWithProviders(<SavingsPage />)
    expect(captured.renders).toBeGreaterThan(0)
    expect(captured.rows).toHaveLength(3)
    expect(captured.rows?.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('folds the account row to an absent target and keeps the goal targets', () => {
    renderWithProviders(<SavingsPage />)
    expect(captured.rows?.map((r) => r.target)).toEqual([900_00, 2_000_00, null])
  })

  // AC-3: the chart plots the same quantity the page's headline figure is the
  // sum of. If the chart ever silently switched to a contribution figure
  // (`monthlyAllocation` / `distributablePool` / `effectiveAllocation` — all
  // three named as forbidden by story 32.1's fence), this breaks.
  it('plots balances that sum to the page total', () => {
    renderWithProviders(<SavingsPage />)
    const plotted = (captured.rows ?? []).reduce((sum, row) => sum + row.saved, 0)
    expect(plotted).toBe(1_350_00)
    // ⚠️ No `$`. `vitest.setup.ts` forces `{mode:'none', currency:'NONE'}` on
    // the currency store before every jsdom test, so the whole unit suite
    // renders amounts currency-less. A unit assertion on a symbol proves
    // nothing about symbol mode — that lives in e2e, which runs the real default.
    expect(screen.getByText('1,350.00')).toBeInTheDocument()
  })

  it('starts in the table’s manual order', () => {
    renderWithProviders(<SavingsPage />)
    expect(captured.rows?.map((r) => r.label)).toEqual(['Vacation', 'Emergency Fund', 'TFSA'])
  })

  // ⚠️ The one that matters. `sortedRows` is a VIEW projection that changes
  // with the user's column sort, while the page's empty gate reads the raw
  // `savingsGoals`. Feeding the chart the raw array is the easiest mistake to
  // make here and every other assertion in the story would stay green.
  it('re-orders with the table when a column is sorted', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)
    expect(captured.rows?.map((r) => r.label)).toEqual(['Vacation', 'Emergency Fund', 'TFSA'])

    await user.click(screen.getByRole('button', { name: /Current Balance/ }))

    // ⚠️ Compare IDs, not names, and compare them for EXACT equality. Names are
    // not unique in this app, so a name-substring comparison
    // (`tableOrder[i].includes(label)`) can pass while the two orders genuinely
    // disagree — "Fund" is a substring of "Emergency Fund". The badge testid
    // carries the row's id, which is the real identity.
    const chartOrder = captured.rows?.map((r) => r.id)
    const tableOrder = screen
      .getAllByTestId(/^savings-badge-/)
      .map((badge) => (badge.getAttribute('data-testid') ?? '').replace('savings-badge-', ''))
    expect(tableOrder).toHaveLength(3)
    expect(chartOrder).not.toEqual(['a', 'b', 'c'])
    expect(chartOrder).toEqual(tableOrder)
  })

  it('does not render a second textual copy of the values', () => {
    const { container } = renderWithProviders(<SavingsPage />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(screen.getAllByText('Vacation')).toHaveLength(1)
  })
})
