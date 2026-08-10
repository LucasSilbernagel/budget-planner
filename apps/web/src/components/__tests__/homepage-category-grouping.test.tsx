/**
 * Overview breakdown pies group by CATEGORY (story 30.4b, AC-7 / AC-3).
 *
 * `aggregateByCategoryAndType` has merged rows sharing a category since story
 * 3-3 — but nothing could ever assign one, so the merge path never ran. Making
 * categories assignable turns it on, and that behaviour change is the feature:
 * it is asserted here rather than left to happen.
 *
 * ⚠️ Asserting a pie RENDERED is not asserting it GROUPED. Every test below
 * names both the merged label and the per-row labels that must have disappeared.
 */

import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { HomePage } from '../HomePage'

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

function expenseRow(id: string, name: string, amount: number, categoryId: string | null) {
  return {
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly' as const,
    categoryId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function incomeRow(id: string, name: string, amount: number, categoryId: string | null) {
  return {
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly' as const,
    categoryId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/**
 * The expense pie's card — its sub-heading, chart and legend list.
 *
 * Scoped rather than page-wide on purpose: the income pie is a sibling with the
 * same markup, so an unscoped `getByText` would pass on a label that landed in
 * the wrong pie. `BreakdownPie` renders `<div>{<div><h3/></div>}{…}<ul/></div>`,
 * so the card is the heading's grandparent.
 */
function expensePie(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /expenses by category/i })
  const card = heading.parentElement?.parentElement
  if (!card) {
    throw new Error('Expense pie card not found — BreakdownPie markup changed')
  }
  return card
}

/**
 * The expense pie's LEGEND list — one <li> per slice.
 *
 * Narrower than {@link expensePie} because the card also carries the pie's own
 * TOTAL, which for a single-slice pie is the same figure as that slice: an
 * amount assertion scoped only to the card would pass on the total while the
 * legend showed something else entirely.
 */
function expenseLegend(): HTMLElement {
  return within(expensePie()).getByRole('list')
}

/** The INCOME pie's legend — the income side has its own resolve call site. */
function incomeLegend(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /income by category/i })
  const card = heading.parentElement?.parentElement
  if (!card) {
    throw new Error('Income pie card not found — BreakdownPie markup changed')
  }
  return within(card).getByRole('list')
}

beforeEach(() => {
  vi.clearAllMocks()
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: 'free',
      isLoading: false,
      error: null,
      isAuthenticated: false,
    } satisfies PremiumAccessStatus,
  })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ balanceEntries: [] })
  useCategoryStore.setState({ categories: [] })
})

describe('AC-7: two rows sharing a category merge into one slice', () => {
  it('shows the category once with the summed figure, and neither row name', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    useExpenseStore.setState({
      expenses: [
        expenseRow('x1', 'Tesco run', 5000, 'e1'),
        expenseRow('x2', 'Aldi run', 3000, 'e1'),
      ],
    })

    render(<HomePage />)
    const legend = expenseLegend()

    // ONE slice, not two: 8000c/month → 96000c/year (Annually is the default).
    expect(within(legend).getAllByRole('listitem')).toHaveLength(1)
    expect(within(legend).getByText('Groceries')).toBeInTheDocument()
    expect(within(legend).getByText('960.00')).toBeInTheDocument()
    // The merge is the point: the per-row names must be GONE, and neither
    // per-row figure (600.00 / 360.00) may survive as its own slice.
    expect(within(legend).queryByText('Tesco run')).not.toBeInTheDocument()
    expect(within(legend).queryByText('Aldi run')).not.toBeInTheDocument()
    expect(within(legend).queryByText('600.00')).not.toBeInTheDocument()
    expect(within(legend).queryByText('360.00')).not.toBeInTheDocument()
  })

  it('keeps two DIFFERENT categories as two slices', () => {
    useCategoryStore.setState({
      categories: [
        category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
        category({ id: 'e2', name: 'Housing', kind: 'expense' }),
      ],
    })
    useExpenseStore.setState({
      expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1'), expenseRow('x2', 'Rent', 3000, 'e2')],
    })

    render(<HomePage />)
    const legend = expenseLegend()

    expect(within(legend).getAllByRole('listitem')).toHaveLength(2)
    expect(within(legend).getByText('Groceries')).toBeInTheDocument()
    expect(within(legend).getByText('Housing')).toBeInTheDocument()
    expect(within(legend).getByText('600.00')).toBeInTheDocument()
    expect(within(legend).getByText('360.00')).toBeInTheDocument()
  })

  it('an UNCATEGORIZED row still falls back to its own name (Decision 10)', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    useExpenseStore.setState({
      expenses: [
        expenseRow('x1', 'Tesco run', 5000, 'e1'),
        expenseRow('x2', 'Netflix', 3000, null),
      ],
    })

    render(<HomePage />)
    const legend = expenseLegend()

    expect(within(legend).getByText('Groceries')).toBeInTheDocument()
    expect(within(legend).getByText('Netflix')).toBeInTheDocument()
  })

  it('never leaks a raw categoryId uuid into the legend', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Groceries' })],
    })
    useExpenseStore.setState({
      expenses: [expenseRow('x1', 'Tesco run', 5000, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')],
    })

    render(<HomePage />)

    expect(within(expenseLegend()).getByText('Groceries')).toBeInTheDocument()
    // The slice label truncates to 11 chars + "...", so a leak would read
    // "cccccccc-cc...". Assert page-wide: the uuid must reach no surface.
    expect(screen.queryByText(/cccccccc-cc/)).not.toBeInTheDocument()
  })
})

describe('AC-7: a rename re-renders the pies', () => {
  it('follows a category rename with no other store change (the memo dependency)', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
    })
    useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

    render(<HomePage />)
    expect(within(expenseLegend()).getByText('Groceries')).toBeInTheDocument()

    // ONLY the category store changes. If `categoryNames` is missing from the
    // financialData memo's dependency list, the pie keeps the old label.
    act(() => {
      useCategoryStore.getState().renameCategory('e1', 'Food')
    })

    const legend = expenseLegend()
    expect(within(legend).getByText('Food')).toBeInTheDocument()
    expect(within(legend).queryByText('Groceries')).not.toBeInTheDocument()
  })
})

describe('AC-3: a dangling categoryId degrades gracefully in the pies', () => {
  it('CAUSE 1 (pull pagination): an id not yet on this device falls back to the row name', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'e-other', name: 'Housing', kind: 'expense' })],
    })
    useExpenseStore.setState({
      expenses: [expenseRow('x1', 'Tesco run', 5000, 'e-not-yet-pulled')],
    })

    render(<HomePage />)
    const legend = expenseLegend()

    expect(within(legend).getByText('Tesco run')).toBeInTheDocument()
    expect(screen.queryByText(/e-not-yet-pulled/)).not.toBeInTheDocument()
  })

  it('CAUSE 2 (deleted on another device): a removed category falls back to the row name', () => {
    useCategoryStore.setState({ categories: [] })
    useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

    render(<HomePage />)

    expect(within(expenseLegend()).getByText('Tesco run')).toBeInTheDocument()
  })

  it('CAUSE 3 (soft-deleted locally): a tombstoned category falls back to the row name', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense', isDeleted: true })],
    })
    useExpenseStore.setState({ expenses: [expenseRow('x1', 'Tesco run', 5000, 'e1')] })

    render(<HomePage />)
    const legend = expenseLegend()

    expect(within(legend).getByText('Tesco run')).toBeInTheDocument()
    // The deleted category's name must not appear as a slice either.
    expect(within(legend).queryByText('Groceries')).not.toBeInTheDocument()
  })
})

describe('AC-7: the INCOME pie groups by category too (found by mutation M34)', () => {
  // ⚠️ The two pies have SEPARATE resolve call sites (`HomePage.tsx` income and
  // expense loops). Covering only the expense side left the income one free to
  // regress: deleting its `resolveCategoryLabel` call kept every other test in
  // this file green.
  it('merges two income sources sharing a category into one slice', () => {
    useCategoryStore.setState({
      categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
    })
    useIncomeStore.setState({
      incomeSources: [
        incomeRow('n1', 'Main salary', 5000, 'i1'),
        incomeRow('n2', 'Overtime', 3000, 'i1'),
      ],
    })

    render(<HomePage />)
    const legend = incomeLegend()

    expect(within(legend).getAllByRole('listitem')).toHaveLength(1)
    expect(within(legend).getByText('Employment')).toBeInTheDocument()
    expect(within(legend).getByText('960.00')).toBeInTheDocument()
    expect(within(legend).queryByText('Main salary')).not.toBeInTheDocument()
    expect(within(legend).queryByText('Overtime')).not.toBeInTheDocument()
  })

  it('falls back to the row name for a dangling income categoryId', () => {
    useCategoryStore.setState({ categories: [] })
    useIncomeStore.setState({ incomeSources: [incomeRow('n1', 'Main salary', 5000, 'i-gone')] })

    render(<HomePage />)

    expect(within(incomeLegend()).getByText('Main salary')).toBeInTheDocument()
    expect(screen.queryByText(/i-gone/)).not.toBeInTheDocument()
  })
})
