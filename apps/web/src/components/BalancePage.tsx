import { remainingContributionRoom } from '@budget-planner/core'
import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNetWorth } from '../hooks/useNetWorth'
import { useTableSort } from '../hooks/useTableSort'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { type BalanceSortKey, createBalanceSortExtractors } from '../lib/table-sort-keys'
import {
  useBalanceEntries,
  useBalanceStore,
  useTotalDebtBalance as useTotalDebts,
  useTotalInvestmentBalance as useTotalInvestments,
  useTotalSavings,
} from '../stores'
import type { FinanceType } from '../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../stores/currencyStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Modal } from './ui/Modal'
import {
  FieldLabel,
  RESPONSIVE_ACTIONS_CELL_CLASS,
  RESPONSIVE_ACTIONS_GROUP_CLASS,
  RESPONSIVE_ACTION_BUTTON_CLASS,
  RESPONSIVE_CELL_CLASS,
  RESPONSIVE_FOOTER_CELL_CLASS,
  RESPONSIVE_FOOTER_ROW_CLASS,
  RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_TFOOT_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { RowMoveControls } from './ui/RowMoveControls'
import { SortableColumnHeader, TableSortNotice } from './ui/SortableColumnHeader'

// Type options for the select dropdown
const TYPE_OPTIONS: { value: FinanceType; label: string; color: string }[] = [
  {
    value: 'investment',
    label: 'Investment',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  {
    value: 'debt',
    label: 'Debt',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
]

// Contribution-frequency options for the select dropdown (Story 16-2).
// Reuses the shared frequency enum; the normalization engine converts to a monthly
// base for all timeline/projection math.
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

// Human-readable label for a stored frequency value (falls back to the raw value).
const frequencyLabel = (frequency: Frequency): string =>
  FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency

/**
 * Column labels for the sortable header cells and the mobile "Sorted by
 * {Column}" notice, so the two cannot drift apart (story 34.2).
 */
/** Module scope: the factory takes no arguments and closes over nothing, so a
 * per-instance `useMemo` would allocate an identical object on every mount. */
const BALANCE_SORT_EXTRACTORS = createBalanceSortExtractors()

const SORT_COLUMN_LABELS: Record<BalanceSortKey, string> = {
  type: 'Type',
  name: 'Name',
  currentBalance: 'Current Balance',
  maxContribution: 'Max Contribution',
  remainingRoom: 'Remaining Room',
  contribution: 'Contribution',
}

export function BalancePage() {
  const balanceEntries = useBalanceEntries()
  const totalInvestments = useTotalInvestments()
  const totalDebts = useTotalDebts()
  // Story 32.2 (FR59): net worth is investments + savings − debts, read through
  // the one shared hook so this card can never disagree with the Overview. The
  // savings total is also displayed in its own card below — a savings-inclusive
  // net worth sitting beside only Investments and Debts reads as broken
  // arithmetic, so the contributing figure has to be on screen too.
  const totalSavings = useTotalSavings()
  const netWorth = useNetWorth()
  // Story 26.5: the investment-only slice for the "Investment Accounts" breakdown.
  // Derived from the already-subscribed entries (no new store selector); the section
  // re-renders on any store change, which is what makes its live update free. The
  // combined total below reuses `totalInvestments` (= useTotalInvestmentBalance) so
  // the breakdown total and the "Total Investments" stat card are the same number.
  const investmentAccounts = balanceEntries.filter((entry) => entry.type === 'investment')
  const { addBalanceEntry, updateBalanceEntry, deleteBalanceEntry, moveBalanceEntry } =
    useBalanceStore()

  // Column sorting for the EDITABLE table only (story 34.2, FR61). A VIEW-level
  // projection: it never writes `sortOrder`, never calls a move action and never
  // enqueues a sync operation.
  //
  // ⚠️ Scoped to this one table on purpose. `investmentAccounts` above is a
  // `.filter` of the SAME array, and a filter preserves the relative order of
  // whatever it is given — so hoisting this projection to page level would
  // silently reorder the read-only Investment Accounts breakdown too. The
  // breakdown stays in manual order at all times.
  //
  // ⚠️ Only `contribution` is frequency-normalized. `currentBalance` is a
  // point-in-time STOCK (and may be negative for a debt), so normalizing it
  // would contradict the stat cards above.
  const sortExtractors = BALANCE_SORT_EXTRACTORS
  const sort = useTableSort(balanceEntries, sortExtractors)
  const sortedRows = sort.rows
  // Amounts are stored in cents; the formatter respects the user's currency
  // display preference (currency-less vs explicit symbols) from the store.
  const formatAmount = useFormattedAmount()
  // Currency preferences drive the input symbol affordance and locale-aware
  // grouping/parsing (story 14-3). Currency-less mode shows no symbol and groups
  // with the neutral en-US locale (per the store).
  const { mode, currency, locale } = useCurrencyPreferences()

  // Re-echo an amount field in grouped, locale-aware form on blur. Both guard arms
  // are load-bearing and must stay: the empty arm keeps "not filled in" from
  // becoming "entered zero", and the no-digit arm keeps the digit-free partials
  // sanitizeMoneyInput deliberately allows through (story 28-1) VISIBLE — without
  // it a half-typed "-" would silently become "0.00" under the user's cursor.
  const reformatAmountOnBlur = (value: string, setter: (v: string) => void) => {
    if (value.trim() === '' || !/\d/.test(value)) return
    setter(formatForInputDisplay(parseFromInput(value, locale), locale))
  }

  // State for the add/edit modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  // uuid PK (Story 5-14) — ids are strings, not numbers.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [type, setType] = useState<FinanceType>('investment')
  const [name, setName] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [maxContributionLimit, setMaxContributionLimit] = useState('')
  const [monthlyContribution, setMonthlyContribution] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('monthly')

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'currentBalance' | 'maxContributionLimit' | 'monthlyContribution'
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const hasFieldError = (field: FieldName): boolean => Boolean(errors[field])
  const getFieldError = (field: FieldName): string | undefined => errors[field]

  // Compute inline validation errors from the current field values, preserving
  // the exact conditions, optional-field semantics and messages that previously
  // drove the alert() popups.
  const computeErrors = useCallback((): Partial<Record<FieldName, string>> => {
    const next: Partial<Record<FieldName, string>> = {}
    if (!name.trim()) {
      next.name = 'Please enter a name for the balance entry'
    }
    const balanceInCents = parseFromInput(currentBalance, locale)
    if (balanceInCents < 0) {
      next.currentBalance = 'Please enter a valid non-negative current balance'
    }
    // Max contribution limit is optional and investment-only: empty is valid,
    // only validate a provided value on an investment (the field is hidden for
    // debts — a debt has no contribution limit — so never block a debt submit on
    // a stale value).
    if (type === 'investment' && maxContributionLimit && maxContributionLimit.trim() !== '') {
      const parsed = parseFromInput(maxContributionLimit, locale)
      if (parsed < 0) {
        next.maxContributionLimit = 'Please enter a valid non-negative max contribution limit'
      }
    }
    const monthlyInCents = parseFromInput(monthlyContribution, locale)
    if (monthlyInCents < 0) {
      next.monthlyContribution = 'Please enter a valid non-negative monthly contribution'
    }
    return next
  }, [type, name, currentBalance, maxContributionLimit, monthlyContribution, locale])

  const clearErrors = () => {
    setErrors({})
    setSubmitAttempted(false)
  }

  // Reset form state when modal opens or editingId changes
  useEffect(() => {
    if (isModalOpen) {
      if (editingId === null) {
        // Adding new: reset all fields
        setType('investment')
        setName('')
        setCurrentBalance('')
        setMaxContributionLimit('')
        setMonthlyContribution('')
      }
      // Editing: fields are set by openEditModal
    }
  }, [isModalOpen, editingId])

  // After the first submit attempt, re-validate as the user edits so errors
  // clear on correction (AC-3).
  useEffect(() => {
    if (submitAttempted) {
      setErrors(computeErrors())
    }
  }, [submitAttempted, computeErrors])

  // Ref for the "Add Balance Entry" trigger so the modal can restore focus to
  // it on close (accessibility), matching the sibling money pages.
  const addButtonRef = useRef<HTMLButtonElement>(null)

  // Open modal for adding new balance entry
  const openAddModal = () => {
    setEditingId(null)
    clearErrors()
    setIsModalOpen(true)
  }

  // Open modal for editing existing balance entry
  const openEditModal = (entry: {
    id: string
    type: FinanceType
    name: string
    currentBalance: number
    maxContributionLimit: number | null
    monthlyContribution: number
    frequency: Frequency
  }) => {
    setEditingId(entry.id)
    setType(entry.type)
    setName(entry.name)
    setCurrentBalance(formatForInputDisplay(entry.currentBalance, locale))
    setMaxContributionLimit(
      entry.maxContributionLimit !== null
        ? formatForInputDisplay(entry.maxContributionLimit, locale)
        : ''
    )
    setMonthlyContribution(formatForInputDisplay(entry.monthlyContribution, locale))
    setFrequency(entry.frequency ?? 'monthly')
    clearErrors()
    setIsModalOpen(true)
  }

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
    setType('investment')
    setName('')
    setCurrentBalance('')
    setMaxContributionLimit('')
    setMonthlyContribution('')
    setFrequency('monthly')
    clearErrors()
  }

  // Loading state to prevent duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete confirmation state (themed dialog replaces browser confirm()). Focus
  // returns to the list heading after a confirmed delete removes the triggering
  // row (the Add button is a separate focus target used on modal close).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const listHeadingRef = useRef<HTMLHeadingElement>(null)
  const pendingDeleteName = balanceEntries.find((e) => e.id === pendingDeleteId)?.name ?? ''

  // Handle form submission (add or update)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)
    setIsSubmitting(true)

    try {
      // Validate all fields inline; block submission if any errors exist.
      const validationErrors = computeErrors()
      setErrors(validationErrors)
      if (Object.keys(validationErrors).length > 0) {
        return
      }

      // A contribution limit is an investment-only concept — a debt never carries
      // one. Force null for debts so a new debt, an investment→debt switch, or
      // saving a legacy debt that already had a limit all persist no limit.
      const maxLimitInCents =
        type === 'investment' && maxContributionLimit && maxContributionLimit.trim() !== ''
          ? parseFromInput(maxContributionLimit, locale)
          : null

      const newEntry = {
        type,
        name: name.trim(),
        currentBalance: parseFromInput(currentBalance, locale),
        maxContributionLimit: maxLimitInCents,
        monthlyContribution: parseFromInput(monthlyContribution, locale),
        frequency,
      }

      if (editingId !== null) {
        updateBalanceEntry(editingId, newEntry)
      } else {
        addBalanceEntry(newEntry)
      }

      closeModal()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Open the themed delete confirmation for a balance entry
  const handleDelete = (id: string) => {
    setPendingDeleteId(id)
  }

  // Confirm and execute the pending delete
  const confirmDelete = () => {
    if (pendingDeleteId !== null) {
      deleteBalanceEntry(pendingDeleteId)
      setPendingDeleteId(null)
    }
  }

  // Get type label and color for display
  const getTypeDisplay = (type: FinanceType) => {
    const option = TYPE_OPTIONS.find((o) => o.value === type)
    return option
      ? option
      : { label: type, color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' }
  }

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <div>
            <h1 className="font-bold text-heading text-3xl">Balance Tracking</h1>
            <p className="mt-2 text-body">
              Monitor your investments and debts, and see your net worth including savings
            </p>
          </div>
        </header>

        <main className="space-y-6">
          {/* Stats Cards */}
          <section className="surface shadow-md p-6 rounded-lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-semibold text-subheading text-xl">Financial Overview</h2>
              <button
                ref={addButtonRef}
                type="button"
                onClick={openAddModal}
                data-testid="balance-add-button"
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-md text-white transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              >
                + Add Balance Entry
              </button>
            </div>
            {/* Four cards, not three (story 32.2): Investments + Savings − Debts
                = Net Worth, so the arithmetic the user can see adds up.
                ⚠️ Breakpoints are MEASURED, not guessed (code review 32.2): a bold
                `text-2xl` figure like "-$127,000.00" needs ~145px and has no wrap
                opportunity, and `grid-cols-*` uses `minmax(0,1fr)` so a column
                shrinks below its content and CLIPS rather than overflowing the page
                — which is why no page-level overflow test could see it. Going 4-up
                at `md` gave each card 120px at 768px and clipped three of the four
                figures. 4-up therefore starts at `lg` (1024px → 168px needed, 200px
                available); `md` keeps the 2-up layout, and 1-up holds at the 320px
                floor. */}
            <div className="gap-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Total Investments</p>
                <p
                  className="mt-1 font-bold text-green-600 dark:text-green-400 text-2xl"
                  data-testid="stat-total-investments"
                >
                  {formatAmount(totalInvestments)}
                </p>
              </div>
              {/* Read-only: savings are entered on /savings, so this card shows the
                  figure and points there rather than offering a second entry path. */}
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">
                  Total Savings{' '}
                  <a
                    href="/savings"
                    className="text-blue-600 text-xs underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Savings page
                  </a>
                </p>
                <p
                  className="mt-1 font-bold text-blue-600 dark:text-blue-400 text-2xl"
                  data-testid="stat-total-savings"
                >
                  {formatAmount(totalSavings)}
                </p>
              </div>
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Total Debts</p>
                <p
                  className="mt-1 font-bold text-red-600 dark:text-red-400 text-2xl"
                  data-testid="stat-total-debts"
                >
                  {formatAmount(totalDebts)}
                </p>
              </div>
              <div className="surface-inset p-4 rounded-lg">
                <p className="text-muted text-sm">Net Worth</p>
                <p
                  data-testid="stat-net-worth"
                  className={`text-2xl font-bold mt-1 ${
                    netWorth >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatAmount(netWorth)}
                </p>
              </div>
            </div>
          </section>

          {/* Investment Accounts breakdown (Story 26.5) — investment-type accounts
              grouped with a combined total, the way the source spreadsheet lays out
              RRSP / Work RRSP / TFSA. The combined total renders `totalInvestments`
              (= useTotalInvestmentBalance) — the SAME selector behind the "Total
              Investments" stat card above — so the two are provably equal (no
              re-summing, no divergence). Investment-only, so no per-row type guard. */}
          <section
            className="surface shadow-md p-6 rounded-lg"
            data-testid="investment-breakdown"
            aria-labelledby="investment-breakdown-heading"
          >
            <h2
              id="investment-breakdown-heading"
              className="mb-6 font-semibold text-subheading text-xl"
            >
              Investment Accounts
            </h2>

            {investmentAccounts.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No investment accounts yet</p>
                <p className="text-faint text-sm">
                  Add an account with type Investment to see it grouped here
                </p>
              </div>
            ) : (
              <div className={RESPONSIVE_WRAPPER_CLASS}>
                <table className={RESPONSIVE_TABLE_CLASS}>
                  <thead className={RESPONSIVE_THEAD_CLASS}>
                    <tr>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Account
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Current Balance
                      </th>
                      <th className="px-6 py-3 font-medium text-muted text-xs text-left uppercase tracking-wider">
                        Remaining Room
                      </th>
                    </tr>
                  </thead>
                  <tbody className={RESPONSIVE_TBODY_CLASS}>
                    {investmentAccounts.map((entry) => {
                      // Every row here is an investment (pre-filtered), so no
                      // `type === 'investment'` guard is needed — just the Story 26.4
                      // three-state room contract: null → "—", else formatted.
                      const room = remainingContributionRoom(entry)
                      return (
                        <tr key={entry.id} className={RESPONSIVE_ROW_CLASS}>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Account</FieldLabel>
                            <div className="font-medium text-heading text-sm">{entry.name}</div>
                          </td>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Current Balance</FieldLabel>
                            <div
                              className="text-muted text-sm"
                              data-testid={`investment-breakdown-balance-${entry.id}`}
                            >
                              {formatAmount(entry.currentBalance)}
                            </div>
                          </td>
                          <td className={RESPONSIVE_CELL_CLASS}>
                            <FieldLabel>Remaining Room</FieldLabel>
                            <div
                              className="text-muted text-sm"
                              data-testid={`investment-breakdown-room-${entry.id}`}
                            >
                              {room === null ? '—' : formatAmount(room)}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {/* Below `sm` this footer becomes a one-line summary strip, not
                      a card: label left, total right. The <tfoot> must switch to
                      `block` alongside the <tbody> — leaving it as
                      `table-footer-group` while the body is `block` would leave
                      one table holding both block and table-internal subtrees. */}
                  <tfoot className={RESPONSIVE_TFOOT_CLASS}>
                    <tr className={RESPONSIVE_FOOTER_ROW_CLASS}>
                      <th
                        scope="row"
                        className={`${RESPONSIVE_FOOTER_CELL_CLASS} font-semibold text-heading text-sm text-left`}
                      >
                        Combined Total
                      </th>
                      <td
                        className={`${RESPONSIVE_FOOTER_CELL_CLASS} font-semibold text-heading text-sm whitespace-nowrap`}
                      >
                        <span data-testid="investment-breakdown-total">
                          {formatAmount(totalInvestments)}
                        </span>
                      </td>
                      {/* Empty filler cell keeps the footer row structurally 3-wide
                          (matching the 3-column head). Left as a real (empty) data
                          cell — inert to assistive tech — rather than aria-hidden,
                          which would drop the column from the accessibility tree.
                          `max-sm:hidden` is a display change, not a removal: the
                          cell stays in the DOM and returns at >= 640px. */}
                      <td className={`${RESPONSIVE_FOOTER_CELL_CLASS} max-sm:hidden`} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Balance Entries List */}
          <section className="surface shadow-md p-6 rounded-lg">
            <h2
              ref={listHeadingRef}
              tabIndex={-1}
              className="mb-6 font-semibold text-subheading text-xl rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Your Balance Entries
            </h2>

            {balanceEntries.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No balance entries recorded yet</p>
                <p className="text-faint text-sm">Click "Add Balance Entry" to get started</p>
              </div>
            ) : (
              <>
                {/* The mobile escape hatch (story 34.2, decision 7): a sort can
                    only be STARTED at >= 640px but survives a narrow, where the
                    `<thead>` is `display: none` and the move arrows are
                    disabled. Rendered only when a sort exists. */}
                {sort.state !== null && (
                  <TableSortNotice
                    columnLabel={SORT_COLUMN_LABELS[sort.state.key]}
                    onClear={sort.clear}
                  />
                )}
                <div className={RESPONSIVE_WRAPPER_CLASS}>
                  <table className={RESPONSIVE_TABLE_CLASS}>
                    <thead className={RESPONSIVE_THEAD_CLASS}>
                      <tr>
                        {/* Sortable headers (story 34.2) for the EDITABLE table
                          only. Each `<th>`'s text content stays EXACTLY the
                          column label — the indicator is an aria-hidden <svg>. */}
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.type}
                          ariaSort={sort.ariaSort('type')}
                          onToggle={() => sort.toggle('type')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.name}
                          ariaSort={sort.ariaSort('name')}
                          onToggle={() => sort.toggle('name')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.currentBalance}
                          ariaSort={sort.ariaSort('currentBalance')}
                          onToggle={() => sort.toggle('currentBalance')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.maxContribution}
                          ariaSort={sort.ariaSort('maxContribution')}
                          onToggle={() => sort.toggle('maxContribution')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.remainingRoom}
                          ariaSort={sort.ariaSort('remainingRoom')}
                          onToggle={() => sort.toggle('remainingRoom')}
                        />
                        <SortableColumnHeader
                          label={SORT_COLUMN_LABELS.contribution}
                          ariaSort={sort.ariaSort('contribution')}
                          onToggle={() => sort.toggle('contribution')}
                        />
                        {/* Not sortable: no button, and no `aria-sort` at all. */}
                        <th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={RESPONSIVE_TBODY_CLASS}>
                      {sortedRows.map((entry, index) => {
                        const typeDisplay = getTypeDisplay(entry.type)
                        return (
                          <tr key={entry.id} className={RESPONSIVE_ROW_CLASS}>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Type</FieldLabel>
                              <span
                                className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${typeDisplay.color}`}
                              >
                                {typeDisplay.label}
                              </span>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Name</FieldLabel>
                              <div className="font-medium text-heading text-sm">{entry.name}</div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Current Balance</FieldLabel>
                              <div className="text-muted text-sm">
                                {formatAmount(entry.currentBalance)}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Max Contribution</FieldLabel>
                              <div className="text-muted text-sm">
                                {/* Contribution limit is investment-only (FR41);
                                  debts show None, and a legacy null/undefined
                                  limit also reads None (loose != null). */}
                                {entry.type === 'investment' && entry.maxContributionLimit != null
                                  ? formatAmount(entry.maxContributionLimit)
                                  : 'None'}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Remaining Room</FieldLabel>
                              <div
                                className="text-muted text-sm"
                                data-testid={`balance-remaining-room-${entry.id}`}
                              >
                                {/* Remaining contribution room is investment-only
                                  (FR41) — debts show the em-dash placeholder. */}
                                {entry.type === 'investment'
                                  ? (() => {
                                      const room = remainingContributionRoom(entry)
                                      return room === null ? '—' : formatAmount(room)
                                    })()
                                  : '—'}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Contribution</FieldLabel>
                              {/* The amount and its cadence sub-label are ONE field.
                                Wrapped together so the cell has exactly two flex
                                children below `sm` (label + value), not three —
                                otherwise `justify-between` would fling the cadence
                                to the far edge as a third column. */}
                              <div>
                                <div className="text-muted text-sm">
                                  {formatAmount(entry.monthlyContribution)}
                                </div>
                                <div className="text-faint text-xs">
                                  {frequencyLabel(entry.frequency)}
                                </div>
                              </div>
                            </td>
                            <td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
                              <FieldLabel>Actions</FieldLabel>
                              <div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
                                <RowMoveControls
                                  label={entry.name}
                                  isFirst={index === 0}
                                  isLast={index === sortedRows.length - 1}
                                  disabled={sort.state !== null}
                                  onMove={(direction) => moveBalanceEntry(entry.id, direction)}
                                />
                                <button
                                  type="button"
                                  onClick={() => openEditModal(entry)}
                                  aria-label={`Edit ${entry.name}`}
                                  className={`mr-4 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(entry.id)}
                                  aria-label={`Delete ${entry.name}`}
                                  className={`text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </main>

        {/* Add/Edit Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          labelledBy="balance-modal-title"
          finalFocusRef={addButtonRef}
          className="bg-white dark:bg-gray-800 dark:text-gray-100 shadow-xl p-6 rounded-lg w-full max-w-md"
        >
          <div className="flex justify-between items-center mb-6">
            <h3 id="balance-modal-title" className="font-medium text-heading text-lg">
              {editingId !== null ? 'Edit Balance Entry' : 'Add Balance Entry'}
            </h3>
            <button
              type="button"
              onClick={closeModal}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close"
            >
              <svg
                aria-hidden="true"
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="type" className="block mb-1 font-medium text-label text-sm">
                Type *
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as FinanceType)}
                className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
                required
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="name" className="block mb-1 font-medium text-label text-sm">
                Name *
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 401k, Student Loan, Credit Card"
                className={`shadow-sm px-3 py-2 border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                  hasFieldError('name')
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                }`}
                aria-invalid={hasFieldError('name')}
                aria-required
                aria-describedby={hasFieldError('name') ? 'balance-name-error' : undefined}
                data-testid="balance-name-input"
              />
              {hasFieldError('name') && (
                <p
                  id="balance-name-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-name-error"
                >
                  {getFieldError('name')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="currentBalance" className="block mb-1 font-medium text-label text-sm">
                Current Balance *
              </label>
              <div className="relative shadow-sm rounded-md">
                {mode === 'symbol' && (
                  <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                    <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                  </div>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  id="currentBalance"
                  value={currentBalance}
                  onChange={(e) => setCurrentBalance(sanitizeMoneyChange(e.target, locale))}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setCurrentBalance)}
                  placeholder="0.00"
                  className={`shadow-sm px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('currentBalance')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  aria-invalid={hasFieldError('currentBalance')}
                  aria-required
                  aria-describedby={
                    hasFieldError('currentBalance') ? 'balance-current-balance-error' : undefined
                  }
                  data-testid="balance-current-balance-input"
                />
              </div>
              {hasFieldError('currentBalance') && (
                <p
                  id="balance-current-balance-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-current-balance-error"
                >
                  {getFieldError('currentBalance')}
                </p>
              )}
              {/* Story 36.3 (UX-DR40). Debts only: this one input carries the
                  amount still owed, and the field name alone does not say so.
                  It also sends the recurring payment to the Expenses page,
                  where it is the only place it counts against cash flow — a
                  debt's Contribution value reaches no cash-flow calculation.
                  Deliberately says where the payment IS counted rather than
                  telling anyone to leave Contribution blank, since that field
                  is still shown and still labelled required. `text-muted` (not
                  the `text-faint` used elsewhere) because gray-400 on the white
                  modal card measures 2.54:1, below WCAG AA. */}
              {type === 'debt' && (
                <p className="mt-1 text-xs text-muted" data-testid="balance-debt-hint">
                  Enter what you still owe today. Record the recurring payment on the Expenses page
                  — that's where it counts against your cash flow.
                </p>
              )}
            </div>

            {/* A contribution limit applies only to investment/retirement
                accounts — a debt has none (FR41), so hide the field for debts. */}
            {type === 'investment' && (
              <div>
                <label
                  htmlFor="maxContributionLimit"
                  className="block mb-1 font-medium text-label text-sm"
                >
                  Max Contribution Limit (Optional)
                </label>
                <div className="relative shadow-sm rounded-md">
                  {mode === 'symbol' && (
                    <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                      <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                    </div>
                  )}
                  <input
                    type="text"
                    inputMode="decimal"
                    id="maxContributionLimit"
                    value={maxContributionLimit}
                    onChange={(e) => setMaxContributionLimit(sanitizeMoneyChange(e.target, locale))}
                    onBlur={(e) => reformatAmountOnBlur(e.target.value, setMaxContributionLimit)}
                    placeholder="0.00"
                    className={`shadow-sm px-3 py-2 ${
                      mode === 'symbol' ? 'pl-7' : ''
                    } border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                      hasFieldError('maxContributionLimit')
                        ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                        : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                    }`}
                    aria-invalid={hasFieldError('maxContributionLimit')}
                    aria-describedby={
                      hasFieldError('maxContributionLimit')
                        ? 'balance-max-contribution-error'
                        : undefined
                    }
                    data-testid="balance-max-contribution-input"
                  />
                </div>
                {hasFieldError('maxContributionLimit') && (
                  <p
                    id="balance-max-contribution-error"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                    role="alert"
                    data-testid="balance-max-contribution-error"
                  >
                    {getFieldError('maxContributionLimit')}
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="monthlyContribution"
                className="block mb-1 font-medium text-label text-sm"
              >
                Contribution *
              </label>
              <div className="relative shadow-sm rounded-md">
                {mode === 'symbol' && (
                  <div className="left-0 absolute inset-y-0 flex items-center pl-3 pointer-events-none">
                    <span className="text-muted text-sm">{currencySymbol(currency)}</span>
                  </div>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  id="monthlyContribution"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(sanitizeMoneyChange(e.target, locale))}
                  onBlur={(e) => reformatAmountOnBlur(e.target.value, setMonthlyContribution)}
                  placeholder="0.00"
                  className={`shadow-sm px-3 py-2 ${
                    mode === 'symbol' ? 'pl-7' : ''
                  } border rounded-md focus:outline-none focus:ring-2 w-full dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
                    hasFieldError('monthlyContribution')
                      ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 dark:border-gray-600 focus:border-purple-500 focus:ring-purple-500'
                  }`}
                  aria-invalid={hasFieldError('monthlyContribution')}
                  aria-required
                  aria-describedby={
                    hasFieldError('monthlyContribution')
                      ? 'balance-monthly-contribution-error'
                      : undefined
                  }
                  data-testid="balance-monthly-contribution-input"
                />
              </div>
              {hasFieldError('monthlyContribution') && (
                <p
                  id="balance-monthly-contribution-error"
                  className="mt-1 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                  data-testid="balance-monthly-contribution-error"
                >
                  {getFieldError('monthlyContribution')}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="frequency" className="block mb-1 font-medium text-label text-sm">
                Contribution Frequency *
              </label>
              <select
                id="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="shadow-sm px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:border-purple-500 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 w-full"
                required
                data-testid="balance-frequency-select"
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="hover:bg-gray-50 dark:hover:bg-gray-700 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-md text-white disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingId !== null
                    ? 'Save Changes'
                    : 'Add Balance Entry'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Delete confirmation */}
        <ConfirmDialog
          isOpen={pendingDeleteId !== null}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
          finalFocusRef={listHeadingRef}
          message={
            <>
              Are you sure you want to delete
              {pendingDeleteName ? ` "${pendingDeleteName}"` : ' this balance entry'}? This cannot
              be undone.
            </>
          }
        />
      </div>
    </div>
  )
}
