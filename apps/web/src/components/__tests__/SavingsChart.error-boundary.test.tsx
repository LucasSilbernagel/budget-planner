/**
 * SavingsChart ErrorBoundary containment (story 37.1, AC-8).
 *
 * ⚠️ THIS IS THE FIRST TEST IN THE REPO THAT MOUNTS A THROWING CHILD IN AN
 * `ErrorBoundary`. Nine chart call sites are wrapped and three test files
 * mention `ErrorBoundary`, but all three assert the OPPOSITE direction — that
 * the fallback is NOT reached. Nothing proved the boundary actually contains
 * anything. This does.
 *
 * ⚠️ Kept in its own file, and not folded into `SavingsPage.test.tsx`, because
 * the only way to force the chart to throw is `vi.mock('recharts')`, which is
 * module-scoped — doing it there would silently convert that file's 53 tests
 * into mocked-chart tests.
 */

import { cleanup, renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavingsChartRow } from '../../lib/savings-chart-data'
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
  Legend: () => null,
  Bar: () => null,
  Cell: () => null,
}))

const { SavingsChart } = await import('../SavingsChart')
const { SavingsPage } = await import('../SavingsPage')

const NOW = '2026-01-01T00:00:00.000Z'
const ROWS: SavingsChartRow[] = [{ id: 'a', label: 'Vacation', saved: 600_00, target: 1_000_00 }]

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // `ErrorBoundary.componentDidCatch` writes unconditionally AND React writes
  // its own boundary warning, so an expected-throw test is noisy by design.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'a',
        name: 'Vacation',
        targetAmount: 1_000_00,
        currentBalance: 600_00,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
})

afterEach(() => {
  // Unmount before resetting the store: `setState` on a live store re-renders a
  // still-mounted page, and that update lands outside `act()`.
  cleanup()
  consoleErrorSpy.mockRestore()
  useSavingsStore.setState({ savingsGoals: [] })
})

describe('SavingsChart error containment', () => {
  it('renders the chart fallback instead of propagating the throw', () => {
    renderWithProviders(
      <SavingsChart rows={ROWS} formatAmount={(c) => `$${c / 100}`} mode="none" currency="NONE" />
    )

    expect(screen.getByText('Chart error occurred')).toBeInTheDocument()
    // ⚠️ Assert the error was actually LOGGED, not just that the fallback is
    // present. A silenced-but-absent console.error would mean the child never
    // threw and this test proved nothing about containment.
    expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the rest of the Savings page rendering and interactive', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SavingsPage />)

    // The chart is down...
    expect(screen.getByText('Chart error occurred')).toBeInTheDocument()

    // ...and everything else on the page still works.
    expect(screen.getByRole('heading', { name: 'Savings Goals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Total Savings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your Savings Goals' })).toBeInTheDocument()
    expect(screen.getByText('Vacation')).toBeInTheDocument()
    expect(screen.getByTestId('savings-leftover-summary')).toBeInTheDocument()

    // Not merely present — still interactive.
    await user.click(screen.getByRole('button', { name: '+ Add Savings Goal' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('contains the failure to the chart section, leaving the table intact', () => {
    const { container } = renderWithProviders(<SavingsPage />)

    const section = screen.getByTestId('savings-chart-section')
    expect(section).toHaveTextContent('Chart error occurred')
    // The boundary is INSIDE the section, so the section's own heading survives.
    expect(section).toHaveTextContent('Savings at a Glance')
    expect(container.querySelectorAll('table')).toHaveLength(1)
  })
})
