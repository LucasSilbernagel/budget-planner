import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'

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
const free = () =>
	mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

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

function resetStores(): void {
	useCategoryStore.setState({ categories: [] })
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
}

beforeEach(() => {
	vi.clearAllMocks()
	resetStores()
})

afterEach(() => {
	act(() => {
		resetStores()
	})
})

describe('IncomePage category assignment', () => {
	it('persists the chosen category to the row and shows it in the table', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
		})
		render(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
		await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
		await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		const [row] = useIncomeStore.getState().incomeSources
		expect(row?.categoryId).toBe('i1')
		expect(screen.getByTestId('income-row-category')).toHaveTextContent('Employment')
		expect(screen.queryByText('i1')).not.toBeInTheDocument()
	})

	it('re-opens an edit form on the row’s existing category', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [
				category({ id: 'i1', name: 'Employment', kind: 'income' }),
				category({ id: 'i2', name: 'Dividends', kind: 'income' }),
			],
		})
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'row-1',
					userId: 0,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					categoryId: 'i2',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		render(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
		const dialog = screen.getByRole('dialog')
		expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('i2')
	})

	it('does not carry the previous entry’s category into the next Add (found by mutation M32)', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
		})
		render(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		let dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
		await user.type(within(dialog).getByTestId('income-amount-input'), '5000')
		await user.selectOptions(within(dialog).getByLabelText('Category'), 'i1')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		// Without the form reset the next row silently inherits the previous category.
		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		dialog = screen.getByRole('dialog')
		expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')

		await user.type(within(dialog).getByTestId('income-name-input'), 'Bonus')
		await user.type(within(dialog).getByTestId('income-amount-input'), '100')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		const rows = useIncomeStore.getState().incomeSources
		expect(rows).toHaveLength(2)
		expect(rows.find((row) => row.name === 'Bonus')?.categoryId).toBeNull()
	})

	it('clearing the category writes null, not the empty-string sentinel', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'i1', name: 'Employment', kind: 'income' })],
		})
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'row-1',
					userId: 0,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					categoryId: 'i1',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		render(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
		const dialog = screen.getByRole('dialog')
		await user.selectOptions(within(dialog).getByLabelText('Category'), '')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBeNull()
		expect(screen.getByTestId('income-row-uncategorized')).toBeInTheDocument()
	})
})

describe('ExpensesPage category assignment', () => {
	it('persists the chosen category to the row and shows it in the table', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
		await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe('e1')
		expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
	})
})

describe('ExpensesPage EDIT round-trip — the sibling the first pass never tested', () => {
	function seedCategorizedExpense(categoryId: string): void {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'row-1',
					userId: 0,
					name: 'Tesco run',
					amount: 8000,
					frequency: 'monthly',
					categoryId,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
	}

	it('re-opens an edit form on the row’s existing category', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [
				category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
				category({ id: 'e2', name: 'Housing', kind: 'expense' }),
			],
		})
		seedCategorizedExpense('e2')
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
		const dialog = screen.getByRole('dialog')
		expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('e2')
	})

	it('an UNRELATED edit preserves the category — the HIGH defect this review caught', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		seedCategorizedExpense('e1')
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
		const dialog = screen.getByRole('dialog')
		await user.clear(within(dialog).getByTestId('expense-amount-input'))
		await user.type(within(dialog).getByTestId('expense-amount-input'), '95')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		const [row] = useExpenseStore.getState().expenses
		expect(row?.amount).toBe(9500)
		expect(row?.categoryId).toBe('e1')
		expect(screen.getByTestId('expense-row-category')).toHaveTextContent('Groceries')
	})

	it('clearing the category writes null, not the empty-string sentinel', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		seedCategorizedExpense('e1')
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Tesco run' }))
		const dialog = screen.getByRole('dialog')
		await user.selectOptions(within(dialog).getByLabelText('Category'), '')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		expect(useExpenseStore.getState().expenses[0]?.categoryId).toBeNull()
		expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
	})

	it('does not carry the previous entry’s category into the next Add', async () => {
		const user = userEvent.setup()
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense' })],
		})
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		let dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Tesco run')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '80')
		await user.selectOptions(within(dialog).getByLabelText('Category'), 'e1')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		dialog = screen.getByRole('dialog')
		expect((within(dialog).getByLabelText('Category') as HTMLSelectElement).value).toBe('')
	})
})

describe('a dangling reference in the table', () => {
	function seedExpenseRow(categoryId: string | null): void {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'row-1',
					userId: 0,
					name: 'Tesco run',
					amount: 8000,
					frequency: 'monthly',
					categoryId,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
	}

	it('CAUSE 1 (pull pagination): an id not yet on this device renders uncategorized', () => {
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e-other', name: 'Rent', kind: 'expense' })],
		})
		seedExpenseRow('e-not-yet-pulled')
		render(<ExpensesPage />)

		expect(screen.getByTestId('expense-row-uncategorized')).toHaveTextContent('—')
		expect(screen.queryByText('e-not-yet-pulled')).not.toBeInTheDocument()
		expect(screen.queryByTestId('expense-row-category')).not.toBeInTheDocument()
	})

	it('CAUSE 2 (deleted on another device): a removed category renders uncategorized', () => {
		premium()
		useCategoryStore.setState({ categories: [] })
		seedExpenseRow('e1')
		render(<ExpensesPage />)

		expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
		expect(screen.queryByText('e1')).not.toBeInTheDocument()
	})

	it('CAUSE 3 (soft-deleted locally): a tombstoned category renders uncategorized', () => {
		premium()
		useCategoryStore.setState({
			categories: [category({ id: 'e1', name: 'Groceries', kind: 'expense', isDeleted: true })],
		})
		seedExpenseRow('e1')
		render(<ExpensesPage />)

		expect(screen.getByTestId('expense-row-uncategorized')).toBeInTheDocument()
		expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
	})
})

describe('the free tier: a locked picker, and CRUD that still works', () => {
	it('the locked picker inside the Add Expense modal is a link OUT to /pricing, and opens no second dialog', async () => {
		const user = userEvent.setup()
		free()
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		expect(screen.getAllByRole('dialog')).toHaveLength(1)

		const locked = screen.getByTestId('expense-category-locked')
		const link = within(locked).getByRole('link')

		expect(link).toHaveAttribute('href', '/pricing')

		// Not clicked: jsdom logs "Not implemented: navigation" for a real `<a href>`.

		// Modal doesn't inert the background, so a nested dialog stays forbidden.
		expect(screen.getAllByRole('dialog')).toHaveLength(1)
		expect(screen.queryByRole('dialog', { name: /go premium/i })).not.toBeInTheDocument()
	})

	it('the income form carries the identical locked link, from the same component', async () => {
		const user = userEvent.setup()
		free()
		render(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))

		const locked = screen.getByTestId('income-category-locked')
		expect(within(locked).getByRole('link')).toHaveAttribute('href', '/pricing')
		expect(screen.getAllByRole('dialog')).toHaveLength(1)
	})

	// Modal stops propagation, so only a capture-phase listener sees the click; read
	// `defaultPrevented` once dispatch has finished.
	for (const { Page, prefix, addButton } of [
		{ Page: ExpensesPage, prefix: 'expense', addButton: '+ Add Expense' },
		{ Page: IncomePage, prefix: 'income', addButton: '+ Add Income Source' },
	] as const) {
		it(`41.2: the ${prefix} form's locked picker is a navigation nothing intercepts (was e2e categories-premium:266)`, async () => {
			const user = userEvent.setup()
			free()
			render(<Page />)
			await user.click(screen.getByRole('button', { name: addButton }))
			const link = within(screen.getByTestId(`${prefix}-category-locked`)).getByRole('link')
			expect(link).toHaveAttribute('href', '/pricing')

			const clicks: MouseEvent[] = []
			const record = (event: MouseEvent) => clicks.push(event)
			window.addEventListener('click', record, { capture: true })
			try {
				await user.click(link)
			} finally {
				window.removeEventListener('click', record, { capture: true })
			}
			expect(clicks).toHaveLength(1)
			expect(
				clicks[0]?.defaultPrevented,
				'the browser default (navigate to /pricing) must not be prevented'
			).toBe(false)

			expect(screen.getAllByRole('dialog')).toHaveLength(1)
			expect(screen.queryByRole('dialog', { name: /go premium/i })).toBeNull()
		})
	}

	it('a free user can still add an expense, uncategorized, with no required field added', async () => {
		const user = userEvent.setup()
		free()
		render(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Rent')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '1200')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		const [row] = useExpenseStore.getState().expenses
		expect(row?.name).toBe('Rent')
		expect(row?.categoryId).toBeNull()
		expect(screen.queryByTestId('expense-row-uncategorized')).not.toBeInTheDocument()
		expect(screen.queryByTestId('expense-row-category')).not.toBeInTheDocument()
	})
})

describe('the Category column is Premium-only', () => {
	function seedIncomeRow(categoryId: string | null): void {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					categoryId,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
	}

	function seedExpenseRow(categoryId: string | null): void {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-1',
					userId: 0,
					name: 'Rent',
					amount: 150000,
					frequency: 'monthly',
					categoryId,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
	}

	function readTable(container: HTMLElement): { headers: string[]; cellCounts: number[] } {
		const table = container.querySelector('table')
		if (!table) throw new Error('no <table> rendered')
		return {
			headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? ''),
			cellCounts: [...table.querySelectorAll('tbody tr')].map(
				(tr) => tr.querySelectorAll('td').length
			),
		}
	}

	function expectColumnParity(container: HTMLElement): void {
		const { headers, cellCounts } = readTable(container)
		expect(cellCounts.length).toBeGreaterThan(0)
		for (const count of cellCounts) {
			expect(count).toBe(headers.length)
		}
	}

	const PAGES = [
		{
			name: 'IncomePage',
			render: () => render(<IncomePage />),
			seed: seedIncomeRow,
			readStoreRow: () => useIncomeStore.getState().incomeSources[0],
			rowName: 'Salary',
			prefix: 'income',
			categoryName: 'Employment',
			kind: 'income' as const,
			categoryId: 'i1',
		},
		{
			name: 'ExpensesPage',
			render: () => render(<ExpensesPage />),
			seed: seedExpenseRow,
			readStoreRow: () => useExpenseStore.getState().expenses[0],
			rowName: 'Rent',
			prefix: 'expense',
			categoryName: 'Groceries',
			kind: 'expense' as const,
			categoryId: 'e1',
		},
	]

	const NOT_ENTITLED = [
		{ label: 'free', status: { subscriptionStatus: 'free', isAuthenticated: true } },
		{ label: 'past_due', status: { subscriptionStatus: 'past_due', isAuthenticated: true } },
		{ label: 'canceled', status: { subscriptionStatus: 'canceled', isAuthenticated: true } },
		{ label: 'unauthenticated', status: { subscriptionStatus: null, isAuthenticated: false } },
		{ label: 'unresolved (isLoading)', status: { isLoading: true, subscriptionStatus: null } },
		{
			label: 'errored',
			status: { error: 'premium check failed', subscriptionStatus: null, isAuthenticated: false },
		},
	] satisfies { label: string; status: Partial<PremiumAccessStatus> }[]

	const ENTITLED = [
		{ label: 'active', status: { hasAccess: true, subscriptionStatus: 'active' } },
		// `lifetime` is entitled and easy to drop if the gate is simplified to `status === 'active'`.
		{ label: 'lifetime', status: { hasAccess: true, subscriptionStatus: 'lifetime' } },
	] satisfies { label: string; status: Partial<PremiumAccessStatus> }[]

	for (const page of PAGES) {
		describe(page.name, () => {
			for (const { label, status } of NOT_ENTITLED) {
				it(`renders no Category column for a ${label} user`, () => {
					mockStatus({ ...status, isAuthenticated: status.isAuthenticated ?? false })
					useCategoryStore.setState({
						categories: [
							category({ id: page.categoryId, name: page.categoryName, kind: page.kind }),
						],
					})
					page.seed(page.categoryId)
					const { container } = page.render()

					const { headers } = readTable(container)
					expect(headers).toEqual(['Name', 'Amount', 'Frequency', 'Actions'])
					expect(screen.queryByTestId(`${page.prefix}-row-category`)).not.toBeInTheDocument()
					expect(screen.queryByTestId(`${page.prefix}-row-uncategorized`)).not.toBeInTheDocument()
					expect(screen.queryByText(page.categoryName)).not.toBeInTheDocument()
					expectColumnParity(container)
				})
			}

			for (const { label, status } of ENTITLED) {
				it(`renders the Category column for a ${label} user`, () => {
					mockStatus({ ...status, isAuthenticated: true })
					useCategoryStore.setState({
						categories: [
							category({ id: page.categoryId, name: page.categoryName, kind: page.kind }),
						],
					})
					page.seed(page.categoryId)
					const { container } = page.render()

					const { headers } = readTable(container)
					expect(headers).toEqual(['Name', 'Amount', 'Frequency', 'Category', 'Actions'])
					expect(screen.getByTestId(`${page.prefix}-row-category`)).toHaveTextContent(
						page.categoryName
					)
					expectColumnParity(container)
				})
			}

			it('shows the em-dash placeholder to an entitled user with an uncategorized row', () => {
				premium()
				page.seed(null)
				const { container } = page.render()

				expect(screen.getByTestId(`${page.prefix}-row-uncategorized`)).toHaveTextContent('—')
				expectColumnParity(container)
			})

			it('keeps header and cell counts in lockstep across a tier change', () => {
				page.seed(page.categoryId)

				free()
				const freeRender = page.render()
				const freeTable = readTable(freeRender.container)
				expectColumnParity(freeRender.container)
				freeRender.unmount()

				premium()
				const premiumRender = page.render()
				const premiumTable = readTable(premiumRender.container)
				expectColumnParity(premiumRender.container)

				expect(premiumTable.headers.length).toBe(freeTable.headers.length + 1)
			})
		})
	}

	it('renders both pages under one tier state with neither showing a Category column', () => {
		free()
		useCategoryStore.setState({
			categories: [
				category({ id: 'i1', name: 'Employment', kind: 'income' }),
				category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
			],
		})
		seedIncomeRow('i1')
		seedExpenseRow('e1')

		const income = render(<IncomePage />)
		expect(readTable(income.container).headers).not.toContain('Category')
		income.unmount()

		const expenses = render(<ExpensesPage />)
		expect(readTable(expenses.container).headers).not.toContain('Category')
	})

	// Lapsed users keep categoryIds they cannot see; editing another field must
	// round-trip them.
	for (const page of PAGES) {
		it(`preserves a lapsed user's category when they edit a ${page.name} row`, async () => {
			const user = userEvent.setup()
			// `canceled`, not `free`: this is the state that holds orphaned assignments.
			mockStatus({ subscriptionStatus: 'canceled', isAuthenticated: true })
			useCategoryStore.setState({
				categories: [category({ id: page.categoryId, name: page.categoryName, kind: page.kind })],
			})
			page.seed(page.categoryId)
			const { container } = page.render()

			expect(readTable(container).headers).not.toContain('Category')
			expect(screen.queryByTestId(`${page.prefix}-row-category`)).not.toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: `Edit ${page.rowName}` }))
			const dialog = screen.getByRole('dialog')
			const amountInput = within(dialog).getByTestId(`${page.prefix}-amount-input`)
			await user.clear(amountInput)
			await user.type(amountInput, '4321')
			await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

			const row = page.readStoreRow()
			expect(row?.amount).toBe(432100)
			expect(row?.categoryId).toBe(page.categoryId)
		})
	}
})
