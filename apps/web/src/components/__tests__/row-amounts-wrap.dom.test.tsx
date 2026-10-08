// jsdom computes no layout: this pins the wiring (amount class + GroupedAmount), never that figures fit.

import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'
import { RESPONSIVE_AMOUNT_CLASS } from '../ui/ResponsiveTable'

const premiumTier = vi.hoisted(() => ({
	status: {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: false,
	} as PremiumAccessStatus,
}))

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => ({ status: premiumTier.status }),
}))

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useCategoryStore.setState({ categories: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	localStorage.clear()
}

beforeEach(() => {
	clearStores()
	useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
})

afterEach(clearStores)

function runsOf(el: Element): string[] {
	const out = ['']
	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeName === 'WBR') out.push('')
			else if (child.nodeType === Node.TEXT_NODE) out[out.length - 1] += child.textContent ?? ''
			else walk(child)
		}
	}
	walk(el)
	return out
}

const tokens = (value: string | null | undefined): string[] =>
	(value ?? '').split(/\s+/).filter(Boolean)

const AMOUNT_TOKENS = tokens(RESPONSIVE_AMOUNT_CLASS)

const isAmount = (el: Element): boolean => {
	const own = tokens(el.getAttribute('class'))
	return AMOUNT_TOKENS.length > 0 && AMOUNT_TOKENS.every((t) => own.includes(t))
}

function cellsLabelled(container: HTMLElement, label: string): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>('tbody td')].filter(
		(td) => td.querySelector(':scope > span.uppercase')?.textContent === label
	)
}

/** The mobile label carries the same `overflow-wrap: normal` token, so it is excluded by being
 * the cell's label, not by its classes. */
function figureIn(td: HTMLElement): HTMLElement {
	const label = td.querySelector(':scope > span.uppercase')
	const figures = [...td.querySelectorAll<HTMLElement>('*')].filter(
		(el) => el !== label && isAmount(el)
	)
	expect(figures, `cell "${td.textContent}" has ${figures.length} amount elements`).toHaveLength(1)
	return figures[0] as HTMLElement
}

interface PageCase {
	name: string
	seed: () => void
	render: () => ReactElement
	figures: Record<string, string[][]>
}

const CASES: PageCase[] = [
	{
		name: 'Income',
		seed: () => {
			useIncomeStore
				.getState()
				.addIncomeSource({ name: 'Salary', amount: 1_234_567_890, frequency: 'monthly' })
		},
		render: () => <IncomePage />,
		figures: { Amount: [['$12,', '345,', '678.90']] },
	},
	{
		name: 'Expenses',
		seed: () => {
			useExpenseStore
				.getState()
				.addExpense({ name: 'Rent', amount: 987_654_321, frequency: 'monthly' })
		},
		render: () => <ExpensesPage />,
		figures: { Amount: [['$9,', '876,', '543.21']] },
	},
	{
		name: 'Savings',
		seed: () => {
			useSavingsStore.getState().addSavingsGoal({
				name: 'House',
				targetAmount: 5_000_000_000,
				currentBalance: 1_234_567_890,
				allocationMode: 'manual',
				monthlyAllocation: 98_765_400,
			})
		},
		render: () => <SavingsPage />,
		figures: {
			Target: [['$50,', '000,', '000.00']],
			'Current Balance': [['$12,', '345,', '678.90']],
			'Monthly Allocation': [['$987,', '654.00']],
		},
	},
	{
		name: 'Balance',
		seed: () => {
			useBalanceStore.getState().addBalanceEntry({
				type: 'investment',
				name: 'Brokerage',
				currentBalance: 1_234_567_890,
				monthlyContribution: 45_678_900,
				frequency: 'monthly',
			})
		},
		render: () => <BalancePage />,
		figures: {
			'Current Balance/Value': [['$12,', '345,', '678.90']],
			Contribution: [['$456,', '789.00']],
		},
	},
]

describe('row money figures wrap only between digit groups (story 91.1)', () => {
	for (const page of CASES) {
		for (const [label, expectedRuns] of Object.entries(page.figures)) {
			it(`${page.name} › every "${label}" figure is a GroupedAmount inside the amount class`, () => {
				page.seed()
				const { container } = renderWithProviders(page.render())

				const cells = cellsLabelled(container, label)
				expect(cells, `no "${label}" cells rendered on ${page.name}`).toHaveLength(
					expectedRuns.length
				)
				cells.forEach((td, i) => {
					const figure = figureIn(td)
					const runs = expectedRuns[i] as string[]
					expect(runsOf(figure)).toEqual(runs)
					expect(figure.textContent).toBe(runs.join(''))
				})
			})
		}
	}

	// The free-text NAME must keep the cell's inherited `anywhere`: with the amount class a long
	// name overflows its wrapper.
	for (const page of CASES) {
		it(`${page.name} › the free-text Name never carries the amount class`, () => {
			page.seed()
			const { container } = renderWithProviders(page.render())
			const cells = cellsLabelled(container, 'Name')
			expect(cells, `no Name cells rendered on ${page.name}`).toHaveLength(1)
			for (const td of cells) {
				const label = td.querySelector(':scope > span.uppercase')
				// ANY amount token, not all: `overflow-wrap: normal` alone is the revert.
				const carriers = [...td.querySelectorAll('*')].filter(
					(el) =>
						el !== label && tokens(el.getAttribute('class')).some((t) => AMOUNT_TOKENS.includes(t))
				)
				expect(carriers, `${page.name}'s Name cell carries the amount class`).toHaveLength(0)
			}
		})
	}

	// Finds figures by rendered text in every cell, so a new money column can't ship ungrouped.
	// Seeds are all >= $1,000 so every figure has a separator; the count is pinned exactly.
	const FIGURE = /-?\$\d{1,3}(?:,\d{3})+\.\d{2}/g
	const SWEEP_COUNT: Record<string, number> = {
		Income: 1,
		Expenses: 1,
		Savings: 3,
		Balance: 2,
	}

	function deepestHolding(td: HTMLElement, figure: string): HTMLElement {
		let el: HTMLElement = td
		for (;;) {
			const child = [...el.children].find((c) => (c.textContent ?? '').includes(figure)) as
				| HTMLElement
				| undefined
			if (!child) return el
			el = child
		}
	}

	for (const page of CASES) {
		it(`${page.name} › EVERY money figure in the table body is a GroupedAmount, named column or not (93.1)`, () => {
			page.seed()
			const { container } = renderWithProviders(page.render())
			const found: string[] = []
			for (const td of container.querySelectorAll<HTMLElement>('tbody td')) {
				for (const match of (td.textContent ?? '').matchAll(FIGURE)) {
					const figure = match[0]
					found.push(figure)
					const holder = deepestHolding(td, figure)
					// The holder must be the figure's own element, or an unrelated <wbr> in the cell fakes a split.
					expect(
						runsOf(holder).join(''),
						`${page.name}: "${figure}" in cell "${td.textContent}" has no element of its own`
					).toBe(figure)
					expect(
						runsOf(holder).length,
						`${page.name}: "${figure}" in cell "${td.textContent}" is a plain string, not a GroupedAmount`
					).toBeGreaterThan(1)
				}
			}
			expect(found, `${page.name}: figures found by the sweep`).toHaveLength(
				SWEEP_COUNT[page.name] as number
			)
		})
	}

	it('Savings › "No target" stays plain words inside the same amount element', () => {
		useSavingsStore
			.getState()
			.addSavingsGoal({ name: 'Rainy Day', targetAmount: null, currentBalance: 50_000 })
		const { container } = renderWithProviders(<SavingsPage />)
		const [td] = cellsLabelled(container, 'Target')
		expect(td, 'no Target cell rendered').toBeDefined()
		const figure = figureIn(td as HTMLElement)
		expect(runsOf(figure)).toEqual(['No target'])
	})

	it('Balance › the "Current Balance/Value" label may break after its slash, and still reads whole', () => {
		useBalanceStore.getState().addBalanceEntry({
			type: 'investment',
			name: 'Brokerage',
			currentBalance: 100_00,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		const { container } = renderWithProviders(<BalancePage />)
		const [td] = cellsLabelled(container, 'Current Balance/Value')
		const label = td?.querySelector(':scope > span.uppercase') as HTMLElement
		expect(runsOf(label)).toEqual(['Current Balance/', 'Value'])
	})
})
