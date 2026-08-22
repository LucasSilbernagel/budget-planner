/**
 * BalanceChart ErrorBoundary containment (story 37.2, AC-8).
 *
 * ⚠️ Kept in its own file, and not folded into `BalancePage.test.tsx`, because
 * the only way to force the chart to throw is `vi.mock('recharts')`, which is
 * module-scoped — doing it there would silently convert that file's whole suite
 * into mocked-chart tests, including the three helpers that pin "exactly two
 * tables".
 */

import { cleanup, renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBalanceChartModel } from '../../lib/balance-chart-data'
import { useBalanceStore } from '../../stores/balanceStore'
import { useSavingsStore } from '../../stores/savingsStore'

vi.mock('recharts', () => ({
  // The throw happens on render of the container, i.e. inside the boundary —
  // which is exactly where a real Recharts failure would surface.
  ResponsiveContainer: () => {
    throw new Error('boom')
  },
  BarChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  Bar: () => null,
  Cell: () => null,
}))

const { BalanceChart } = await import('../BalanceChart')
const { BalancePage } = await import('../BalancePage')

const NOW = '2026-01-01T00:00:00.000Z'

const ENTRIES = [
  {
    id: 'inv-1',
    type: 'investment' as const,
    name: 'Brokerage',
    currentBalance: 500_000,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'debt-1',
    type: 'debt' as const,
    name: 'Mortgage',
    currentBalance: 200_000,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

const MODEL = buildBalanceChartModel({ entries: ENTRIES, savingsCents: 100_000 })

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // `ErrorBoundary.componentDidCatch` writes unconditionally AND React writes
  // its own boundary warning, so an expected-throw test is noisy by design.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useBalanceStore.setState({ entries: ENTRIES })
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'sav-1',
        name: 'Emergency Fund',
        targetAmount: null,
        currentBalance: 100_000,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
})

afterEach(() => {
  // Unmount before resetting the stores: `setState` on a live store re-renders a
  // still-mounted page, and that update lands outside `act()`.
  cleanup()
  consoleErrorSpy.mockRestore()
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
})

describe('BalanceChart error containment', () => {
  it('renders the chart fallback instead of propagating the throw', () => {
    renderWithProviders(
      <BalanceChart
        model={MODEL}
        formatAmount={(cents) => `$${cents / 100}`}
        mode="none"
        currency="NONE"
      />
    )

    expect(screen.getByText('Chart error occurred')).toBeInTheDocument()
    // ⚠️ Assert the error was actually LOGGED, and assert its CONTENT. A
    // silenced-but-absent console.error would mean the child never threw and this
    // test proved nothing about containment — but a bare CALL COUNT couples the
    // proof to React's logging behaviour (19 routes caught errors through
    // `onCaughtError`, and a future minor could consolidate the two writers into
    // one). Matching the thrown message is version-proof and a stronger witness.
    const logged = consoleErrorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(logged).toContain('boom')
  })

  it('keeps the rest of the Balance page rendering and interactive', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    // The chart is down...
    expect(screen.getByText('Chart error occurred')).toBeInTheDocument()

    // ...and everything else on the page still works.
    expect(screen.getByRole('heading', { name: 'Balance Tracking' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Financial Overview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Investment Accounts' })).toBeInTheDocument()
    expect(screen.getByTestId('stat-net-worth')).toBeInTheDocument()
    expect(screen.getAllByText('Brokerage').length).toBeGreaterThan(0)

    // Not merely present — still interactive.
    await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('contains the failure to the chart section, leaving BOTH tables intact', () => {
    const { container } = renderWithProviders(<BalancePage />)

    const section = screen.getByTestId('balance-chart-section')
    expect(section).toHaveTextContent('Chart error occurred')
    // The boundary is INSIDE the section, so the section's own heading survives.
    expect(section).toHaveTextContent('What You Own vs What You Owe')
    // ⚠️ Two, not one: this page carries the Investment Accounts breakdown AND
    // the editable entries table, and a chart failure must not cost either.
    expect(container.querySelectorAll('table')).toHaveLength(2)
  })
})
