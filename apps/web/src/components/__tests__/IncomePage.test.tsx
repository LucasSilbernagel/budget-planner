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
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useIncomeStore } from '../../stores/incomeStore'

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
import { IncomePage } from '../IncomePage'

describe('IncomePage delete confirmation', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('opens a themed alertdialog instead of a browser confirm', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Delete Salary' }))

		const dialog = screen.getByRole('alertdialog', { name: 'Confirm Delete' })
		expect(dialog).toBeInTheDocument()
		expect(dialog).toHaveTextContent('Salary')
	})

	it('Cancel aborts the delete — the row remains', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Delete Salary' }))
		await user.click(screen.getByTestId('delete-confirm-cancel'))

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
	})

	it('Confirm performs the delete — the row is removed', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Delete Salary' }))
		await user.click(screen.getByTestId('delete-confirm-confirm'))

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
		expect(screen.queryByText('Salary')).not.toBeInTheDocument()
		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('Escape aborts the delete — the row remains', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Delete Salary' }))
		await user.keyboard('{Escape}')

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
	})

	it('a backdrop click aborts the delete — the row remains', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Delete Salary' }))
		const dialog = screen.getByRole('alertdialog', { name: 'Confirm Delete' })
		await user.click(dialog.parentElement as HTMLElement)

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
	})
})

describe('IncomePage add dialog dismissal', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	async function openFilledAddDialog(user: ReturnType<typeof userEvent.setup>) {
		renderWithProviders(<IncomePage />)
		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expectSharedGreen(screen.getByRole('button', { name: '+ Add Income Source' }))
		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog', { name: 'Add Income Source' })
		await user.type(within(dialog).getByLabelText('Name *'), 'Draft')
		await user.type(within(dialog).getByLabelText('Amount *'), '1000')
		return dialog
	}

	it('closes on Escape with no income added', async () => {
		const user = userEvent.setup()
		await openFilledAddDialog(user)

		await user.keyboard('{Escape}')

		expect(screen.queryByRole('dialog', { name: 'Add Income Source' })).not.toBeInTheDocument()
		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('closes on a backdrop click with no income added', async () => {
		const user = userEvent.setup()
		const dialog = await openFilledAddDialog(user)

		await user.click(dialog.parentElement as HTMLElement)

		expect(screen.queryByRole('dialog', { name: 'Add Income Source' })).not.toBeInTheDocument()
		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})

	it('does not close when clicking inside the dialog content', async () => {
		const user = userEvent.setup()
		const dialog = await openFilledAddDialog(user)

		await user.click(within(dialog).getByRole('heading', { name: 'Add Income Source' }))

		expect(screen.getByRole('dialog', { name: 'Add Income Source' })).toBeInTheDocument()
	})
})

describe('IncomePage inline validation', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('shows inline field errors on invalid submit and does not mutate the store', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		expect(screen.getByTestId('income-name-error')).toHaveTextContent(
			'Please enter a name for the income source'
		)
		expect(screen.getByTestId('income-amount-error')).toHaveTextContent(
			'Please enter a valid positive amount'
		)
		const nameInput = screen.getByTestId('income-name-input')
		expect(nameInput).toHaveAttribute('aria-invalid', 'true')
		expect(nameInput).toHaveAttribute('aria-describedby', 'income-name-error')
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('clears the error after correction and a valid submit succeeds (AC-3)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))
		expect(screen.getByTestId('income-name-error')).toBeInTheDocument()

		await user.type(screen.getByTestId('income-name-input'), 'Freelance')
		await waitFor(() => expect(screen.queryByTestId('income-name-error')).not.toBeInTheDocument())

		await user.type(screen.getByTestId('income-amount-input'), '100')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		const sources = useIncomeStore.getState().incomeSources
		expect(sources).toHaveLength(1)
		expect(sources[0]).toMatchObject({ name: 'Freelance', amount: 10000 })
	})
})

describe('IncomePage take-home guidance (story 46.1)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('states at the point of entry that the amount is take-home pay (AC-1, AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const hint = within(dialog).getByTestId('income-amount-hint')

		expect(hint.textContent).toMatch(
			/Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
		)
		expect(hint.textContent).toMatch(/after\s+tax\s+and\s+any\s+other\s+deductions/i)
	})

	it('shows the same guidance when editing an existing source (AC-3)', async () => {
		const user = userEvent.setup()
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')

		expect(amountInput).toHaveAccessibleDescription(
			/Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
		)
	})

	it('does not use the word "net" anywhere in the dialog (AC-11)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')

		expect(dialog.textContent).not.toMatch(/\bnet\b/i)
	})

	it('describes the amount input with the hint when there is no error (AC-8)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')

		expect(amountInput).toHaveAccessibleDescription(
			/Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
		)
		const described = (amountInput.getAttribute('aria-describedby') ?? '').split(/\s+/)
		expect(described).toEqual(['income-amount-hint'])
	})

	it('keeps BOTH the hint and the error described when validation fails (AC-8)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		const amountInput = within(dialog).getByTestId('income-amount-input')
		const described = (amountInput.getAttribute('aria-describedby') ?? '').split(/\s+/)
		expect(described).toContain('income-amount-hint')
		expect(described).toContain('income-amount-error')

		expect(amountInput).toHaveAccessibleDescription(
			/Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
		)
		expect(amountInput).toHaveAccessibleDescription(
			/Please\s+enter\s+a\s+valid\s+positive\s+amount/i
		)

		expect(within(dialog).getByTestId('income-amount-error')).toHaveTextContent(
			'Please enter a valid positive amount'
		)
	})
})

describe('IncomePage currency input formatting (story 14-3)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	it('shows no currency symbol on the amount input in currency-less mode', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		expect(within(dialog).queryByText('$')).not.toBeInTheDocument()
		expect(within(dialog).queryByText('€')).not.toBeInTheDocument()
	})

	it('shows the selected currency symbol (not $) on the amount input in symbols mode', async () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByText('€')).toBeInTheDocument()
		expect(within(dialog).queryByText('$')).not.toBeInTheDocument()
	})

	it('parses a grouped amount to the correct integer cents on submit', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('income-name-input'), 'Bonus')
		await user.type(within(dialog).getByTestId('income-amount-input'), '1,234,567.89')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(useIncomeStore.getState().incomeSources[0]).toMatchObject({
			name: 'Bonus',
			amount: 123456789,
		})
	})

	it('re-echoes the amount with locale grouping on blur', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')
		await user.type(amountInput, '1234567.89')
		await user.tab()

		await waitFor(() => expect(amountInput).toHaveValue('1,234,567.89'))
	})

	it('never lets letters into the field, and blur leaves it empty rather than "0.00" (story 28-1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')
		await user.type(amountInput, 'abc')

		expect(amountInput).toHaveValue('')

		await user.tab()
		await waitFor(() => expect(amountInput).toHaveValue(''))
		expect(amountInput).not.toHaveValue('0.00')
	})

	it('keeps a lone "-" on blur instead of zeroing it (the no-digit guard arm)', async () => {
		// The sanitizer keeps digit-free partials so a negative can be typed; "-" must
		// not blur-echo as "0.00".
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')
		await user.type(amountInput, '-')
		await user.tab()

		await waitFor(() => expect(amountInput).toHaveValue('-'))
	})

	it('strips pasted garbage down to the numeric part in one change event (AC-5)', async () => {
		// A paste arrives as one change event, which is why the filter lives in onChange.
		renderWithProviders(<IncomePage />)

		await userEvent.setup().click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')
		const amountInput = within(dialog).getByTestId('income-amount-input')
		fireEvent.change(amountInput, { target: { value: 'USD 1,234.56 per month' } })

		expect(amountInput).toHaveValue('1,234.56')
	})

	it('prefills the edit modal with a grouped, locale-aware amount (story 28-1)', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({ incomeSources: [] })
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 123456789, frequency: 'monthly' })
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
		const dialog = screen.getByRole('dialog')

		expect(within(dialog).getByTestId('income-amount-input')).toHaveValue('1,234,567.89')
	})
})

describe('IncomePage form controls have a visible focus ring', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('every control that kills the native outline restores a 2px ring', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		const dialog = screen.getByRole('dialog')

		const controls = [
			within(dialog).getByTestId('income-name-input'),
			within(dialog).getByTestId('income-amount-input'),
			within(dialog).getByLabelText('Frequency *'),
		]

		let checked = 0
		for (const control of controls) {
			const tokens = control.className.split(/\s+/)
			expect(tokens, `${control.id} no longer kills the native outline`).toContain(
				'focus:outline-none'
			)
			expect(tokens, `${control.id} has no visible focus ring`).toContain('focus:ring-2')
			expect(
				tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
				`${control.id} has a ring width but no ring colour`
			).toBe(true)
			checked++
		}
		expect(checked).toBe(controls.length)
	})
})

describe('IncomePage mobile card presentation (story 31.2)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	function rowFor(name: string): HTMLElement {
		const row = screen.getByText(name).closest('tr')
		if (!row) throw new Error(`no <tr> ancestor for "${name}"`)
		return row as HTMLElement
	}

	it('carries every column value on the card', () => {
		premium()
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')

		expect(within(row).getByText('5,000.00')).toBeInTheDocument()
		expect(within(row).getByText('monthly')).toBeInTheDocument()
		expect(within(row).getByTestId('income-row-uncategorized')).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Edit Salary' })).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Delete Salary' })).toBeInTheDocument()
	})

	it('carries every column value on a free user’s card, minus Category (story 33.3)', () => {
		free()
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')

		expect(within(row).getByText('5,000.00')).toBeInTheDocument()
		expect(within(row).getByText('monthly')).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Edit Salary' })).toBeInTheDocument()
		expect(within(row).getByRole('button', { name: 'Delete Salary' })).toBeInTheDocument()
		expect(within(row).queryByTestId('income-row-uncategorized')).not.toBeInTheDocument()
		expect(within(row).queryByTestId('income-row-category')).not.toBeInTheDocument()
	})

	it('labels every field on the card (AC-4)', () => {
		premium()
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')

		// Scoped with within(row): jsdom applies no media queries, so header and mobile
		// label text are both in the DOM.
		expect(mobileLabelsIn(row)).toEqual(['Name', 'Amount', 'Frequency', 'Category', 'Actions'])
		for (const label of ['Name', 'Amount', 'Frequency', 'Category', 'Actions']) {
			expect([...within(row).getByText(label).classList]).toContain('sm:hidden')
		}
	})

	it('labels every field on a free user’s card, with no Category field (story 33.3)', () => {
		free()
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')

		expect(mobileLabelsIn(row)).toEqual(['Name', 'Amount', 'Frequency', 'Actions'])
	})

	it('has exactly one table in the DOM — no dual-rendered card list', () => {
		const { container } = renderWithProviders(<IncomePage />)
		expect(container.querySelectorAll('table')).toHaveLength(1)
		expect(screen.getAllByText('Salary')).toHaveLength(1)
	})

	it('declares the shared card classes on the table, body and rows (AC-8)', () => {
		const { container } = renderWithProviders(<IncomePage />)
		const table = container.querySelector('table') as HTMLElement

		expect([...table.classList]).toContain('max-sm:block')
		expect([...(table.querySelector('thead') as HTMLElement).classList]).toContain('max-sm:hidden')
		expect([...(table.querySelector('tbody') as HTMLElement).classList]).toContain('max-sm:block')
		expect([...rowFor('Salary').classList]).toContain('max-sm:block')
	})

	it('every row Edit/Delete button carries a focus ring with a colour (AC-5)', () => {
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')
		for (const label of ['Edit Salary', 'Delete Salary']) {
			assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
		renderWithProviders(<IncomePage />)
		const row = rowFor('Salary')
		for (const label of ['Edit Salary', 'Delete Salary']) {
			assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
		}
	})

	it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
		renderWithProviders(<IncomePage />)
		const cell = rowFor('Salary').querySelector('td:last-child') as HTMLElement
		expect(
			within(cell)
				.getAllByRole('button')
				.map((b) => b.getAttribute('aria-label'))
		).toEqual(['Edit Salary', 'Delete Salary'])
	})

	it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
		renderWithProviders(<IncomePage />)
		const cell = rowFor('Salary').querySelector('td:last-child') as HTMLElement
		const geometry = ['Edit Salary', 'Delete Salary'].map((label) =>
			assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
		)
		expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
	})

	it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
		const { container } = renderWithProviders(<IncomePage />)
		const table = container.querySelector('table') as HTMLElement
		expect(collectRetiredTokenViolations(table)).toEqual([])
	})
})

describe('IncomePage — sort by column (34.2)', () => {
	const SEED = [
		{ name: 'Zeta', amount: 600_00, frequency: 'annually' as const },
		{ name: 'Alpha', amount: 500_00, frequency: 'monthly' as const },
		{ name: 'Mid', amount: 500_00, frequency: 'monthly' as const },
		{ name: 'Beta', amount: 100_00, frequency: 'weekly' as const },
	]
	const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

	function seedRows() {
		useIncomeStore.setState({ incomeSources: [] })
		// Distinct createdAt: rows created in one millisecond tie on the manual key,
		// so a stable sort could pass an ordering assertion by accident.
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
		for (const row of SEED) {
			useIncomeStore.getState().addIncomeSource(row)
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
		useIncomeStore.setState({ incomeSources: [] })
	})

	it('renders in MANUAL order until a header is activated', () => {
		renderWithProviders(<IncomePage />)
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
		for (const name of ['Name', 'Amount', 'Frequency']) {
			expect(header(name)).toHaveAttribute('aria-sort', 'none')
		}
	})

	it('offers exactly the sortable columns, and Actions is not one of them', () => {
		renderWithProviders(<IncomePage />)
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
		renderWithProviders(<IncomePage />)
		await expectSortHeaderAnnouncements(user, 'Sort income sources')
	})

	it('cycles a column ascending -> descending -> back to manual order', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

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
		renderWithProviders(<IncomePage />)
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid'])
	})

	it('falls back to MANUAL order for rows that tie, in both directions', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		const button = () => within(header('Frequency')).getByRole('button', { name: 'Frequency' })

		await user.click(button())
		expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Mid', 'Zeta'])
		await user.click(button())
		expect(renderedOrder()).toEqual(['Zeta', 'Alpha', 'Mid', 'Beta'])
	})

	it('keeps at most one column active', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(header('Amount')).toHaveAttribute('aria-sort', 'ascending')
		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending')
		expect(header('Amount')).toHaveAttribute('aria-sort', 'none')
	})

	it('places an unreadable row LAST without blanking the page', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState((state) => ({
			incomeSources: [
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
				...state.incomeSources,
			],
		}))
		renderWithProviders(<IncomePage />)
		expect(renderedOrder()[0]).toBe('Corrupt')

		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid', 'Corrupt'])
		await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
		expect(renderedOrder().at(-1)).toBe('Corrupt')
	})

	it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		const before = screen.getByRole('button', { name: 'Edit Zeta' })

		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])

		// Identity, not equality: under key={index} a different node would be relabelled
		// and focus or scroll anchored to a row would jump.
		expect(screen.getByRole('button', { name: 'Edit Zeta' })).toBe(before)
	})

	it('keeps focus on the header the user activated', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		const button = within(header('Amount')).getByRole('button', { name: 'Amount' })
		await user.click(button)
		expect(renderedOrder()).not.toEqual(MANUAL_ORDER)
		expect(within(header('Amount')).getByRole('button', { name: 'Amount' })).toHaveFocus()
	})
	it('places a row added under an active sort in its SORTED position, not at the bottom', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)
		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))

		await act(async () => {
			useIncomeStore.getState().addIncomeSource({
				name: 'Bravo',
				amount: 1_00,
				frequency: 'monthly',
			})
		})
		expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Bravo', 'Mid', 'Zeta'])
		expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
			...MANUAL_ORDER,
			'Bravo',
		])
	})

	function sortControl(): HTMLSelectElement {
		return screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement
	}

	it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		expect(sortControl()).toBeInTheDocument()
		expect(sortControl().value).toBe('manual')

		await user.selectOptions(sortControl(), 'name:asc')
		expect(sortControl().value).toBe('name:asc')
	})

	it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
	})

	it('returns to manual order from the mobile control (48.1 AC-4)', async () => {
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(renderedOrder()).not.toEqual(MANUAL_ORDER)

		await user.selectOptions(sortControl(), 'manual')
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
	})

	it('a header click RESUMES the cycle from a sort chosen on the mobile control (was e2e mobile-table-sort:275)', async () => {
		// The desc state came from the <select>, so the header's first activation must
		// clear it; a header with its own cycle would go to ascending.
		const user = userEvent.setup()
		renderWithProviders(<IncomePage />)

		await user.selectOptions(sortControl(), 'name:desc')
		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
		expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

		await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
		expect(header('Name')).toHaveAttribute('aria-sort', 'none')
		expect(sortControl().value).toBe('manual')
		expect(renderedOrder()).toEqual(MANUAL_ORDER)
	})

	describe('Category is a sort target only for entitled users (AC-5)', () => {
		it('offers Category as a mobile sort option ONLY for an entitled user (48.1 AC-7)', async () => {
			free()
			const { unmount } = renderWithProviders(<IncomePage />)
			expect(
				within(screen.getByRole('combobox', { name: 'Sort income sources' }))
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
			renderWithProviders(<IncomePage />)
			expect(
				within(screen.getByRole('combobox', { name: 'Sort income sources' }))
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
			renderWithProviders(<IncomePage />)
			expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
			expect(screen.queryByRole('button', { name: 'Category' })).toBeNull()
		})

		it('offers a sortable Category header for an entitled user', async () => {
			premium()
			const user = userEvent.setup()
			renderWithProviders(<IncomePage />)
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
		renderWithProviders(<IncomePage />)
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
			renderWithProviders(<IncomePage />)
			const before = useIncomeStore.getState().incomeSources.map((row) => [row.id, row.sortOrder])

			const button = () => within(header('Amount')).getByRole('button', { name: 'Amount' })
			await user.click(button())
			await user.click(button())
			await user.click(button())

			expect(spies.queueUpdate).not.toHaveBeenCalled()
			expect(spies.queueCreate).not.toHaveBeenCalled()
			expect(spies.queueDelete).not.toHaveBeenCalled()
			expect(useIncomeStore.getState().incomeSources.map((row) => [row.id, row.sortOrder])).toEqual(
				before
			)
		} finally {
			clearSyncBridge()
		}
	})

	describe('Category is a live sort key, and it disappears with its column', () => {
		function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
			return {
				userId: 0,
				profileId: null,
				name: 'Groceries',
				kind: 'income',
				isDeleted: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				...overrides,
			}
		}

		function seedCategories() {
			useCategoryStore.setState({
				categories: [
					category({ id: 'cat-1', name: 'Zulu' }),
					category({ id: 'cat-2', name: 'Alfa' }),
				],
			})
			const rows = useIncomeStore.getState().incomeSources
			useIncomeStore.setState({
				incomeSources: rows.map((row, i) => ({
					...row,
					categoryId: i % 2 === 0 ? 'cat-1' : 'cat-2',
				})),
			})
		}

		afterEach(() => {
			useCategoryStore.setState({ categories: [] })
		})

		it('re-sorts when a category is RENAMED, though no row changed', async () => {
			premium()
			seedCategories()
			const user = userEvent.setup()
			renderWithProviders(<IncomePage />)
			await user.click(within(header('Category')).getByRole('button', { name: 'Category' }))
			expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])

			await act(async () => {
				useCategoryStore.setState((state) => ({
					categories: state.categories.map((c) => (c.id === 'cat-2' ? { ...c, name: 'Zzz' } : c)),
				}))
			})
			expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])
		})

		it('degrades an active Category sort to manual order if entitlement lapses', () => {
			// Unreachable today, but a sort by an unrendered column would have no exit, so the
			// extractor is omitted to make the state unrepresentable.
			premium()
			seedCategories()
			const { rerender } = renderWithProviders(<IncomePage />)
			fireEvent.click(within(header('Category')).getByRole('button', { name: 'Category' }))
			expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])

			free()
			rerender(<IncomePage />)

			expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
			expect(renderedOrder()).toEqual(MANUAL_ORDER)
			expect(
				(screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement).value
			).toBe('manual')
		})
	})

	it('gives every sortable header the standard focus ring', () => {
		renderWithProviders(<IncomePage />)
		for (const name of ['Name', 'Amount', 'Frequency']) {
			assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
		}
	})
})

// jsdom reproduces the caret jump, so the selection is asserted, not just the value.
describe('IncomePage money field: caret, focus and magnitude (story 28-1)', () => {
	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
	})

	async function openAmount(user: ReturnType<typeof userEvent.setup>): Promise<HTMLInputElement> {
		renderWithProviders(<IncomePage />)
		await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
		return within(screen.getByRole('dialog')).getByTestId('income-amount-input') as HTMLInputElement
	}

	it('rejecting a character mid-string keeps the caret and focus (was e2e money-input-sanitization:58)', async () => {
		const user = userEvent.setup()
		const amount = await openAmount(user)

		await user.click(amount)
		await user.keyboard('12abc34')
		expect(amount).toHaveValue('1234')
		expect(amount).toHaveFocus()

		await user.clear(amount)
		await user.keyboard('1,234.56')
		amount.setSelectionRange(3, 3)

		await user.keyboard('x')
		expect(amount).toHaveValue('1,234.56')
		expect(amount.selectionStart).toBe(3)

		await user.keyboard('9')
		expect(amount).toHaveValue('1,2934.56')
		expect(amount.selectionStart).toBe(4)
	})

	it('a stray leading separator cannot rescale the amount, and submit rejects it (was e2e money-input-sanitization:92)', async () => {
		const user = userEvent.setup()
		const amount = await openAmount(user)

		await user.click(amount)
		await user.keyboard('1000')
		await user.tab()
		expect(amount).toHaveValue('1,000.00')

		await user.click(amount)
		amount.setSelectionRange(0, 0)
		await user.keyboard('.')
		await user.tab()
		expect(amount).toHaveValue('0.00')

		const dialog = screen.getByRole('dialog')
		await user.type(within(dialog).getByTestId('income-name-input'), 'Salary')
		await user.click(within(dialog).getByRole('button', { name: 'Add Income Source' }))
		expect(within(dialog).getByTestId('income-amount-error')).toHaveTextContent(
			'Please enter a valid positive amount'
		)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
	})
})
