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
import { type ClientCategory, useCategoryStore } from '../../stores/categoryStore'
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
 * Take-home guidance on the Amount field (story 46.1, UX-DR52).
 *
 * The form never said whether to enter pay before or after tax, and every
 * downstream figure assumes one answer. The guidance states it at the point of
 * entry.
 *
 * ⚠️ Every assertion here anchors on the DISTINGUISHING phrasing. "income",
 * "amount" and "pay" all appear throughout this page and an assertion on any of
 * them would have passed against the pre-fix defect — which is the whole reason
 * the story called the pin out as its own AC.
 *
 * ⚠️ The word "net" is deliberately absent from the copy. `netIncome` in
 * `packages/core/src/finance/netIncome.ts` means income MINUS EXPENSES, and that
 * meaning is already user-visible on the pricing page and in the PDF summary
 * report. Using "net" here would give one word two axes. The negative guard
 * below is scoped to the hint element, never the page: the page legitimately
 * contains "net" elsewhere and a page-wide negative would be red on arrival.
 */
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

    // The concrete test a user can apply, not the jargon. Pinned as ONE ordered
    // clause, not three loose fragments: separate `/reaches your bank account/`,
    // `/after tax/` and `/deductions/` assertions all pass against a mangled
    // string like "After tax, deductions reaches your bank account", and none of
    // them pins the instruction verb that carries AC-1.
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

    // One modal serves add and edit; the hint must not be gated on `editingId`.
    await user.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')

    // Assert through the ACCESSIBLE DESCRIPTION, which resolves the
    // `aria-describedby` id list against the real DOM — so edit mode proves the
    // association too, not merely that the copy is on screen somewhere.
    expect(amountInput).toHaveAccessibleDescription(
      /Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
    )
  })

  it('does not use the word "net" anywhere in the dialog (AC-11)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')

    // ⚠️ Scoped to the DIALOG, not to the hint element. Scoped to the hint this
    // assertion was true-by-construction — the copy pins above already fix that
    // element's exact text, so re-checking it for "net" guarded nothing. The
    // real collision risk is a SIBLING in the same form ("Net amount" on a
    // label, placeholder or future field), which only a dialog-wide negative
    // can see. Still not page-wide: the page legitimately says "Net Worth"
    // elsewhere and that would be red on arrival.
    expect(dialog.textContent).not.toMatch(/\bnet\b/i)
  })

  it('describes the amount input with the hint when there is no error (AC-8)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    await user.click(screen.getByRole('button', { name: '+ Add Income Source' }))
    const dialog = screen.getByRole('dialog')
    const amountInput = within(dialog).getByTestId('income-amount-input')

    // Unconditional: before story 46.1 this attribute was `undefined` until a
    // validation error existed, so the hint reached no screen reader at all.
    //
    // ⚠️ `toHaveAccessibleDescription` is the load-bearing half. Asserting the
    // attribute STRING alone passes even when the id resolves to nothing —
    // rename `id="income-amount-hint"` to anything while leaving the
    // `data-testid` intact and a string-only suite stays green while screen
    // readers announce nothing. This resolves the id against the real DOM.
    expect(amountInput).toHaveAccessibleDescription(
      /Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
    )
    // And ONLY the hint describes it in this state — asserted as a token list
    // rather than a string equality so appending a second legitimate describer
    // later fails loudly here instead of silently widening the description.
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
    // `aria-describedby` is an ID LIST. Replacing rather than composing is the
    // silent regression this test exists for: the page still looks right and the
    // error announcement is simply gone. Assert on the parsed token set so the
    // order of the two ids is not accidentally pinned.
    const described = (amountInput.getAttribute('aria-describedby') ?? '').split(/\s+/)
    expect(described).toContain('income-amount-hint')
    expect(described).toContain('income-amount-error')

    // Both ids must RESOLVE, not merely be listed. The accessible description
    // is the concatenation of the referenced nodes, so this fails if either id
    // points at nothing — the failure a string-only assertion cannot see.
    expect(amountInput).toHaveAccessibleDescription(
      /Enter\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
    )
    expect(amountInput).toHaveAccessibleDescription(
      /Please\s+enter\s+a\s+valid\s+positive\s+amount/i
    )

    // And the error itself is still rendered and still says what it said.
    expect(within(dialog).getByTestId('income-amount-error')).toHaveTextContent(
      'Please enter a valid positive amount'
    )
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

  /**
   * Story 48.2 (AC-1, AC-15) — the actions cell offers EXACTLY Edit and Delete.
   *
   * ⚠️ AN EXACT ARRAY, NOT `queryByRole(/^Move /) -> toBeNull()`. Story 48.2
   * DELETES `RowMoveControls`, and an absence assertion about a deleted component
   * is vacuous by construction: it passes for the same reason whether the removal
   * was done correctly or the render broke entirely. Enumerating what IS offered
   * fails on a re-added arrow AND on a lost Edit/Delete button, so it is
   * falsifiable in both directions (mutation arm M1).
   */
  it('offers exactly Edit and Delete in a row action cell (48.2 AC-1, AC-15)', () => {
    renderWithProviders(<IncomePage />)
    const cell = rowFor('Salary').querySelector('td:last-child') as HTMLElement
    expect(
      within(cell)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Edit Salary', 'Delete Salary'])
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<IncomePage />)
    const table = container.querySelector('table') as HTMLElement
    expect(collectRetiredTokenViolations(table)).toEqual([])
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
describe('IncomePage — sort by column (34.2)', () => {
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
    useIncomeStore.setState({ incomeSources: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary manual key, and a tie-preserving stable sort can then make an
    // ordering assertion pass by accident (34.1a's M10, 34.1b's M6).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const row of SEED) {
      useIncomeStore.getState().addIncomeSource(row)
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
    // Not `none` — no attribute at all. `aria-sort="none"` advertises a column
    // as sortable, which this one is not.
    expect(actions).not.toHaveAttribute('aria-sort')
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
    // Raw ascending would be ['Beta','Alpha','Mid','Zeta'] — a completely
    // different sequence, so this assertion can actually fail.
    expect(renderedOrder()).toEqual(['Zeta', 'Beta', 'Alpha', 'Mid'])
  })

  it('falls back to MANUAL order for rows that tie, in both directions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)
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
    renderWithProviders(<IncomePage />)
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
    // Absent values stay last under DESCENDING too — they are not merely the
    // ascending order reversed.
    await user.click(within(header('Amount')).getByRole('button', { name: 'Amount' }))
    expect(renderedOrder().at(-1)).toBe('Corrupt')
  })

  it('MOVES each row node rather than relabelling positions (rows keyed by id)', async () => {
    // ⚠️ This is what proves rows are keyed by IDENTITY, not by position.
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)
    const before = screen.getByRole('button', { name: 'Edit Zeta' })

    await user.click(within(header('Name')).getByRole('button', { name: 'Name' }))
    expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Mid', 'Zeta'])

    // Identity, not equality: React MOVED Zeta's existing DOM node to the end.
    // Under `key={index}` the element in each position would be reused and
    // relabelled instead, so the node now named "Edit Zeta" would be a different
    // object — and anything anchored to a row (focus, scroll position, an open
    // menu) would silently jump to whichever row landed in that slot.
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
    // The MANUAL order still has it at the bottom — sorting never writes to it.
    expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual([
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
    return screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement
  }

  it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

    // Present in MANUAL order — the state the old escape hatch rendered nothing in.
    expect(sortControl()).toBeInTheDocument()
    expect(sortControl().value).toBe('manual')

    await user.selectOptions(sortControl(), 'name:asc')
    // And still present once a sort is active, now reporting it.
    expect(sortControl().value).toBe('name:asc')
  })

  it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<IncomePage />)

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
    renderWithProviders(<IncomePage />)

    await user.selectOptions(sortControl(), 'name:desc')
    expect(renderedOrder()).not.toEqual(MANUAL_ORDER)

    await user.selectOptions(sortControl(), 'manual')
    expect(renderedOrder()).toEqual(MANUAL_ORDER)
    expect(header('Name')).toHaveAttribute('aria-sort', 'none')
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
      renderWithProviders(<IncomePage />)
      const before = useIncomeStore.getState().incomeSources.map((row) => [row.id, row.sortOrder])

      const button = () => within(header('Amount')).getByRole('button', { name: 'Amount' })
      await user.click(button())
      await user.click(button())
      await user.click(button())

      expect(spies.queueUpdate).not.toHaveBeenCalled()
      expect(spies.queueCreate).not.toHaveBeenCalled()
      expect(spies.queueDelete).not.toHaveBeenCalled()
      // And the persisted order itself is byte-identical — no `sortOrder` write.
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

    /** Seed two categories and assign them so the Category order differs from
     * every other order in the fixture. */
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
      // ⚠️ The real invalidation path, end to end: rename -> new `categories`
      // array -> new name map -> new extractor identity -> re-sorted projection.
      // The hook's own test swaps the extractors object directly, which proves
      // the memo reacts but NOT that a store rename reaches it.
      premium()
      seedCategories()
      const user = userEvent.setup()
      renderWithProviders(<IncomePage />)
      await user.click(within(header('Category')).getByRole('button', { name: 'Category' }))
      // 'Alfa' before 'Zulu': rows 1 and 3 (Alpha, Beta) carry cat-2.
      expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])

      await act(async () => {
        useCategoryStore.setState((state) => ({
          categories: state.categories.map((c) => (c.id === 'cat-2' ? { ...c, name: 'Zzz' } : c)),
        }))
      })
      // No row changed — only the label the key resolves to.
      expect(renderedOrder()).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])
    })

    it('degrades an active Category sort to manual order if entitlement lapses', () => {
      // ⚠️ Unreachable today — `usePremiumAccess` cannot downgrade within a mount
      // — but the combination it guards against has no exit: the table would stay
      // sorted by a column that is no longer rendered, every header would report
      // `aria-sort="none"`, every move arrow would be disabled, and the only reset
      // control is `sm:hidden`. Omitting the extractor makes the state
      // unrepresentable rather than merely improbable.
      premium()
      seedCategories()
      const { rerender } = renderWithProviders(<IncomePage />)
      fireEvent.click(within(header('Category')).getByRole('button', { name: 'Category' }))
      expect(renderedOrder()).toEqual(['Alpha', 'Beta', 'Zeta', 'Mid'])

      free()
      rerender(<IncomePage />)

      expect(screen.queryByRole('columnheader', { name: 'Category' })).toBeNull()
      expect(renderedOrder()).toEqual(MANUAL_ORDER)
      // ⚠️ The POSITIVE form. The old `queryByText(/^Sorted by /)` absence
      // assertion went vacuous when `TableSortNotice` was deleted; this fails if
      // `effectiveState` is bypassed, because `category:asc` has no matching
      // `<option>` on the free tier and the select's DOM value would be `''`.
      expect(
        (screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement).value
      ).toBe('manual')
    })
  })

  it('gives every sortable header the standard focus ring', () => {
    renderWithProviders(<IncomePage />)
    // ⚠️ ENUMERATED, not grepped — `assertHasFocusRing` takes one element, so a
    // control missing from this array is silently uncovered.
    for (const name of ['Name', 'Amount', 'Frequency']) {
      assertHasFocusRing(within(header(name)).getByRole('button', { name }), name)
    }
  })
})
