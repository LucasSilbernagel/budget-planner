import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
  collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { fireEvent, renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useIncomeStore } from '../../stores/incomeStore'

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

import { IncomePage } from '../IncomePage'

/**
 * IncomePage delete-confirmation tests (story 6-3).
 *
 * Proves the destructive delete now flows through the themed ConfirmDialog
 * (alertdialog) instead of a browser `confirm()`: opening the dialog, aborting
 * on Cancel (nothing deleted), and proceeding on Confirm (row removed). This is
 * the representative end-to-end wiring for the four converted page components.
 */
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
})

/**
 * IncomePage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open, and
 * that correcting the fields clears the errors and lets a valid submit proceed.
 */
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

    // Both field errors render with the exact preserved messages.
    expect(screen.getByTestId('income-name-error')).toHaveTextContent(
      'Please enter a name for the income source'
    )
    expect(screen.getByTestId('income-amount-error')).toHaveTextContent(
      'Please enter a valid positive amount'
    )
    // Errors are programmatically associated (AC-2).
    const nameInput = screen.getByTestId('income-name-input')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', 'income-name-error')
    // No store mutation and the modal stays open (AC-1).
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

    // Correct the name — its error clears as the user types (re-validate on change).
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

/**
 * IncomePage currency-input formatting tests (story 14-3).
 *
 * Proves the amount input shows the selected currency's symbol only in symbols
 * mode (never a hard-coded "$"), and that a locale-grouped entry both parses to
 * the correct integer cents on submit and re-echoes grouped on blur. This is the
 * representative wiring for the four money add/edit forms.
 */
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
    // Retargeted from the original review patch: the letters used to survive
    // on-blur as visible garbage; on-input sanitization now stops them reaching
    // state at all. The load-bearing half of that patch's intent — blur must NOT
    // rewrite the field to a validating "0.00" — is what is pinned here.
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
    // The sanitizer deliberately preserves digit-free partials so a negative can
    // be typed one character at a time. That makes the `!/\d/` arm of the blur
    // guard genuinely reachable: without it, "-" would parse to 0 and echo back
    // as "0.00", turning an unfinished entry into a valid-looking zero.
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
    // A paste arrives as a single change event carrying the whole string — the
    // reason the filter lives in onChange rather than a keystroke handler.
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

    // Not "1234567.89" — the prefill goes through the same formatter as the blur
    // echo, so re-saving without editing cannot shift the stored cents.
    expect(within(dialog).getByTestId('income-amount-input')).toHaveValue('1,234,567.89')
  })
})

/**
 * Visible focus indicator (story 28-1, AC-7).
 *
 * `focus:outline-none` removes the browser's native focus ring, so a
 * `focus:ring-<color>` without `focus:ring-2` sets a ring colour of zero width —
 * keyboard users get no visible focus indicator at all. Third recurrence of this
 * defect class (Epics 15 and 24), hence a structural guard rather than a manual
 * check only.
 *
 * Asserted by class-TOKEN membership, not substring: a substring check for
 * "focus:ring-2" also matches tokens like "focus:ring-2xl" and would pass on a
 * class list that has no 2px ring at all.
 */
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

    // Count the controls actually asserted on: a bare `if (tokens.includes(...))`
    // guard silently asserts NOTHING the day `focus:outline-none` moves or the
    // class string is reshaped, which is exactly how this defect class recurs.
    let checked = 0
    for (const control of controls) {
      const tokens = control.className.split(/\s+/)
      expect(tokens, `${control.id} no longer kills the native outline`).toContain(
        'focus:outline-none'
      )
      expect(tokens, `${control.id} has no visible focus ring`).toContain('focus:ring-2')
      // And the ring must carry a real COLOUR — `focus:ring-offset-*` / `-inset`
      // satisfy a naive "starts with focus:ring-" check while painting nothing.
      expect(
        tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
        `${control.id} has a ring width but no ring colour`
      ).toBe(true)
      checked++
    }
    expect(checked).toBe(controls.length)
  })
})

/**
 * Mobile card presentation (story 31.2, UX-DR36).
 *
 * Below `sm` the income table's rows render as stacked cards. There is exactly
 * ONE `<table>` in the DOM at every viewport — the switch is CSS-only.
 *
 * ⚠️ These are STRUCTURE and CLASS assertions, not layout proofs. jsdom
 * computes no layout (every width is 0), so nothing here can show that anything
 * fits, stacks or hides; a width assertion would pass vacuously. The geometry
 * proofs live in `e2e/responsive-320.spec.ts`. Titles below say "declares"
 * rather than "does" for exactly that reason.
 *
 * Every class check asserts TOKEN membership, never a substring of `className`:
 * `-` and `:` are substring boundaries, so `toContain('block')` false-matches
 * `max-sm:block`.
 */
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

    // The currency baseline in unit tests is `{ mode: 'none' }`, so amounts
    // render as neutral grouped numbers rather than symbols.
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

    // Everything the free tier IS entitled to still renders...
    expect(within(row).getByText('5,000.00')).toBeInTheDocument()
    expect(within(row).getByText('monthly')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Salary' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Salary' })).toBeInTheDocument()
    // ...and BOTH category renderings are gone. Asserting only the placeholder
    // would still pass if the assigned-category pill leaked through.
    expect(within(row).queryByTestId('income-row-uncategorized')).not.toBeInTheDocument()
    expect(within(row).queryByTestId('income-row-category')).not.toBeInTheDocument()
  })

  it('labels every field on the card (AC-4)', () => {
    premium()
    renderWithProviders(<IncomePage />)
    const row = rowFor('Salary')

    // Scoped with `within(row)`: the <thead> <th> text and the mobile label
    // text are BOTH in the DOM at all times (jsdom applies no media queries),
    // so an unscoped getByText would be ambiguous.
    //
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
    renderWithProviders(<IncomePage />)
    const row = rowFor('Salary')

    expect(mobileLabelsIn(row)).toEqual(['Name', 'Amount', 'Frequency', 'Actions'])
  })

  it('has exactly one table in the DOM — no dual-rendered card list', () => {
    // A `hidden sm:table` + `sm:hidden` card list would duplicate every value
    // and make the queries above multi-match under jsdom.
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
    // ENUMERATED, not grepped: these two buttons carried neither
    // `focus:outline-none` nor `focus:ring-2` before this story, so the
    // completeness grep that guards the modal controls above was structurally
    // blind to them and returned zero either way. A missing guard has no
    // mutation to run against — coverage has to come from naming the controls.
    renderWithProviders(<IncomePage />)
    const row = rowFor('Salary')
    for (const label of ['Edit Salary', 'Delete Salary', 'Move Salary up', 'Move Salary down']) {
      assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
    renderWithProviders(<IncomePage />)
    const row = rowFor('Salary')
    for (const label of ['Edit Salary', 'Delete Salary', 'Move Salary up', 'Move Salary down']) {
      assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('separates the move controls from their siblings on desktop (34.1b review)', () => {
    // Desktop-only: below `sm` the actions group supplies its own `gap-1`, so an
    // unprefixed margin would stack on top of it. Without this the two chevrons
    // rendered flush against each other and against Edit — `mr-4` separates only
    // Edit from Delete. Pinned because it is otherwise invisible to every test.
    renderWithProviders(<IncomePage />)
    const row = rowFor('Salary')
    for (const label of ['Move Salary up', 'Move Salary down']) {
      const button = within(row).getByRole('button', { name: label })
      expect(button.className.split(/\s+/)).toContain('sm:mr-2')
    }
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<IncomePage />)
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
describe('IncomePage — reorder rows (34.1b)', () => {
  const NAMES = ['Alpha', 'Beta', 'Gamma']

  function seedRows() {
    useIncomeStore.setState({ incomeSources: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary sort key, and a tie-preserving stable sort can make an ordering
    // assertion pass by accident (34.1a's M10).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const name of NAMES) {
      useIncomeStore.getState().addIncomeSource({ name, amount: 100000, frequency: 'monthly' })
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
    useIncomeStore.setState({ incomeSources: [] })
    localStorage.clear()
  })

  it('offers a move-up and move-down control naming each row (AC-1)', () => {
    renderWithProviders(<IncomePage />)
    for (const name of NAMES) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeInTheDocument()
    }
  })

  it('moves a row up when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(NAMES)

    await user.click(screen.getByRole('button', { name: 'Move Beta up' }))

    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('moves a row down when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

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
    renderWithProviders(<IncomePage />)
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
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    await user.click(screen.getByRole('button', { name: 'Move Gamma down' }))

    expect(renderedOrder()).toEqual(NAMES)
  })

  it('marks BOTH controls aria-disabled on a single-row list (AC-4)', () => {
    useIncomeStore.setState({ incomeSources: [] })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Solo', amount: 100000, frequency: 'monthly' })
    renderWithProviders(<IncomePage />)

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
    renderWithProviders(<IncomePage />)
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
    renderWithProviders(<IncomePage />)
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
    const { unmount } = renderWithProviders(<IncomePage />)
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }))
    unmount()

    // ⚠️ `setState` goes THROUGH the persist middleware, so clearing in-memory
    // state would overwrite the blob we are about to read back. Snapshot it,
    // clear, restore, then rehydrate — which is what a reload actually does.
    const persisted = localStorage.getItem('budget-planner-income-v1')
    expect(persisted).toBeTruthy()
    useIncomeStore.setState({ incomeSources: [] })
    localStorage.setItem('budget-planner-income-v1', persisted as string)
    await useIncomeStore.persist.rehydrate()

    renderWithProviders(<IncomePage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
})
