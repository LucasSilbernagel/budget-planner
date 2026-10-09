import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { type ClientCategory, useCategoryStore } from '../../../stores/categoryStore'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { CategoryPicker } from '../CategoryPicker'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
	usePremiumAccess.mockReturnValue({
		status: {
			hasAccess: false,
			subscriptionStatus: null,
			isLoading: false,
			error: null,
			isAuthenticated: false,
			...overrides,
		} satisfies PremiumAccessStatus,
	})
}

const premium = () =>
	mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })

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

function seed(categories: ClientCategory[]): void {
	useCategoryStore.setState({ categories })
}

beforeEach(() => {
	vi.clearAllMocks()
	seed([])
})

afterEach(() => {
	// This afterEach runs before testing-library cleanup, so the picker is still mounted when the store resets.
	act(() => {
		seed([])
	})
})

describe('CategoryPicker — premium user', () => {
	it('offers the uncategorized option first, then this form’s categories', () => {
		premium()
		seed([
			category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
			category({ id: 'e2', name: 'Rent', kind: 'expense' }),
		])

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const select = screen.getByLabelText('Category')
		const options = within(select)
			.getAllByRole('option')
			.map((o) => o.textContent)
		expect(options).toEqual(['Uncategorized', 'Groceries', 'Rent'])
	})

	it('filters by KIND — an income category never appears on the expense form', () => {
		premium()
		seed([
			category({ id: 'i1', name: 'Salary', kind: 'income' }),
			category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
		])

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const select = screen.getByLabelText('Category')
		expect(within(select).getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
		expect(within(select).queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument()
	})

	it('filters by KIND in the other direction too — the income form omits expense categories', () => {
		premium()
		seed([
			category({ id: 'i1', name: 'Salary', kind: 'income' }),
			category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
		])

		render(<CategoryPicker kind="income" value={null} onChange={vi.fn()} idPrefix="income" />)

		const select = screen.getByLabelText('Category')
		expect(within(select).getByRole('option', { name: 'Salary' })).toBeInTheDocument()
		expect(within(select).queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument()
	})

	it('omits soft-deleted categories from the pickable set', () => {
		premium()
		seed([
			category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
			category({ id: 'e2', name: 'Gone', kind: 'expense', isDeleted: true }),
		])

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const select = screen.getByLabelText('Category')
		expect(within(select).getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
		expect(within(select).queryByRole('option', { name: 'Gone' })).not.toBeInTheDocument()
	})

	it('reports a chosen category by id, and uncategorized as null', async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		premium()
		seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

		const { rerender } = render(
			<CategoryPicker kind="expense" value={null} onChange={onChange} idPrefix="expense" />
		)

		await user.selectOptions(screen.getByLabelText('Category'), 'e1')
		expect(onChange).toHaveBeenCalledWith('e1')

		rerender(<CategoryPicker kind="expense" value="e1" onChange={onChange} idPrefix="expense" />)
		await user.selectOptions(screen.getByLabelText('Category'), '')
		expect(onChange).toHaveBeenLastCalledWith(null)
	})

	it('is NOT required — leaving a row uncategorized is always valid', () => {
		premium()
		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)
		expect(screen.getByLabelText('Category')).not.toBeRequired()
	})

	it('displays a dangling categoryId as uncategorized rather than a blank selection', () => {
		// Not discriminating: jsdom reports selectedIndex 0 for an unmatched value where browsers show blank.
		// This only proves the dangling id is not offered and does not crash.
		premium()
		seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

		render(
			<CategoryPicker
				kind="expense"
				value="not-on-this-device"
				onChange={vi.fn()}
				idPrefix="expense"
			/>
		)

		const select = screen.getByLabelText('Category') as HTMLSelectElement
		expect(select.value).toBe('')
		expect(
			within(select).queryByRole('option', { name: 'not-on-this-device' })
		).not.toBeInTheDocument()
	})

	it('kills the native outline only alongside a real 2px coloured ring', () => {
		// The counter stops a reshaped class string from silently asserting nothing.
		premium()
		const control = (() => {
			render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)
			return screen.getByLabelText('Category')
		})()

		const tokens = control.className.split(/\s+/)
		let checked = 0
		expect(tokens, 'category picker no longer kills the native outline').toContain(
			'focus:outline-none'
		)
		checked++
		expect(tokens, 'category picker has no visible focus ring').toContain('focus:ring-2')
		checked++
		expect(
			tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
			'category picker has a ring width but no ring colour'
		).toBe(true)
		checked++
		expect(checked).toBe(3)
	})
})

describe('CategoryPicker — gate', () => {
	it.each([
		['free' as const, false],
		['past_due' as const, true],
		['canceled' as const, true],
		[null, false],
	])(
		'renders a locked link to /pricing, not a picker, for %s',
		(subscriptionStatus, isAuthenticated) => {
			mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated })
			seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

			render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

			expect(screen.getByTestId('expense-category-locked')).toBeInTheDocument()
			expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
			expect(screen.getByText('Premium')).toBeInTheDocument()
			// The href is written out rather than read from the component, so changing it fails this.
			expect(
				within(screen.getByTestId('expense-category-locked')).getByRole('link')
			).toHaveAttribute('href', '/pricing')
		}
	)

	it('treats an ERRORED tier check as not premium, and still leads to /pricing (fail-closed)', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const locked = screen.getByTestId('expense-category-locked')
		expect(locked).toBeInTheDocument()
		expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
		expect(within(locked).getByRole('link')).toHaveAttribute('href', '/pricing')
	})

	it('never renders category content while the tier is unknown (loading is UNCHANGED)', () => {
		mockStatus({ isLoading: true })
		seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		expect(screen.getByTestId('expense-category-skeleton')).toBeInTheDocument()
		expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
		expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
		// No lock while loading: a paying user would flash a lock before their tier resolves.
		expect(screen.queryByRole('link')).not.toBeInTheDocument()
		expect(screen.queryByTestId('expense-category-locked')).not.toBeInTheDocument()
	})

	it('the locked control is a LINK out of the form, not a button that opens a dialog', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const locked = screen.getByTestId('expense-category-locked')
		const link = within(locked).getByRole('link')
		expect(link).toHaveAttribute('href', '/pricing')

		// Not PremiumFeatureGate's shape: its button opens a second Modal inside the Add/Edit one.
		expect(within(locked).queryByRole('button')).not.toBeInTheDocument()
		// Not user.click(link): jsdom logs "Not implemented: navigation" for a real <a href>.
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	})

	it('says the form will close before the user commits to leaving', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const link = within(screen.getByTestId('expense-category-locked')).getByRole('link')
		// Leaving the route discards the form, so the warning must be in the accessible name too.
		expect(link).toHaveAccessibleName(/closes this form/i)
		expect(link).toHaveTextContent(/closes this form/i)
	})

	it('the link restores a visible focus ring in a non-destructive colour', () => {
		mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		const link = within(screen.getByTestId('expense-category-locked')).getByRole('link')
		const tokens = link.className.split(/\s+/)
		// Unconditional: guarding on focus:outline-none would skip the ring check instead of failing it.
		expect(tokens, 'locked link has no visible focus ring').toContain('focus:ring-2')
		expect(tokens, 'a ring with no colour is not visible').toContain('focus:ring-blue-500')
		expect(tokens).not.toContain('focus:ring-red-500')
	})

	it('an entitled user gets the real <select> and no navigation affordance', () => {
		premium()
		seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

		render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

		expect(screen.getByTestId('expense-category-select')).toBeInTheDocument()
		expect(screen.getByLabelText('Category')).toBeInTheDocument()
		expect(screen.queryByRole('link')).not.toBeInTheDocument()
		expect(screen.queryByText('Premium')).not.toBeInTheDocument()
		expect(screen.queryByTestId('expense-category-locked')).not.toBeInTheDocument()
	})
})
