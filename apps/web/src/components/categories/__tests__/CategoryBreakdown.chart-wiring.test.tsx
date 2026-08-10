/**
 * CategoryBreakdown → Recharts wiring (story 30.5, added at code review).
 *
 * ⚠️ WHY THIS FILE EXISTS. The AC-6 test in `CategoryBreakdown.test.tsx` called
 * `barDomainTicks` directly on two hand-written arrays and compared the results.
 * That asserts the shared helper is deterministic — which was never in doubt —
 * and never involves the component at all, so the regression it is named for
 * (pooling both sides' amounts into one axis, story UX-2's defect) would leave
 * it green. This repo's own rule, stated three times in story 30.5: asserting a
 * chart RENDERED is not asserting WHAT it plotted.
 *
 * jsdom cannot help — `ResponsiveContainer` measures 0×0, so no axis, tick or
 * bar ever reaches the DOM. So Recharts is replaced with prop-capturing stubs
 * and the assertions are made on what each chart was HANDED.
 *
 * ⚠️ Kept in its own file because `vi.mock('recharts')` is module-scoped: doing
 * it in the main suite would silently convert every test there into a
 * mocked-chart test.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { barDomainTicks } from '../../../lib/chart-axis'
import { useExpenseStore, useIncomeStore } from '../../../stores'
import { type ClientCategory, useCategoryStore } from '../../../stores/categoryStore'
import { useOverviewDurationStore } from '../../../stores/overviewDurationStore'

interface CapturedDatum {
  key: string
  category: string
  amount: number
  fill: string
}

interface CapturedChart {
  data: CapturedDatum[]
  ticks: number[]
  domain: [number, number]
}

const captured = vi.hoisted(() => ({ charts: [] as CapturedChart[] }))

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Wrapper,
    // React renders depth-first in tree order, so a BarChart is always followed
    // by its own XAxis before the next BarChart begins — which is what lets the
    // axis props be attributed to the chart pushed immediately before them.
    BarChart: ({ children, data }: { children?: ReactNode; data: CapturedDatum[] }) => {
      captured.charts.push({ data, ticks: [], domain: [0, 0] })
      return <div>{children}</div>
    },
    XAxis: ({ ticks, domain }: { ticks: number[]; domain: [number, number] }) => {
      const current = captured.charts[captured.charts.length - 1]
      if (current) {
        current.ticks = ticks
        current.domain = domain
      }
      return null
    },
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Cell: () => null,
  }
})

const { CategoryBreakdown } = await import('../CategoryBreakdown')

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

function row(id: string, name: string, amount: number, categoryId: string | null) {
  return {
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly' as const,
    categoryId,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

beforeEach(() => {
  captured.charts.length = 0
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useOverviewDurationStore.setState({ duration: 'monthly' })
})

describe('CategoryBreakdown chart wiring', () => {
  it('hands each side a chart built from ONLY its own rows, with its own domain (AC-6)', () => {
    // Income ~$9,000 against expenses ~$150: pooling the two would lift the
    // expense ceiling to the income maximum and crush every expense bar to a
    // sliver — story UX-2's defect, and the reason each chart derives its own.
    useCategoryStore.setState({
      categories: [
        category({ id: 'cat-inc', name: 'Salary', kind: 'income' }),
        category({ id: 'cat-exp', name: 'Groceries' }),
      ],
    })
    useIncomeStore.setState({ incomeSources: [row('i1', 'Job', 900000, 'cat-inc')] })
    useExpenseStore.setState({
      expenses: [row('e1', 'Shop', 10000, 'cat-exp'), row('e2', 'Misc', 5000, null)],
    })

    render(<CategoryBreakdown />)

    expect(captured.charts).toHaveLength(2)
    const income = captured.charts[0] as CapturedChart
    const expense = captured.charts[1] as CapturedChart

    // Each chart plots its own side's amounts, and NEITHER can see the other's.
    expect(income.data.map((datum) => datum.amount)).toEqual([900000])
    expect(expense.data.map((datum) => datum.amount)).toEqual([10000, 5000])
    expect(income.data.map((datum) => datum.amount)).not.toContain(10000)
    expect(expense.data.map((datum) => datum.amount)).not.toContain(900000)

    // And the axes are derived independently. Literal-pinned via the helper on
    // each side's own amounts — the pooled domain is asserted to differ, which
    // is what would change if the two were ever merged.
    const incomeTicks = barDomainTicks([900000])
    const expenseTicks = barDomainTicks([10000, 5000])
    const pooledTicks = barDomainTicks([900000, 10000, 5000])

    expect(income.ticks).toEqual(incomeTicks)
    expect(expense.ticks).toEqual(expenseTicks)
    expect(income.domain[1]).toBe(incomeTicks[incomeTicks.length - 1])
    expect(expense.domain[1]).toBe(expenseTicks[expenseTicks.length - 1])
    expect(expense.ticks).not.toEqual(pooledTicks)
    expect(expense.domain[1]).not.toBe(income.domain[1])
  })

  it('renders no chart at all for a side with no rows', () => {
    useCategoryStore.setState({ categories: [category({ id: 'cat-exp', name: 'Groceries' })] })
    useExpenseStore.setState({ expenses: [row('e1', 'Shop', 10000, 'cat-exp')] })

    render(<CategoryBreakdown />)

    expect(captured.charts).toHaveLength(1)
    expect(screen.queryByTestId('breakdown-income-chart')).not.toBeInTheDocument()
  })

  it('keeps a category bar the SAME colour when the ordering changes around it', () => {
    // ⚠️ `generateColorMap` assigns palette entries BY ARRAY INDEX, so feeding
    // it the magnitude-sorted rows would rebind colours on every reorder: edit
    // one expense so Housing overtakes Groceries and untouched categories
    // change colour. The component sorts the KEYS before generating for exactly
    // this reason.
    useCategoryStore.setState({
      categories: [
        category({ id: 'cat-a', name: 'Groceries' }),
        category({ id: 'cat-b', name: 'Housing' }),
      ],
    })
    useExpenseStore.setState({
      expenses: [row('e1', 'Shop', 50000, 'cat-a'), row('e2', 'Rent', 40000, 'cat-b')],
    })
    const first = render(<CategoryBreakdown />)
    const before = new Map(
      (captured.charts[0] as CapturedChart).data.map((datum) => [datum.key, datum.fill])
    )
    first.unmount()

    // Housing now outranks Groceries — the ROWS reorder, the DATA does not.
    captured.charts.length = 0
    useExpenseStore.setState({
      expenses: [row('e1', 'Shop', 50000, 'cat-a'), row('e2', 'Rent', 90000, 'cat-b')],
    })
    render(<CategoryBreakdown />)
    const after = new Map(
      (captured.charts[0] as CapturedChart).data.map((datum) => [datum.key, datum.fill])
    )

    // The reorder actually happened...
    expect((captured.charts[0] as CapturedChart).data.map((datum) => datum.key)).toEqual([
      'cat-b',
      'cat-a',
    ])
    // ...and neither category changed colour.
    expect(after.get('cat-a')).toBe(before.get('cat-a'))
    expect(after.get('cat-b')).toBe(before.get('cat-b'))
    expect(after.get('cat-a')).not.toBe(after.get('cat-b'))
  })
})
