import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
  collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { fireEvent, renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../../stores/expenseStore'
import { ExpensesPage } from '../ExpensesPage'

/**
 * ExpensesPage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open, and
 * that correcting the fields clears the errors and lets a valid submit proceed.
 */
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

/**
 * Danger-color reservation (story 11-3, AC-2).
 *
 * These are additive, non-destructive actions, so they must not wear the
 * danger-red fill that reads as "delete" (red stays reserved for the row Delete
 * control and its ConfirmDialog).
 */
describe('ExpensesPage safe-action buttons are not danger-red', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] })
  })

  it('the "+ Add Expense" and modal submit buttons use no red fill', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    const addButton = screen.getByRole('button', { name: '+ Add Expense' })
    expect(addButton.className).not.toMatch(/bg-red-(600|700)/)

    await user.click(addButton)
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Expense' })
    expect(submit.className).not.toMatch(/bg-red-(600|700)/)
  })
})

/**
 * Money-input sanitization (story 28-1, FR46).
 *
 * The amount field shares the core `sanitizeMoneyInput` helper with every other
 * money surface; this proves the wiring on this page (AC-3), not the helper's
 * own rule table (covered exhaustively in packages/core).
 */
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
    // The sanitizer is opt-in per field — a text input on the same form must not
    // inherit it.
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: '+ Add Expense' }))
    const nameInput = within(screen.getByRole('dialog')).getByTestId('expense-name-input')
    await user.type(nameInput, 'Rent')

    expect(nameInput).toHaveValue('Rent')
  })
})

/**
 * Visible focus indicator (story 28-1, AC-7).
 *
 * See the IncomePage sibling suite for the rationale. This page additionally
 * pins the focused-valid vs focused-invalid hue split: before AC-7 the ring had
 * zero width, so both branches using red went unnoticed. Once the ring is
 * visible, a red ring on a valid field is indistinguishable from the error
 * state — and red is reserved for destructive actions (story 11-3, AC-2).
 */
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

    // No submit attempted yet → no error → the ring must not read as "invalid".
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

/**
 * Edit-modal prefill (story 28-1, Task 4).
 *
 * The sibling assertion to IncomePage's: both pages had a bare
 * `(amount / 100).toString()` prefill that emitted ungrouped, locale-unaware text.
 */
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

    // Not "1234567.89" — re-saving without editing must not shift the stored cents.
    expect(within(dialog).getByTestId('expense-amount-input')).toHaveValue('1,234,567.89')
  })
})

/**
 * Mobile card presentation (story 31.2, UX-DR36).
 *
 * See `IncomePage.test.tsx` for the full rationale — one `<table>` in the DOM,
 * CSS-only switching, class-TOKEN assertions, and the 320px geometry proofs
 * deferred to `e2e/responsive-320.spec.ts` because jsdom computes no layout.
 */
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
    renderWithProviders(<ExpensesPage />)
    const row = rowFor('Rent')

    expect(within(row).getByText('1,500.00')).toBeInTheDocument()
    expect(within(row).getByText('monthly')).toBeInTheDocument()
    expect(within(row).getByTestId('expense-row-uncategorized')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Rent' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Rent' })).toBeInTheDocument()
  })

  it('labels every field on the card (AC-4)', () => {
    renderWithProviders(<ExpensesPage />)
    const row = rowFor('Rent')

    for (const label of ['Name', 'Amount', 'Frequency', 'Category', 'Actions']) {
      expect(within(row).getByText(label)).toBeInTheDocument()
      expect([...within(row).getByText(label).classList]).toContain('sm:hidden')
    }
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

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<ExpensesPage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })
})
