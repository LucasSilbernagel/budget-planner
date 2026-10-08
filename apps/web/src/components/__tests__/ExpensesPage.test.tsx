import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	assertHasFocusRing,
	assertHasMobileTapTarget,
	assertIsIconOnlyAction,
	collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import {
	act,
	fireEvent,
	renderWithProviders,
	screen,
	userEvent,
	waitFor,
	within,
} from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useExpenseStore } from '../../stores/expenseStore'
import {
	PLANNER_VISIBILITY_STORAGE_KEY,
	usePlannerVisibilityStore,
} from '../../stores/plannerVisibilityStore'

// A plain object, not vi.fn(): vi.clearAllMocks() would strip a mockReturnValue
// and make the hook return undefined.
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

function setTier(overrides: Partial<PremiumAccessStatus>): void {
	premiumTier.status = {
		hasAccess: false,
		subscriptionStatus: 'free',
		isLoading: false,
		error: null,
		isAuthenticated: true,
		...overrides,
	}
}

const premium = () =>
	setTier({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
const free = () => setTier({})

beforeEach(() => {
	free()
})

function mobileLabelsIn(row: HTMLElement): string[] {
	return [...row.querySelectorAll('span.sm\\:hidden')].map((el) => el.textContent ?? '')
}

import { expectSortHeaderAnnouncements } from '@/test/sort-announcements'
import { expectSharedGreen } from '@/test/white-fill-tokens'
import { ExpensesPage } from '../ExpensesPage'

describe('ExpensesPage inline validation', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('shows inline field errors on invalid submit and does not mutate the store', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		expect(screen.getByTestId('expense-name-error')).toHaveTextContent(
			'Please enter a name for the expense'
		)
		expect(screen.getByTestId('expense-amount-error')).toHaveTextContent(
			'Please enter a valid positive amount'
		)
		const nameInput = screen.getByTestId('expense-name-input')
		expect(nameInput).toHaveAttribute('aria-invalid', 'true')
		expect(nameInput).toHaveAttribute('aria-describedby', 'expense-name-error')
		expect(useExpenseStore.getState().expenses).toHaveLength(0)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))
		expect(screen.getByTestId('expense-name-error')).toBeInTheDocument()

		await user.type(screen.getByTestId('expense-name-input'), 'Rent')
		await waitFor(() => expect(screen.queryByTestId('expense-name-error')).not.toBeInTheDocument())

		await user.type(screen.getByTestId('expense-amount-input'), '1500')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const expenses = useExpenseStore.getState().expenses
		expect(expenses).toHaveLength(1)
		expect(expenses[0]).toMatchObject({ name: 'Rent', amount: 150000 })
	})
})

describe('ExpensesPage safe-action buttons are not danger-red', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('the "+ Add Expense" and modal submit buttons use no red fill', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		const addButton = screen.getByRole('button', { name: '+ Add Expense' })
		expect(addButton.className).not.toMatch(/bg-red-(600|700)/)
		expectSharedGreen(addButton)

		await user.click(addButton)
		const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expense' })
		expect(submit.className).not.toMatch(/bg-red-(600|700)/)
		expectSharedGreen(submit)
	})
})

describe('ExpensesPage amount input rejects non-numeric characters', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('strips letters and symbols from a pasted value but keeps the number', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const amountInput = within(screen.getByRole('dialog')).getByTestId('expense-amount-input')
		fireEvent.change(amountInput, { target: { value: '$1,500.00 rent' } })

		expect(amountInput).toHaveValue('1,500.00')
	})

	it('never lets a typed letter appear in the field', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const amountInput = within(screen.getByRole('dialog')).getByTestId('expense-amount-input')
		await user.type(amountInput, '12abc34')

		expect(amountInput).toHaveValue('1234')
	})

	it('leaves the name field free to accept letters', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const nameInput = within(screen.getByRole('dialog')).getByTestId('expense-name-input')
		await user.type(nameInput, 'Rent')

		expect(nameInput).toHaveValue('Rent')
	})
})

describe('ExpensesPage form controls have a visible focus ring', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('every control that kills the native outline restores a 2px ring', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')

		const controls = [
			within(dialog).getByTestId('expense-name-input'),
			within(dialog).getByTestId('expense-amount-input'),
			within(dialog).getByLabelText('Frequency *'),
		]

		let checked = 0
		for (const control of controls) {
			const tokens = control.className.split(/\s+/)
			expect(tokens, `${control.id} no longer kills the native outline`).toContain(
				'focus:outline-none'
			)
			expect(tokens, `${control.id} has no visible focus ring`).toContain('focus:ring-2')
			checked++
		}
		expect(checked).toBe(controls.length)
	})

	it('a valid field does not wear the error ring colour', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('expense-amount-input')

		expect(amountInput.className.split(/\s+/)).toContain('focus:ring-blue-500')
		expect(amountInput.className.split(/\s+/)).not.toContain('focus:ring-red-500')
	})

	it('an invalid field does wear the error ring colour', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await waitFor(() => {
			expect(within(dialog).getByTestId('expense-amount-input').className.split(/\s+/)).toContain(
				'focus:ring-red-500'
			)
		})
	})
})

describe('ExpensesPage edit modal prefills a grouped, locale-aware amount', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('seeds the amount through the same formatter as the blur echo', async () => {
		const user = userEvent.setup()
		useExpenseStore.getState().addExpense({ name: 'Rent', amount: 123456789, frequency: 'monthly' })
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Rent' }))
		const dialog = screen.getByRole('dialog')

		expect(within(dialog).getByTestId('expense-amount-input')).toHaveValue('1,234,567.89')
	})
})

describe('ExpensesPage mobile card presentation (story 31.2)', () => {
	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
		useExpenseStore.getState().addExpense({ name: 'Rent', amount: 150000, frequency: 'monthly' })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	function rowFor(name: string): HTMLElement {
		const row = screen.getByText(name).closest('tr')
		if (!row) throw new Error(`no <tr> ancestor for "${name}"`)
		return row as HTMLElement
	}

	it('carries every column value on the card', () => {
		premium()
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')

		expect(within(row).getByText('1,500.00')).toBeInTheDocument()
		expect(within(row).getByText('monthly')).toBeInTheDocument()
		expect(within(row).getByTestId('expense-row-uncategorized')).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Edit Rent' })).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Delete Rent' })).toBeInTheDocument()
	})

	it('carries every column value on a free user’s card, minus Category (story 33.3)', () => {
		free()
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')

		expect(within(row).getByText('1,500.00')).toBeInTheDocument()
		expect(within(row).getByText('monthly')).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Edit Rent' })).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Delete Rent' })).toBeInTheDocument()
		expect(within(row).queryByTestId('expense-row-uncategorized')).not.toBeInTheDocument()
		expect(within(row).queryByTestId('expense-row-category')).not.toBeInTheDocument()
	})

	it('labels every field on the card (AC-4)', () => {
		premium()
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')

		expect(mobileLabelsIn(row)).toEqual(['Name', 'Amount', 'Frequency', 'Category', 'Actions'])
		for (const label of ['Name', 'Amount', 'Frequency', 'Category', 'Actions']) {
			expect([...within(row).getByText(label).classList]).toContain('sm:hidden')
		}
	})

	it('labels every field on a free user’s card, with no Category field (story 33.3)', () => {
		free()
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')

		expect(mobileLabelsIn(row)).toEqual(['Name', 'Amount', 'Frequency', 'Actions'])
	})

	it('has exactly one table in the DOM — no dual-rendered card list', () => {
		const { container } = renderWithProviders(<ExpensesPage />)
		expect(container.querySelectorAll('table')).toHaveLength(1)
		expect(screen.getAllByText('Rent')).toHaveLength(1)
	})

	it('declares the shared card classes on the table, body and rows (AC-8)', () => {
		const { container } = renderWithProviders(<ExpensesPage />)
		const table = container.querySelector('table') as HTMLElement

		expect([...table.classList]).toContain('max-sm:block')
		expect([...(table.querySelector('thead') as HTMLElement).classList]).toContain('max-sm:hidden')
		expect([...(table.querySelector('tbody') as HTMLElement).classList]).toContain('max-sm:block')
		expect([...rowFor('Rent').classList]).toContain('max-sm:block')
	})

	it('every row Edit/Delete button carries a focus ring with a colour (AC-5)', () => {
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')
		for (const label of ['Edit Rent', 'Delete Rent']) {
			assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
		renderWithProviders(<ExpensesPage />)
		const row = rowFor('Rent')
		for (const label of ['Edit Rent', 'Delete Rent']) {
			assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
		renderWithProviders(<ExpensesPage />)
		const cell = rowFor('Rent').querySelector('td:last-child') as HTMLElement
		expect(
			within(cell)
				.getAllByRole('button')
				.map((b) => b.getAttribute('aria-label'))
		).toEqual(['Edit Rent', 'Delete Rent'])
	})

	it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
		renderWithProviders(<ExpensesPage />)
		const cell = rowFor('Rent').querySelector('td:last-child') as HTMLElement
		const geometry = ['Edit Rent', 'Delete Rent'].map((label) =>
			assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
		)
		expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
	})

	it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
		const { container } = renderWithProviders(<ExpensesPage />)
		const table = container.querySelector('table') as HTMLElement
		expect(collectRetiredTokenViolations(table)).toEqual([])
	})
})

describe('ExpensesPage — sort by column (34.2)', () => {
	const SEED = [
		{ name: 'Zeta', amount: 600_00, frequency: 'annually' as const },
		{ name: 'Alpha', amount: 500_00, frequency: 'monthly' as const },
		{ name: 'Mid', amount: 500_00, frequency: 'monthly' as const },
		{ name: 'Beta', amount: 100_00, frequency: 'weekly' as const },
	]
	const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

	function seedRows() {
		useExpenseStore.setState({ expenses: [] })
		// Distinct createdAt: rows created in one millisecond tie on the manual key,
		// so a stable sort could pass an ordering assertion by accident.
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
		for (const row of SEED) {
			useExpenseStore.getState().addExpense(row)
			vi.advanceTimersByTime(1000)
		}
		vi.useRealTimers()
	}

	function renderedOrder(): string[] {
		return screen
			.getAllByRole('row')
			.slice(1)
			.map((row) => row.querySelector('td')?.textContent?.replace('Name', '').trim() ?? '')
	}

	function header(name: string): HTMLElement {
		return screen.getByRole('columnheader', { name })
	}

	beforeEach(() => {
		seedRows()
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('renders in MANUAL order until a header is activated', () => {
		renderWithProviders(<ExpensesPage />)
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
		for (const name of ['Name', 'Amount', 'Frequency']) {
			expect(header(name)).toHaveAttribute('aria-sort', 'none')
		}
	})

	it('offers exactly the sortable columns, and Actions is not one of them', () => {
		renderWithProviders(<ExpensesPage />)
		const headers = screen.getAllByRole('columnheader')
		expect(headers.map((th) => th.textContent?.trim())).toEqual([
			'Name',
			'Amount',
			'Frequency',
			'Actions',
		])
		for (const name of ['Name', 'Amount', 'Frequency']) {
			expect(within(header(name)).getByRole('button', { name })).toBeInTheDocument()
		}
		const actions = header('Actions')
		expect(within(actions).queryByRole('button')).toBeNull()
		// No attribute at all: aria-sort="none" advertises the column as sortable.
		expect(actions).not.toHaveAttribute('aria-sort')
	})

	it('describes its headers and announces a header click, not a picker change (120.1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await expectSortHeaderAnnouncements(user, 'Sort expenses')
	})

	it('cycles a column ascending -> descending -> back to manual order', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
		expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])

		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
		expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
	})

	it('sorts Amount by the FREQUENCY-NORMALIZED value, not the raw number', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid'])
	})

	it('falls back to MANUAL order for rows that tie, in both directions', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		const button = () => within(header('Frequency')).getByRole('button', { name: 'Frequency' })

		await user.click(button())
		expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Mid', 'Zeta'])
		await user.click(button())
		expect(renderedOrder()).toEqual(['Zeta', 'Alpha', 'Mid', 'Beta'])
	})

	it('keeps at most one column active', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(header('Amount')).toHaveAttribute('aria-sort', 'ascending')
		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
		expect(header('Amount')).toHaveAttribute('aria-sort', 'none')
	})

	it('places an unreadable row LAST without blanking the page', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState((state) => ({
			expenses: [
				{
					id: 'corrupt-row',
					userId: 0,
					name: 'Corrupt',
					amount: 1_00,
					frequency: 'fortnightly' as never,
					categoryId: null,
					sortOrder: -1,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				...state.expenses,
			],
		}))
		renderWithProviders(<ExpensesPage />)
		expect(renderedOrder()[0]).toBe('Corrupt')

		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid', 'Corrupt'])
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder().at(-1)).toBe('Corrupt')
	})

	it('keeps focus on the header the user activated', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		const button = within(header('Amount')).getByRole('button', { name: 'Amount' })
		await user.click(button)
		expect(renderedOrder()).not.toEqual(MANUAL_ORDER)
		expect(within(header('Amount')).getByRole('button', { name: 'Amount' })).toHaveFocus()
	})
	it('places a row added under an active sort in its SORTED position, not at the bottom', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))

		await act(async () => {
			useExpenseStore.getState().addExpense({
				name: 'Bravo',
				amount: 1_00,
				frequency: 'monthly',
			})
		})
		expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Bravo', 'Mid', 'Zeta'])
		expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual([
			...MANUAL_ORDER,
			'Bravo',
		])
	})

	function sortControl(): HTMLSelectElement {
		return screen.getByRole('combobox', { name: 'Sort expenses' }) as HTMLSelectElement
	}

	it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		expect(sortControl()).toBeInTheDocument()
		expect(sortControl().value).toBe('manual')

		await user.selectOptions(sortControl(), 'name:asc')
		expect(sortControl().value).toBe('name:asc')
	})

	it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
	})

	it('returns to manual order from the mobile control (48.1 AC-4)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(renderedOrder()).not.toEqual(MANUAL_ORDER)

		await user.selectOptions(sortControl(), 'manual')
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
	})

	describe('Category is a sort target only for entitled users (AC-5)', () => {
		it('offers Category as a mobile sort option ONLY for an entitled user (48.1 AC-7)', async () => {
			free()
			const { unmount } = renderWithProviders(<ExpensesPage />)
			expect(
				within(screen.getByRole('combobox', { name: 'Sort expenses' }))
					.getAllByRole('option')
					.map((option) => option.textContent)
			).toEqual([
				'Default order',
				'Name (ascending)',
				'Name (descending)',
				'Amount (ascending)',
				'Amount (descending)',
				'Frequency (ascending)',
				'Frequency (descending)',
			])
			unmount()

			premium()
			renderWithProviders(<ExpensesPage />)
			expect(
				within(screen.getByRole('combobox', { name: 'Sort expenses' }))
					.getAllByRole('option')
					.map((option) => option.textContent)
			).toEqual([
				'Default order',
				'Name (ascending)',
				'Name (descending)',
				'Amount (ascending)',
				'Amount (descending)',
				'Frequency (ascending)',
				'Frequency (descending)',
				'Category (ascending)',
				'Category (descending)',
			])
		})

		it('offers no Category header at all on the free tier', () => {
			free()
			renderWithProviders(<ExpensesPage />)
			expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
			expect(screen.queryByRole('button', { name: 'Category' })).toBeNull()
		})

		it('offers a sortable Category header for an entitled user', async () => {
			premium()
			const user = userEvent.setup()
			renderWithProviders(<ExpensesPage />)
			const categoryHeader = screen.getByRole('columnheader', { name: 'Category' })
			expect(categoryHeader).toHaveAttribute('aria-sort', 'none')
			await user.click(within(categoryHeader).getByRole('button', { name: 'Category' }))
			expect(screen.getByRole('columnheader', { name: 'Category' })).toHaveAttribute(
				'aria-sort',
				'ascending'
			)
		})
	})

	it('adds no retired colour tokens to the header row', () => {
		renderWithProviders(<ExpensesPage />)
		const table = screen.getAllByRole('table')[0] as HTMLElement
		expect(collectRetiredTokenViolations(table)).toEqual([])
	})

	it('enqueues NOTHING on a PAID session — sorting is read-only over the store (AC-8)', async () => {
		// Registered so not.toHaveBeenCalled() can fail, and paid because that tier has a sync path.
		const spies = {
			userId: '550e8400-e29b-41d4-a716-446655440000',
			queueCreate: vi.fn(async () => {}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		}
		registerSyncBridge(spies)
		try {
			const user = userEvent.setup()
			renderWithProviders(<ExpensesPage />)
			const before = useExpenseStore.getState().expenses.map((row) => [row.id, row.sortOrder])

			const button = () => within(header('Amount')).getByRole('button', { name: 'Amount' })
			await user.click(button())
			await user.click(button())
			await user.click(button())

			expect(spies.queueUpdate).not.toHaveBeenCalled()
			expect(spies.queueCreate).not.toHaveBeenCalled()
			expect(spies.queueDelete).not.toHaveBeenCalled()
			expect(useExpenseStore.getState().expenses.map((row) => [row.id, row.sortOrder])).toEqual(
				before
			)
		} finally {
			clearSyncBridge()
		}
	})

	it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		const before = screen.getByRole('button', { name: 'Edit Zeta' })
		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
		expect(screen.getByRole('button', { name: 'Edit Zeta' })).toBe(before)
	})

	it('gives every sortable header the standard focus ring', () => {
		renderWithProviders(<ExpensesPage />)
		for (const name of ['Name', 'Amount', 'Frequency']) {
			assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
		}
	})
})

describe('ExpensesPage — mortgage guidance (36.3)', () => {
	const EXPENSE_HINT =
		'Paying off a loan or mortgage? Enter the payment here, and the amount still owed on the Balance Tracking page.'

	const hintText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('points the user at the Balance Tracking page for the amount still owed', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')

		expect(hintText(within(dialog).getByTestId('expense-mortgage-hint'))).toBe(EXPENSE_HINT)
	})

	it('shows the same guidance when editing an existing expense', async () => {
		const user = userEvent.setup()
		useExpenseStore
			.getState()
			.addExpense({ name: 'Mortgage', amount: 150_000, frequency: 'monthly' })
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')

		expect(hintText(within(dialog).getByTestId('expense-mortgage-hint'))).toBe(EXPENSE_HINT)
	})
})

describe('ExpensesPage — "ends before I retire" (65.2, FR101)', () => {
	const LABEL = 'This expense ends before I retire'
	const HELP =
		"Tick this for a cost that will have stopped by the time you retire — a mortgage you'll have paid off, tuition, daycare or a commute. The retirement planner uses it to suggest what your income needs to cover."

	const norm = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
	})

	it('offers the control, unticked, with its ratified label and help', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')

		const box = within(dialog).getByRole('checkbox', { name: LABEL })
		expect(box).not.toBeChecked()
		const describedBy = box.getAttribute('aria-describedby')
		expect(describedBy).toBeTruthy()
		const help = document.getElementById(describedBy as string)
		expect(help).not.toBeNull()
		expect(norm(help as HTMLElement)).toBe(HELP)
	})

	it('⚠️ the copy never says "must" — it states a prediction, not a commitment', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)
		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		const box = within(dialog).getByRole('checkbox', { name: LABEL })
		const help = document.getElementById(box.getAttribute('aria-describedby') as string)
		const rendered = `${box.parentElement?.textContent ?? ''} ${help?.textContent ?? ''}`
		expect(rendered.toLowerCase()).not.toContain('must')
		expect(rendered.toLowerCase()).toContain('ends before i retire')
	})

	it('persists the flag on ADD', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Mortgage')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '1800')
		await user.click(within(dialog).getByRole('checkbox', { name: LABEL }))
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses).toHaveLength(1)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(true)
	})

	it('leaves the flag false on an add where the box is untouched', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Groceries')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '400')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses).toHaveLength(1)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(false)
	})

	it('⚠️ does NOT carry the previous entry’s tick into the next Add', async () => {
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		let dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Mortgage')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '1800')
		await user.click(within(dialog).getByRole('checkbox', { name: LABEL }))
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))
		await waitFor(() => expect(useExpenseStore.getState().expenses).toHaveLength(1))

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		dialog = screen.getByRole('dialog')
		expect(within(dialog).getByRole('checkbox', { name: LABEL })).not.toBeChecked()
	})

	it('re-opens the edit form on the row’s existing tick', async () => {
		const user = userEvent.setup()
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByRole('checkbox', { name: LABEL })).toBeChecked()
	})

	it('⚠️⚠️ editing only the AMOUNT leaves the tick intact', async () => {
		const user = userEvent.setup()
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')
		const amount = within(dialog).getByTestId('expense-amount-input')
		await user.clear(amount)
		await user.type(amount, '1900')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses[0].amount).toBe(190_000)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(true)
	})

	it('⚠️ UNTICKING on edit actually clears the flag', async () => {
		const user = userEvent.setup()
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('checkbox', { name: LABEL }))
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(false)
		})
	})

	it('marks the row in the list, in words rather than colour alone', async () => {
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		useExpenseStore
			.getState()
			.addExpense({ name: 'Groceries', amount: 40_000, frequency: 'monthly' })
		const { container } = renderWithProviders(<ExpensesPage />)

		const badges = container.querySelectorAll('[data-testid="expense-row-ends-before-retirement"]')
		expect(badges).toHaveLength(1)
		expect(norm(badges[0] as HTMLElement)).toBe('Ends before retirement')
		const row = (badges[0] as HTMLElement).closest('tr')
		expect(norm(row as HTMLElement)).toContain('Mortgage')
	})

	it("the marker sits inside the name's own block, so a phone row stacks it below the name", async () => {
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		useExpenseStore
			.getState()
			.addExpense({ name: 'Groceries', amount: 40_000, frequency: 'monthly' })
		const { container } = renderWithProviders(<ExpensesPage />)

		const badge = container.querySelector(
			'[data-testid="expense-row-ends-before-retirement"]'
		) as HTMLElement
		expect(badge).not.toBeNull()
		const row = badge.closest('tr') as HTMLElement
		const name = within(row).getByText('Mortgage')
		const wrapper = name.parentElement as HTMLElement
		expect(badge.parentElement, 'marker and name do not share one parent').toBe(wrapper)
		const cell = wrapper.parentElement as HTMLElement
		expect(cell.tagName).toBe('TD')
		expect(cell.children).toHaveLength(2)
		expect(cell.children[1]).toBe(wrapper)
		expect(cell.children[0]).toHaveTextContent('Name')

		const groceries = within(container).getByText('Groceries')
		const plainWrapper = groceries.parentElement as HTMLElement
		expect(plainWrapper.children).toHaveLength(1)
		expect(plainWrapper.parentElement?.tagName).toBe('TD')
		expect(plainWrapper.parentElement?.children).toHaveLength(2)
	})

	it.each([
		[
			'free',
			{ hasAccess: false, subscriptionStatus: 'free' as const },
			['Name', 'Amount', 'Frequency', 'Actions'],
		],
		[
			'entitled',
			{ hasAccess: true, subscriptionStatus: 'active' as const },
			['Name', 'Amount', 'Frequency', 'Category', 'Actions'],
		],
	])('⚠️ adds NO column — the header array is unchanged for a %s user', (_label, tier, expected) => {
		setTier(tier)
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})
		const { container } = renderWithProviders(<ExpensesPage />)

		const headers = [...container.querySelectorAll('thead th')].map((th) => norm(th as HTMLElement))
		expect(headers).toEqual(expected)
		const cells = container.querySelectorAll('tbody tr:first-child > td')
		expect(cells).toHaveLength(headers.length)
		expect(
			container.querySelector('[data-testid="expense-row-ends-before-retirement"]')
		).not.toBeNull()
	})
})

describe('ExpensesPage — the retirement question follows the planner toggle (71.1, FR113)', () => {
	const LABEL = 'This expense ends before I retire'
	const BADGE = '[data-testid="expense-row-ends-before-retirement"]'
	const HELP_ID = 'expense-ends-before-retirement-help'

	const hidePlanner = () => usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
	const showPlanner = () => usePlannerVisibilityStore.setState({ showRetirementPlanner: true })

	const addMarkedMortgage = () =>
		useExpenseStore.getState().addExpense({
			name: 'Mortgage',
			amount: 180_000,
			frequency: 'monthly',
			endsBeforeRetirement: true,
		})

	beforeEach(() => {
		useExpenseStore.setState({ expenses: [] })
		showPlanner()
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
		showPlanner()
		// setState goes through persist's write path (skipHydration skips only the read),
		// so remove the stored blob too.
		localStorage.removeItem(PLANNER_VISIBILITY_STORAGE_KEY)
	})

	it('does not ask on the ADD form while the planner is off', async () => {
		hidePlanner()
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByTestId('expense-amount-input')).toBeInTheDocument()

		expect(within(dialog).queryByRole('checkbox', { name: LABEL })).toBeNull()
		expect(within(dialog).queryByTestId('expense-ends-before-retirement')).toBeNull()
		expect(document.getElementById(HELP_ID)).toBeNull()
		expect(within(dialog).queryByText(/retire/i)).toBeNull()
	})

	it('does not ask on the EDIT form of a marked row while the planner is off', async () => {
		addMarkedMortgage()
		hidePlanner()
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByTestId('expense-amount-input')).toBeInTheDocument()

		expect(within(dialog).queryByRole('checkbox', { name: LABEL })).toBeNull()
		expect(within(dialog).queryByTestId('expense-ends-before-retirement')).toBeNull()
		expect(document.getElementById(HELP_ID)).toBeNull()
		expect(within(dialog).queryByText(/retire/i)).toBeNull()
	})

	it('badges a marked row only while the planner is on — asserted in BOTH states', async () => {
		addMarkedMortgage()
		const { container } = renderWithProviders(<ExpensesPage />)

		expect(container.querySelectorAll(BADGE)).toHaveLength(1)

		act(() => hidePlanner())
		expect(container.querySelectorAll(BADGE)).toHaveLength(0)
		expect(screen.getByRole('button', { name: 'Edit Mortgage' })).toBeInTheDocument()

		act(() => showPlanner())
		const badges = container.querySelectorAll(BADGE)
		expect(badges).toHaveLength(1)
		expect((badges[0] as HTMLElement).closest('tr')?.textContent).toContain('Mortgage')
	})

	it('⚠️⚠️ keeps the mark through an edit made while the planner is off', async () => {
		addMarkedMortgage()
		hidePlanner()
		const user = userEvent.setup()
		const { container } = renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		let dialog = screen.getByRole('dialog')
		const amount = within(dialog).getByTestId('expense-amount-input')
		await user.clear(amount)
		await user.type(amount, '1900')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses[0].amount).toBe(190_000)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(true)

		act(() => showPlanner())
		expect(container.querySelectorAll(BADGE)).toHaveLength(1)
		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		dialog = screen.getByRole('dialog')
		expect(within(dialog).getByRole('checkbox', { name: LABEL })).toBeChecked()
	})

	it('⚠️ writes NOTHING to the flag while hidden — a change made under the open modal survives', async () => {
		// The row changes under the open modal, as a sync pull would: re-sending the
		// seeded value writes stale data back, omitting the key does not.
		addMarkedMortgage()
		hidePlanner()
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: 'Edit Mortgage' }))
		const dialog = screen.getByRole('dialog')

		const id = useExpenseStore.getState().expenses[0].id
		act(() => {
			useExpenseStore.setState((state) => ({
				expenses: state.expenses.map((e) =>
					e.id === id ? { ...e, endsBeforeRetirement: false } : e
				),
			}))
		})

		const amount = within(dialog).getByTestId('expense-amount-input')
		await user.clear(amount)
		await user.type(amount, '1900')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses[0].amount).toBe(190_000)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(false)
	})

	it('saves a new expense unmarked while the planner is off', async () => {
		hidePlanner()
		const user = userEvent.setup()
		renderWithProviders(<ExpensesPage />)

		await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('expense-name-input'), 'Groceries')
		await user.type(within(dialog).getByTestId('expense-amount-input'), '400')
		await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }))

		await waitFor(() => {
			expect(useExpenseStore.getState().expenses).toHaveLength(1)
		})
		expect(useExpenseStore.getState().expenses[0].endsBeforeRetirement).toBe(false)
	})
})
