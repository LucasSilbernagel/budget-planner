import { act, renderWithProviders, screen, userEvent, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
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

    // Modal closes and the new entry is rendered. As an investment it now shows
    // both in the "Investment Accounts" breakdown and in the entries table below
    // (Story 26.5), so assert at least one occurrence rather than a single match.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getAllByText('My 401k').length).toBeGreaterThan(0)
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
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
 * BalancePage "Investment Accounts" breakdown tests (Story 26.5, FR-parity).
 *
 * A dedicated section groups the investment-type accounts (name + current
 * balance + the Story 26.4 remaining room) with a combined total that REUSES
 * `useTotalInvestmentBalance()` — the same selector behind the "Total
 * Investments" stat card — so the two figures are provably equal (no
 * double-counting, no divergence). Debts are excluded. Amounts render in the
 * default currency-less mode ("50,000.00", not "$50,000.00").
 */
describe('BalancePage investment accounts breakdown (Story 26.5)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  // Seed two investments + one debt; return the seeded entries by name.
  const seedMixed = () => {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Personal RRSP',
      currentBalance: 5_000_000, // $50,000.00
      maxContributionLimit: 8_000_000, // room = 3,000,000 → $30,000.00
      monthlyContribution: 50_000,
      frequency: 'monthly',
    })
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Personal TFSA',
      currentBalance: 2_000_000, // $20,000.00
      maxContributionLimit: null, // no limit → "—"
      monthlyContribution: 30_000,
      frequency: 'monthly',
    })
    useBalanceStore.getState().addBalanceEntry({
      type: 'debt',
      name: 'Car Loan',
      currentBalance: 1_500_000, // $15,000.00 — must NOT appear in the breakdown/total
      maxContributionLimit: null,
      monthlyContribution: 20_000,
      frequency: 'monthly',
    })
    const entries = useBalanceStore.getState().entries
    const rrsp = entries.find((e) => e.name === 'Personal RRSP')
    const tfsa = entries.find((e) => e.name === 'Personal TFSA')
    if (!rrsp || !tfsa) throw new Error('seed failed')
    return { rrsp, tfsa }
  }

  it('lists investment accounts only, each with its balance and remaining room (AC-1)', async () => {
    const { rrsp, tfsa } = seedMixed()
    renderWithProviders(<BalancePage />)

    const breakdown = within(await screen.findByTestId('investment-breakdown'))

    // Both investments appear inside the breakdown; the debt does NOT.
    expect(breakdown.getByText('Personal RRSP')).toBeInTheDocument()
    expect(breakdown.getByText('Personal TFSA')).toBeInTheDocument()
    expect(breakdown.queryByText('Car Loan')).not.toBeInTheDocument()

    // Per-account balances.
    expect(breakdown.getByTestId(`investment-breakdown-balance-${rrsp.id}`)).toHaveTextContent(
      '50,000.00'
    )
    expect(breakdown.getByTestId(`investment-breakdown-balance-${tfsa.id}`)).toHaveTextContent(
      '20,000.00'
    )

    // Per-account remaining room: RRSP = max(0, 8,000,000 − 5,000,000) = 3,000,000
    // → 30,000.00; TFSA has no limit → the "—" placeholder (never a formatted 0).
    expect(breakdown.getByTestId(`investment-breakdown-room-${rrsp.id}`)).toHaveTextContent(
      '30,000.00'
    )
    const tfsaRoom = breakdown.getByTestId(`investment-breakdown-room-${tfsa.id}`)
    expect(tfsaRoom).toHaveTextContent('—')
    expect(tfsaRoom).not.toHaveTextContent('0')
  })

  it('shows a combined total that equals the Total Investments stat and excludes debts (AC-2, AC-3)', async () => {
    const { rrsp, tfsa } = seedMixed()
    renderWithProviders(<BalancePage />)

    // Combined total = 50,000 + 20,000 = 70,000.00 (the $15,000 debt is excluded).
    const total = await screen.findByTestId('investment-breakdown-total')
    expect(total).toHaveTextContent('70,000.00')

    // Reconciliation is the real invariant: the footer total must equal the SUM of
    // the per-account balance cells actually rendered above it — not merely re-assert
    // the same formatted string (which is a tautology since both render the same
    // expression). Parse the currency-less amounts and compare the numbers.
    const parseAmount = (el: HTMLElement | null): number =>
      Number((el?.textContent ?? '').replace(/,/g, ''))
    const rowsSum =
      parseAmount(screen.getByTestId(`investment-breakdown-balance-${rrsp.id}`)) +
      parseAmount(screen.getByTestId(`investment-breakdown-balance-${tfsa.id}`))
    expect(parseAmount(total)).toBe(rowsSum)

    // And it reconciles with the "Total Investments" stat card (same selector value).
    expect(screen.getByTestId('stat-total-investments')).toHaveTextContent('70,000.00')

    // The debt's balance is never folded into the investment total.
    expect(total).not.toHaveTextContent('85,000.00')
  })

  it('updates the per-account rows and combined total live when an investment is added (AC-4)', async () => {
    seedMixed()
    renderWithProviders(<BalancePage />)

    // Baseline total before the change.
    expect(await screen.findByTestId('investment-breakdown-total')).toHaveTextContent('70,000.00')

    // Add a third investment via the store (no reload / no re-render call).
    act(() => {
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment',
        name: 'Work RRSP',
        currentBalance: 1_000_000, // +$10,000.00
        maxContributionLimit: null,
        monthlyContribution: 40_000,
        frequency: 'monthly',
      })
    })

    // The new row appears and the combined total recomputes to 80,000.00.
    const breakdown = within(await screen.findByTestId('investment-breakdown'))
    expect(await breakdown.findByText('Work RRSP')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('investment-breakdown-total')).toHaveTextContent('80,000.00')
    )
  })

  it('shows a calm placeholder and no total when there are no investment accounts (AC-5)', async () => {
    // A debts-only book still has zero investment accounts.
    act(() => {
      useBalanceStore.getState().addBalanceEntry({
        type: 'debt',
        name: 'Only Debt',
        currentBalance: 500_000,
        maxContributionLimit: null,
        monthlyContribution: 10_000,
        frequency: 'monthly',
      })
    })
    renderWithProviders(<BalancePage />)

    const breakdown = within(await screen.findByTestId('investment-breakdown'))
    expect(breakdown.getByText('No investment accounts yet')).toBeInTheDocument()
    // No table + no combined-total row when the group is empty.
    expect(breakdown.queryByTestId('investment-breakdown-total')).not.toBeInTheDocument()
  })
})
