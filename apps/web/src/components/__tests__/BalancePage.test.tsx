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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDocPage } from '../../content/docs'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../../stores/balanceStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'

/**
 * BalancePage "Add Balance Entry" button tests (story 6-6, BUG-A).
 *
 * The live /balance page already shipped a complete add/edit modal + add
 * submit path, but the opener was dead (`_openAddModal`, never called) so no
 * UI element triggered it — while the empty-state copy told users to "Click
 * 'Add Balance Entry'". These tests prove the trigger now exists, opens the
 * add modal, actually creates an entry (existing Story 2.3 create flow), stays
 * discoverable when the list is empty, and restores focus on close.
 */
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
    // Empty state present, and the add affordance is still shown.
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

    // Modal closes and the new entry is rendered in the entries table.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('My 401k')).toBeInTheDocument()
    expect(useBalanceStore.getState().entries).toHaveLength(1)
  })

  it('resets the form when reopened for a new add after an edit (AC-4)', async () => {
    const user = userEvent.setup()
    // Seed an existing entry so an Edit trigger renders.
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Existing 401k',
      currentBalance: 100000,
      monthlyContribution: 50000,
      frequency: 'monthly',
    })
    renderWithProviders(<BalancePage />)

    // Open the edit modal — fields are populated from the entry.
    await user.click(screen.getByRole('button', { name: 'Edit Existing 401k' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
    expect(within(editDialog).getByLabelText(/name/i)).toHaveValue('Existing 401k')

    // Close it, then open the add modal — the form must be back to defaults.
    await user.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('balance-add-button'))

    const addDialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
    expect(within(addDialog).getByLabelText(/name/i)).toHaveValue('')
    // Currency inputs are now type="text" (story 14-3, for locale-aware grouping),
    // so an empty field reports '' rather than a number input's null.
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

  // Story 16-2: contribution frequency selection round-trips through create + edit.
  it('creates an entry with a chosen frequency and round-trips it on edit', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    // Create with a non-default (biweekly) frequency.
    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })
    await user.type(within(dialog).getByLabelText(/name/i), 'Brokerage')
    await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '250')
    await user.selectOptions(within(dialog).getByTestId('balance-frequency-select'), 'biweekly')
    await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useBalanceStore.getState().entries[0].frequency).toBe('biweekly')

    // Reopen for edit — the select reflects the stored value.
    await user.click(screen.getByRole('button', { name: 'Edit Brokerage' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit Balance Entry' })
    expect(within(editDialog).getByTestId('balance-frequency-select')).toHaveValue('biweekly')

    // Change it and save — the new value persists.
    await user.selectOptions(within(editDialog).getByTestId('balance-frequency-select'), 'weekly')
    await user.click(within(editDialog).getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useBalanceStore.getState().entries[0].frequency).toBe('weekly')
  })
})

/**
 * BalancePage inline field-validation tests (story 6-8).
 *
 * Proves invalid add submissions surface themed, accessible inline field errors
 * (no browser alert()), block the store mutation and keep the modal open,
 * preserve the optional max-contribution-limit semantics, and that correcting
 * the fields clears the errors and lets a valid submit proceed.
 */
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

    // Empty current balance / monthly contribution default to 0 → valid.
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

/**
 * The page's SECTION COMPOSITION (story 43.1, FR68).
 *
 * ⚠️ This replaces story 37.2's "is the SECOND of four sections" test, which was
 * deleted with the chart. Without it nothing asserted the page's composition at
 * all: a control that re-added an `<h2>Investment Accounts</h2>` section ran
 * GREEN against the whole suite, because every other test scopes itself to a
 * table, a stat card or a testid and none of them counts the sections.
 *
 * ⚠️ Asserts the ORDER and the exact set, not just a count. A count alone would
 * accept the right number of the wrong sections, and `theme-page-coverage.spec.ts`
 * asserts the computed background of `.surface` `.first()` — so which section is
 * index 0 is load-bearing beyond this file.
 *
 * ⚠️ The `not.toBeInTheDocument()` guards below name subjects that can no longer
 * exist — normally the vacuous shape this story spent its review budget deleting.
 * They are kept DELIBERATELY: each was verified RED by re-adding the section
 * (story control 8.1), each runs against a SEEDED store, and each sits beside a
 * positive ordered-list `toEqual` that cannot go vacuous. A future sweep for
 * dead absence guards should keep these and re-run that control instead.
 */
describe('BalancePage section composition (43.1)', () => {
  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  /** The ordered `<h2>` of every `main > section`, so a heading-less section still
   *  shows up as `(no h2)` rather than vanishing from the comparison. */
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

    // ⚠️ WITNESS FIRST. Every other assertion in this test is an ABSENCE, and an
    // absence is satisfied by a page that rendered nothing at all. Prove the seed
    // reached the DOM before concluding anything from what is missing.
    expect(screen.getByText('Brokerage')).toBeInTheDocument()

    // ⚠️ The composition assertion is repeated HERE, against the seeded DOM, and
    // that repetition is the point. Both removed sections were data-dependent —
    // the breakdown rendered only for `type === 'investment'` rows — so a
    // regression that re-added one would be INVISIBLE to the empty-store arm
    // above. Seeded is the state in which such a section actually appears.
    expect(sectionHeadings(container)).toEqual(SECTIONS)

    // Corroboration, not the fence: the retired headings and the breakdown's
    // empty copy, none of which can exist once the list above is exact.
    for (const name of ['Investment Accounts', 'What You Own vs What You Owe']) {
      expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByText('No investment accounts yet')).not.toBeInTheDocument()
  })
})

/**
 * Money-input sanitization (story 28-1, FR46).
 *
 * All three money fields on this page route through the shared core
 * `sanitizeMoneyInput` helper; these prove the wiring (AC-3). Note the negative
 * sign is deliberately NOT stripped — see the '-5' validation test above, which
 * still relies on a typed minus reaching the submit validator.
 */
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

/**
 * Visible focus indicator (story 28-1, AC-7).
 *
 * See the SavingsPage sibling suite. This page has the most affected controls
 * (5), including the two contribution fields that no e2e path focuses.
 */
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

/**
 * Mobile card presentation (story 31.2, UX-DR36).
 *
 * See `IncomePage.test.tsx` for the full rationale. Your Balance Entries is the
 * widest table in the app (7 columns) and the primary 320px risk.
 */
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
          monthlyContribution: 30000,
          frequency: 'monthly',
          createdAt: ISO_31_2,
          updatedAt: ISO_31_2,
        },
      ],
    })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  function tables(container: HTMLElement): { entries: HTMLElement } {
    const found = [...container.querySelectorAll('table')] as HTMLElement[]
    // The page renders exactly one table: Your Balance Entries.
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
    expect(within(row).getByText('-4,000.00')).toBeInTheDocument()
    expect(within(row).getByText('300.00')).toBeInTheDocument()
    expect(within(row).getByText('Monthly')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Car Loan' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Car Loan' })).toBeInTheDocument()
  })

  /**
   * ⚠️ Story 49.1 (FR75): seven labels → five. 'Max Contribution' and 'Remaining
   * Room' are gone and 'Current Balance' is now 'Current Balance/Value'.
   *
   * ⚠️⚠️ THIS ASSERTS THE EXACT ORDERED ARRAY, NOT "each of these five exists".
   * The loop form it replaced was a per-label existence check, and mutation arm
   * M1 proved it GREEN against a re-added `<FieldLabel>Max Contribution</...>`
   * cell — every one of the five still existed, so the extra sixth sailed
   * through. A per-item loop cannot see an ADDITION, which is the whole defect
   * this story needs guarded. The `sm:hidden` check is kept per label because it
   * is what makes these mobile-card labels rather than visible chrome.
   */
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

    // Two flex children below `sm` — the label and one wrapper holding both the
    // amount and the cadence. A third child would let `justify-between` fling
    // the cadence to the far edge as if it were its own column.
    expect(cell.children).toHaveLength(2)
    const [, value] = [...cell.children] as HTMLElement[]
    expect(value).toHaveTextContent('500.00')
    expect(value).toHaveTextContent('Bi-weekly')
  })

  it('has exactly ONE table in the DOM — no dual-rendered card list', () => {
    const { container } = renderWithProviders(<BalancePage />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    // Each entry is rendered once. A card list rendered ALONGSIDE the converted
    // table — the defect this guards — would show every name twice.
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

  /**
   * Story 50.1 (AC-1, AC-3, AC-9) — the row actions are ICONS now.
   *
   * ⚠️ THE TEST DIRECTLY ABOVE CANNOT TELL. It reads `aria-label`, which 50.1
   * leaves byte-identical, so it stays green against a button that renders no
   * child at all — despite being titled "offers exactly Edit and Delete". It is
   * the right guard for the accessibility contract and the wrong one for what
   * the row SHOWS. This is the assertion that goes red.
   *
   * See `assertIsIconOnlyAction` for why both halves ship together and why
   * `aria-hidden` is pinned as an attribute rather than through the name.
   */
  it('renders each row action as an aria-hidden icon with no visible label (50.1 AC-1, AC-3, AC-9)', () => {
    const { container } = renderWithProviders(<BalancePage />)
    const cell = rowIn(tables(container).entries, 'Car Loan').querySelector(
      'td:last-child'
    ) as HTMLElement
    const geometry = ['Edit Car Loan', 'Delete Car Loan'].map((label) =>
      assertIsIconOnlyAction(within(cell).getByRole('button', { name: label }), label)
    )
    // ⚠️ EDIT AND DELETE MUST BE DIFFERENT GLYPHS, AND NOTHING ELSE CHECKS THAT.
    // Both icons are `h-5 w-5` `aria-hidden` SVGs from the same module, so pasting
    // `<TrashIcon>` into the Edit slot — the likeliest slip across four copy-pasted
    // call sites — leaves the accessible names, the empty textContent, the icon
    // count, the rendered box and every width baseline untouched. Copied from
    // `SortableColumnHeader.test.tsx`, which pins asc vs desc the same way and says
    // why: "the two states would be visually identical and only a screen reader
    // could tell them apart".
    expect(geometry[0], 'Edit and Delete render the same glyph').not.toBe(geometry[1])
  })

  it('introduces no retired surface/text tokens in the table region (AC-7)', () => {
    const { container } = renderWithProviders(<BalancePage />)
    const { entries } = tables(container)
    expect(collectRetiredTokenViolations(entries)).toEqual([])
  })
})

/**
 * BalancePage net-worth tests (Story 32.2, FR59).
 *
 * Net worth is now `investments + savings − debts`, read through the single
 * shared `useNetWorth()` hook, and the page carries a fourth read-only "Savings"
 * stat card so the four figures on screen visibly reconcile (a savings-inclusive
 * net worth beside only Investments and Debts reads as broken arithmetic).
 *
 * ⚠️ Expectations are HAND-COMPUTED from the story §3 fixture and rendered in the
 * suite-wide currency-less mode ("−127,000.00", not "−$127,000.00"):
 *
 *   investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
 *   the pre-32.2 formula gave −13,000,000c → "-130,000.00"
 */
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

    // 250,000 + 50,000 = 300,000c
    expect(screen.getByTestId('stat-total-savings')).toHaveTextContent('3,000.00')
    expect(screen.getByTestId('stat-total-investments')).toHaveTextContent('20,000.00')
    expect(screen.getByTestId('stat-total-debts')).toHaveTextContent('150,000.00')

    // The claimed invariant, actually asserted (code review 32.2: the original
    // version of this test named reconciliation in its comment and then checked
    // two of the four cards). Parse the four RENDERED strings back to numbers and
    // prove investments + savings − debts equals the net-worth card on screen —
    // not merely in the store the cards were built from.
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

    // No investments, no debts — net worth is exactly the savings total, not 0.
    // Asserted as an exact match, not a `not.toHaveTextContent('0.00')` substring
    // check: '0.00' is a substring of '3,000.00', so the negative form could only
    // ever be written in a way that cannot fail (code review 32.2 caught exactly
    // that — a stray trailing period made the guard unmatchable against anything).
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

/**
 * Column sorting (Story 34.2, FR61).
 *
 * ⚠️ The sort is a VIEW-level projection over the store's array: it never writes
 * `sortOrder` and never enqueues a sync operation. That the store's default
 * order survives a column sort is asserted here, not assumed.
 */
describe('BalancePage — sort by column (34.2)', () => {
  /**
   * manual (insertion):   Zeta, Alpha, Mid, Beta
   * by type:              Zeta, Mid, Beta, Alpha   (investment before debt)
   * by name:              Alpha, Beta, Mid, Zeta
   * by current balance:   Alpha(-500) Zeta(300) Mid(300) Beta(800)  <- Zeta/Mid TIE
   * by contribution NORM: Mid(4_17) Beta(200_00) Alpha(300_00) Zeta(433_33)
   * by contribution RAW:  Mid(50_00) Zeta(100_00) Beta(200_00) Alpha(300_00)
   */
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
      currentBalance: -500_00,
      monthlyContribution: 300_00,
      frequency: 'monthly' as const,
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const entry of SEED) {
      useBalanceStore.getState().addBalanceEntry(entry)
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /** The page's only table — the editable "Your Balance Entries" one. */
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
    // ⚠️ Sorting by the DISPLAYED label would invert this: the labels are
    // 'Investment' and 'Debt', and 'Debt'.localeCompare('Investment') < 0.
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
    // Raw ascending would be ['Mid','Zeta','Beta','Alpha'] — a different order.
    expect(orderIn(entriesTable())).toEqual(['Mid', 'Beta', 'Alpha', 'Zeta'])
  })

  it('sorts Current Balance RAW, with a negative debt first and ties on manual order', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    await user.click(sortBy('Current Balance/Value'))
    expect(orderIn(entriesTable())).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
    await user.click(sortBy('Current Balance/Value'))
    expect(orderIn(entriesTable())).toEqual(['Beta', 'Zeta', 'Mid', 'Alpha'])
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
    return screen.getByRole('combobox', { name: 'Sort balance entries' }) as HTMLSelectElement
  }

  it('offers the mobile sort control whether or not a sort is active (48.1 AC-1)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    // Present in MANUAL order — the state the old escape hatch rendered nothing in.
    expect(sortControl()).toBeInTheDocument()
    expect(sortControl().value).toBe('manual')

    await user.selectOptions(sortControl(), 'name:asc')
    // And still present once a sort is active, now reporting it.
    expect(sortControl().value).toBe('name:asc')
  })

  it('sorts from the mobile control and drives the SAME state as the headers (48.1 AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    // ⚠️ DESCENDING, chosen directly. Ascending alone cannot tell a `select`
    // from a `toggle`, and name-descending differs from BOTH the manual order
    // and the ascending order for this seed — an order assertion that happened
    // to match one of them could not fail.
    await user.selectOptions(sortControl(), 'name:desc')
    expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Beta', 'Alpha'])

    // ⚠️ THE SINGLE-SOURCE-OF-TRUTH CLAIM. A control wired to its own state
    // would reorder the rows and leave this header reporting `none`.
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
      renderWithProviders(<BalancePage />)
      const before = useBalanceStore.getState().entries.map((row) => [row.id, row.sortOrder])

      const button = () => within(header('Name')).getByRole('button', { name: 'Name' })
      await user.click(button())
      await user.click(button())
      await user.click(button())

      expect(spies.queueUpdate).not.toHaveBeenCalled()
      expect(spies.queueCreate).not.toHaveBeenCalled()
      expect(spies.queueDelete).not.toHaveBeenCalled()
      // And the persisted order itself is byte-identical — no `sortOrder` write.
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
    // ⚠️ Balance is the one page whose `isReadableRow` call has an ADAPTED shape
    // (`{amount: monthlyContribution, frequency}`), so the lib-level proof does
    // not cover this wiring. `sortOrder: -1` puts the row FIRST manually, so
    // "last under the sort" cannot be an accident of its manual position.
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
    // ⚠️ ENUMERATED, not grepped.
    for (const name of ['Type', 'Name', 'Current Balance/Value', 'Contribution']) {
      assertHasFocusRing(sortBy(name), name)
    }
  })
})

/**
 * Whitespace-normalized text of a hint element. `textContent` is normalized
 * because JSX joins the source lines with newlines and `{' '}` separators.
 *
 * ⚠️ Story 49.2 lifted this out of the 36.3 `describe` so the debt, asset and
 * cross-arm blocks share ONE helper rather than growing three copies that can
 * drift apart.
 */
const hintText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * The ratified Balance-form hint strings, pinned WHOLE.
 *
 * ⚠️ WHOLE, not by distinguishing substring — see the matching note in
 * `ExpensesPage.test.tsx`. Two substrings proved the hint was the right hint but
 * left its entire middle clause unpinned, so a reword or a truncation there
 * would have passed. Review 36.3 caught it.
 *
 * The dashes are literal em dashes (U+2014) and every apostrophe is ASCII
 * (U+0027); both are part of what "verbatim" means here, and M12 proves the
 * dash is load-bearing.
 *
 * ⚠️ Story 49.2 REPLACED 36.3's `'…\u2019…'.replace('\u2019', "'")` idiom with
 * plain ASCII literals. `String.prototype.replace` with a STRING pattern
 * replaces only the FIRST occurrence — harmless for the debt hint, which has
 * one apostrophe, but `ASSET_HINT` has two ("it's", "asset's"), so copying the
 * idiom forward would have left the second one curly and pinned a string the
 * component can never produce. The pin would have gone red for a reason that
 * has nothing to do with the copy.
 */
const DEBT_HINT =
  "Enter what you still owe today. Record the recurring payment on the Expenses page — that's where it counts against your cash flow. If the loan bought something you still have, record that as an Asset entry too, so your net worth reflects both sides. Where a mortgage belongs works through a full example."

const ASSET_HINT =
  "Enter what it's worth today. Money you put aside toward it belongs on the Savings page — an asset's value here changes as it appreciates, not as you contribute. A loan against it is recorded separately as a Debt entry, and your down payment is not entered anywhere. Where a mortgage belongs works through a full example."

/**
 * The one doc the two hints point at (story 49.2, UX-DR40 as amended).
 *
 * ⚠️ DERIVED from the doc registry, not typed twice. Review 49.2: a hard-coded
 * href string is a pin on a literal, not on a route — renaming the slug in
 * `DOC_PAGES` would leave every test in this file green while both form links
 * 404 through the `$docId` not-found path. Building the href from the slug and
 * asserting the slug RESOLVES makes the rename fail here instead.
 */
const MORTGAGE_DOC_SLUG = 'where-a-mortgage-belongs'
const MORTGAGE_DOC_HREF = `/docs/${MORTGAGE_DOC_SLUG}`
const MORTGAGE_DOC_LINK_NAME = 'Where a mortgage belongs'

/**
 * Story 36.3 (UX-DR40): debt guidance on the balance entry form.
 *
 * ⚠️ The present-for-debt and absent-for-investment claims live in SEPARATE
 * `it()` blocks on purpose. In one block the first failing assertion aborts and
 * the second never runs, which makes "the gate condition was inverted" and "the
 * gate body was deleted" indistinguishable — and telling those two apart is the
 * whole point of having both.
 */
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

  /**
   * ⚠️ NEGATIVE-ONLY, deliberately, and this was MEASURED rather than reasoned.
   *
   * A first version of this test also asserted the hint APPEARS after switching
   * to debt. That extra positive assertion destroyed the discrimination the pair
   * exists for: deleting the gate's body and inverting its condition both turned
   * this test red, producing identical failure signatures for two different
   * defects. With only negative assertions here, deleting the body leaves this
   * green (the hint is absent everywhere, which is what this test claims) while
   * inverting the condition turns it red.
   */
  it('does not show the debt guidance on the default investment entry', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

    // Default type is investment — the hint must not be there at all.
    expect(within(dialog).queryByTestId('balance-debt-hint')).not.toBeInTheDocument()
  })

  it('withdraws the debt guidance when the type is switched back to investment', async () => {
    // The gate must track the CURRENT type, not merely the type on open. Also
    // negative-only, for the reason given above.
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

    // ⚠️ Story 49.1 (FR75) dropped the third field, the contribution LIMIT, for
    // every type. Its absence is no longer asserted here: a `queryBy` on a control
    // that exists for no type can never fail again, and a vacuous assertion is
    // worse than none. The exact modal field list is pinned separately below.
    // Default type is investment → both conditional fields are present.
    expect(within(dialog).getByTestId('balance-monthly-contribution-input')).toBeInTheDocument()
    expect(within(dialog).getByTestId('balance-frequency-select')).toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText(/type/i), 'asset')

    // An owned asset changes value by appreciation, not by deposits — and a
    // contribution on an asset would be excluded from `/savings`'s
    // investment-only pool filter, overstating it.
    expect(
      within(dialog).queryByTestId('balance-monthly-contribution-input')
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId('balance-frequency-select')).not.toBeInTheDocument()

    // The asset arm gets a hint saying where recurring saving DOES belong, the
    // same way the debt arm points at the Expenses page.
    // ⚠️ Story 49.2: this is a PRESENCE assertion and nothing more. It was the
    // asset arm's only guard for five stories, and it stays green against any
    // rewrite of the copy — which is why 49.2 added the whole-string pin below
    // rather than trusting this one. Kept because it is the assertion that
    // belongs to THIS test's subject (the hidden-fields gate), not to the copy.
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
    // Both columns are NOT NULL in the schema, so hiding the fields must still
    // write values — never leave them undefined.
    expect(entries[0]?.monthlyContribution).toBe(0)
    expect(entries[0]?.frequency).toBe('monthly')
    // Story 49.1 removed `maxContributionLimit`; the saved row must not carry it.
    expect('maxContributionLimit' in (entries[0] ?? {})).toBe(false)
  })

  it('counts an asset on the ASSET side, in its own card, not folded into investments', async () => {
    // ⚠️ The component totals are what make this test meaningful. Net worth is
    // INVARIANT under classifying an asset as an investment — (I+A)+S−D === I+S+A−D
    // — so a net-worth-only assertion would pass the exact mistake FR70 forbids.
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

    // Hand-computed: 5,000,000 + 0 savings + 40,000,000 − 30,000,000 = 15,000,000.
    expect(screen.getByTestId('stat-total-investments')).toHaveTextContent('50,000.00')
    expect(screen.getByTestId('stat-total-assets')).toHaveTextContent('400,000.00')
    expect(screen.getByTestId('stat-total-debts')).toHaveTextContent('300,000.00')
    expect(screen.getByTestId('stat-net-worth')).toHaveTextContent('150,000.00')
  })
})

/**
 * Story 49.2 (UX-DR40, amended): both loan-shaped arms point at the SAME guidance
 * doc, and both keep the accessible token.
 *
 * ⚠️ These claims are deliberately NOT folded into the whole-string pins above.
 * `textContent` flattens an anchor into its text, so a pin that reads
 * "Where a mortgage belongs works through a full example" stays perfectly green
 * when the `<a>` is deleted, when its `href` points at the wrong doc, or when it
 * is not a link at all. The whole-string pin proves the SENTENCE; only these
 * prove the LINK.
 *
 * ⚠️ Class assertions are TOKEN membership, never substring: `text-muted` is a
 * substring of nothing here today, but `classList` is what makes that guarantee
 * hold for a future class like `text-muted-foreground`.
 */
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
    // ⚠️ The one assertion in this file that would survive a slug rename is this
    // one. Everything else compares the anchor against `MORTGAGE_DOC_HREF`, so
    // renaming the slug moves BOTH sides together and stays green.
    expect(getDocPage(MORTGAGE_DOC_SLUG)?.title).toBe(MORTGAGE_DOC_LINK_NAME)
  })

  for (const type of ['debt', 'asset'] as const) {
    it(`links the ${type} hint to the mortgage guidance doc (AC-1/AC-2)`, async () => {
      const hint = await openArm(type)

      const link = within(hint).getByRole('link', { name: MORTGAGE_DOC_LINK_NAME })
      // ⚠️ The TARGET, not just the text. M5 repoints the href at another doc
      // and every text-based assertion in this file stays green.
      expect(link.getAttribute('href')).toBe(MORTGAGE_DOC_HREF)
    })

    it(`keeps the ${type} hint on the token that passes AA in both themes (AC-5)`, async () => {
      const hint = await openArm(type)

      // `.text-muted` is `text-gray-500 dark:text-gray-400`: 4.83:1 on the white
      // modal card and 5.78:1 on `dark:bg-gray-800`. Both pass AA for small text.
      // ⚠️ `text-faint` resolves to gray-400 in BOTH themes, so it is identical to
      // `text-muted` in dark and fails in LIGHT ONLY, at 2.54:1 (36.3's figure,
      // reproduced independently by 49.2). Swapping the token is therefore a
      // regression in one theme and a no-op in the other — which is exactly the
      // kind of half-visible change a class pin catches and a style review does not.
      //
      // ⚠️ HONESTY NOTE: this pair was GREEN before story 49.2 — both hints already
      // carried `text-muted`. It proves nothing about 49.2's change and is purely a
      // forward regression pin, the same admission the presence assertion above
      // carries. A green run here is not evidence that this story did anything.
      expect([...hint.classList]).toContain('text-muted')
      expect([...hint.classList]).not.toContain('text-faint')
    })
  }
})

/**
 * Story 45.1 (FR72, D8) — the "already recorded as an expense" checkbox.
 *
 * Investment-only: a debt's contribution never reaches the distributable pool
 * (`SavingsPage`
 * filters on `type === 'investment'`), and an asset has no contribution field at
 * all, so offering the control there would advertise an effect that does not exist.
 */
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

    // Default type is investment → present.
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

    // Back to investment → returns. ⚠️ The positive arms bracket the absence
    // guards so neither can pass because the dialog itself failed to render.
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
    // ⚠️ The persistence gate, not just the hidden control. A stale `true` left
    // over from the investment branch would otherwise reach the store and
    // `validateBalanceTracking` would reject the entire write — the user would
    // press Save and silently get nothing.
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

/**
 * The contribution control asks a question BOTH populations can answer
 * (Story 47.1, FR73, AC-1, AC-2, AC-3).
 *
 * ⚠️ Nothing pinned this copy before 47.1. A grep for "Already recorded as an
 * expense" across `apps/web/src/**` test files returned zero hits at the previous
 * baseline — every existing flag test addressed the control by `data-testid`. So
 * the wording could be changed to anything at all and the suite stayed green. That
 * is precisely why these pins are load-bearing rather than ceremonial.
 */
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
    // ⚠️ ONE ordered clause, not loose fragments. Separate /Not/, /taken/ and
    // /money left over/ assertions all pass against a mangled reordering.
    expect(within(dialog).getByLabelText(/Not\s+taken\s+from\s+the\s+money\s+left\s+over/i)).toBe(
      within(dialog).getByTestId('balance-contribution-recorded-as-expense')
    )
  })

  it('AC-1(a): the payroll arm is CONJUNCTIVE, so a gross-income user answers no', async () => {
    const dialog = await openInvestmentForm()
    const help = within(dialog).getByText(/Tick this if the contribution/i)

    // ⚠️⚠️ THE MOST IMPORTANT ASSERTION IN THIS FILE. A user whose contribution
    // comes out of their pay but who entered GROSS income must NOT tick the box:
    // ticking OVERSTATES their pool by exactly the contribution. The copy earns
    // its keep only if it asks about the ENTERED INCOME as well as the deduction.
    // A disjunctive arm ("tick this if it comes out of your pay") is true for them
    // and ships a new wrong number — the opposite direction of error from FR72.
    expect(help.textContent).toMatch(
      /comes\s+out\s+of\s+your\s+pay\s+and\s+the\s+income\s+you\s+entered\s+is\s+the\s+amount\s+that\s+reaches\s+your\s+bank\s+account/i
    )

    // ⚠️ PRESENCE IS NOT EXCLUSIVITY. Code review: the containment pin above cannot
    // fail against copy that keeps this sentence AND appends a disjunctive escape
    // ("…or simply if it comes out of your pay"), which is precisely the
    // gross-income regression it claims to guard. "comes out of your pay" must
    // appear EXACTLY ONCE — a second occurrence is how such an escape reads.
    expect(help.textContent?.match(/comes\s+out\s+of\s+your\s+pay/gi)?.length).toBe(1)
  })

  it('AC-1(b,c): it also names the expense-listing arm and resolves the both-at-once case', async () => {
    const dialog = await openInvestmentForm()
    const help = within(dialog).getByText(/Tick this if the contribution/i)

    expect(help.textContent).toMatch(
      /also\s+list\s+this\s+contribution\s+on\s+your\s+Expenses\s+page/i
    )
    // Ticking alone leaves a both-at-once user still wrong by the contribution —
    // their expense line subtracts money that was never in their take-home income.
    expect(help.textContent).toMatch(
      /If\s+both\s+are\s+true,\s+take\s+the\s+line\s+off\s+your\s+Expenses\s+page/i
    )
    // The counting claim must name where the counting happens, not "here".
    expect(help.textContent).toMatch(/money\s+left\s+over\s+on\s+the\s+Savings\s+page/i)
  })

  it('AC-2: the control never says "net" (story 46.1 removed that word from income copy)', async () => {
    const dialog = await openInvestmentForm()
    // ⚠️ The SCOPE is what is load-bearing here; the carve-out is insurance.
    // A page-wide bare-word ban would be RED ON ARRIVAL — BalancePage legitimately
    // says "Net Worth" in eight places — but every one of them is OUTSIDE the modal,
    // so within this scope the carve-out is currently redundant. Kept because it
    // costs nothing and survives a net-worth string later entering the form. Code
    // review flagged that this comment previously justified the carve-out with
    // page-wide reasoning that does not apply at dialog scope.
    expect(dialog.textContent).not.toMatch(/\bnet\b(?!\s+worth)/i)
  })

  it('AC-3: the help text is the checkbox’s accessible description', async () => {
    const dialog = await openInvestmentForm()
    // ⚠️ `toHaveAccessibleDescription`, not a string comparison on
    // `aria-describedby`. A string pin passes against an id that resolves to
    // nothing; only this matcher walks the id list to real nodes. Story 46.1's
    // review found exactly that hole.
    expect(
      within(dialog).getByTestId('balance-contribution-recorded-as-expense')
    ).toHaveAccessibleDescription(/Tick this if the contribution comes out of your pay/i)
  })
})

/**
 * The Add/Edit modal's field list per finance type (story 49.1, FR75).
 *
 * ⚠️ WHY THIS IS A POSITIVE, EXACT-SET ASSERTION. Story 49.1 removed the
 * "Max Contribution Limit (Optional)" field for every type. Two assertions in this
 * file previously proved it was hidden for debts and assets with
 * `queryByTestId(...).not.toBeInTheDocument()`. Those would now pass TRIVIALLY and
 * FOREVER — the control exists for no type at all — which is exactly the vacuity
 * trap stories 48.1 and 48.2 both hit ("deleting a component makes every absence
 * assertion about it vacuous, not red").
 *
 * Asserting the EXACT set of rendered controls keeps the same defect caught (a
 * limit field reappearing on any arm) while ALSO catching the opposite defect a
 * bare absence check never could: a field silently disappearing from an arm that
 * still needs it.
 *
 * MUTATIONS KILLED: re-add the limit field to the investment arm (M2); drop the
 * frequency select from the debt arm; render the contribution checkbox for a debt.
 */
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
      [
        'balance-name-input',
        'balance-current-balance-input',
        'balance-monthly-contribution-input',
        'balance-frequency-select',
      ],
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

  /**
   * ⚠️ This test ACTUALLY SWITCHES TYPE, and that is the point of it. Code review
   * caught the first version rendering only the default (investment) arm while
   * its name promised "all three types at once" — the name claimed more than the
   * assertion delivered, which in this repo is the shape of a bug report.
   *
   * The claim being pinned is that ONE label now covers all three finance types
   * (an asset has a VALUE, not a balance), so it has to be observed on all three.
   */
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

      // ⚠️ The DOM id stays `currentBalance`: 49.1 renames the LABEL, not the KEY.
      const label = within(dialog).getByText('Current Balance/Value *')
      expect(label).toHaveAttribute('for', 'currentBalance')
      expect(within(dialog).getByTestId('balance-current-balance-input')).toHaveAttribute(
        'id',
        'currentBalance'
      )
    }
  )
})
