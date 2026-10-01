import { render, screen, waitFor, within } from '@testing-library/react'
import { type ReactElement, cloneElement } from 'react'
import { Pie, PieChart } from 'recharts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { useCategoryStore } from '../../stores/categoryStore'

/**
 * Overview breakdown pies paint NO in-plot slice labels, with the REAL chart
 * library (was `e2e/breakdown-pie-labels.spec.ts`, story 36.2 UX-DR41; moved by
 * story 84.5, FR137).
 *
 * ⚠️ WHY THIS WORKS BELOW THE BROWSER NOW (MEASURED, 84.5 Task 1). jsdom gives
 * `ResponsiveContainer` a 0×0 box and Recharts renders nothing; that is why
 * `HomePage.pie-labels.chart-wiring.test.tsx` mocks Recharts and pins only the
 * `label` PROP. Here ONLY `ResponsiveContainer` is replaced, by one that hands
 * its chart a fixed 600×300: the real `PieChart`, `Pie`, sectors and labels
 * render real SVG. Probe: 5 sectors, 0 labels with the shipped `label={false}`;
 * with `label` turned on, 5 label texts and 2 label layers.
 *
 * ⚠️⚠️ THE TRAP, which jsdom reproduces exactly: Recharts paints pie labels only
 * AFTER the sector animation (probe with labels ON: 0 at t=1000 ms, 5 at
 * t=2000 ms). An absence assertion on an animating pie passes against labels-ON
 * code. So the animation is switched OFF here (`Pie.defaultProps`), and the
 * POSITIVE CONTROL below proves that, in this exact harness, a pie handed
 * `label` paints labels on the first render.
 *
 * ⚠️ What is NOT pinned (the named D2 loss): hover hit-testing on the donut and
 * the painted layout. The tooltip's CONTENT is pinned in the chart-wiring file.
 * Unit tests run currency-less, so totals read "68,400.00", not "$68,400.00".
 */

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({
    status: {
      hasAccess: false,
      subscriptionStatus: 'free',
      isLoading: false,
      error: null,
      isAuthenticated: false,
    },
  }),
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  // Animation off, on the REAL class, so the first render is the final frame.
  // Recharts' static `defaultProps` are untyped here.
  const PieClass = actual.Pie as unknown as { defaultProps?: Record<string, unknown> }
  PieClass.defaultProps = { ...PieClass.defaultProps, isAnimationActive: false }
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 600, height: 300 } as never),
  }
})

const { HomePage } = await import('../HomePage')

const NOW = '2026-01-01T00:00:00.000Z'
const row = (name: string, amount: number, index: number) => ({
  id: `${name}-${index}`,
  userId: 0,
  name,
  amount,
  frequency: 'monthly' as const,
  // Uncategorized rows fall back to their own name (story 30.4b, Decision 10).
  categoryId: null,
  sortOrder: index,
  createdAt: NOW,
  updatedAt: NOW,
})

const EXPENSES = [
  ['Rent', 120_000],
  ['Groceries', 110_000],
  ['Transport', 100_000],
  ['Utilities', 90_000],
  ['Insurance', 80_000],
  ['Entertainment', 70_000],
] as const
const INCOME = [
  ['Salary', 400_000],
  ['Freelance', 350_000],
  ['Dividends', 300_000],
] as const

function seed(income: readonly (readonly [string, number])[], expenses: typeof income): void {
  useIncomeStore.setState({ incomeSources: income.map(([n, a], i) => row(n, a, i)) })
  useExpenseStore.setState({ expenses: expenses.map(([n, a], i) => row(n, a, i)) })
}

const RATIO = 'breakdown-pie-expense-ratio'
const EXPENSE = 'breakdown-pie-expense'

/** Witness first (sectors drawn), then absence of BOTH label surfaces. */
async function assertNoInPlotLabels(
  container: HTMLElement,
  { ratioSlices, expenseSlices }: { ratioSlices: number; expenseSlices: number }
): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(RATIO).querySelectorAll('.recharts-sector')).toHaveLength(ratioSlices)
    expect(screen.getByTestId(EXPENSE).querySelectorAll('.recharts-sector')).toHaveLength(
      expenseSlices
    )
  })
  expect(container.querySelectorAll('.recharts-pie-label-text')).toHaveLength(0)
  expect(container.querySelectorAll('.recharts-pie-labels')).toHaveLength(0)
}

/** Narrow for WIDTH queries only: every other query (e.g. `prefers-color-scheme`)
 * answers false, so "narrow" does not also mean "dark" (84.5 code review). */
function matchNarrow(narrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: narrow && /max-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  useCategoryStore.setState({ categories: [] })
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
})

describe('the harness can see a pie label at all (positive control)', () => {
  it('a real Recharts pie handed `label` paints its labels here, on the first render', () => {
    // Without this, every absence assertion below could be the silence of a
    // harness that never draws labels (the e2e file's whole warning).
    const { container } = render(
      <PieChart width={400} height={300}>
        <Pie
          data={[
            { name: 'A', value: 1 },
            { name: 'B', value: 2 },
          ]}
          dataKey="value"
          label
        />
      </PieChart>
    )
    expect(container.querySelectorAll('.recharts-sector')).toHaveLength(2)
    expect(container.querySelectorAll('.recharts-pie-label-text')).toHaveLength(2)
  })
})

describe('Overview breakdown pies paint no in-plot slice labels (was e2e breakdown-pie-labels)', () => {
  it('many categories: no labels; list, totals and accessible names intact (was :222, AC-4/5/6)', async () => {
    seed(INCOME, EXPENSES)
    const { container } = render(<HomePage />)
    await assertNoInPlotLabels(container, { ratioSlices: EXPENSES.length + 1, expenseSlices: 6 })

    const expenseItems = within(screen.getByTestId(EXPENSE)).getAllByRole('listitem')
    const ratioItems = within(screen.getByTestId(RATIO)).getAllByRole('listitem')
    expect(expenseItems).toHaveLength(EXPENSES.length)
    expect(ratioItems).toHaveLength(EXPENSES.length + 1)
    for (const [name] of EXPENSES) {
      expect(expenseItems.some((li) => li.textContent?.includes(name))).toBe(true)
      expect(ratioItems.some((li) => li.textContent?.includes(name))).toBe(true)
    }
    // 5,760,000 / 12,600,000 × 100 = 45.71…% -> 46%; anchored against "146%".
    expect(
      ratioItems.find((li) => li.textContent?.includes('Remaining income'))?.textContent
    ).toMatch(/(?<![\d.])46%/)
    expect(screen.getByTestId('breakdown-pie-total-expense')).toHaveTextContent('68,400.00')
    expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent(/^54%$/)

    expect(
      screen.getByRole('img', { name: 'Expenses as % of income (per year) breakdown chart' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Expenses by category (per year) breakdown chart' })
    ).toBeInTheDocument()
  })

  it('a two-slice pie is still readable with no in-plot labels (was :275, AC-8)', async () => {
    seed(INCOME.slice(0, 2), EXPENSES.slice(0, 2))
    const { container } = render(<HomePage />)
    await assertNoInPlotLabels(container, { ratioSlices: 3, expenseSlices: 2 })

    const expenseItems = within(screen.getByTestId(EXPENSE)).getAllByRole('listitem')
    const ratioItems = within(screen.getByTestId(RATIO)).getAllByRole('listitem')
    expect(expenseItems).toHaveLength(2)
    expect(ratioItems).toHaveLength(3)
    for (const [name, amount, share] of [
      ['Rent', '14,400.00', /(?<![\d.])16%/],
      ['Groceries', '13,200.00', /(?<![\d.])15%/],
    ] as const) {
      expect(expenseItems.find((li) => li.textContent?.includes(name))?.textContent).toContain(
        amount
      )
      expect(ratioItems.find((li) => li.textContent?.includes(name))?.textContent).toMatch(share)
    }
    expect(
      ratioItems.find((li) => li.textContent?.includes('Remaining income'))?.textContent
    ).toMatch(/(?<![\d.])69%/)
    expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent(/^31%$/)
  })

  it('a one-slice pie is still readable with no in-plot labels (was :313, AC-8)', async () => {
    seed(INCOME.slice(0, 1), EXPENSES.slice(0, 1))
    const { container } = render(<HomePage />)
    await assertNoInPlotLabels(container, { ratioSlices: 2, expenseSlices: 1 })

    const expenseItems = within(screen.getByTestId(EXPENSE)).getAllByRole('listitem')
    expect(expenseItems).toHaveLength(1)
    expect(expenseItems[0]).toHaveTextContent('Rent')
    expect(expenseItems[0]).toHaveTextContent('14,400.00')
    const ratioItems = within(screen.getByTestId(RATIO)).getAllByRole('listitem')
    expect(ratioItems).toHaveLength(2)
    expect(ratioItems.find((li) => li.textContent?.includes('Rent'))?.textContent).toMatch(
      /(?<![\d.])30%/
    )
    expect(
      ratioItems.find((li) => li.textContent?.includes('Remaining income'))?.textContent
    ).toMatch(/(?<![\d.])70%/)
    expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent(/^30%$/)
  })

  it('no in-plot labels on a NARROW viewport either (was :345, AC-9)', async () => {
    // `matchMedia` does not exist in jsdom, so the chart-wiring file only ever
    // sees the desktop branch; a regression to `label={isNarrow}` would pass it.
    matchNarrow(true)
    seed(INCOME, EXPENSES)
    const { container } = render(<HomePage />)
    await assertNoInPlotLabels(container, { ratioSlices: EXPENSES.length + 1, expenseSlices: 6 })
  })
})
