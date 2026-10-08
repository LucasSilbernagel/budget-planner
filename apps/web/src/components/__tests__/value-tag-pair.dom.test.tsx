import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { SavingsPage } from '../SavingsPage'
import {
	RESPONSIVE_AMOUNT_CLASS,
	RESPONSIVE_STACKED_CELL_CLASS,
	RESPONSIVE_TAG_CLASS,
	RESPONSIVE_VALUE_TAG_CLASS,
} from '../ui/ResponsiveTable'

// Every pair is checked by iteration, never `[0]`: a forgotten pair fails silently.
// Structural only; jsdom has no layout.

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

function seedSavings(): void {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
	useSavingsStore.getState().addSavingsGoal({
		name: 'Alpha',
		targetAmount: 900_00,
		currentBalance: 300_00,
	})
	useSavingsStore.getState().addSavingsGoal({
		name: 'Emergency Fund',
		targetAmount: null,
		currentBalance: 500_00,
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
	seedSavings()
})

afterEach(() => {
	useSavingsStore.setState({ savingsGoals: [] })
})

const tokens = (value: string | null | undefined): string[] =>
	(value ?? '').split(/\s+/).filter(Boolean)

/** Class tokens with variant prefixes removed; bracket-aware so `[padding-left:1rem]` survives. */
const bareUtilities = (list: string[]): string[] =>
	list.map((token) => {
		const bracket = token.indexOf('[')
		const head = bracket === -1 ? token : token.slice(0, bracket)
		const stripped = head.replace(/^(?:[a-z][a-z0-9-]*:)+/, '')
		return bracket === -1 ? stripped : stripped + token.slice(bracket)
	})

/** Assert the expectation set is non-empty: a loop over an empty or undefined constant asserts nothing. */
function expectedTokens(name: string, value: string | undefined): string[] {
	const list = tokens(value)
	expect(
		list.length,
		`${name} resolved to no class tokens — this suite would assert nothing`
	).toBeGreaterThan(0)
	return list
}

describe('value/tag pairs on the Savings table', () => {
	it('EVERY allocation cell carries a protected tag and a group-wrapping amount, stacked (AC-1, 91.1)', () => {
		const { container } = renderWithProviders(<SavingsPage />)

		const amounts = [...container.querySelectorAll('[data-testid^="savings-allocation-"]')].filter(
			(el) => !(el.getAttribute('data-testid') ?? '').startsWith('savings-allocation-mode-')
		)
		expect(amounts.length, 'the savings table rendered no allocation cells').toBeGreaterThan(0)

		for (const amount of amounts) {
			const id = amount.getAttribute('data-testid')
			for (const token of expectedTokens('RESPONSIVE_AMOUNT_CLASS', RESPONSIVE_AMOUNT_CLASS)) {
				expect(tokens(amount.getAttribute('class')), `${id} is missing ${token}`).toContain(token)
			}
			expect(
				bareUtilities(tokens(amount.getAttribute('class'))),
				`${id}: the allocation figure is nowrap again (story 91.1 D3 moved it off nowrap)`
			).not.toContain('whitespace-nowrap')
			const cell = amount.closest('td')
			for (const token of expectedTokens(
				'RESPONSIVE_STACKED_CELL_CLASS',
				RESPONSIVE_STACKED_CELL_CLASS
			)) {
				expect(tokens(cell?.getAttribute('class')), `${id} cell is missing ${token}`).toContain(
					token
				)
			}

			const pair = amount.parentElement
			expect(pair, `${id} has no pair wrapper`).not.toBeNull()
			for (const token of expectedTokens(
				'RESPONSIVE_VALUE_TAG_CLASS',
				RESPONSIVE_VALUE_TAG_CLASS
			)) {
				expect(tokens(pair?.getAttribute('class')), `${id} pair is missing ${token}`).toContain(
					token
				)
			}

			// Classified from the store, not rendered text, so an account row can't drop out of the loop.
			const rowId = (id ?? '').replace('savings-allocation-', '')
			const seeded = useSavingsStore.getState().savingsGoals.find((g) => g.id === rowId)
			expect(seeded, `${id} matches no seeded savings row`).toBeDefined()
			const tag = pair?.querySelector('[data-testid^="savings-allocation-mode-"]')
			expect(tag, `${id} has no Auto/Fixed tag`).not.toBeNull()
			for (const token of expectedTokens('RESPONSIVE_TAG_CLASS', RESPONSIVE_TAG_CLASS)) {
				expect(tokens(tag?.getAttribute('class')), `${id} tag is missing ${token}`).toContain(token)
			}
		}
		const seededRows = useSavingsStore.getState().savingsGoals
		expect(seededRows.map((g) => (g.targetAmount == null ? 'account' : 'goal')).sort()).toEqual([
			'account',
			'goal',
		])
		const visitedIds = amounts
			.map((el) => (el.getAttribute('data-testid') ?? '').replace('savings-allocation-', ''))
			.sort()
		expect(visitedIds).toEqual(seededRows.map((g) => g.id).sort())
	})

	it('EVERY name cell protects its badge but leaves the name wrappable (AC-2)', () => {
		const { container } = renderWithProviders(<SavingsPage />)

		const badges = [...container.querySelectorAll('[data-testid^="savings-badge-"]')]
		expect(badges.length, 'the savings table rendered no name badges').toBeGreaterThan(0)

		for (const badge of badges) {
			const id = badge.getAttribute('data-testid')
			for (const token of expectedTokens('RESPONSIVE_TAG_CLASS', RESPONSIVE_TAG_CLASS)) {
				expect(tokens(badge.getAttribute('class')), `${id} is missing ${token}`).toContain(token)
			}

			const pair = badge.parentElement
			for (const token of expectedTokens(
				'RESPONSIVE_VALUE_TAG_CLASS',
				RESPONSIVE_VALUE_TAG_CLASS
			)) {
				expect(tokens(pair?.getAttribute('class')), `${id} pair is missing ${token}`).toContain(
					token
				)
			}

			// The name is unbounded free text and must stay wrappable. Protect the tag, never the value.
			const name = pair?.firstElementChild
			expect(name, `${id} pair has no name element`).not.toBeNull()
			// Variant-stripped: `max-sm:whitespace-nowrap` is the most plausible bad edit.
			expect(
				bareUtilities(tokens(name?.getAttribute('class'))),
				`${id}: the NAME carries whitespace-nowrap (in some variant). That reverts the 320px card layout — only the badge may be protected.`
			).not.toContain('whitespace-nowrap')
			// Nor `overflow-wrap: normal`: the name must keep the cell's inherited `anywhere`.
			expect(
				bareUtilities(tokens(name?.getAttribute('class'))),
				`${id}: the NAME carries the amount class; free text must keep wrapping anywhere`
			).not.toContain('[overflow-wrap:normal]')

			const cell = badge.closest('td')
			for (const token of expectedTokens(
				'RESPONSIVE_STACKED_CELL_CLASS',
				RESPONSIVE_STACKED_CELL_CLASS
			)) {
				expect(tokens(cell?.getAttribute('class')), `${id} cell is missing ${token}`).toContain(
					token
				)
			}
		}
	})

	it('only the TAGS are nowrap: never the name, and never the figure (since 91.1)', () => {
		const { container } = renderWithProviders(<SavingsPage />)
		const nowrapped = [...container.querySelectorAll('td span')].filter((el) =>
			bareUtilities(tokens(el.getAttribute('class'))).includes('whitespace-nowrap')
		)
		// One goal and one account, each with a pill and a badge: 2 × 2 = 4 protected elements.
		expect(
			nowrapped.length,
			'no element carries whitespace-nowrap — this case would assert nothing'
		).toBe(4)
		for (const el of nowrapped) {
			const testId = el.getAttribute('data-testid') ?? ''
			const isTag =
				testId.startsWith('savings-allocation-mode-') || testId.startsWith('savings-badge-')
			expect(
				isTag,
				`an unexpected element carries whitespace-nowrap: ${testId || el.textContent}`
			).toBe(true)
		}
	})
})
