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
      maxContributionLimit: null,
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

    // Empty current balance / monthly contribution default to 0 → valid, and the
    // optional max-contribution limit is valid when blank.
    expect(screen.queryByTestId('balance-current-balance-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('balance-monthly-contribution-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('balance-max-contribution-error')).not.toBeInTheDocument()

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
 * BalancePage "Remaining Room" column tests (Story 26.4, FR41).
 *
 * Each investment/balance account shows remaining contribution room =
 * max(0, maxContributionLimit − currentBalance). An account with no limit shows
 * a placeholder ("—"), NEVER "0"/"$0.00". The derivation lives in the pure core
 * `remainingContributionRoom` (unit-tested separately); these tests prove the
 * cell renders the right value per row.
 */
describe('BalancePage remaining contribution room column (Story 26.4)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  it('shows max(0, limit − balance) for an account with a limit, and "—" for one without', async () => {
    // Under-limit account: room = 500000 − 100000 = 400000 cents ($4,000.00).
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'TFSA',
      currentBalance: 100000,
      maxContributionLimit: 500000,
      monthlyContribution: 50000,
      frequency: 'monthly',
    })
    // No-limit account: cell shows the placeholder, not a formatted zero.
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance: 200000,
      maxContributionLimit: null,
      monthlyContribution: 30000,
      frequency: 'monthly',
    })

    const entries = useBalanceStore.getState().entries
    const withLimit = entries.find((e) => e.name === 'TFSA')
    const noLimit = entries.find((e) => e.name === 'Brokerage')
    if (!withLimit || !noLimit) throw new Error('seed failed')

    renderWithProviders(<BalancePage />)

    // Under-limit row shows the formatted room (4,000.00 in the default
    // currency-less mode), never negative/zero.
    expect(await screen.findByTestId(`balance-remaining-room-${withLimit.id}`)).toHaveTextContent(
      '4,000.00'
    )
    // No-limit row shows the placeholder, NOT a formatted zero.
    const noLimitCell = screen.getByTestId(`balance-remaining-room-${noLimit.id}`)
    expect(noLimitCell).toHaveTextContent('—')
    expect(noLimitCell).not.toHaveTextContent('0')
  })

  it('shows a formatted 0 (never negative) when the balance meets or exceeds the limit', async () => {
    // Over-limit: balance 150000 ≥ limit 100000 ⇒ room floors to 0 (distinct from "no limit").
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Maxed RRSP',
      currentBalance: 150000,
      maxContributionLimit: 100000,
      monthlyContribution: 0,
      frequency: 'monthly',
    })

    const entry = useBalanceStore.getState().entries[0]
    if (!entry) throw new Error('seed failed')

    renderWithProviders(<BalancePage />)

    // room floors to 0 — a real formatted zero, distinct from the "—" no-limit case.
    expect(await screen.findByTestId(`balance-remaining-room-${entry.id}`)).toHaveTextContent(
      '0.00'
    )
  })

  it('shows "—" remaining room AND "None" max contribution for a DEBT, even if a limit is set (FR41)', async () => {
    // A contribution limit is an investment-only concept — a debt should never
    // display remaining room, even a legacy debt that somehow carries a limit.
    useBalanceStore.getState().addBalanceEntry({
      type: 'debt',
      name: 'Legacy Card',
      currentBalance: 300000,
      maxContributionLimit: 1000000,
      monthlyContribution: 20000,
      frequency: 'monthly',
    })

    const entry = useBalanceStore.getState().entries[0]
    if (!entry) throw new Error('seed failed')

    const { container } = renderWithProviders(<BalancePage />)

    // Remaining Room cell shows the placeholder, not max(0, 1000000 − 300000).
    const roomCell = await screen.findByTestId(`balance-remaining-room-${entry.id}`)
    expect(roomCell).toHaveTextContent('—')
    expect(roomCell).not.toHaveTextContent('7,000')
    // The pre-existing Max Contribution column also reads "None" for the debt
    // (the stale limit is never surfaced), so the row is internally consistent.
    expect(container).not.toHaveTextContent('10,000.00')
  })
})

describe('BalancePage max-contribution-limit field is investment-only (Story 26.4)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })
  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  it('hides the Max Contribution Limit field for debts and shows it for investments', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

    // Default type is investment → the limit field is present.
    expect(within(dialog).getByTestId('balance-max-contribution-input')).toBeInTheDocument()

    // Switch to debt → the field disappears (a debt has no contribution limit).
    await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
    expect(within(dialog).queryByTestId('balance-max-contribution-input')).not.toBeInTheDocument()

    // Switch back to investment → the field returns.
    await user.selectOptions(within(dialog).getByLabelText(/type/i), 'investment')
    expect(within(dialog).getByTestId('balance-max-contribution-input')).toBeInTheDocument()
  })

  it('clears any prior limit when an investment is switched to a debt on save', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog', { name: 'Add Balance Entry' })

    // Fill an investment with a limit, then switch the type to debt before saving.
    await user.type(within(dialog).getByLabelText(/name/i), 'Reclassified')
    await user.type(within(dialog).getByTestId('balance-current-balance-input'), '3000')
    await user.type(within(dialog).getByTestId('balance-max-contribution-input'), '9999')
    await user.type(within(dialog).getByTestId('balance-monthly-contribution-input'), '100')
    await user.selectOptions(within(dialog).getByLabelText(/type/i), 'debt')
    await user.click(within(dialog).getByRole('button', { name: 'Add Balance Entry' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const entry = useBalanceStore.getState().entries[0]
    if (!entry) throw new Error('save failed')
    expect(entry.type).toBe('debt')
    // The debt persists NO limit despite the value typed while it was an investment.
    expect(entry.maxContributionLimit).toBeNull()
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
      screen.getByTestId('balance-max-contribution-input'),
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
          maxContributionLimit: 700000,
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
    // Contribution limit and remaining room are investment-only (FR41).
    expect(within(row).getByText('None')).toBeInTheDocument()
    expect(within(row).getByTestId('balance-remaining-room-debt-1')).toHaveTextContent('—')
    expect(within(row).getByText('300.00')).toBeInTheDocument()
    expect(within(row).getByText('Monthly')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Edit Car Loan' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Car Loan' })).toBeInTheDocument()
  })

  it('labels all seven Balance Entries fields on the card (AC-4)', () => {
    const { container } = renderWithProviders(<BalancePage />)
    const row = rowIn(tables(container).entries, 'Car Loan')

    for (const label of [
      'Type',
      'Name',
      'Current Balance',
      'Max Contribution',
      'Remaining Room',
      'Contribution',
      'Actions',
    ]) {
      expect(within(row).getByText(label)).toBeInTheDocument()
      expect([...within(row).getByText(label).classList]).toContain('sm:hidden')
    }
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
    for (const label of [
      'Edit Car Loan',
      'Delete Car Loan',
      'Move Car Loan up',
      'Move Car Loan down',
    ]) {
      assertHasFocusRing(within(row).getByRole('button', { name: label }), label)
    }
  })

  it('declares a >= 44px mobile tap target on each row action, scoped to max-sm (AC-6)', () => {
    const { container } = renderWithProviders(<BalancePage />)
    const row = rowIn(tables(container).entries, 'Car Loan')
    for (const label of [
      'Edit Car Loan',
      'Delete Car Loan',
      'Move Car Loan up',
      'Move Car Loan down',
    ]) {
      assertHasMobileTapTarget(within(row).getByRole('button', { name: label }), label)
    }
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
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
    add({
      type: 'investment',
      name: 'Pension',
      currentBalance: 1_200_000,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
    add({
      type: 'debt',
      name: 'Mortgage',
      currentBalance: 15_000_000,
      maxContributionLimit: null,
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
      maxContributionLimit: null,
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
 * Row reordering (Story 34.1b, FR60).
 *
 * ⚠️ Written per page rather than once over a table of four. These are four
 * independent page components with four hand-rolled actions cells; stories 30-4b
 * and 33.3 each shipped a HIGH by testing one surface and assuming its siblings.
 */
describe('BalancePage — reorder rows (34.1b)', () => {
  const NAMES = ['Alpha', 'Beta', 'Gamma']

  function seedRows() {
    useBalanceStore.setState({ entries: [] })
    // Distinct createdAt per row: rows added inside one millisecond tie on the
    // secondary sort key, and a tie-preserving stable sort can make an ordering
    // assertion pass by accident (34.1a's M10).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    for (const name of NAMES) {
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment' as const,
        name,
        currentBalance: 100000,
        monthlyContribution: 0,
        frequency: 'monthly' as const,
      })
      vi.advanceTimersByTime(1000)
    }
    vi.useRealTimers()
  }

  /**
   * The rendered row names, top to bottom, in the editable table.
   *
   * ⚠️ Still identified by its move controls rather than by `getAllByRole`'s
   * first match, so an ordering assertion here can never silently start reading
   * some other table if one is ever added back to this page.
   */
  function editableTable(): HTMLElement {
    const control = screen.getAllByRole('button', { name: /^Move .+ up$/ })[0] as HTMLElement
    return control.closest('table') as HTMLElement
  }

  function renderedOrder(): string[] {
    return within(editableTable())
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
    useBalanceStore.setState({ entries: [] })
    localStorage.clear()
  })

  it('offers a move-up and move-down control naming each row (AC-1)', () => {
    renderWithProviders(<BalancePage />)
    for (const name of NAMES) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeInTheDocument()
    }
  })

  it('moves a row up when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    expect(renderedOrder()).toEqual(NAMES)

    await user.click(screen.getByRole('button', { name: 'Move Beta up' }))

    expect(renderedOrder()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  it('moves a row down when its control is activated (AC-2)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)

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
    renderWithProviders(<BalancePage />)
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
    renderWithProviders(<BalancePage />)

    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    await user.click(screen.getByRole('button', { name: 'Move Gamma down' }))

    expect(renderedOrder()).toEqual(NAMES)
  })

  it('marks BOTH controls aria-disabled on a single-row list (AC-4)', () => {
    useBalanceStore.setState({ entries: [] })
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment' as const,
      name: 'Solo',
      currentBalance: 100000,
      monthlyContribution: 0,
      frequency: 'monthly' as const,
    })
    renderWithProviders(<BalancePage />)

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
    renderWithProviders(<BalancePage />)
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
    renderWithProviders(<BalancePage />)
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
    const { unmount } = renderWithProviders(<BalancePage />)
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }))
    unmount()

    // ⚠️ `setState` goes THROUGH the persist middleware, so clearing in-memory
    // state would overwrite the blob we are about to read back. Snapshot it,
    // clear, restore, then rehydrate — which is what a reload actually does.
    const persisted = localStorage.getItem('budget-planner:balance-tracking')
    expect(persisted).toBeTruthy()
    useBalanceStore.setState({ entries: [] })
    localStorage.setItem('budget-planner:balance-tracking', persisted as string)
    await useBalanceStore.persist.rehydrate()

    renderWithProviders(<BalancePage />)
    expect(renderedOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
})

/**
 * Column sorting (Story 34.2, FR61).
 *
 * ⚠️ The sort is a VIEW-level projection over the store's array: it never writes
 * `sortOrder`, never calls a move action and never enqueues a sync operation.
 * That the store's manual order survives a column sort is asserted here, not
 * assumed.
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
      maxContributionLimit: 900_00,
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
      maxContributionLimit: 400_00,
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
    ).toEqual([
      'Type',
      'Name',
      'Current Balance',
      'Max Contribution',
      'Remaining Room',
      'Contribution',
      'Actions',
    ])
    for (const name of [
      'Type',
      'Name',
      'Current Balance',
      'Max Contribution',
      'Remaining Room',
      'Contribution',
    ]) {
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
    await user.click(sortBy('Current Balance'))
    expect(orderIn(entriesTable())).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
    await user.click(sortBy('Current Balance'))
    expect(orderIn(entriesTable())).toEqual(['Beta', 'Zeta', 'Mid', 'Alpha'])
  })

  it('treats a debt row as having no limit or room, in both directions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    await user.click(sortBy('Max Contribution'))
    // The two debts-or-limitless rows (Alpha, Beta) render 'None' and sort last,
    // in their manual relative order.
    expect(orderIn(entriesTable())).toEqual(['Mid', 'Zeta', 'Alpha', 'Beta'])
    await user.click(sortBy('Max Contribution'))
    expect(orderIn(entriesTable())).toEqual(['Zeta', 'Mid', 'Alpha', 'Beta'])

    await user.click(sortBy('Remaining Room'))
    expect(orderIn(entriesTable())).toEqual(['Mid', 'Zeta', 'Alpha', 'Beta'])
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

  it('disables every move control while sorted, and restores them on clear (AC-7)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    await user.click(sortBy('Name'))
    for (const name of NAMES) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    const sorted = orderIn(entriesTable())
    await user.click(screen.getByRole('button', { name: 'Move Mid up' }))
    expect(orderIn(entriesTable())).toEqual(sorted)
    expect(useBalanceStore.getState().entries.map((e) => e.name)).toEqual(MANUAL_ORDER)

    await user.click(screen.getByRole('button', { name: 'Show manual order' }))
    expect(orderIn(entriesTable())).toEqual(MANUAL_ORDER)
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))
    expect(orderIn(entriesTable())).toEqual(['Alpha', 'Zeta', 'Mid', 'Beta'])
  })

  it('shows the mobile escape hatch only while a sort is active', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
    await user.click(sortBy('Contribution'))
    expect(screen.getByText('Sorted by Contribution')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show manual order' }))
    expect(screen.queryByText(/^Sorted by /)).toBeNull()
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
    for (const name of [
      'Type',
      'Name',
      'Current Balance',
      'Max Contribution',
      'Remaining Room',
      'Contribution',
    ]) {
      assertHasFocusRing(sortBy(name), name)
    }
  })
})

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
  /**
   * ⚠️ The RATIFIED string, pinned WHOLE — see the matching note in
   * `ExpensesPage.test.tsx`. Two distinguishing substrings proved the hint was
   * the right hint but left its entire middle clause unpinned, so a reword or a
   * truncation there would have passed. Review 36.3 caught it.
   *
   * The dash is a literal em dash (U+2014) and the apostrophe is ASCII; both are
   * part of what "verbatim" means here. `textContent` is whitespace-normalized
   * because JSX joins the source lines with newlines.
   */
  const DEBT_HINT =
    'Enter what you still owe today. Record the recurring payment on the Expenses page — that\u2019s where it counts against your cash flow.'.replace(
      '\u2019',
      "'"
    )

  const hintText = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

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
