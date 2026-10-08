import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	restoreRegionWidths,
	setRegionFits,
	setRegionOverflows,
	stubRegionWidths,
} from '@/test/region-widths'
import { renderWithProviders, screen } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'
import { RESPONSIVE_SCROLL_SHADOW_CLASS, RESPONSIVE_WRAPPER_CLASS } from '../ui/ResponsiveTable'

// Structural only: jsdom has no layout. Region widths are stubbed so the Tab-stop rule is checked both ways.

const premiumTier = vi.hoisted(() => ({
	status: {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: true,
	} as PremiumAccessStatus,
}))

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => ({ status: premiumTier.status }),
}))

const FLOW_SEED = [{ name: 'Alpha', amount: 100_00, frequency: 'monthly' as const }]

function seedAll(): void {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
	for (const row of FLOW_SEED) {
		useIncomeStore.getState().addIncomeSource(row)
		useExpenseStore.getState().addExpense(row)
	}
	useSavingsStore.getState().addSavingsGoal({
		name: 'Alpha',
		targetAmount: 900_00,
		currentBalance: 300_00,
	})
	useBalanceStore.getState().addBalanceEntry({
		type: 'investment',
		name: 'Alpha',
		currentBalance: 300_00,
		monthlyContribution: 100_00,
		frequency: 'monthly',
	})
	vi.useRealTimers()
}

beforeEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useCategoryStore.setState({ categories: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
	localStorage.clear()
	seedAll()
})

afterEach(() => {
	restoreRegionWidths()
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useCategoryStore.setState({ categories: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.setState({ entries: [] })
})

const PAGES = [
	{ name: 'Income', render: () => renderWithProviders(<IncomePage />) },
	{ name: 'Expenses', render: () => renderWithProviders(<ExpensesPage />) },
	{ name: 'Savings', render: () => renderWithProviders(<SavingsPage />) },
	{ name: 'Balance', render: () => renderWithProviders(<BalancePage />) },
] as const

describe('table scroll region', () => {
	for (const page of PAGES) {
		describe(page.name, () => {
			for (const state of ['overflows', 'fits'] as const) {
				it(`wraps EVERY table it renders in a named region, a Tab stop only while it scrolls (AC-5; 93.1): ${state}`, () => {
					// Every table-bearing region, not `[0]`, so a second table can't ship unwired.
					stubRegionWidths()
					if (state === 'overflows') setRegionOverflows()
					else setRegionFits()
					const { container } = page.render()
					const regions = [...container.querySelectorAll('div.overflow-x-auto')].filter((el) =>
						el.querySelector('table')
					)
					expect(regions.length, `${page.name} renders no table scroll wrapper`).toBeGreaterThan(0)
					for (const region of regions) {
						expect(region.getAttribute('role'), `${page.name} wrapper is not a region`).toBe(
							'region'
						)
						if (state === 'overflows') {
							expect(
								region.getAttribute('tabindex'),
								`${page.name} scrolls but is not focusable`
							).toBe('0')
						} else {
							expect(region.hasAttribute('tabindex'), `${page.name} fits but is a Tab stop`).toBe(
								false
							)
						}
						expect(region.getAttribute('aria-label')?.trim()).toBeTruthy()
					}
				})
			}

			it('declares the scroll affordance alongside the wrapper class (AC-1, AC-7)', () => {
				page.render()
				const region = screen.getAllByRole('region')[0]
				const classes = [...region.classList]
				for (const token of RESPONSIVE_WRAPPER_CLASS.split(/\s+/)) {
					expect(classes, `${page.name} lost ${token}`).toContain(token)
				}
				for (const token of RESPONSIVE_SCROLL_SHADOW_CLASS.split(/\s+/)) {
					expect(classes, `${page.name} is missing ${token}`).toContain(token)
				}
			})

			it('nests no second scroll container (AC-7)', () => {
				// A nested `overflow-x-auto` makes a bare `querySelector('div.overflow-x-auto')` pick the wrong one.
				const { container } = page.render()
				const wrappers = container.querySelectorAll('div.overflow-x-auto')
				for (const w of wrappers) {
					expect(
						w.querySelector('div.overflow-x-auto'),
						`${page.name} nests a second scroll container`
					).toBeNull()
				}
			})
		})
	}

	it('every shared-layer table on every page is inside a scroll region', () => {
		for (const page of PAGES) {
			const { container, unmount } = page.render()
			const tables = [...container.querySelectorAll('table')]
			expect(tables.length, `${page.name} rendered no table to check`).toBeGreaterThan(0)
			for (const table of tables) {
				const region = table.closest('div.overflow-x-auto')
				expect(region, `${page.name} has a table outside a scroll wrapper`).not.toBeNull()
				expect(region?.getAttribute('role'), `${page.name} wrapper is not a region`).toBe('region')
			}
			unmount()
		}
	})
})
