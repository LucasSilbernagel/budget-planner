// jsdom measures ResponsiveContainer at 0x0, so Recharts is stubbed to capture the props each chart gets.
// Separate file because vi.mock(recharts) is module-scoped.

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
		// Depth-first render order puts each BarChart's XAxis right after it, which attributes axis props to their chart.
		BarChart: ({ children, data }: { children?: ReactNode; data: CapturedDatum[] }) => {
			captured.charts.push({ data, ticks: [], domain: [0, 0] })
			return <div>{children}</div>
		},
		XAxis: ({ ticks, domain }: { ticks: number[]; domain: [number, number] }) => {
			const current = captured.charts.at(-1)
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
		// Pooling would lift the expense ceiling to the income maximum and crush every expense bar.
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

		expect(income.data.map((datum) => datum.amount)).toEqual([900000])
		expect(expense.data.map((datum) => datum.amount)).toEqual([10000, 5000])
		expect(income.data.map((datum) => datum.amount)).not.toContain(10000)
		expect(expense.data.map((datum) => datum.amount)).not.toContain(900000)

		const incomeTicks = barDomainTicks([900000])
		const expenseTicks = barDomainTicks([10000, 5000])
		const pooledTicks = barDomainTicks([900000, 10000, 5000])

		expect(income.ticks).toEqual(incomeTicks)
		expect(expense.ticks).toEqual(expenseTicks)
		expect(income.domain[1]).toBe(incomeTicks.at(-1))
		expect(expense.domain[1]).toBe(expenseTicks.at(-1))
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
		// generateColorMap assigns by array index, so the component must sort keys to survive reorders.
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

		captured.charts.length = 0
		useExpenseStore.setState({
			expenses: [row('e1', 'Shop', 50000, 'cat-a'), row('e2', 'Rent', 90000, 'cat-b')],
		})
		render(<CategoryBreakdown />)
		const after = new Map(
			(captured.charts[0] as CapturedChart).data.map((datum) => [datum.key, datum.fill])
		)

		expect((captured.charts[0] as CapturedChart).data.map((datum) => datum.key)).toEqual([
			'cat-b',
			'cat-a',
		])
		expect(after.get('cat-a')).toBe(before.get('cat-a'))
		expect(after.get('cat-b')).toBe(before.get('cat-b'))
		expect(after.get('cat-a')).not.toBe(after.get('cat-b'))
	})
})
