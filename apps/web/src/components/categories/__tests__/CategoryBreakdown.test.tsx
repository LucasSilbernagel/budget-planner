// The jsdom currency baseline has no symbol, so amounts assert as bare numbers.

import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { barDomainTicks } from '../../../lib/chart-axis'
import { useExpenseStore, useIncomeStore } from '../../../stores'
import { type ClientCategory, useCategoryStore } from '../../../stores/categoryStore'
import { useOverviewDurationStore } from '../../../stores/overviewDurationStore'
import { CategoryBreakdown } from '../CategoryBreakdown'

const NOW = '2026-01-01T00:00:00.000Z'

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
  return {
    userId: 0,
    profileId: null,
    name: 'Groceries',
    kind: 'expense',
    isDeleted: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function row(
  id: string,
  name: string,
  amount: number,
  categoryId: string | null,
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'annually' = 'monthly'
) {
  return { id, userId: 0, name, amount, frequency, categoryId, createdAt: NOW, updatedAt: NOW }
}

type Row = ReturnType<typeof row>

function seed({
  income = [],
  expenses = [],
  categories = [],
}: {
  income?: Row[]
  expenses?: Row[]
  categories?: ClientCategory[]
}): void {
  useIncomeStore.setState({ incomeSources: income })
  useExpenseStore.setState({ expenses })
  useCategoryStore.setState({ categories })
}

// Scoped per side: both sides render identical markup, so a page-wide query passes on the wrong side.
function rowsOf(side: 'income' | 'expense'): string[][] {
  const table = screen.getByTestId(`breakdown-${side}-table`)
  return within(table)
    .getAllByTestId(`breakdown-${side}-row`)
    .map((tr) =>
      within(tr)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? '')
    )
    .map((cells, index) => {
      const header = within(
        within(table).getAllByTestId(`breakdown-${side}-row`)[index] as HTMLElement
      ).getAllByRole('rowheader')[0]
      return [header?.textContent ?? '', ...cells]
    })
}

function labelsOf(side: 'income' | 'expense'): string[] {
  return rowsOf(side).map(([label]) => label ?? '')
}

function totalOf(side: 'income' | 'expense'): string {
  const footer = screen.getByTestId(`breakdown-${side}-total`)
  return within(footer).getAllByRole('cell')[0]?.textContent ?? ''
}

beforeEach(() => {
  seed({})
  useOverviewDurationStore.setState({ duration: 'monthly' })
})

describe('CategoryBreakdown', () => {
  describe('grouping by categoryId (AC-1)', () => {
    it('merges EXPENSES sharing one category into a single row with a count-correct total', () => {
      seed({
        categories: [category({ id: 'cat-groceries', name: 'Groceries' })],
        expenses: [
          row('e1', 'Weekly shop', 20000, 'cat-groceries'),
          row('e2', 'Corner store', 30000, 'cat-groceries'),
        ],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Groceries'])
      expect(screen.queryByText('Weekly shop')).not.toBeInTheDocument()
      expect(screen.queryByText('Corner store')).not.toBeInTheDocument()
      expect(rowsOf('expense')[0]?.[1]).toBe('500.00')
    })

    it('merges INCOME sharing one category into a single row with a count-correct total', () => {
      seed({
        categories: [category({ id: 'cat-employment', name: 'Employment', kind: 'income' })],
        income: [
          row('i1', 'Main salary', 400000, 'cat-employment'),
          row('i2', 'Bonus', 100000, 'cat-employment'),
        ],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Employment'])
      expect(screen.queryByText('Main salary')).not.toBeInTheDocument()
      expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
      expect(rowsOf('income')[0]?.[1]).toBe('5,000.00')
    })

    it('folds two DIFFERENTLY-NAMED uncategorized EXPENSES into ONE Uncategorized row', () => {
      // The overview pies keep these as two slices; here they must be one bucket.
      seed({
        expenses: [row('e1', 'Rent', 100000, null), row('e2', 'Petrol', 50000, null)],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Uncategorized'])
      expect(screen.queryByText('Rent')).not.toBeInTheDocument()
      expect(screen.queryByText('Petrol')).not.toBeInTheDocument()
      expect(rowsOf('expense')[0]?.[1]).toBe('1,500.00')
    })

    it('folds two DIFFERENTLY-NAMED uncategorized INCOME rows into ONE Uncategorized row', () => {
      seed({
        income: [row('i1', 'Salary', 100000, null), row('i2', 'Dividends', 50000, null)],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Uncategorized'])
      expect(screen.queryByText('Salary')).not.toBeInTheDocument()
      expect(screen.queryByText('Dividends')).not.toBeInTheDocument()
      expect(rowsOf('income')[0]?.[1]).toBe('1,500.00')
    })

    it('normalizes frequency rather than summing raw entered amounts', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Weekly shop', 10000, 'cat-a', 'weekly')],
      })
      render(<CategoryBreakdown />)

      // Math.round(10000 * 52/12) = 43333; a raw sum would show 100.00.
      expect(rowsOf('expense')[0]?.[1]).toBe('433.33')
    })
  })

  describe('separate wholes (AC-2)', () => {
    it('measures an EXPENSE share against the expense total, not a combined one', () => {
      seed({
        categories: [
          category({ id: 'cat-inc', name: 'Employment', kind: 'income' }),
          category({ id: 'cat-exp', name: 'Groceries' }),
        ],
        income: [row('i1', 'Salary', 900000, 'cat-inc')],
        expenses: [row('e1', 'Shop', 75000, 'cat-exp'), row('e2', 'Other', 25000, null)],
      })
      render(<CategoryBreakdown />)

      // A combined denominator (1,000,000) would render 7.5% instead.
      expect(rowsOf('expense')[0]).toEqual(['Groceries', '750.00', '75.0%'])
      expect(rowsOf('expense')[1]).toEqual(['Uncategorized', '250.00', '25.0%'])
      expect(totalOf('expense')).toBe('1,000.00')
    })

    it('measures an INCOME share against the income total, not a combined one', () => {
      seed({
        categories: [
          category({ id: 'cat-inc', name: 'Employment', kind: 'income' }),
          category({ id: 'cat-exp', name: 'Groceries' }),
        ],
        income: [row('i1', 'Salary', 75000, 'cat-inc'), row('i2', 'Other', 25000, null)],
        expenses: [row('e1', 'Shop', 900000, 'cat-exp')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('income')[0]).toEqual(['Employment', '750.00', '75.0%'])
      expect(rowsOf('income')[1]).toEqual(['Uncategorized', '250.00', '25.0%'])
      expect(totalOf('income')).toBe('1,000.00')
    })

    it('renders per-side totals that equal the sum of that side rows', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Housing' }),
        ],
        expenses: [row('e1', 'Shop', 30000, 'cat-a'), row('e2', 'Rent', 120000, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense').map((cells) => cells[1])).toEqual(['1,200.00', '300.00'])
      expect(totalOf('expense')).toBe('1,500.00')
    })
  })

  describe('cadence follows the global overview preference (AC-3)', () => {
    it('re-expresses EXPENSE totals when the preference changes', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      const { rerender } = render(<CategoryBreakdown />)

      expect(rowsOf('expense')[0]?.[1]).toBe('1,000.00')

      act(() => {
        useOverviewDurationStore.setState({ duration: 'annually' })
      })
      rerender(<CategoryBreakdown />)

      expect(rowsOf('expense')[0]?.[1]).toBe('12,000.00')
    })

    it('re-expresses INCOME totals when the preference changes', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Employment', kind: 'income' })],
        income: [row('i1', 'Salary', 100000, 'cat-a')],
      })
      const { rerender } = render(<CategoryBreakdown />)

      expect(rowsOf('income')[0]?.[1]).toBe('1,000.00')

      act(() => {
        useOverviewDurationStore.setState({ duration: 'annually' })
      })
      rerender(<CategoryBreakdown />)

      expect(rowsOf('income')[0]?.[1]).toBe('12,000.00')
    })

    it('names the cadence in each side heading, since this page has no cadence control', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      const { rerender } = render(<CategoryBreakdown />)

      expect(
        screen.getByRole('heading', { name: /expenses by category \(per month\)/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: /income by category \(per month\)/i })
      ).toBeInTheDocument()

      act(() => {
        useOverviewDurationStore.setState({ duration: 'weekly' })
      })
      rerender(<CategoryBreakdown />)

      expect(
        screen.getByRole('heading', { name: /expenses by category \(per week\)/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: /income by category \(per week\)/i })
      ).toBeInTheDocument()
    })
  })

  describe('empty and degenerate states (AC-4)', () => {
    it('shows a whole-section empty state when there is no income and no expenses', () => {
      render(<CategoryBreakdown />)

      expect(screen.getByTestId('breakdown-empty')).toBeInTheDocument()
      expect(screen.queryByTestId('breakdown-income-table')).not.toBeInTheDocument()
      expect(screen.queryByTestId('breakdown-expense-table')).not.toBeInTheDocument()
      expect(screen.getByTestId('breakdown-empty')).toHaveTextContent(
        /no need to categorize everything first/i
      )
    })

    it('renders the populated EXPENSE side and an empty label for the income side', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      expect(screen.getByTestId('breakdown-expense-table')).toBeInTheDocument()
      expect(screen.getByTestId('breakdown-income-empty')).toHaveTextContent(
        /no income to break down yet/i
      )
      expect(screen.queryByTestId('breakdown-income-table')).not.toBeInTheDocument()
      expect(screen.queryByTestId('breakdown-empty')).not.toBeInTheDocument()
    })

    it('renders the populated INCOME side and an empty label for the expense side', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Employment', kind: 'income' })],
        income: [row('i1', 'Salary', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      expect(screen.getByTestId('breakdown-income-table')).toBeInTheDocument()
      expect(screen.getByTestId('breakdown-expense-empty')).toHaveTextContent(
        /no expenses to break down yet/i
      )
      expect(screen.queryByTestId('breakdown-expense-table')).not.toBeInTheDocument()
    })

    it('renders 0.0% shares — never NaN or Infinity — when a side totals zero cents', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Housing' }),
        ],
        expenses: [row('e1', 'Shop', 0, 'cat-a'), row('e2', 'Rent', 0, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense').map((cells) => cells[2])).toEqual(['0.0%', '0.0%'])
      const section = screen.getByTestId('category-breakdown')
      expect(section.textContent).not.toMatch(/NaN/)
      expect(section.textContent).not.toMatch(/Infinity/)
    })

    it('renders every-row-uncategorized as ONE 100% row, not an empty state', () => {
      seed({ expenses: [row('e1', 'Rent', 100000, null)] })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense')).toEqual([['Uncategorized', '1,000.00', '100.0%']])
      expect(screen.queryByTestId('breakdown-empty')).not.toBeInTheDocument()
    })

    it('omits categories that no row uses — it enumerates rows, not categories', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-unused', name: 'Holidays' }),
        ],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Groceries'])
      expect(screen.queryByText('Holidays')).not.toBeInTheDocument()
    })

    it('folds a DANGLING categoryId into Uncategorized and never leaks the raw uuid', () => {
      const dangling = '9f1c2b7e-0000-4aaa-8bbb-ccccdddd1111'
      seed({ expenses: [row('e1', 'Rent', 100000, dangling)] })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Uncategorized'])
      expect(screen.getByTestId('category-breakdown').textContent).not.toContain(dangling)
    })

    it('folds a TOMBSTONED category into Uncategorized (deleted elsewhere is a normal state)', () => {
      seed({
        categories: [category({ id: 'cat-gone', name: 'Groceries', isDeleted: true })],
        expenses: [row('e1', 'Shop', 100000, 'cat-gone')],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Uncategorized'])
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    })

    it('renders 0.0% shares — never NaN or Infinity — when the INCOME side totals zero cents', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Salary', kind: 'income' }),
          category({ id: 'cat-b', name: 'Bonus', kind: 'income' }),
        ],
        income: [row('i1', 'Job', 0, 'cat-a'), row('i2', 'Extra', 0, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('income').map((cells) => cells[2])).toEqual(['0.0%', '0.0%'])
      const section = screen.getByTestId('category-breakdown')
      expect(section.textContent).not.toMatch(/NaN/)
      expect(section.textContent).not.toMatch(/Infinity/)
    })

    it('renders every INCOME row uncategorized as ONE 100% row, not an empty state', () => {
      seed({ income: [row('i1', 'Salary', 100000, null)] })
      render(<CategoryBreakdown />)

      expect(rowsOf('income')).toEqual([['Uncategorized', '1,000.00', '100.0%']])
      expect(screen.queryByTestId('breakdown-empty')).not.toBeInTheDocument()
    })

    it('folds a DANGLING INCOME categoryId into Uncategorized and never leaks the raw uuid', () => {
      const dangling = '3b7c1a5d-1111-4ccc-9ddd-eeeeffff2222'
      seed({ income: [row('i1', 'Salary', 100000, dangling)] })
      render(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Uncategorized'])
      expect(screen.getByTestId('category-breakdown').textContent).not.toContain(dangling)
    })

    it('folds a TOMBSTONED INCOME category into Uncategorized', () => {
      seed({
        categories: [
          category({ id: 'cat-gone', name: 'Employment', kind: 'income', isDeleted: true }),
        ],
        income: [row('i1', 'Salary', 100000, 'cat-gone')],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Uncategorized'])
      expect(screen.queryByText('Employment')).not.toBeInTheDocument()
    })

    it('degrades a corrupt INCOME row rather than throwing during render', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Employment', kind: 'income' })],
        income: [
          row('i1', 'Salary', 100000, 'cat-a'),
          { ...row('i2', 'Corrupt', 0, 'cat-a'), amount: Number.NaN },
          { ...row('i3', 'Bad frequency', 5000, 'cat-a'), frequency: 'quarterly' as never },
        ],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('income')).toEqual([['Employment', '1,000.00', '100.0%']])
    })

    it('degrades a corrupt row rather than throwing during render', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [
          row('e1', 'Shop', 100000, 'cat-a'),
          { ...row('e2', 'Corrupt', 0, 'cat-a'), amount: Number.NaN },
          { ...row('e3', 'Bad frequency', 5000, 'cat-a'), frequency: 'quarterly' as never },
        ],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense')).toEqual([['Groceries', '1,000.00', '100.0%']])
    })
  })

  describe('live updates', () => {
    it('follows an EXPENSE category rename rather than going stale', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      const { rerender } = render(<CategoryBreakdown />)
      expect(labelsOf('expense')).toEqual(['Groceries'])

      act(() => {
        useCategoryStore.setState({
          categories: [category({ id: 'cat-a', name: 'Food & drink' })],
        })
      })
      rerender(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Food & drink'])
      expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    })

    it('follows an INCOME category rename rather than going stale', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Employment', kind: 'income' })],
        income: [row('i1', 'Salary', 100000, 'cat-a')],
      })
      const { rerender } = render(<CategoryBreakdown />)
      expect(labelsOf('income')).toEqual(['Employment'])

      act(() => {
        useCategoryStore.setState({
          categories: [category({ id: 'cat-a', name: 'Day job', kind: 'income' })],
        })
      })
      rerender(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Day job'])
      expect(screen.queryByText('Employment')).not.toBeInTheDocument()
    })
  })

  describe('ordering and charts', () => {
    it('orders by descending magnitude with Uncategorized last even when largest', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Housing' }),
        ],
        expenses: [
          row('e1', 'Shop', 10000, 'cat-a'),
          row('e2', 'Rent', 50000, 'cat-b'),
          row('e3', 'Misc', 90000, null),
        ],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('expense')).toEqual(['Housing', 'Groceries', 'Uncategorized'])
    })

    it('orders INCOME by descending magnitude with Uncategorized last even when largest', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Bonus', kind: 'income' }),
          category({ id: 'cat-b', name: 'Salary', kind: 'income' }),
        ],
        income: [
          row('i1', 'Q1', 10000, 'cat-a'),
          row('i2', 'Job', 50000, 'cat-b'),
          row('i3', 'Odd jobs', 90000, null),
        ],
      })
      render(<CategoryBreakdown />)

      expect(labelsOf('income')).toEqual(['Salary', 'Bonus', 'Uncategorized'])
    })

    it('renders a chart per populated side and none for an empty side', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      expect(screen.getByTestId('breakdown-expense-chart')).toBeInTheDocument()
      expect(screen.queryByTestId('breakdown-income-chart')).not.toBeInTheDocument()
    })

    it('barDomainTicks yields a different domain per amount set (helper precondition)', () => {
      // Precondition only: these amount sets produce different domains, so the wiring test can tell them apart.
      const incomeAmounts = [900000]
      const expenseAmounts = [10000, 5000]

      const incomeTicks = barDomainTicks(incomeAmounts)
      const expenseTicks = barDomainTicks(expenseAmounts)

      expect(incomeTicks).not.toEqual(expenseTicks)
      expect(incomeTicks[incomeTicks.length - 1]).toBeGreaterThan(
        expenseTicks[expenseTicks.length - 1] ?? 0
      )
      expect(barDomainTicks([...incomeAmounts, ...expenseAmounts])).not.toEqual(expenseTicks)
    })
  })

  describe('the residual bucket is identified structurally, not by its label', () => {
    it('marks the residual EXPENSE row and leaves real category rows unmarked', () => {
      seed({
        categories: [category({ id: 'cat-real', name: 'Uncategorized' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-real'), row('e2', 'Misc', 50000, null)],
      })
      render(<CategoryBreakdown />)

      const table = screen.getByTestId('breakdown-expense-table')
      const rows = within(table).getAllByTestId('breakdown-expense-row')
      expect(labelsOf('expense')).toEqual(['Uncategorized', 'Uncategorized'])
      expect(rows[0]?.getAttribute('data-uncategorized')).toBeNull()
      expect(rows[1]?.getAttribute('data-uncategorized')).toBe('true')
      expect(rows[0]?.getAttribute('data-category-key')).toBe('cat-real')
      expect(rows[1]?.getAttribute('data-category-key')).toBe('uncategorized')
    })

    it('marks the residual INCOME row and leaves real category rows unmarked', () => {
      seed({
        categories: [category({ id: 'cat-real', name: 'Uncategorized', kind: 'income' })],
        income: [row('i1', 'Job', 100000, 'cat-real'), row('i2', 'Odd', 50000, null)],
      })
      render(<CategoryBreakdown />)

      const rows = within(screen.getByTestId('breakdown-income-table')).getAllByTestId(
        'breakdown-income-row'
      )
      expect(rows[0]?.getAttribute('data-uncategorized')).toBeNull()
      expect(rows[1]?.getAttribute('data-uncategorized')).toBe('true')
    })
  })

  describe('shares are suppressed when a side mixes signs', () => {
    it('replaces EXPENSE shares with an em dash and explains why', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Refund' }),
        ],
        expenses: [row('e1', 'Shop', 10000, 'cat-a'), row('e2', 'Credit', -9999, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense').map((cells) => cells[2])).toEqual(['—', '—'])
      expect(screen.getByTestId('breakdown-expense-share-suppressed')).toHaveTextContent(
        /mixes positive and negative amounts/i
      )
      expect(screen.getByTestId('category-breakdown').textContent).not.toContain('1000000.0%')
    })

    it('replaces INCOME shares with an em dash and explains why', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Salary', kind: 'income' }),
          category({ id: 'cat-b', name: 'Clawback', kind: 'income' }),
        ],
        income: [row('i1', 'Job', 10000, 'cat-a'), row('i2', 'Repaid', -10000, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('income').map((cells) => cells[2])).toEqual(['—', '—'])
      expect(screen.getByTestId('breakdown-income-share-suppressed')).toBeInTheDocument()
      expect(rowsOf('income').map((cells) => cells[2])).not.toContain('0.0%')
    })

    it('keeps shares — and shows no note — when every row on a side shares a sign', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Housing' }),
        ],
        expenses: [row('e1', 'Shop', 25000, 'cat-a'), row('e2', 'Rent', 75000, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense').map((cells) => cells[2])).toEqual(['75.0%', '25.0%'])
      expect(screen.queryByTestId('breakdown-expense-share-suppressed')).not.toBeInTheDocument()
    })

    it('keeps shares for an all-NEGATIVE side — one sign is still one whole', () => {
      seed({
        categories: [
          category({ id: 'cat-a', name: 'Groceries' }),
          category({ id: 'cat-b', name: 'Housing' }),
        ],
        expenses: [row('e1', 'Refund', -25000, 'cat-a'), row('e2', 'Credit', -75000, 'cat-b')],
      })
      render(<CategoryBreakdown />)

      expect(rowsOf('expense').map((cells) => cells[2])).toEqual(['75.0%', '25.0%'])
      expect(screen.queryByTestId('breakdown-expense-share-suppressed')).not.toBeInTheDocument()
    })
  })

  describe('the non-integral-cadence rounding note', () => {
    // Rows round per bucket, the dashboard over the whole set; only non-integral multipliers
    // (weekly, biweekly) make those disagree.
    it.each(['weekly', 'biweekly'] as const)('appears at a %s cadence', (duration) => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      useOverviewDurationStore.setState({ duration })
      render(<CategoryBreakdown />)

      expect(screen.getByTestId('breakdown-rounding-note')).toHaveTextContent(
        /differ from the dashboard total by a few cents/i
      )
    })

    it('is absent at monthly and annually, where the two agree exactly', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })

      for (const duration of ['monthly', 'annually'] as const) {
        useOverviewDurationStore.setState({ duration })
        const { unmount } = render(<CategoryBreakdown />)
        expect(screen.queryByTestId('breakdown-rounding-note')).not.toBeInTheDocument()
        unmount()
      }
    })
  })

  describe('accessibility and layout', () => {
    it('gives every row a distinguishing row header and column headers', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      const table = screen.getByTestId('breakdown-expense-table')
      expect(within(table).getByRole('columnheader', { name: /^category$/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /^total$/i })).toBeInTheDocument()
      expect(within(table).getByRole('columnheader', { name: /^share$/i })).toBeInTheDocument()
      expect(within(table).getByRole('rowheader', { name: 'Groceries' })).toBeInTheDocument()
    })

    it('lets a very long category name wrap instead of widening the page', () => {
      const longName = 'A'.repeat(255)
      seed({
        categories: [category({ id: 'cat-a', name: longName })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      const table = screen.getByTestId('breakdown-expense-table')
      expect([...table.classList]).toContain('table-fixed')
      const header = within(table).getByRole('rowheader', { name: longName })
      expect([...header.classList]).toContain('break-words')
      expect([...header.classList]).toContain('min-w-0')
    })

    it('uses semantic surface/text tokens, never light-only hardcoded colours', () => {
      seed({
        categories: [category({ id: 'cat-a', name: 'Groceries' })],
        expenses: [row('e1', 'Shop', 100000, 'cat-a')],
      })
      render(<CategoryBreakdown />)

      const section = screen.getByTestId('category-breakdown')
      const classes = [section, ...section.querySelectorAll('*')].flatMap((element) => [
        ...element.classList,
      ])
      expect(classes).not.toContain('bg-white')
      expect(classes).not.toContain('text-gray-900')
      expect(classes).toContain('surface')
    })
  })
})
