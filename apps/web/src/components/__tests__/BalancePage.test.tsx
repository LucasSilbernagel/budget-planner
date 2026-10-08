import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	assertHasFocusRing,
	assertHasMobileTapTarget,
	assertIsIconOnlyAction,
	collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { expectSortHeaderAnnouncements } from '@/test/sort-announcements'
import {
	act,
	fireEvent,
	renderWithProviders,
	screen,
	userEvent,
	waitFor,
	within,
} from '@/test/utils'
import { getDocPage } from '../../content/docs'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import type { FinanceType } from '../../stores/balanceStore'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'

type ClientExpense = ReturnType<typeof useExpenseStore.getState>['expenses'][number]

function expenseRow(
	id: string,
	name: string,
	amount: number,
	frequency: ClientExpense['frequency'] = 'monthly'
): ClientExpense {
	return {
		id,
		userId: 0,
		name,
		amount,
		frequency,
		categoryId: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe('BalancePage add balance entry button', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('renders a visible Add Balance Entry button on load (AC-1)', () => {
		renderWithProviders(<BalancePage />)
		expect(screen.getByTestId('balance-add-button')).toBeInTheDocument()
	})

	it('keeps the Add Balance Entry button visible when the list is empty (AC-3)', () => {
		renderWithProviders(<BalancePage />)
		expect(screen.getByText('No balance entries recorded yet')).toBeInTheDocument()
		expect(screen.getByTestId('balance-add-button')).toBeInTheDocument()
	})

	it('opens the add modal when the button is clicked (AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		await user.click(screen.getByTestId('balance-add-button'))

		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		expect(dialog).toBeInTheDocument()
	})

	it('creates an entry via the modal and it appears in the list (AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		await user.type(within(dialog).getByLabelText(/name/i), 'My 401k')
		await user.type(within(dialog).getByLabelText(/current balance/i), '1500')
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '250')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(screen.getByText('My 401k')).toBeInTheDocument()
		expect(useBalanceStore.getState().entries).toHaveLength(1)
	})

	it('resets the form when reopened for a new add after an edit (AC-4)', async () => {
		const user = userEvent.setup()
		useBalanceStore.getState().addBalanceEntry({
			type: 'investment',
			name: 'Existing 401k',
			currentBalance: 100000,
			monthlyContribution: 50000,
			frequency: 'monthly',
		})
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Existing 401k' }))
		const editDialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		expect(within(editDialog).getByLabelText(/name/i)).toHaveValue('Existing 401k')

		await user.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		await user.click(screen.getByTestId('balance-add-button'))

		const addDialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		expect(within(addDialog).getByLabelText(/name/i)).toHaveValue('')
		// Currency inputs are type="text", so an empty field reports ''.
		expect(within(addDialog).getByLabelText(/current balance/i)).toHaveValue('')
	})

	it('restores focus to the Add button after the modal closes (AC-5)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		const addButton = screen.getByTestId('balance-add-button')
		await user.click(addButton)
		await user.click(screen.getByRole('button', { name: 'Cancel' }))

		await waitFor(() => expect(addButton).toHaveFocus())
	})

	it('creates an entry with a chosen frequency and round-trips it on edit', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.type(within(dialog).getByLabelText(/name/i), 'Brokerage')
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '250')
		await user.selectOptions(within(dialog).getByTestId('balance-frequency-select'), 'biweekly')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0].frequency).toBe('biweekly')

		await user.click(screen.getByRole('button', { name: 'Edit Brokerage' }))
		const editDialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		expect(within(editDialog).getByTestId('balance-frequency-select')).toHaveValue('biweekly')

		await user.selectOptions(within(editDialog).getByTestId('balance-frequency-select'), 'weekly')
		await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0].frequency).toBe('weekly')
	})
})

describe('BalancePage inline validation', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('shows an inline name error on empty submit and does not mutate the store', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		expect(screen.getByTestId('balance-name-error')).toHaveTextContent(
			'Please enter a name for the balance entry'
		)
		const nameInput = screen.getByTestId('balance-name-input')
		expect(nameInput).toHaveAttribute('aria-invalid', 'true')
		expect(nameInput).toHaveAttribute('aria-describedby', 'balance-name-error')

		expect(screen.queryByTestId('balance-current-balance-error')).not.toBeInTheDocument()
		expect(screen.queryByTestId('balance-monthly-contribution-error')).not.toBeInTheDocument()

		expect(useBalanceStore.getState().entries).toHaveLength(0)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('shows an inline error for a negative current balance', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog')
		await user.type(screen.getByTestId('balance-name-input'), 'Credit Card')
		await user.type(screen.getByTestId('balance-current-balance-input'), '-5')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		expect(screen.getByTestId('balance-current-balance-error')).toHaveTextContent(
			'Please enter a valid non-negative current balance'
		)
		expect(useBalanceStore.getState().entries).toHaveLength(0)
	})

	it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))
		expect(screen.getByTestId('balance-name-error')).toBeInTheDocument()

		await user.type(screen.getByTestId('balance-name-input'), 'My 401k')
		await waitFor(() => expect(screen.queryByTestId('balance-name-error')).not.toBeInTheDocument())

		await user.type(screen.getByTestId('balance-current-balance-input'), '1500')
		await user.type(screen.getByTestId('balance-monthly-contribution-input'), '250')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const entries = useBalanceStore.getState().entries
		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({
			name: 'My 401k',
			currentBalance: 150000,
			monthlyContribution: 25000,
		})
	})
})

// Section order is load-bearing: an e2e theme check reads the first `.surface`.
describe('BalancePage section composition (43.1)', () => {
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	function sectionHeadings(container: HTMLElement): string[] {
		return [...container.querySelectorAll('main > section')].map(
			(section) => section.querySelector('h2')?.textContent?.trim() ?? '(no h2)'
		)
	}

	const SECTIONS = ['Financial Overview', 'Your Balance Entries']

	it('renders exactly two sections — summary, then detail', () => {
		const { container } = renderWithProviders(<BalancePage />)
		expect(sectionHeadings(container)).toEqual(SECTIONS)
	})

	it('renders neither retired section, seeded or empty', () => {
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-43-1',
					type: 'investment',
					name: 'Brokerage',
					currentBalance: 250_000,
					monthlyContribution: 50_000,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		const { container } = renderWithProviders(<BalancePage />)

		expect(screen.getByText('Brokerage')).toBeInTheDocument()

		// Repeated against the seeded DOM: the removed sections only rendered for investment rows.
		expect(sectionHeadings(container)).toEqual(SECTIONS)

		for (const name of ['Investment Accounts', 'What You Own vs What You Owe']) {
			expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument()
		}
		expect(screen.queryByText('No investment accounts yet')).not.toBeInTheDocument()
	})
})

describe('BalancePage money inputs reject non-numeric characters', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('strips garbage from the current balance but keeps the grouped number', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))
		const balanceInput = screen.getByTestId('balance-current-balance-input')
		fireEvent.change(balanceInput, { target: { value: 'roughly $3,000.00 USD' } })

		expect(balanceInput).toHaveValue('3,000.00')
	})

	it('never lets a typed letter into the current balance field', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))
		const balanceInput = screen.getByTestId('balance-current-balance-input')
		await user.type(balanceInput, '15abc00')

		expect(balanceInput).toHaveValue('1500')
	})

	it('still accepts a leading minus so the non-negative validator stays reachable', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))
		const balanceInput = screen.getByTestId('balance-current-balance-input')
		await user.type(balanceInput, '-5')

		expect(balanceInput).toHaveValue('-5')
	})
})

describe('BalancePage form controls have a visible focus ring', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('every control that kills the native outline restores a 2px ring', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Balance Entry' }))

		const controls = [
			screen.getByTestId('balance-name-input'),
			screen.getByTestId('balance-current-balance-input'),
			screen.getByTestId('balance-monthly-contribution-input'),
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
})

describe('BalancePage mobile card presentation (story 31.2)', () => {
	const ISO_31_2 = '2026-01-01T00:00:00.000Z'

	beforeEach(() => {
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment',
					name: 'Brokerage',
					currentBalance: 250000,
					monthlyContribution: 50000,
					frequency: 'biweekly',
					createdAt: ISO_31_2,
					updatedAt: ISO_31_2,
				},
				{
					id: 'debt-1',
					type: 'debt',
					name: 'Car Loan',
					currentBalance: -400000,
					monthlyContribution: 0,
					frequency: 'monthly',
					paymentExpenseId: 'exp-car',
					createdAt: ISO_31_2,
					updatedAt: ISO_31_2,
				},
			],
		})
		useExpenseStore.setState({ expenses: [expenseRow('exp-car', 'Car payment', 30000)] })
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
		useBalanceStore.setState({ entries: [] })
	})

	function tables(container: HTMLElement): { entries: HTMLElement } {
		const found = [...container.querySelectorAll('table')] as HTMLElement[]
		expect(found).toHaveLength(1)
		return { entries: found[0] as HTMLElement }
	}

	function rowIn(table: HTMLElement, name: string): HTMLElement {
		const row = within(table).getByText(name).closest('tr')
		if (!row) throw new Error(`no <tr> ancestor for "${name}"`)
		return row as HTMLElement
	}

	it('carries every column value on a Balance Entries card', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const row = rowIn(tables(container).entries, 'Car Loan')

		expect(within(row).getByText('Debt')).toBeInTheDocument()
		expect(within(row).getByText('4,000.00')).toBeInTheDocument()
		expect(within(row).queryByText('-4,000.00')).toBeNull()
		expect(within(row).getByText('300.00')).toBeInTheDocument()
		expect(within(row).getByText('Monthly')).toBeInTheDocument()
		expect(within(row).getByText('Paid by Car payment')).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Edit Car Loan' })).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Delete Car Loan' })).toBeInTheDocument()
	})

	it('a legacy NEGATIVE debt opens as the amount owed, and a plain save stores it positive (Story 103.1, D2)', async () => {
		// The fixture stores this debt negative (setState skips the validator); without the
		// pre-fill the row could not be saved without retyping.
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		const editDialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		expect(within(editDialog).getByTestId('balance-current-balance-input')).toHaveValue('4,000.00')
		await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const saved = useBalanceStore.getState().entries.find((entry) => entry.id === 'debt-1')
		expect(saved?.currentBalance).toBe(400_000)
		expect(saved?.paymentExpenseId).toBe('exp-car')
	})

	it('labels exactly the five Balance Entries fields on the card (AC-4)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const row = rowIn(tables(container).entries, 'Car Loan')

		const labels = [...row.querySelectorAll('span.sm\\:hidden')].map((el) => el.textContent?.trim())
		expect(labels).toEqual(['Type', 'Name', 'Current Balance/Value', 'Contribution', 'Actions'])
	})

	it('keeps the contribution amount and its cadence as ONE field', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const row = rowIn(tables(container).entries, 'Brokerage')
		const cell = within(row).getByText('Contribution').closest('td') as HTMLElement

		// Two flex children below `sm`: a third would let `justify-between` fling the cadence
		// to the far edge.
		expect(cell.children).toHaveLength(2)
		const [, value] = [...cell.children] as HTMLElement[]
		expect(value).toHaveTextContent('500.00')
		expect(value).toHaveTextContent('Bi-weekly')
	})

	it('has exactly ONE table in the DOM — no dual-rendered card list', () => {
		const { container } = renderWithProviders(<BalancePage />)
		expect(container.querySelectorAll('table')).toHaveLength(1)
		expect(screen.getAllByText('Brokerage')).toHaveLength(1)
		expect(screen.getAllByText('Car Loan')).toHaveLength(1)
	})

	it('declares the shared card classes on the entries table (AC-8)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const { entries } = tables(container)

		expect([...entries.classList]).toContain('max-sm:block')
		expect([...(entries.querySelector('thead') as HTMLElement).classList]).toContain(
			'max-sm:hidden'
		)
		expect([...(entries.querySelector('tbody') as HTMLElement).classList]).toContain('max-sm:block')
		expect([...rowIn(entries, 'Car Loan').classList]).toContain('max-sm:block')
		expect([...rowIn(entries, 'Brokerage').classList]).toContain('max-sm:block')
	})

	it('every row Edit/Delete button carries a focus ring with a colour (AC-5)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const row = rowIn(tables(container).entries, 'Car Loan')
		for (const label of ['Edit Car Loan', 'Delete Car Loan']) {
			assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const row = rowIn(tables(container).entries, 'Car Loan')
		for (const label of ['Edit Car Loan', 'Delete Car Loan']) {
			assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const cell = rowIn(tables(container).entries, 'Car Loan').querySelector(
			'td:last-child'
		) as HTMLElement
		expect(
			within(cell)
				.getAllByRole('button')
				.map((b) => b.getAttribute('aria-label'))
		).toEqual(['Edit Car Loan', 'Delete Car Loan'])
	})

	it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const cell = rowIn(tables(container).entries, 'Car Loan').querySelector(
			'td:last-child'
		) as HTMLElement
		const geometry = ['Edit Car Loan', 'Delete Car Loan'].map((label) =>
			assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
		)
		// Edit and Delete must be different glyphs; nothing else checks that.
		expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
	})

	it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
		const { container } = renderWithProviders(<BalancePage />)
		const { entries } = tables(container)
		expect(collectRetiredTokenViolations(entries)).toEqual([])
	})
})

// investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
describe('BalancePage net worth includes savings (Story 32.2)', () => {
	const clearStores = () => {
		useBalanceStore.setState({ entries: [] })
		useSavingsStore.setState({ savingsGoals: [] })
	}

	beforeEach(clearStores)
	afterEach(clearStores)

	const seedBalances = () => {
		const add = useBalanceStore.getState().addBalanceEntry
		add({
			type: 'investment',
			name: 'ISA',
			currentBalance: 800_000,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		add({
			type: 'investment',
			name: 'Pension',
			currentBalance: 1_200_000,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		add({
			type: 'debt',
			name: 'Mortgage',
			currentBalance: 15_000_000,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
	}

	const seedSavings = () => {
		const add = useSavingsStore.getState().addSavingsGoal
		add({ name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 })
		add({ name: 'Rainy day', targetAmount: null, currentBalance: 50_000 })
	}

	it('adds savings into the Net Worth figure (AC-4)', () => {
		seedBalances()
		seedSavings()
		renderWithProviders(<BalancePage />)

		expect(screen.getByTestId('stat-net-worth')).toHaveTextContent('-127,000.00')
	})

	it('no longer shows the pre-32.2 investments-minus-debts figure (AC-4)', () => {
		seedBalances()
		seedSavings()
		renderWithProviders(<BalancePage />)

		expect(screen.getByTestId('stat-net-worth')).not.toHaveTextContent('-130,000.00')
	})

	it('renders a fourth read-only Savings stat card so the arithmetic reconciles (AC-4)', () => {
		seedBalances()
		seedSavings()
		renderWithProviders(<BalancePage />)

		expect(screen.getByTestId('stat-total-savings')).toHaveTextContent('3,000.00')
		expect(screen.getByTestId('stat-total-investments')).toHaveTextContent('20,000.00')
		expect(screen.getByTestId('stat-total-debts')).toHaveTextContent('150,000.00')

		const toNumber = (testId: string): number =>
			Number.parseFloat((screen.getByTestId(testId).textContent ?? '').replaceAll(',', ''))

		expect(
			toNumber('stat-total-investments') +
				toNumber('stat-total-savings') -
				toNumber('stat-total-debts')
		).toBeCloseTo(toNumber('stat-net-worth'), 2)
	})

	it('shows a positive net worth equal to savings for a savings-only user (AC-6)', () => {
		seedSavings()
		renderWithProviders(<BalancePage />)

		// Exact match: '0.00' is a substring of '3,000.00', so a negative check cannot fail.
		expect(screen.getByTestId('stat-net-worth').textContent?.trim()).toBe('3,000.00')
	})

	it('shows the negated debt total for a debt-only user (AC-6)', () => {
		useBalanceStore.getState().addBalanceEntry({
			type: 'debt',
			name: 'Mortgage',
			currentBalance: 15_000_000,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		renderWithProviders(<BalancePage />)

		expect(screen.getByTestId('stat-net-worth')).toHaveTextContent('-150,000.00')
	})

	it('shows zero with no rows at all, and no NaN (AC-6)', () => {
		renderWithProviders(<BalancePage />)

		const netWorth = screen.getByTestId('stat-net-worth')
		expect(netWorth).toHaveTextContent('0.00')
		expect(netWorth.textContent).not.toMatch(/NaN/)
		expect(screen.getByTestId('stat-total-savings').textContent).not.toMatch(/NaN/)
	})
})

describe('BalancePage — sort by column (34.2)', () => {
	const SEED = [
		{
			type: 'investment' as const,
			name: 'Zeta',
			currentBalance: 300_00,
			monthlyContribution: 100_00,
			frequency: 'weekly' as const,
		},
		{
			type: 'debt' as const,
			name: 'Alpha',
			currentBalance: 500_00,
			monthlyContribution: 0,
			frequency: 'monthly' as const,
			paymentExpenseId: 'exp-alpha',
		},
		{
			type: 'investment' as const,
			name: 'Mid',
			currentBalance: 300_00,
			monthlyContribution: 50_00,
			frequency: 'annually' as const,
		},
		{
			type: 'investment' as const,
			name: 'Beta',
			currentBalance: 800_00,
			monthlyContribution: 200_00,
			frequency: 'monthly' as const,
		},
	]
	const NAMES = SEED.map((entry) => entry.name)
	const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

	function seedRows() {
		useBalanceStore.setState({ entries: [] })
		useExpenseStore.setState({ expenses: [expenseRow('exp-alpha', 'Alpha payment', 300_00)] })
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
		for (const entry of SEED) {
			useBalanceStore.getState().addBalanceEntry(entry)
			vi.advanceTimersByTime(1000)
		}
		vi.useRealTimers()
	}

	function entriesTable(): HTMLElement {
		const found = screen.getAllByRole('table') as HTMLElement[]
		expect(found).toHaveLength(1)
		return found[0] as HTMLElement
	}

	function orderIn(table: HTMLElement): string[] {
		return within(table)
			.getAllByRole('row')
			.slice(1)
			.map((row) => NAMES.find((name) => within(row).queryByText(name)) ?? '')
			.filter((name) => name !== '')
	}

	function header(name: string): HTMLElement {
		return within(entriesTable()).getByRole('columnheader', { name })
	}

	function sortBy(name: string): HTMLElement {
		return within(header(name)).getByRole('button', { name })
	}

	beforeEach(() => {
		seedRows()
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
		useBalanceStore.setState({ entries: [] })
	})

	it('renders in MANUAL order until a header is activated', () => {
		renderWithProviders(<BalancePage />)
		expect(orderIn(entriesTable())).toEqual(MANUAL_ORDER)
	})

	it('offers exactly the sortable columns on the EDITABLE table', () => {
		renderWithProviders(<BalancePage />)
		const entries = entriesTable()
		expect(
			within(entries)
				.getAllByRole('columnheader')
				.map((th) => th.textContent?.trim())
		).toEqual(['Type', 'Name', 'Current Balance/Value', 'Contribution', 'Actions'])
		for (const name of ['Type', 'Name', 'Current Balance/Value', 'Contribution']) {
			expect(within(header(name)).getByRole('button', { name })).toBeInTheDocument()
			expect(header(name)).toHaveAttribute('aria-sort', 'none')
		}
		const actions = header('Actions')
		expect(within(actions).queryByRole('button')).toBeNull()
		expect(actions).not.toHaveAttribute('aria-sort')
	})

	it('describes its headers and announces a header click, not a picker change (120.1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await expectSortHeaderAnnouncements(user, 'Sort balance entries')
	})

	it('cycles a column ascending -> descending -> back to manual order', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Name'))
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
		expect(orderIn(entriesTable())).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
		await user.click(sortBy('Name'))
		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
		expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])
		await user.click(sortBy('Name'))
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
		expect(orderIn(entriesTable())).toEqual(MANUAL_ORDER)
	})

	it('sorts Type by the enum — investments before debts', async () => {
		// Sorting by the displayed label would invert this: 'Debt' < 'Investment'.
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Type'))
		expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])
		await user.click(sortBy('Type'))
		expect(orderIn(entriesTable())).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
	})

	it('sorts Contribution by the FREQUENCY-NORMALIZED value', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Contribution'))
		expect(orderIn(entriesTable())).toEqual(['Mid', 'Beta', 'Alpha', 'Zeta'])
	})

	it('sorts Current Balance by value, ties on manual order', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Current Balance/Value'))
		expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])
		await user.click(sortBy('Current Balance/Value'))
		expect(orderIn(entriesTable())).toEqual(['Beta', 'Alpha', 'Zeta', 'Mid'])
	})

	it('sorts a LEGACY negative debt by the amount owed it shows (Story 103.1, rule 2)', async () => {
		// A legacy negative row shows 500.00, so it must sort as 500, not first as raw -500.
		useBalanceStore.setState({
			entries: useBalanceStore
				.getState()
				.entries.map((entry) =>
					entry.name === 'Alpha' ? { ...entry, currentBalance: -500_00 } : entry
				),
		})
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Current Balance/Value'))
		expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])
		await user.click(sortBy('Current Balance/Value'))
		expect(header('Current Balance/Value')).toHaveAttribute('aria-sort', 'descending')
		expect(orderIn(entriesTable())).toEqual(['Beta', 'Alpha', 'Zeta', 'Mid'])
	})

	it('keeps at most one column active', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Type'))
		expect(header('Type')).toHaveAttribute('aria-sort', 'ascending')
		await user.click(sortBy('Name'))
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
		expect(header('Type')).toHaveAttribute('aria-sort', 'none')
	})

	it('keeps focus on the header the user activated', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Name'))
		expect(orderIn(entriesTable())).not.toEqual(MANUAL_ORDER)
		expect(sortBy('Name')).toHaveFocus()
	})

	function sortControl(): HTMLSelectElement {
		return screen.getByRole('combobox', { name: 'Sort balance entries' }) as HTMLSelectElement
	}

	it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		expect(sortControl()).toBeInTheDocument()
		expect(sortControl().value).toBe('manual')

		await user.selectOptions(sortControl(), 'name:asc')
		expect(sortControl().value).toBe('name:asc')
	})

	it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		// Descending: ascending alone cannot tell a `select` from a `toggle`.
		await user.selectOptions(sortControl(), 'name:desc')
		expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
	})

	it('returns to manual order from the mobile control (48.1 AC-4)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(orderIn(entriesTable())).not.toEqual(MANUAL_ORDER)

		await user.selectOptions(sortControl(), 'manual')
		expect(orderIn(entriesTable())).toEqual(MANUAL_ORDER)
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
	})

	it('adds no retired colour tokens to the header row', () => {
		renderWithProviders(<BalancePage />)
		expect(collectRetiredTokenViolations(entriesTable())).toEqual([])
	})

	it('enqueues NOTHING on a PAID session — sorting is read-only over the store (AC-8)', async () => {
		// Registered and paid: an unregistered spy can never be called, and only the paid
		// tier has a sync path.
		const spies = {
			userId: '550e8400-e29b-41d4-a716-446655440000',
			queueCreate: vi.fn(async () => {}),
			queueUpdate: vi.fn(async () => {}),
			queueDelete: vi.fn(async () => {}),
		}
		registerSyncBridge(spies)
		try {
			const user = userEvent.setup()
			renderWithProviders(<BalancePage />)
			const before = useBalanceStore.getState().entries.map((row) => [row.id, row.sortOrder])

			const button = () => within(header('Name')).getByRole('button', { name: 'Name' })
			await user.click(button())
			await user.click(button())
			await user.click(button())

			expect(spies.queueUpdate).not.toHaveBeenCalled()
			expect(spies.queueCreate).not.toHaveBeenCalled()
			expect(spies.queueDelete).not.toHaveBeenCalled()
			expect(useBalanceStore.getState().entries.map((row) => [row.id, row.sortOrder])).toEqual(
				before
			)
		} finally {
			clearSyncBridge()
		}
	})

	it('places an entry added under an active sort in its SORTED position, not at the bottom', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(sortBy('Name'))

		await act(async () => {
			useBalanceStore.getState().addBalanceEntry({
				type: 'investment' as const,
				name: 'Bravo',
				currentBalance: 1_00,
				monthlyContribution: 0,
				frequency: 'monthly' as const,
			})
		})

		const names = [...NAMES, 'Bravo']
		const rendered = within(entriesTable())
			.getAllByRole('row')
			.slice(1)
			.map((row) => names.find((n) => within(row).queryByText(n)) ?? '')
			.filter((n) => n !== '')
		expect(rendered).toEqual(['Alpha', 'Beta', 'Bravo', 'Mid', 'Zeta'])
		expect(useBalanceStore.getState().entries.map((e) => e.name)).toEqual([
			...MANUAL_ORDER,
			'Bravo',
		])
	})

	it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		const before = screen.getByRole('button', { name: 'Edit Zeta' })
		await user.click(sortBy('Name'))
		expect(orderIn(entriesTable())).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])
		expect(screen.getByRole('button', { name: 'Edit Zeta' })).toBe(before)
	})

	it('places an unreadable contribution LAST without blanking the page (AC-4)', async () => {
		// Balance passes an adapted `isReadableRow` shape. `sortOrder: -1` puts the row first
		// manually, so "last under the sort" is not an accident of position.
		const user = userEvent.setup()
		useBalanceStore.setState((state) => ({
			entries: [
				{
					id: 'corrupt-balance-row',
					type: 'investment' as const,
					name: 'Corrupt',
					currentBalance: 1_00,
					monthlyContribution: 1_00,
					frequency: 'fortnightly' as never,
					sortOrder: -1,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				...state.entries,
			],
		}))
		renderWithProviders(<BalancePage />)
		const names = [...NAMES, 'Corrupt']
		const order = () =>
			within(entriesTable())
				.getAllByRole('row')
				.slice(1)
				.map((row) => names.find((n) => within(row).queryByText(n)) ?? '')
				.filter((n) => n !== '')
		expect(order()[0]).toBe('Corrupt')

		await user.click(sortBy('Contribution'))
		expect(order().at(-1)).toBe('Corrupt')
		await user.click(sortBy('Contribution'))
		expect(order().at(-1)).toBe('Corrupt')
	})

	it('gives every sortable header the standard focus ring', () => {
		renderWithProviders(<BalancePage />)
		for (const name of ['Type', 'Name', 'Current Balance/Value', 'Contribution']) {
			assertHasFocusRing(sortBy(name), name)
		}
	})
})

// Normalized because JSX joins source lines with newlines and `{' '}` separators.
const hintText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

// Pinned whole. Dashes are literal em dashes (U+2014) and apostrophes ASCII.
const DEBT_HINT =
	"Enter what you still owe today. Record the recurring payment on the Expenses page — that's where it counts against your cash flow — then pick it under Paid by. If the loan bought something you still have, record that as an Asset entry too, so your net worth reflects both sides. Where a mortgage belongs works through a full example."

const ASSET_HINT =
	"Enter what it's worth today. Money you put aside toward it belongs on the Savings page — an asset's value here changes as it appreciates, not as you contribute. A loan against it is recorded separately as a Debt entry, and your down payment is not entered anywhere. Where a mortgage belongs works through a full example."

// Derived from the doc registry so a slug rename fails here.
const MORTGAGE_DOC_SLUG = 'where-a-mortgage-belongs'
const MORTGAGE_DOC_HREF = `/docs/${MORTGAGE_DOC_SLUG}`
const MORTGAGE_DOC_LINK_NAME = 'Where a mortgage belongs'

// Present and absent claims are separate `it()` blocks so an inverted gate and a
// deleted gate body fail differently.
describe('BalancePage — debt guidance (36.3)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('explains the Current Balance field and where the payment goes, for debts', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')

		const hint = within(dialog).getByTestId('balance-debt-hint')
		expect(hintText(hint)).toBe(DEBT_HINT)
	})

	// Negative-only: a positive assertion here makes a deleted gate body and an
	// inverted condition fail identically.
	it('does not show the debt guidance on the default investment entry', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		expect(within(dialog).queryByTestId('balance-debt-hint')).not.toBeInTheDocument()
	})

	it('withdraws the debt guidance when the type is switched back to investment', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'investment')

		expect(within(dialog).queryByTestId('balance-debt-hint')).not.toBeInTheDocument()
	})
})

describe('BalancePage — the asset type (Story 43.4, FR70, AC-1/AC-4)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('offers Asset as a third type, selectable by its accessible name', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		const select = within(dialog).getByLabelText(/type/i)

		await user.selectOptions(select, 'asset')
		expect((select as HTMLSelectElement).value).toBe('asset')
	})

	it('asks an asset for NO contribution or frequency (D2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		expect(within(dialog).getByTestId('balance-monthly-contribution-input')).toBeInTheDocument()
		expect(within(dialog).getByTestId('balance-frequency-select')).toBeInTheDocument()

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'asset')

		// An asset grows by appreciation; a contribution on it would be excluded from
		// `/savings`'s investment-only pool, overstating it.
		expect(
			within(dialog).queryByTestId('balance-monthly-contribution-input')
		).not.toBeInTheDocument()
		expect(within(dialog).queryByTestId('balance-frequency-select')).not.toBeInTheDocument()

		expect(within(dialog).getByTestId('balance-asset-hint')).toBeInTheDocument()
	})

	it('states the asset hint verbatim, including the loan pointer and the down payment (49.2, AC-3/AC-14)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'asset')

		const hint = within(dialog).getByTestId('balance-asset-hint')
		expect(hintText(hint)).toBe(ASSET_HINT)
	})

	it('saves an asset with a zero contribution and a monthly frequency', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'asset')
		await user.type(within(dialog).getByTestId('balance-name-input'), 'Condo')
		await user.type(within(dialog).getByTestId('balance-current-balance-input'), '400000')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		const entries = useBalanceStore.getState().entries
		expect(entries).toHaveLength(1)
		expect(entries[0]?.type).toBe('asset')
		expect(entries[0]?.currentBalance).toBe(40_000_000)
		// Both columns are NOT NULL, so hiding the fields must still write values.
		expect(entries[0]?.monthlyContribution).toBe(0)
		expect(entries[0]?.frequency).toBe('monthly')
		expect('maxContributionLimit' in (entries[0] ?? {})).toBe(false)
	})

	it('counts an asset on the ASSET side, in its own card, not folded into investments', async () => {
		// Net worth is invariant under classifying an asset as an investment, so assert
		// the component totals.
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment',
					name: 'ISA',
					currentBalance: 5_000_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: 'asset-1',
					type: 'asset',
					name: 'Condo',
					currentBalance: 40_000_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: 'debt-1',
					type: 'debt',
					name: 'Mortgage',
					currentBalance: 30_000_000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		renderWithProviders(<BalancePage />)

		// 5,000,000 + 0 savings + 40,000,000 − 30,000,000 = 15,000,000.
		expect(screen.getByTestId('stat-total-investments')).toHaveTextContent('50,000.00')
		expect(screen.getByTestId('stat-total-assets')).toHaveTextContent('400,000.00')
		expect(screen.getByTestId('stat-total-debts')).toHaveTextContent('300,000.00')
		expect(screen.getByTestId('stat-net-worth')).toHaveTextContent('150,000.00')
	})
})

describe('BalancePage — mortgage guidance link and contrast token (49.2)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	const openArm = async (type: 'debt' | 'asset'): Promise<HTMLElement> => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.selectOptions(within(dialog).getByLabelText(/type/i), type)
		return within(dialog).getByTestId(`balance-${type}-hint`)
	}

	it('the pinned href resolves to a real doc page, not just a matching string (AC-1)', () => {
		// The only assertion that survives a slug rename: the rest compare against
		// `MORTGAGE_DOC_HREF`, which moves with it.
		expect(getDocPage(MORTGAGE_DOC_SLUG)?.title).toBe(MORTGAGE_DOC_LINK_NAME)
	})

	for (const type of ['debt', 'asset'] as const) {
		it(`links the ${type} hint to the mortgage guidance doc (AC-1/AC-2)`, async () => {
			const hint = await openArm(type)

			const link = within(hint).getByRole('link', { name: MORTGAGE_DOC_LINK_NAME })
			expect(link.getAttribute('href')).toBe(MORTGAGE_DOC_HREF)
		})

		it(`keeps the ${type} hint on the token that passes AA in both themes (AC-5)`, async () => {
			const hint = await openArm(type)

			expect([...hint.classList]).toContain('text-muted')
			expect([...hint.classList]).not.toContain('text-faint')
		})
	}
})

describe('BalancePage — contributionRecordedAsExpense is investment-only (Story 45.1)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	it('shows the checkbox for an investment and HIDES it for a debt and an asset', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

		expect(
			within(dialog).getByTestId('balance-contribution-recorded-as-expense')
		).toBeInTheDocument()

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
		expect(
			within(dialog).queryByTestId('balance-contribution-recorded-as-expense')
		).not.toBeInTheDocument()

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'asset')
		expect(
			within(dialog).queryByTestId('balance-contribution-recorded-as-expense')
		).not.toBeInTheDocument()

		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'investment')
		expect(
			within(dialog).getByTestId('balance-contribution-recorded-as-expense')
		).toBeInTheDocument()
	})

	it('persists the ticked flag on save', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.type(within(dialog).getByLabelText(/name/i), 'TFSA')
		await user.type(within(dialog).getByTestId('balance-current-balance-input'), '10000')
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '500')
		await user.click(within(dialog).getByTestId('balance-contribution-recorded-as-expense'))
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.contributionRecordedAsExpense).toBe(true)
	})

	it('saves false when the box is left unticked (today’s arithmetic, unchanged)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.type(within(dialog).getByLabelText(/name/i), 'RRSP')
		await user.type(within(dialog).getByTestId('balance-current-balance-input'), '10000')
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '500')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.contributionRecordedAsExpense).toBe(false)
	})

	it('FORCES the flag false when an investment is switched to a debt before saving', async () => {
		// A stale `true` from the investment branch would make `validateBalanceTracking`
		// reject the whole write.
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.type(within(dialog).getByLabelText(/name/i), 'Reclassified')
		await user.type(within(dialog).getByTestId('balance-current-balance-input'), '3000')
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '100')
		await user.click(within(dialog).getByTestId('balance-contribution-recorded-as-expense'))
		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const entry = useBalanceStore.getState().entries[0]
		if (!entry) throw new Error('save failed — the type-switch gate did not clear the flag')
		expect(entry.type).toBe('debt')
		expect(entry.contributionRecordedAsExpense).toBe(false)
	})

	it('re-opens an edit modal with the stored flag reflected', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({
			entries: [
				{
					id: 'inv-1',
					type: 'investment',
					name: 'TFSA',
					currentBalance: 100_000,
					monthlyContribution: 50_000,
					frequency: 'monthly',
					contributionRecordedAsExpense: true,
					sortOrder: 0,
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			],
		})
		renderWithProviders(<BalancePage />)

		await user.click(screen.getAllByRole('button', { name: /edit/i })[0] as HTMLElement)
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByTestId('balance-contribution-recorded-as-expense')).toBeChecked()
	})
})

describe('BalancePage — the contribution control serves both populations (Story 47.1)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	async function openInvestmentForm(): Promise<HTMLElement> {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		await user.click(screen.getByTestId('balance-add-button'))
		return screen.getByRole('dialog', { name: 'Add Balance Entry' })
	}

	it('AC-1: the label states the EFFECT rather than one of the two causes', async () => {
		const dialog = await openInvestmentForm()
		expect(within(dialog).getByLabelText(/Not\s+taken\s+from\s+the\s+money\s+left\s+over/i)).toBe(
			within(dialog).getByTestId('balance-contribution-recorded-as-expense')
		)
	})

	it('AC-1(a): the payroll arm is CONJUNCTIVE, so a gross-income user answers no', async () => {
		const dialog = await openInvestmentForm()
		const help = within(dialog).getByText(/Tick this if the contribution/i)

		// Must ask that the entered income is take-home: a gross-income user who ticks the
		// box overstates the pool by the contribution.
		expect(help.textContent).toMatch(
			/comes\s+out\s+of\s+your\s+pay\s+and\s+the\s+income\s+you\s+entered\s+is\s+your\s+take-home\s+pay/i
		)
		expect(help.textContent).not.toMatch(/before\s+the\s+income\s+you\s+entered/i)
		expect(help.textContent).not.toMatch(/reaches\s+your\s+bank\s+account/i)

		// "comes out of your pay" must appear exactly once; a second occurrence is how a
		// disjunctive escape reads.
		expect(help.textContent?.match(/comes\s+out\s+of\s+your\s+pay/gi)?.length).toBe(1)
	})

	it('AC-1(b,c): it also names the expense-listing arm and resolves the both-at-once case', async () => {
		const dialog = await openInvestmentForm()
		const help = within(dialog).getByText(/Tick this if the contribution/i)

		expect(help.textContent).toMatch(/listed\s+on\s+your\s+Expenses\s+page/i)
		expect(help.textContent).toMatch(/If\s+it's\s+both,\s+delete\s+the\s+Expenses\s+line/i)
		expect(help.textContent).toMatch(/Savings\s+page\s+doesn't\s+subtract\s+it\s+twice/i)
	})

	it('AC-2: the control never says "net" (story 46.1 removed that word from income copy)', async () => {
		const dialog = await openInvestmentForm()
		expect(dialog.textContent).not.toMatch(/\bnet\b(?!\s+worth)/i)
	})

	it('AC-3: the help text is the checkbox’s accessible description', async () => {
		const dialog = await openInvestmentForm()
		// A string pin on `aria-describedby` passes for an id that resolves to nothing.
		expect(
			within(dialog).getByTestId('balance-contribution-recorded-as-expense')
		).toHaveAccessibleDescription(/Tick this if the contribution is already counted/i)
	})
})

describe('BalancePage — the modal asks exactly the right fields per type (story 49.1)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	const controlsIn = (dialog: HTMLElement): string[] =>
		[...dialog.querySelectorAll('[data-testid]')]
			.map((el) => el.getAttribute('data-testid') ?? '')
			.filter((id) => /-(input|select|checkbox)$|recorded-as-expense$/.test(id))
			.sort()

	it.each([
		[
			'investment',
			[
				'balance-name-input',
				'balance-current-balance-input',
				'balance-monthly-contribution-input',
				'balance-frequency-select',
				'balance-contribution-recorded-as-expense',
			],
		],
		[
			'debt',
			['balance-name-input', 'balance-current-balance-input', 'balance-payment-expense-select'],
		],
		['asset', ['balance-name-input', 'balance-current-balance-input']],
	])('a %s asks for exactly its own fields', async (type, expected) => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		if (type !== 'investment') {
			await user.selectOptions(within(dialog).getByLabelText(/type/i), type)
		}

		expect(controlsIn(dialog)).toEqual([...expected].sort())
	})

	it.each(['investment', 'debt', 'asset'])(
		'labels the balance field the same way for a %s (AC-12)',
		async (type) => {
			const user = userEvent.setup()
			renderWithProviders(<BalancePage />)

			await user.click(screen.getByTestId('balance-add-button'))
			const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
			if (type !== 'investment') {
				await user.selectOptions(within(dialog).getByLabelText(/type/i), type)
			}

			// The DOM id stays `currentBalance`: only the label changed.
			const label = within(dialog).getByText('Current Balance/Value *')
			expect(label).toHaveAttribute('for', 'currentBalance')
			expect(within(dialog).getByTestId('balance-current-balance-input')).toHaveAttribute(
				'id',
				'currentBalance'
			)
		}
	)
})

// The jurisdiction ban is asserted on the strings, never the file: names like
// `401k` are legitimate fixtures here.
describe('BalancePage — the Name placeholder follows the Type dropdown (story 52.1)', () => {
	beforeEach(() => {
		useBalanceStore.setState({ entries: [] })
	})
	afterEach(() => {
		useBalanceStore.setState({ entries: [] })
	})

	const JURISDICTION_SPECIFIC =
		/\b(401\s*\(?k\)?s?|IRAs?|Roth|HSAs?|529s?|TFSAs?|RRSPs?|ISAs?|Premium Bonds?|Super(annuation| Fund)?|SIPPs?|KiwiSaver|Brokerage|Mutual Funds?|Unit Trusts?)\b/i

	const DISTINGUISHING = {
		investment: /investment account/i,
		debt: /mortgage/i,
		asset: /property/i,
	} as const satisfies Record<FinanceType, RegExp>

	const OWNED_NOUNS = {
		investment: [/investment account/i, /pension/i, /index fund/i],
		debt: [/mortgage/i, /car loan/i, /credit card/i],
		asset: [/property/i, /vehicle/i, /artwork/i],
	} as const satisfies Record<FinanceType, readonly RegExp[]>

	const placeholderIn = (dialog: HTMLElement): string =>
		within(dialog).getByTestId('balance-name-input').getAttribute('placeholder') ?? ''

	const openAddDialog = async () => {
		const user = userEvent.setup()
		await user.click(screen.getByTestId('balance-add-button'))
		return { user, dialog: screen.getByRole('dialog', { name: 'Add Balance Entry' }) }
	}

	const selectType = async (
		user: ReturnType<typeof userEvent.setup>,
		dialog: HTMLElement,
		type: FinanceType
	) => {
		await user.selectOptions(within(dialog).getByLabelText(/type/i), type)
	}

	// Driven off FINANCE_TYPES so a new finance type is exercised here too.
	it.each(FINANCE_TYPES)(
		'offers examples of a %s once that type is chosen (AC-1, AC-2)',
		async (type) => {
			renderWithProviders(<BalancePage />)
			const { user, dialog } = await openAddDialog()
			// Selected unconditionally so the investment option's `value` is exercised too.
			await selectType(user, dialog, type)

			const placeholder = placeholderIn(dialog)

			expect(placeholder).toMatch(/^e\.g\., \S/)
			expect(placeholder).toMatch(DISTINGUISHING[type])

			for (const [other, patterns] of Object.entries(OWNED_NOUNS)) {
				if (other === type) continue
				for (const pattern of patterns) {
					expect(placeholder, `a ${type} must not show a ${other} example`).not.toMatch(pattern)
				}
			}
		}
	)

	it('changes the example as the type changes, within one render (AC-1)', async () => {
		renderWithProviders(<BalancePage />)
		const { user, dialog } = await openAddDialog()

		// One mounted form, not three renders: the placeholder must track the current type.
		const investment = placeholderIn(dialog)
		await selectType(user, dialog, 'debt')
		const debt = placeholderIn(dialog)
		await selectType(user, dialog, 'asset')
		const asset = placeholderIn(dialog)

		expect(investment).toMatch(DISTINGUISHING.investment)
		expect(debt).toMatch(DISTINGUISHING.debt)
		expect(asset).toMatch(DISTINGUISHING.asset)
		expect(new Set([investment, debt, asset]).size).toBe(3)
	})

	it('follows a type change made inside the edit dialog (AC-4)', async () => {
		const user = userEvent.setup()
		// Seeded as an asset so the initial assertion is not the default type.
		useBalanceStore.getState().addBalanceEntry({
			type: 'asset',
			name: 'Family Home',
			currentBalance: 45000000,
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Family Home' }))
		const dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })

		const before = placeholderIn(dialog)
		expect(before).toMatch(DISTINGUISHING.asset)

		await selectType(user, dialog, 'debt')
		const after = placeholderIn(dialog)
		expect(after).toMatch(DISTINGUISHING.debt)
		expect(after).not.toBe(before)
	})

	it('offers no cash or savings example on the asset arm (52.1 review reversal)', async () => {
		renderWithProviders(<BalancePage />)
		const { user, dialog } = await openAddDialog()
		await selectType(user, dialog, 'asset')

		const placeholder = placeholderIn(dialog)

		expect(placeholder).toMatch(/^e\.g\., \S/)
		expect(placeholder).toMatch(OWNED_NOUNS.asset[0])

		// A cash example contradicts the asset hint beside it and invites double-counting
		// with Savings.
		expect(placeholder).not.toMatch(/cash|savings|deposit/i)
	})

	it('still shows an example when the stored type is outside FinanceType', async () => {
		const user = userEvent.setup()
		// Reachable: neither persist `migrate` nor sync pull validates `type`.
		useBalanceStore.setState({
			entries: [
				{
					id: 'legacy-1',
					type: 'savings' as unknown as FinanceType,
					name: 'Legacy Row',
					currentBalance: 100000,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			] as never,
		})
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Legacy Row' }))
		const dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })

		expect(placeholderIn(dialog)).toMatch(/^e\.g\., \S/)
	})

	it.each(FINANCE_TYPES)(
		'names no single-country product in the %s example (AC-6, AC-7)',
		async (type) => {
			renderWithProviders(<BalancePage />)
			const { user, dialog } = await openAddDialog()
			await selectType(user, dialog, type)

			const placeholder = placeholderIn(dialog)

			// The `?? ''` helper turns a missing placeholder into an assertable empty string.
			expect(placeholder).toMatch(/^e\.g\., \S/)
			expect(placeholder).not.toMatch(JURISDICTION_SPECIFIC)
		}
	)
})

describe('BalancePage — a debt is paid by a linked expense (Story 102.1)', () => {
	const MAIN = 'profile-main'
	const OTHER = 'profile-other'

	beforeEach(() => {
		useProfileStore.setState({ activeProfileId: MAIN })
		useBalanceStore.setState({ entries: [] })
		useExpenseStore.setState({
			expenses: [
				{ ...expenseRow('exp-car', 'Car payment', 45_000), profileId: MAIN },
				{ ...expenseRow('exp-rent', 'Rent', 150_000), profileId: MAIN },
				{ ...expenseRow('exp-other', 'Other profile bill', 9_900), profileId: OTHER },
			],
		})
	})

	afterEach(() => {
		useExpenseStore.setState({ expenses: [] })
		useBalanceStore.setState({ entries: [] })
		useProfileStore.setState({ activeProfileId: null })
	})

	const debt = (overrides: Record<string, unknown> = {}) => ({
		id: 'debt-car',
		profileId: MAIN,
		type: 'debt' as const,
		name: 'Car Loan',
		// Positive, as the form saves a debt (a negative value fails the form's balance check).
		currentBalance: 1_200_000,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		paymentExpenseId: 'exp-car',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	})

	const optionTexts = (select: HTMLElement): string[] =>
		[...(select as HTMLSelectElement).options].map((option) => option.textContent ?? '')

	async function openAddDebt(user: ReturnType<typeof userEvent.setup>) {
		await user.click(screen.getByTestId('balance-add-button'))
		const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
		return dialog
	}

	it('offers a labelled "Paid by" picker for a debt: Not linked, then this profile’s expenses', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		const dialog = await openAddDebt(user)

		const picker = within(dialog).getByLabelText('Paid by')
		expect(picker).toHaveValue('')
		const texts = optionTexts(picker)
		expect(texts[0]).toBe('Not linked')
		expect(texts).toHaveLength(3)
		expect(texts[1]).toMatch(/^Car payment — .*450\.00 \/ Monthly$/)
		expect(texts[2]).toMatch(/^Rent — .*1,500\.00 \/ Monthly$/)
		expect(texts.join('|')).not.toContain('Other profile bill')
	})

	it('saves the link with a zero contribution, and the row shows the expense’s payment', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		const dialog = await openAddDebt(user)

		await user.type(within(dialog).getByLabelText(/name/i), 'Car Loan')
		await user.type(within(dialog).getByLabelText(/current balance/i), '12000')
		await user.selectOptions(within(dialog).getByLabelText('Paid by'), 'exp-car')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const [saved] = useBalanceStore.getState().entries
		expect(saved).toMatchObject({
			type: 'debt',
			paymentExpenseId: 'exp-car',
			monthlyContribution: 0,
			frequency: 'monthly',
		})
		expect(screen.getByText('Paid by Car payment')).toBeInTheDocument()
		expect(screen.getAllByText('450.00').length).toBeGreaterThan(0)
	})

	it('saves "Not linked" as null, and the row says Not linked', async () => {
		const user = userEvent.setup()
		renderWithProviders(<BalancePage />)
		const dialog = await openAddDebt(user)

		await user.type(within(dialog).getByLabelText(/name/i), 'Card')
		await user.type(within(dialog).getByLabelText(/current balance/i), '500')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBeNull()
		expect(screen.getByText('Not linked')).toBeInTheDocument()
	})

	it('does not offer an expense another debt already uses, but keeps the edited debt’s own', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({ entries: [debt()] })
		renderWithProviders(<BalancePage />)

		let dialog = await openAddDebt(user)
		expect(optionTexts(within(dialog).getByLabelText('Paid by')).join('|')).not.toContain(
			'Car payment'
		)
		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		const picker = within(dialog).getByLabelText('Paid by')
		expect(picker).toHaveValue('exp-car')
	})

	it('follows the expense live: editing its amount changes the debt row with no debt edit', () => {
		useBalanceStore.setState({ entries: [debt()] })
		renderWithProviders(<BalancePage />)
		expect(screen.getAllByText('450.00').length).toBeGreaterThan(0)

		act(() => {
			useExpenseStore.getState().updateExpense('exp-car', { amount: 47_500 })
		})
		expect(screen.getAllByText('475.00').length).toBeGreaterThan(0)
		expect(screen.queryByText('450.00')).not.toBeInTheDocument()
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBe('exp-car')
	})

	it('reads a deleted linked expense as Not linked, without touching the debt', () => {
		useBalanceStore.setState({ entries: [debt()] })
		renderWithProviders(<BalancePage />)
		expect(screen.getByText('Paid by Car payment')).toBeInTheDocument()

		act(() => {
			useExpenseStore.getState().deleteExpense('exp-car')
		})
		expect(screen.getByText('Not linked')).toBeInTheDocument()
		// No cascade: the stored link stays (it may resolve again after a pull).
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBe('exp-car')
	})

	it.each([
		['another profile’s expense', 'exp-other'],
		['an expense this device has never pulled', '55555555-5555-4555-8555-555555555555'],
		['a corrupt non-string value', 42],
	])('reads a link to %s as Not linked, with no error', (_case, paymentExpenseId) => {
		useBalanceStore.setState({ entries: [debt({ paymentExpenseId })] as never })
		renderWithProviders(<BalancePage />)
		expect(screen.getByText('Not linked')).toBeInTheDocument()
		expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
	})

	it('⚠️ D7: keeps a link this device cannot resolve when the debt is saved untouched', async () => {
		const user = userEvent.setup()
		const remote = '55555555-5555-4555-8555-555555555555'
		useBalanceStore.setState({ entries: [debt({ paymentExpenseId: remote })] })
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		let dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		const picker = within(dialog).getByLabelText('Paid by') as HTMLSelectElement
		expect(picker.selectedOptions[0]?.textContent).toBe('Linked expense not on this device')

		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBe(remote)

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		await user.selectOptions(within(dialog).getByLabelText('Paid by'), '')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBeNull()
	})

	it('keeps the unavailable-link option after "Not linked" is picked, so the stored link can be restored (code review)', async () => {
		const user = userEvent.setup()
		const remote = '55555555-5555-4555-8555-555555555555'
		useBalanceStore.setState({ entries: [debt({ paymentExpenseId: remote })] })
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		const dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		const picker = within(dialog).getByLabelText('Paid by') as HTMLSelectElement
		await user.selectOptions(picker, '')
		expect(optionTexts(picker)).toContain('Linked expense not on this device')

		await user.selectOptions(picker, 'Linked expense not on this device')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]?.paymentExpenseId).toBe(remote)
	})

	it('survives a linked expense with a corrupt non-string frequency (code review)', async () => {
		const user = userEvent.setup()
		useExpenseStore.setState({
			expenses: [
				{
					...expenseRow('exp-car', 'Car payment', 45_000),
					profileId: MAIN,
					frequency: {} as never,
				},
			],
		})
		useBalanceStore.setState({ entries: [debt()] })
		renderWithProviders(<BalancePage />)
		expect(screen.getByText('Paid by Car payment')).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		const dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		const texts = optionTexts(within(dialog).getByLabelText('Paid by'))
		expect(texts[1]).toMatch(/^Car payment — .*450\.00$/)
		expect(texts.join('|')).not.toContain('[object')
	})

	it('⚠️ saves null when a linked debt is switched to an investment', async () => {
		const user = userEvent.setup()
		useBalanceStore.setState({ entries: [debt()] })
		renderWithProviders(<BalancePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Car Loan' }))
		const dialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
		await user.selectOptions(within(dialog).getByLabelText(/type/i), 'investment')
		await user.clear(within(dialog).getByTestId('balance-monthly-contribution-input'))
		await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '100')
		await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useBalanceStore.getState().entries[0]).toMatchObject({
			type: 'investment',
			paymentExpenseId: null,
			monthlyContribution: 10_000,
		})
	})

	it('never writes the expense store (linking only reads it)', async () => {
		const user = userEvent.setup()
		const before = useExpenseStore.getState().expenses
		renderWithProviders(<BalancePage />)
		const dialog = await openAddDebt(user)
		await user.type(within(dialog).getByLabelText(/name/i), 'Car Loan')
		await user.type(within(dialog).getByLabelText(/current balance/i), '12000')
		await user.selectOptions(within(dialog).getByLabelText('Paid by'), 'exp-car')
		await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useExpenseStore.getState().expenses).toBe(before)
	})
})
