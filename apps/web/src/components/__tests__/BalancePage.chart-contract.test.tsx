/**
 * What the Balance PAGE hands the chart (story 37.2).
 *
 * ⚠️ The chart is stubbed, so this file asserts the CONTRACT — the model the
 * page folds — not anything the chart renders. The real chart draws no SVG in
 * jsdom at all, so a rendering assertion here could not fail.
 *
 * ⚠️ The stub renders NO row labels, deliberately. `BalancePage.test.tsx:805`
 * asserts a PAGE-WIDE `getAllByText('Brokerage')).toHaveLength(2)`, so a stub
 * that echoed entry names would turn a pre-existing test red for a reason that
 * has nothing to do with this story.
 */

import { cleanup, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BalanceChartModel } from '../../lib/balance-chart-data'
import { useBalanceStore } from '../../stores/balanceStore'
import { useSavingsStore } from '../../stores/savingsStore'

const captured = vi.hoisted(() => ({ model: null as BalanceChartModel | null }))

vi.mock('../BalanceChart', () => ({
  BalanceChart: ({ model }: { model: BalanceChartModel }) => {
    captured.model = model
    return <div data-testid="balance-chart-stub" />
  },
}))

const { BalancePage } = await import('../BalancePage')

const NOW = '2026-01-01T00:00:00.000Z'

function entry(over: {
  id: string
  type?: 'investment' | 'debt'
  name?: string
  currentBalance?: number
}) {
  return {
    type: 'investment' as const,
    name: `Account ${over.id}`,
    currentBalance: 100_000,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function seed(
  entries: ReturnType<typeof entry>[],
  savings: Array<{ id: string; currentBalance: number }> = []
) {
  useBalanceStore.setState({ entries })
  useSavingsStore.setState({
    savingsGoals: savings.map((goal) => ({
      id: goal.id,
      name: `Goal ${goal.id}`,
      targetAmount: null,
      currentBalance: goal.currentBalance,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  })
}

beforeEach(() => {
  captured.model = null
})

afterEach(() => {
  // Unmount BEFORE resetting the stores: `setState` on a live store re-renders a
  // still-mounted page, and that update lands outside `act()`.
  cleanup()
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
})

describe('BalancePage → BalanceChart contract', () => {
  it('hands one segment per entry, plus the savings aggregate', () => {
    seed(
      [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'b', type: 'debt', currentBalance: 200_000 }),
      ],
      [
        { id: 's1', currentBalance: 60_000 },
        { id: 's2', currentBalance: 40_000 },
      ]
    )
    renderWithProviders(<BalancePage />)

    expect(captured.model?.segments.map((segment) => segment.key)).toEqual([
      'seg-savings',
      'seg-a',
      'seg-b',
    ])
    // Savings arrives as ONE aggregate, not one segment per goal.
    expect(captured.model?.segments[0]?.value).toBe(100_000)
  })

  it('plots totals that AGREE with the page’s own stat cards', () => {
    seed(
      [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'b', type: 'debt', currentBalance: 200_000 }),
      ],
      [{ id: 's1', currentBalance: 100_000 }]
    )
    renderWithProviders(<BalancePage />)

    // ⚠️ No `$` anywhere in these assertions: the shared test setup forces the
    // currency store to `none`/`NONE`, so the whole unit suite renders
    // currency-less. A symbol assertion here would prove nothing about mode.
    const netWorthCard = screen.getByTestId('stat-net-worth').textContent
    expect(captured.model?.assetsTotal).toBe(600_000)
    expect(captured.model?.liabilitiesTotal).toBe(200_000)
    expect(captured.model?.netWorth).toBe(400_000)
    // The chart's derived net worth is the SAME number the card renders.
    expect(netWorthCard).toContain('4,000.00')
  })

  it('agrees with the card for a SAVINGS-ONLY user, where net worth is non-zero', () => {
    seed([], [{ id: 's1', currentBalance: 300_000 }])
    renderWithProviders(<BalancePage />)

    // Story 32.2's case 5. This must be a real chart, not an empty state beside
    // a positive Net Worth card.
    expect(screen.getByTestId('balance-chart-stub')).toBeInTheDocument()
    expect(captured.model?.netWorth).toBe(300_000)
    expect(screen.getByTestId('stat-net-worth').textContent).toContain('3,000.00')
  })

  it('keeps the chart in MANUAL order after a column sort re-orders the table', async () => {
    // ⚠️ The sort MUST be activated for this test to mean anything. `useTableSort`
    // returns the INPUT ARRAY BY REFERENCE while unsorted, so a chart wired to
    // `sortedRows` by mistake would look identical to a correct one until a
    // header is clicked.
    const user = userEvent.setup()
    seed([
      entry({ id: 'z', name: 'Zebra', currentBalance: 100_000 }),
      entry({ id: 'a', name: 'Alpha', currentBalance: 900_000 }),
    ])
    const { container } = renderWithProviders(<BalancePage />)

    const manual = captured.model?.segments.map((segment) => segment.key)
    expect(manual).toEqual(['seg-z', 'seg-a'])

    const tables = [...container.querySelectorAll('table')] as HTMLElement[]
    const editable = tables[1] as HTMLElement
    const nameHeader = within(editable).getByRole('columnheader', { name: 'Name' })
    await user.click(within(nameHeader).getByRole('button', { name: 'Name' }))

    // The TABLE re-ordered — proving the click took...
    const rowNames = [...editable.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td:nth-child(2)')?.textContent
    )
    expect(rowNames[0]).toContain('Alpha')

    // ...and the CHART did not follow it.
    expect(captured.model?.segments.map((segment) => segment.key)).toEqual(['seg-z', 'seg-a'])
  })

  it('does not render a second textual copy of the plotted values', () => {
    seed([entry({ id: 'a', name: 'Brokerage', currentBalance: 500_000 })])
    const { container } = renderWithProviders(<BalancePage />)

    // The chart section adds no table and no entry name of its own — the two
    // existing tables stay the only text path to per-entry figures.
    expect(container.querySelectorAll('table')).toHaveLength(2)
    const section = screen.getByTestId('balance-chart-section')
    expect(section.textContent).not.toContain('Brokerage')
  })
})
