import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useExpenseStore } from '../../stores/expenseStore'

/**
 * Tier control for the Premium-only Category column (story 33.3, FR57).
 *
 * ⚠️ A plain object mutated in place, NOT a `vi.fn()`. This file does not call
 * `vi.clearAllMocks()` today, but `category-assignment.test.tsx` — which mocks
 * the same hook and is the template this pattern came from — does (`:66`), and
 * there `clearAllMocks` would strip a `mockReturnValue` and make the hook return
 * `undefined`, so the page throws on `status.hasAccess` and every test in the
 * file fails for a reason unrelated to its subject. A plain object cannot be
 * cleared, so the pattern is safe to copy into either kind of file. Keeping it
 * uniform is the point; do not "simplify" this to a `vi.fn()` here.
 *
 * ⚠️ The factory must export ONLY `usePremiumAccess`. If production code ever
 * reaches for another export of that module, this mock fails at COLLECT time
 * (every test in the file, no clean assertion failure) rather than pointing at
 * the change that caused it.
 */
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

// Reset the tier before EVERY test in this file, so a premium test cannot leak
// entitlement into an unrelated one that renders the same page.
beforeEach(() => {
  free()
})

/**
 * The row's mobile field labels, in document order.
 *
 * Asserting this array (rather than looping over a hand-written list) is what
 * ties the "labels every field" claim to reality: it pins the COUNT and the
 * ORDER, so a column that silently disappears fails the test instead of just
 * shortening an unchecked loop.
 */
function mobileLabelsIn(row: HTMLElement): string[] {
  return [...row.querySelectorAll('span.sm\\:hidden')].map((el) => el.textContent ?? '')
}

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

    // Everything the free tier IS entitled to still renders...
    expect(within(row).getByText('1,500.00')).toBeInTheDocument()
    expect(within(row).getByText('monthly')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Rent' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Rent' })).toBeInTheDocument()
    // ...and BOTH category renderings are gone. Asserting only the placeholder
    // would still pass if the assigned-category pill leaked through.
    expect(within(row).queryByTestId('expense-row-uncategorized')).not.toBeInTheDocument()
    expect(within(row).queryByTestId('expense-row-category')).not.toBeInTheDocument()
  })

  it('labels every field on the card (AC-4)', () => {
    premium()
    renderWithProviders(<ExpensesPage />)
    const row = rowFor('Rent')

    // ⚠️ The array equality is the point. The previous version of this test
    // looped over a hand-written list with no count assertion, so its name
    // ("every field") was a claim its assertions did not make — dropping a
    // column left it green. Pin count and order, not just membership.
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
    for (const label of ['Edit Rent', 'Delete Rent', 'Move Rent up', 'Move Rent down']) {
      assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
    renderWithProviders(<ExpensesPage />)
    const row = rowFor('Rent')
    for (const label of ['Edit Rent', 'Delete Rent', 'Move Rent up', 'Move Rent down']) {
      assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<ExpensesPage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })
})

/**
 * Row reordering (Story 34.1b, FR60).
 *
 * ⚠️ Written per page rather than once over a table of four. These are four
 * independent page components with four hand-rolled actions cells; stories 30-4b
 * and 33.3 each shipped a HIGH by testing one surface and assuming its siblings.
 */
describe('ExpensesPage — reorder rows (34.1b)', () => {
  const NAMES = ['Alpha', 'Beta', 'Gamma']

  function seedRows() {
    useExpenseStore.setState({ expenses: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary sort key, and a tie-preserving stable sort can make an ordering
    // assertion pass by accident (34.1a's M10).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const name of NAMES) {
      useExpenseStore.getState().addExpense({ name, amount: 100000, frequency: 'monthly' })
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** The rendered row names, top to bottom. */
  function renderedOrder(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1) // drop the header row
      .map((row) => NAMES.find((name) => within(row).queryByText(name)))
      .filter((name): name is string => Boolean(name))
  }

  beforeEach(() => {
    localStorage.clear()
    seedRows()
  })

  afterEach(() => {
    useExpenseStore.setState({ expenses: [] })
    localStorage.clear()
  })

  it('offers a move-up and move-down control naming each row (AC-1)', () => {
    renderWithProviders(<ExpensesPage />)
    for (const name of NAMES) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeInTheDocument()
    }
  })

  it('moves a row up when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    expect(renderedOrder()).toEqual(NAMES)

    await user.click(screen.getByRole('button', { name: 'Move Beta up' }))

    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('moves a row down when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Move Beta down' }))

    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  /**
   * ⚠️ `aria-disabled`, NOT the native `disabled` attribute (story decision 2).
   * `toBeDisabled()` deliberately does NOT pass here: a natively disabled button
   * cannot hold focus, which would break the focus-retention AC below at exactly
   * the boundary this assertion is about.
   */
  it('marks the boundary controls aria-disabled while keeping them focusable (AC-4)', () => {
    renderWithProviders(<ExpensesPage />)
    const firstUp = screen.getByRole('button', { name: 'Move Alpha up' })
    const lastDown = screen.getByRole('button', { name: 'Move Gamma down' })

    expect(firstUp).toHaveAttribute('aria-disabled', 'true')
    expect(lastDown).toHaveAttribute('aria-disabled', 'true')
    // Interior controls are NOT marked — otherwise the assertion above would
    // pass on a component that marks every control.
    expect(screen.getByRole('button', { name: 'Move Beta up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    expect(firstUp).not.toBeDisabled()
  })

  it('does nothing when a boundary control is activated (AC-4)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    await user.click(screen.getByRole('button', { name: 'Move Gamma down' }))

    expect(renderedOrder()).toEqual(NAMES)
  })

  it('marks BOTH controls aria-disabled on a single-row list (AC-4)', () => {
    useExpenseStore.setState({ expenses: [] })
    useExpenseStore.getState().addExpense({ name: 'Solo', amount: 100000, frequency: 'monthly' })
    renderWithProviders(<ExpensesPage />)

    expect(screen.getByRole('button', { name: 'Move Solo up' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Move Solo down' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  /**
   * ⚠️ THE POINT OF THIS TEST IS THAT IT CAN FAIL. It asserts the row actually
   * moved AND that focus stayed on the control the user pressed — "something is
   * focused" would prove nothing. Focus survives because all four tables key
   * rows by `id`, so React moves the existing DOM node instead of remounting it.
   */
  it('keeps focus on the activated control after a keyboard move (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    const control = screen.getByRole('button', { name: 'Move Gamma up' })

    control.focus()
    await user.keyboard('{Enter}')

    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Gamma up' })).toHaveFocus()
    })
  })

  it('keeps focus on a control that becomes a boundary control (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    const control = screen.getByRole('button', { name: 'Move Beta up' })

    control.focus()
    await user.keyboard('{Enter}')

    // Beta is now first, so its move-up control is aria-disabled — and must
    // still hold focus. A native `disabled` here would drop focus to <body>.
    const after = screen.getByRole('button', { name: 'Move Beta up' })
    expect(after).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(after).toHaveFocus())
  })

  it('persists the new order across a reload (AC-2)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<ExpensesPage />)
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }))
    unmount()

    // ⚠️ `setState` goes THROUGH the persist middleware, so clearing in-memory
    // state would overwrite the blob we are about to read back. Snapshot it,
    // clear, restore, then rehydrate — which is what a reload actually does.
    const persisted = localStorage.getItem('budget-planner-expenses-v1')
    expect(persisted).toBeTruthy()
    useExpenseStore.setState({ expenses: [] })
    localStorage.setItem('budget-planner-expenses-v1', persisted as string)
    await useExpenseStore.persist.rehydrate()

    renderWithProviders(<ExpensesPage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
})

/**
 * Column sorting (Story 34.2, FR61).
 *
 * ⚠️ Written per page rather than once over a table of four, for the same reason
 * the 34.1b reorder block is: four independent page components, four hand-rolled
 * `<thead>`s and four extractor sets. 30-4b, 33.3 and 34.1b each shipped (or
 * nearly shipped) a HIGH by testing one surface and assuming its siblings.
 */
describe('ExpensesPage — sort by column (34.2)', () => {
  /**
   * The fixture is built so that NO two of the four orderings coincide.
   *
   * manual (insertion):   Zeta, Alpha, Mid, Beta
   * by name:              Alpha, Beta, Mid, Zeta
   * by amount NORMALIZED: Zeta(5000), Beta(43333), Alpha(50000), Mid(50000)
   * by amount RAW:        Beta(100_00), Alpha(500_00), Mid(500_00), Zeta(600_00)
   * by frequency:         Beta(w), Alpha(m), Mid(m), Zeta(a)
   *
   * Alpha and Mid TIE on both amount and frequency while sitting in a known
   * manual order, so the tie fallback is exercised by construction — and the raw
   * and normalized amount orders disagree completely, so an un-normalized
   * comparator cannot pass.
   */
  const SEED = [
    { name: 'Zeta', amount: 600_00, frequency: 'annually' as const },
    { name: 'Alpha', amount: 500_00, frequency: 'monthly' as const },
    { name: 'Mid', amount: 500_00, frequency: 'monthly' as const },
    { name: 'Beta', amount: 100_00, frequency: 'weekly' as const },
  ]
  const MANUAL_ORDER = ['Zeta', 'Alpha', 'Mid', 'Beta']

  function seedRows() {
    useExpenseStore.setState({ expenses: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary manual key, and a tie-preserving stable sort can then make an
    // ordering assertion pass by accident (34.1a's M10, 34.1b's M6).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const row of SEED) {
      useExpenseStore.getState().addExpense(row)
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** The rendered row names, top to bottom (first cell of each body row). */
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
    // Not `none` — no attribute at all. `aria-sort="none"` advertises a column
    // as sortable, which this one is not.
    expect(actions).not.toHaveAttribute('aria-sort')
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
    // Raw ascending would be ['Beta','Alpha','Mid','Zeta'] — a completely
    // different sequence, so this assertion can actually fail.
    expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid'])
  })

  it('falls back to MANUAL order for rows that tie, in both directions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    const button = () => within(header('Frequency')).getByRole('button', { name: 'Frequency' })

    await user.click(button())
    // Alpha and Mid are both monthly; Alpha precedes Mid manually.
    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Mid', 'Zeta'])
    await user.click(button())
    // Descending flips the CADENCES but must not flip the tied pair.
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
    // A corrupt cadence with a sortOrder that puts the row FIRST manually, so
    // "last under the sort" cannot be an accident of its manual position.
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
    // Absent values stay last under DESCENDING too — they are not merely the
    // ascending order reversed.
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

  describe('interaction with the manual move controls (AC-7)', () => {
    it('disables EVERY move control while a sort is active, and the clicks are no-ops', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ExpensesPage />)
      await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
      const sorted = renderedOrder()

      for (const name of MANUAL_ORDER) {
        expect(screen.getByRole('button', { name: `Move ${name} up` })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
        expect(screen.getByRole('button', { name: `Move ${name} down` })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
      }
      await user.click(screen.getByRole('button', { name: 'Move Mid up' }))
      expect(renderedOrder()).toEqual(sorted)
      // And the underlying manual order is untouched.
      expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual(MANUAL_ORDER)
    })

    it('restores the 34.1b boundary behaviour when the sort is cleared', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ExpensesPage />)
      const button = () => within(header('Name')).getByRole('button', { name: 'Name' })
      await user.click(button())
      await user.click(button())
      await user.click(button())

      expect(renderedOrder()).toEqual(MANUAL_ORDER)
      expect(screen.getByRole('button', { name: 'Move Zeta up' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
        'aria-disabled',
        'false'
      )
      expect(screen.getByRole('button', { name: 'Move Beta down' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
      expect(renderedOrder()).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
    })
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
    // The MANUAL order still has it at the bottom — sorting never writes to it.
    expect(useExpenseStore.getState().expenses.map((r) => r.name)).toEqual([
      ...MANUAL_ORDER,
      'Bravo',
    ])
  })

  /**
   * The mobile sort control (story 48.1, UX-DR53).
   *
   * ⚠️ This block REPLACES the old "shows the mobile escape hatch only while a
   * sort is active" test, and the replacement is the point. `TableSortNotice`
   * rendered nothing while a table was in manual order, because a sort could
   * only be STARTED at >= 640px (34.2, ratified decision 1). Manual order is
   * exactly the state a phone user needs a control in — it is how they start
   * one — so the control now renders unconditionally and the old assertion
   * would be asserting the opposite of the requirement.
   */
  function sortControl(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: 'Sort expenses' }) as HTMLSelectElement
  }

  it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    // Present in MANUAL order — the state the old escape hatch rendered nothing in.
    expect(sortControl()).toBeInTheDocument()
    expect(sortControl().value).toBe('manual')

    await user.selectOptions(sortControl(), 'name:asc')
    // And still present once a sort is active, now reporting it.
    expect(sortControl().value).toBe('name:asc')
  })

  it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)

    // ⚠️ DESCENDING, chosen directly. Ascending alone cannot tell a `select`
    // from a `toggle`, and name-descending differs from BOTH the manual order
    // and the ascending order for this seed — an order assertion that happened
    // to match one of them could not fail.
    await user.selectOptions(sortControl(), 'name:desc')
    expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

    // ⚠️ THE SINGLE-SOURCE-OF-TRUTH CLAIM. A control wired to its own state
    // would reorder the rows and leave this header reporting `none`.
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
    // Clearing the sort re-enables the arrows (34.2 AC-11 -> AC-7). Carried over
    // from the escape-hatch test this block replaces: the assertion is about the
    // arrows, not about the control that cleared the sort.
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
  })

  describe('Category is a sort target only for entitled users (AC-5)', () => {
    it('offers Category as a mobile sort option ONLY for an entitled user (48.1 AC-7)', async () => {
      // ⚠️ EXACT ARRAYS on BOTH tiers. `queryByRole('option', { name: /Category/ })`
      // returning null is satisfied by an options list that is empty for any
      // reason at all, and the failure this guards is subtle: the Category
      // extractor is OMITTED for an unentitled user
      // (`createFlowSortExtractors`), so a Category option offered to a free
      // user writes a sort that `effectiveState` immediately degrades — a
      // control that visibly does nothing, with no error anywhere.
      free()
      const { unmount } = renderWithProviders(<ExpensesPage />)
      expect(
        within(screen.getByRole('combobox', { name: 'Sort expenses' }))
          .getAllByRole('option')
          .map((option) => option.textContent)
      ).toEqual([
        'Manual order',
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
        'Manual order',
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
    // The sweep covers the whole <table>, `<thead>` included, so the new header
    // buttons are enrolled with no test change.
    const table = screen.getAllByRole('table')[0] as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
  })

  it('enqueues NOTHING on a PAID session — sorting is read-only over the store (AC-8)', async () => {
    // ⚠️ REGISTERED, not left unregistered. A spy handed to nobody can never be
    // called, so `not.toHaveBeenCalled()` could not fail — the tautology story
    // 34.1b's review caught in the sibling store suite. Registering proves these
    // exact spies are reachable from the code under test.
    //
    // ⚠️ And PAID, not free: `deferred-work.md:822-832` records a mutation that
    // passed 1525 green tests because every test in the suite ran under one tier.
    // Sorting must be inert on the tier that actually has a sync path.
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
      // And the persisted order itself is byte-identical — no `sortOrder` write.
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
    // ⚠️ ENUMERATED, not grepped — `assertHasFocusRing` takes one element, so a
    // control missing from this array is silently uncovered.
    for (const name of ['Name', 'Amount', 'Frequency']) {
      assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
    }
  })
})

/**
 * Story 36.3 (UX-DR40): mortgage guidance on the expense entry form.
 *
 * The hint is plain prose asserted by its text, not by `aria-describedby` —
 * every such attribute in this app is a single id, and joining a permanent hint
 * id into `:530` would break the exact-match assertion at `:118` of this file.
 */
describe('ExpensesPage — mortgage guidance (36.3)', () => {
  /**
   * ⚠️ The RATIFIED string, pinned WHOLE.
   *
   * A distinguishing substring proves the hint is the right hint; it does not
   * pin the copy. The story fixes this sentence verbatim (§Ratified decisions
   * 2), and with substrings alone the unpinned spans — here, the whole opening
   * question — could be reworded, truncated or dropped with every test green.
   * Review 36.3 caught exactly that gap. `textContent` is whitespace-normalized
   * because JSX joins the source lines with newlines.
   */
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

    // ⚠️ Anchored on the DISTINGUISHING half of the sentence. "mortgage" alone
    // would be true-by-construction the moment any other copy on this page
    // mentions one; this phrase appears nowhere else in the repo.
    expect(hintText(within(dialog).getByTestId('expense-mortgage-hint'))).toBe(EXPENSE_HINT)
  })

  it('shows the same guidance when editing an existing expense', async () => {
    // One modal serves both states (switched by `editingId`), so this pins that
    // the hint is not accidentally gated to the add path.
    // Seeded through the store's own action rather than a hand-built object, so
    // the row cannot drift from the real shape (`displayOrder`, `categoryId`).
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
