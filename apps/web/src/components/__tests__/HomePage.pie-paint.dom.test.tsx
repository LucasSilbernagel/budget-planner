import { render, screen, waitFor, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { Pie, PieChart } from 'recharts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'

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
	// Recharts paints pie labels only after the sector animation, so animation is off
	// or an absence assertion passes vacuously.
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

// Narrow for width queries only, so narrow does not also mean dark.
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
	it('many categories: no labels; list, totals and accessible names intact', async () => {
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
		expect(
			ratioItems.find((li) => li.textContent?.includes('Remaining income'))?.textContent
		).toMatch(/(?<![\d.])46%/)
		expect(screen.getByTestId('breakdown-pie-total-expense')).toHaveTextContent('68,400.00')
		expect(screen.getByTestId('breakdown-pie-total-expense-ratio')).toHaveTextContent(/^54%$/)

		for (const testId of [RATIO, EXPENSE]) {
			const sectors = screen.getByTestId(testId).querySelectorAll('.recharts-sector')
			expect(sectors.length, `${testId}: sectors drawn (control)`).toBeGreaterThan(0)
			const plot = sectors[0]?.closest('[aria-hidden="true"]') as HTMLElement | null
			expect(plot, `${testId}: the plot sits in an aria-hidden wrapper`).not.toBeNull()
			expect(plot).not.toContainElement(within(screen.getByTestId(testId)).getAllByRole('list')[0])
			const focusable = Array.from(plot?.querySelectorAll('[tabindex]') ?? []).filter(
				(el) => Number(el.getAttribute('tabindex')) >= 0
			)
			expect(focusable, `${testId}: no tab stop inside the hidden plot`).toHaveLength(0)
			expect(plot?.querySelector('.recharts-pie')?.getAttribute('tabindex')).toBe('-1')
		}
		expect(screen.queryAllByRole('img')).toHaveLength(0)
	})

	it('a two-slice pie is still readable with no in-plot labels', async () => {
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

	it('a one-slice pie is still readable with no in-plot labels', async () => {
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

	it('no in-plot labels on a NARROW viewport either', async () => {
		matchNarrow(true)
		seed(INCOME, EXPENSES)
		const { container } = render(<HomePage />)
		await assertNoInPlotLabels(container, { ratioSlices: EXPENSES.length + 1, expenseSlices: 6 })
	})
})

describe('Overview bar charts and screen readers', () => {
	it('hides the flows chart (its bars ARE the total cards) but NOT the balances chart (no text twin)', async () => {
		seed(INCOME, EXPENSES)
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment' as const,
					name: 'RRSP',
					currentBalance: 1_000_000,
					monthlyContribution: 0,
					frequency: 'monthly' as const,
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		})
		render(<HomePage />)

		const flows = screen.getByTestId('category-bar-flows')
		const balances = screen.getByTestId('category-bar-balances')
		await waitFor(() => {
			expect(flows.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0)
			expect(balances.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0)
		})
		expect(flows).toHaveAttribute('aria-hidden', 'true')
		// Recharts 3's accessibilityLayer puts tabindex="0" on the surface; an upgrade must turn this red.
		const flowStops = Array.from(flows.querySelectorAll('[tabindex]')).filter(
			(el) => Number(el.getAttribute('tabindex')) >= 0
		)
		expect(flowStops, 'no tab stop inside the hidden flows chart').toHaveLength(0)
		expect(balances).not.toHaveAttribute('aria-hidden')
		expect(balances.closest('[aria-hidden="true"]')).toBeNull()
	})
})
