// jsdom gives ResponsiveContainer a 0x0 box, so Recharts renders no SVG: assert on the
// props each stubbed <Pie> receives. vi.mock('recharts') is module-scoped, hence its own file.
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'

interface CapturedPie {
	label: unknown
	labelLine: unknown
}

type TooltipFormatter = (value: number, name: string) => [string, string]

const captured = vi.hoisted(() => ({
	pies: [] as CapturedPie[],
	tooltipFormatters: [] as TooltipFormatter[],
}))

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('recharts', () => {
	const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
	return {
		// Must render children: a missing stub doesn't throw, the page's ErrorBoundary
		// swallows it and captured.pies stays empty.
		ResponsiveContainer: Passthrough,
		PieChart: Passthrough,
		Pie: ({ label, labelLine }: CapturedPie) => {
			captured.pies.push({ label, labelLine })
			return null
		},
		BarChart: Passthrough,
		Bar: () => null,
		CartesianGrid: () => null,
		Cell: () => null,
		Tooltip: ({ formatter }: { formatter?: TooltipFormatter }) => {
			if (formatter) {
				captured.tooltipFormatters.push(formatter)
			}
			return null
		},
		XAxis: () => null,
		YAxis: () => null,
	}
})

const { HomePage } = await import('../HomePage')

const NOW = '2026-01-01T00:00:00.000Z'

function row(id: string, name: string, amount: number) {
	return {
		id,
		userId: 0,
		name,
		amount,
		frequency: 'monthly' as const,
		categoryId: null,
		createdAt: NOW,
		updatedAt: NOW,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	captured.pies.length = 0
	captured.tooltipFormatters.length = 0
	usePremiumAccess.mockReturnValue({
		status: {
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: false,
		} satisfies PremiumAccessStatus,
	})
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	useCategoryStore.setState({ categories: [] })
	// BreakdownPie renders a placeholder before <Pie> for an empty list, so both sides need data.
	useIncomeStore.setState({
		incomeSources: [row('i1', 'Salary', 500_000), row('i2', 'Freelance', 120_000)],
	})
	useExpenseStore.setState({
		expenses: [row('e1', 'Rent', 200_000), row('e2', 'Groceries', 60_000)],
	})
})

describe('BreakdownPie in-plot slice labels (story 36.2)', () => {
	it('AC-1: hands BOTH pies `label={false}`, so no in-plot text can paint', async () => {
		render(<HomePage />)

		await waitFor(() => expect(captured.pies).toHaveLength(2))

		for (const [index, pie] of captured.pies.entries()) {
			expect(pie.label, `pies[${index}].label`).toBe(false)
		}
	})

	it('AC-1: keeps `labelLine={false}` on BOTH pies', async () => {
		render(<HomePage />)

		await waitFor(() => expect(captured.pies).toHaveLength(2))

		for (const [index, pie] of captured.pies.entries()) {
			expect(pie.labelLine, `pies[${index}].labelLine`).toBe(false)
		}
	})
})

describe('pie tooltip zero-total guard (story 36.2, re-pinning story 32.3)', () => {
	it('emits no "NaN" when every slice is zero', async () => {
		useIncomeStore.setState({
			incomeSources: [row('i1', 'Salary', 0), row('i2', 'Freelance', 0)],
		})
		useExpenseStore.setState({
			expenses: [row('e1', 'Rent', 0), row('e2', 'Groceries', 0)],
		})

		render(<HomePage />)

		await waitFor(() => expect(captured.pies).toHaveLength(2))
		expect(captured.tooltipFormatters.length).toBeGreaterThanOrEqual(2)

		for (const [index, formatter] of captured.tooltipFormatters.entries()) {
			const [rendered] = formatter(0, 'Groceries')
			expect(rendered, `tooltipFormatters[${index}]`).not.toContain('NaN')
		}
	})
})

describe('pie tooltip content (was e2e, story 84.5)', () => {
	it('each pie reads the slice as a $ amount AND its own share (was e2e :360, :412)', async () => {
		const pinned = useCurrencyStore.getState()
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		try {
			render(<HomePage />)
			await waitFor(() => expect(captured.pies).toHaveLength(2))

			// tooltipFormatters also holds the bar chart's amount-only tooltip, so assert membership.
			const readings = captured.tooltipFormatters.map((format) => format(2_400_000, 'Rent'))
			expect(readings.map(([amount]) => amount)).toEqual(
				expect.arrayContaining(['$24,000.00 (76.9%)', '$24,000.00 (32.3%)'])
			)
			for (const [, name] of readings) expect(name, 'the tooltip names the slice').toBe('Rent')
		} finally {
			useCurrencyStore.setState({ mode: pinned.mode, currency: pinned.currency })
		}
	})
})
