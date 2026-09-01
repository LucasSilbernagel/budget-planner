import {
  currencySymbol,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import type { Frequency } from '@budget-planner/db'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNetWorth } from '../hooks/useNetWorth'
import { useStoresHydrated } from '../hooks/useStoresHydrated'
import { useTableSort } from '../hooks/useTableSort'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { type BalanceSortKey, createBalanceSortExtractors } from '../lib/table-sort-keys'
import {
  useBalanceEntries,
  useBalanceStore,
  useTotalAssetBalance as useTotalAssets,
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
  RESPONSIVE_HEADER_CELL_RIGHT_CLASS,
  RESPONSIVE_ROW_CLASS,
  RESPONSIVE_SCROLL_SHADOW_CLASS,
  RESPONSIVE_TABLE_CLASS,
  RESPONSIVE_TBODY_CLASS,
  RESPONSIVE_THEAD_CLASS,
  RESPONSIVE_WRAPPER_CLASS,
} from './ui/ResponsiveTable'
import { PencilIcon, TrashIcon } from './ui/RowActionIcons'
import { EmptyStateSkeleton, LoadingStatus, PendingFigure } from './ui/Skeleton'
import { SortableColumnHeader } from './ui/SortableColumnHeader'
import { TableSortControl } from './ui/TableSortControl'

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
  {
    // Story 43.4 / FR70 / D10. "Asset" — something owned outright: a property,
    // a vehicle, or a cash holding. Amber keeps it distinct from investment's
    // green and debt's red in BOTH themes.
    value: 'asset',
    label: 'Asset',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
]

/**
 * Compile-time proof that every `FinanceType` has an option above.
 *
 * ⚠️ A `satisfies readonly FinanceType[]` on the array would NOT do this — a
 * short list is assignable, so a missing type compiles clean. This `Exclude`
 * catches the omission, which is the direction that actually bites: a type with
 * no option is unreachable in the UI and renders as a grey pill showing the raw
 * enum string via `getTypeDisplay`'s fallback.
 */
type _AllTypesHaveAnOption = Exclude<
  FinanceType,
  (typeof TYPE_OPTIONS)[number]['value']
> extends never
  ? true
  : never
const _optionCoverage: _AllTypesHaveAnOption = true
void _optionCoverage

/**
 * Name-field examples, one set per finance type (Story 52.1, UX-DR58).
 *
 * The form asked for a type and then showed ONE fixed list that mixed all three —
 * it offered a debt example and a credit-card example to someone who had just
 * chosen Investment, and it led with a US-only retirement account.
 *
 * ⚠️ Every noun here is a descriptive common noun, never a statutory scheme or a
 * single-country product: 401k / IRA / Roth / HSA / 529 (US), TFSA / RRSP (CA),
 * ISA / Premium Bonds (UK) and Superannuation (AU/NZ) are all out. So are
 * "Brokerage" and "Mutual Fund", which are US/CA idiom for what the UK calls an
 * investment account and a unit trust.
 *
 * ⚠️ NO CASH EXAMPLE ON THIS ARM, deliberately, and this is a REVERSAL. The story
 * first shipped "Cash Holding" — reasoning that it avoided "Cash Savings" because a
 * savings-shaped example would contradict the asset hint below. Review showed that
 * fixed the WORD and not the concept: the hint (`balance-asset-hint`) defines an
 * asset as something whose "value here changes as it appreciates, not as you
 * contribute", and a cash holding changes precisely as you contribute. The two
 * strings shipped in the same render disagreed.
 *
 * It was also a double-count invitation. A goal-less account balance already lives
 * on the Savings page, and `net-worth.ts` adds `savingsCents` and `assetsCents` as
 * SEPARATE addends — so a cash balance recorded in both places is counted twice,
 * with nothing on either form to disambiguate.
 *
 * "Artwork" is owned outright, appreciates (so it matches the hint rather than
 * contradicting it), is jurisdiction-neutral, has no US/UK spelling split, and has
 * no competing home anywhere else in the app. ⚠️ The epic sanctioned "cash savings"
 * for this arm; that is amended by addition at UX-DR58, not silently ignored.
 */
const NAME_PLACEHOLDERS = {
  investment: 'e.g., Investment Account, Pension, Index Fund',
  debt: 'e.g., Mortgage, Car Loan, Credit Card',
  asset: 'e.g., Property, Vehicle, Artwork',
} as const satisfies Record<FinanceType, string>

/**
 * Compile-time proof that every `FinanceType` has a placeholder above.
 *
 * ⚠️ This is NOT the same case as `_AllTypesHaveAnOption`, and the difference was
 * measured rather than assumed (tsc 5.9.3, `--strict`). The rule is
 * assignability-vs-required-keys, not `satisfies`-vs-`Exclude`:
 *
 *   ['investment', 'debt'] as const satisfies readonly FinanceType[]        -> NO ERROR
 *   { investment, debt }   as const satisfies Record<FinanceType, string>   -> TS1360
 *
 * A short TUPLE is assignable, so `satisfies` cannot see the omission — that is
 * the array case above, and story 43.4's "exactly one compiler error monorepo-wide"
 * lesson is about it. A `Record` REQUIRES every key, so the `satisfies` on this map
 * already rejects a missing type on its own.
 *
 * The alias is kept for ONE honest reason: it matches the pattern this file documents
 * directly above. Two narrower claims made in review were MEASURED AND REFUTED, and are
 * recorded here rather than quietly dropped:
 *
 *   - It does NOT survive an ANNOTATION.
 *     `const M: Partial<Record<FinanceType, string>> = { investment, debt }` makes
 *     `keyof typeof M` equal `FinanceType`, so `Exclude` collapses to `never` and the
 *     alias resolves to `true` — SILENTLY. It does still fire under
 *     `as const satisfies Partial<Record<...>>`, which keeps the literal keys.
 *   - It is COMPILE-TIME ONLY. It cannot see a `type` that is outside `FinanceType` at
 *     runtime, which is reachable: neither the persist `migrate` nor the sync-pull path
 *     validates `type`. That hole is closed by the `??` fallback at the call site, not
 *     by this alias.
 *
 * ⚠️ THIS COMMENT DELIBERATELY NAMES THE BANNED TOKENS ABOVE. Scope any jurisdiction
 * guard to the three STRINGS — a file-level absence sweep over `BalancePage.tsx` will
 * fail on the comment that documents the ban.
 */
type _AllTypesHaveAPlaceholder = Exclude<FinanceType, keyof typeof NAME_PLACEHOLDERS> extends never
  ? true
  : never
const _placeholderCoverage: _AllTypesHaveAPlaceholder = true
void _placeholderCoverage

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
 * Column labels for the sortable header cells and the mobile sort control's
 * options, so the two cannot drift apart (story 34.2; the mobile consumer became
 * `TableSortControl` in story 48.1).
 */
/** Module scope: the factory takes no arguments and closes over nothing, so a
 * per-instance `useMemo` would allocate an identical object on every mount. */
const BALANCE_SORT_EXTRACTORS = createBalanceSortExtractors()

const SORT_COLUMN_LABELS: Record<BalanceSortKey, string> = {
  type: 'Type',
  name: 'Name',
  // Story 49.1 (FR75): one label covers all three finance types — an asset has a
  // VALUE, not a balance. The object KEY, the `BalanceSortKey` member, the DOM id
  // and every `data-testid` deliberately stay `currentBalance`: renaming the label
  // is a copy change, renaming the value is a sync/e2e change.
  currentBalance: 'Current Balance/Value',
  contribution: 'Contribution',
}

/**
 * The sortable columns, in the order the headers render them (story 48.1).
 *
 * ⚠️ Module scope: this table has no tier gate, so the set is fixed and a
 * per-instance `useMemo` would allocate an identical array on every mount —
 * and `TableSortControl` memoises its options on this identity.
 *
 * Labels are read from `SORT_COLUMN_LABELS` rather than written out a second
 * time, so a header and its mobile option cannot drift apart.
 */
const BALANCE_SORT_COLUMNS: readonly { key: BalanceSortKey; label: string }[] = [
  { key: 'type', label: SORT_COLUMN_LABELS.type },
  { key: 'name', label: SORT_COLUMN_LABELS.name },
  { key: 'currentBalance', label: SORT_COLUMN_LABELS.currentBalance },
  { key: 'contribution', label: SORT_COLUMN_LABELS.contribution },
]

export function BalancePage() {
  const balanceEntries = useBalanceEntries()
  const totalInvestments = useTotalInvestments()
  const totalDebts = useTotalDebts()
  const totalAssets = useTotalAssets()
  // Story 32.2 (FR59): net worth is investments + savings − debts, read through
  // the one shared hook so this card can never disagree with the Overview. The
  // savings total is also displayed in its own card below — a savings-inclusive
  // net worth sitting beside only Investments and Debts reads as broken
  // arithmetic, so the contributing figure has to be on screen too.
  const totalSavings = useTotalSavings()
  const netWorth = useNetWorth()
  const { addBalanceEntry, updateBalanceEntry, deleteBalanceEntry } = useBalanceStore()

  // Column sorting for the entries table (story 34.2, FR61). A VIEW-level
  // projection: it never writes `sortOrder` and never enqueues a sync operation,
  // so clearing it returns the table to the default order untouched.
  //
  // ⚠️ Deliberately local to this component, not hoisted to page level. It is a
  // projection over the store's array, so anything else that read a hoisted
  // `sortedRows` would silently inherit this table's column order instead of the
  // manual `sortOrder` the store actually holds. Keeping it here means the sort
  // cannot reach a surface that never asked for it.
  //
  // ⚠️ Only `contribution` is frequency-normalized. `currentBalance` is a
  // point-in-time STOCK (and may be negative for a debt), so normalizing it
  // would contradict the stat cards above.
  const sortExtractors = BALANCE_SORT_EXTRACTORS
  const sort = useTableSort('balance', balanceEntries, sortExtractors)
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
  const [monthlyContribution, setMonthlyContribution] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  // Story 45.1 (FR72), broadened by 47.1 (FR73): the user's statement that this
  // contribution is already allowed for in their figures — either because it comes out of
  // their pay before it reaches them, or because they also list it on the Expenses page —
  // so the Savings distributable pool must not deduct it a second time.
  const [contributionRecordedAsExpense, setContributionRecordedAsExpense] = useState(false)

  // Inline field-validation error state (replaces browser alert() popups).
  // Mirrors the app's canonical inline-validation pattern: an errors map plus
  // hasFieldError/getFieldError helpers and re-validate-on-change after the
  // first submit attempt.
  type FieldName = 'name' | 'currentBalance' | 'monthlyContribution'
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
    // Story 43.4 (D2): the contribution field is hidden for assets, so never
    // block an asset submit on a stale value left over from a type switch.
    if (type !== 'asset') {
      const monthlyInCents = parseFromInput(monthlyContribution, locale)
      if (monthlyInCents < 0) {
        next.monthlyContribution = 'Please enter a valid non-negative monthly contribution'
      }
    }
    return next
  }, [type, name, currentBalance, monthlyContribution, locale])

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
        setMonthlyContribution('')
        setContributionRecordedAsExpense(false)
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
  // Takes the stored row itself rather than a hand-copied structural echo of it:
  // a re-stated shape drifts from the store's. (The drift that proved it was on
  // `maxContributionLimit`, a field story 49.1 / FR75 removed.) `Pick` keeps the
  // parameter to the fields this actually reads.
  const openEditModal = (
    entry: Pick<
      ClientBalanceTracking,
      | 'id'
      | 'type'
      | 'name'
      | 'currentBalance'
      | 'monthlyContribution'
      | 'frequency'
      | 'contributionRecordedAsExpense'
    >
  ) => {
    setEditingId(entry.id)
    setType(entry.type)
    setName(entry.name)
    setCurrentBalance(formatForInputDisplay(entry.currentBalance, locale))
    setMonthlyContribution(formatForInputDisplay(entry.monthlyContribution, locale))
    setFrequency(entry.frequency ?? 'monthly')
    // Story 45.1: absent ⇒ unticked ⇒ deducted, matching the pool's own default.
    setContributionRecordedAsExpense(entry.contributionRecordedAsExpense === true)
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
    setMonthlyContribution('')
    setFrequency('monthly')
    setContributionRecordedAsExpense(false)
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

      // Story 43.4 (D2): an asset carries NO contribution. An owned thing changes
      // value by appreciation, not by deposits — recurring saving toward one
      // belongs on the Savings page. Both columns are NOT NULL in the schema, so
      // the FIELDS are hidden but the VALUES are still written.
      // ⚠️ This is also what keeps `/savings` correct: `SavingsPage` sums the
      // `monthlyContribution` of `type === 'investment'` rows into the
      // distributable pool, so an asset that could carry one would overstate the
      // pool and inflate every automatic allocation.
      // ⚠️ KNOWN, DELIBERATE data loss: switching an investment that carries a
      // contribution over to `asset` and saving zeroes it, and switching back does
      // not restore it — the same one-way behaviour the limit gate above has for
      // investment→debt.
      const isAsset = type === 'asset'
      const newEntry = {
        type,
        name: name.trim(),
        currentBalance: parseFromInput(currentBalance, locale),
        monthlyContribution: isAsset ? 0 : parseFromInput(monthlyContribution, locale),
        frequency: isAsset ? ('monthly' as const) : frequency,
        // Story 45.1 (D8): only an investment contribution reaches the pool, so
        // the flag is forced false for every other type. The control is hidden
        // for them too, but this is the PERSISTENCE gate — a stale `true` left
        // over from switching investment→debt would otherwise be saved, and
        // `validateBalanceTracking` would reject the whole write.
        contributionRecordedAsExpense: type === 'investment' && contributionRecordedAsExpense,
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

  // Story 38.2 (UX-DR43): three states — pending, resolved-with-data,
  // resolved-empty. See `hooks/useStoresHydrated` for why this is a mount gate
  // and NOT `persist.hasHydrated()`.
  const hydrated = useStoresHydrated()

  return (
    <div className="surface-sunken p-4 sm:p-8 min-h-screen">
      <div className="mx-auto max-w-4xl">
        {/* Story 38.2, AC-8: ONE announced region per page. Every skeleton on
            this page is `aria-hidden`, so without this a screen reader gets a
            heading followed by nothing; one region per skeleton would announce
            several times instead. */}
        {!hydrated && <LoadingStatus />}
        <header className="mb-8">
          <div>
            <h1 className="font-bold text-heading text-3xl">Balance Tracking</h1>
            <p className="mt-2 text-body">
              Monitor your investments, debts and what you own outright, and see your net worth
              including savings
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
              <div className="surface-inset p-4 lg:px-3 rounded-lg">
                <p className="text-muted text-sm">Total Investments</p>
                <p
                  className="mt-1 font-bold text-green-600 dark:text-green-400 text-2xl"
                  data-testid="stat-total-investments"
                >
                  {hydrated ? (
                    formatAmount(totalInvestments)
                  ) : (
                    <PendingFigure testId="stat-total-investments-skeleton" />
                  )}
                </p>
              </div>
              {/* Read-only: savings are entered on /savings, so this card shows the
                  figure and points there rather than offering a second entry path. */}
              <div className="surface-inset p-4 lg:px-3 rounded-lg">
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
                  {hydrated ? (
                    formatAmount(totalSavings)
                  ) : (
                    <PendingFigure testId="stat-total-savings-skeleton" />
                  )}
                </p>
              </div>
              <div className="surface-inset p-4 lg:px-3 rounded-lg">
                {/* Story 43.4 / D10. "Other Assets", not "Total Assets": this row
                    already shows two other kinds of asset (investments, savings),
                    so the unqualified word would invite the obvious objection that
                    those are assets too. "Other" reads correctly precisely because
                    they sit beside it. */}
                <p className="text-muted text-sm">Other Assets</p>
                <p
                  className="mt-1 font-bold text-amber-600 dark:text-amber-400 text-2xl"
                  data-testid="stat-total-assets"
                >
                  {hydrated ? (
                    formatAmount(totalAssets)
                  ) : (
                    <PendingFigure testId="stat-total-assets-skeleton" />
                  )}
                </p>
              </div>
              <div className="surface-inset p-4 lg:px-3 rounded-lg">
                <p className="text-muted text-sm">Total Debts</p>
                <p
                  className="mt-1 font-bold text-red-600 dark:text-red-400 text-2xl"
                  data-testid="stat-total-debts"
                >
                  {hydrated ? (
                    formatAmount(totalDebts)
                  ) : (
                    <PendingFigure testId="stat-total-debts-skeleton" />
                  )}
                </p>
              </div>
              {/* Story 43.4 / D1: Net Worth spans the full row beneath the four
                  INPUT cards rather than joining them as a fifth peer. Five peers
                  is arithmetically impossible here — the page is capped at
                  `max-w-4xl` (896px), so 5-up yields ~157px per card and ~125px of
                  figure space against the ~145px a bold `text-2xl`
                  "-$127,000.00" needs, and `minmax(0,1fr)` CLIPS rather than
                  overflowing. Spanning also states the arithmetic more plainly:
                  the four inputs add up to the result below them. */}
              <div className="surface-inset sm:col-span-2 lg:col-span-4 p-4 lg:px-3 rounded-lg">
                <p className="text-muted text-sm">Net Worth</p>
                <p
                  data-testid="stat-net-worth"
                  className={`text-2xl font-bold mt-1 ${
                    netWorth >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {hydrated ? (
                    formatAmount(netWorth)
                  ) : (
                    <PendingFigure testId="stat-net-worth-skeleton" />
                  )}
                </p>
              </div>
            </div>
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

            {/* Story 38.2 (UX-DR43): pending is a THIRD state. Before this gate
                the server told a returning user "No balance entries recorded yet" — the store had not
                rehydrated, so the list was empty and the page said so with
                confidence. */}
            {!hydrated ? (
              <EmptyStateSkeleton testId="balance-entries-skeleton" />
            ) : balanceEntries.length === 0 ? (
              <div className="surface-inset p-8 rounded-lg text-center">
                <p className="mb-4 text-muted">No balance entries recorded yet</p>
                <p className="text-faint text-sm">Click "Add Balance Entry" to get started</p>
              </div>
            ) : (
              <>
                {/* The mobile sort control (story 48.1, UX-DR53).

                    ⚠️ This REPLACES `TableSortNotice`, and it renders
                    UNCONDITIONALLY where the notice rendered only while a sort
                    was active. Story 34.2's ratified decision 1 scoped sorting
                    to >= 640px because the `<thead>` is `display: none` below
                    `sm`, so the notice could only ever EXPLAIN and ESCAPE a sort
                    a desktop interaction had already started. This control is
                    the first affordance that can START one on a phone, and
                    manual order is precisely the state it has to be reachable
                    in. `deferred-work.md`'s "Sorting cannot be STARTED below
                    640px" is closed by this story.

                    It drives `sort.select`, the same store slice the headers
                    drive through `sort.toggle` — one source of truth, so a sort
                    chosen on a phone and one chosen on a desktop cannot
                    disagree, and it persists exactly as a header click does. */}
                <TableSortControl
                  label="Sort balance entries"
                  columns={BALANCE_SORT_COLUMNS}
                  state={sort.state}
                  onSelect={sort.select}
                />
                {/* Story 42.2 (UX-DR46): the wrapper is a scrollable REGION, not just a
                    scroll container. `tabindex`/`role`/`aria-label` are unconditional —
                    a region named for its table is meaningful whether or not it happens
                    to be scrolling right now, and making them conditional would need a
                    measurement this layer deliberately does not take. */}
                {/* ⚠️ The suppression below is load-bearing, and its AUTOFIX IS THE HAZARD:
                    biome would DELETE this tabIndex, silently removing the only keyboard
                    route to the Actions column when the table overflows. A scrollable
                    region must be a focus stop (WCAG 2.1.1); the rule does not model
                    scroll containers. role=region + aria-label is the paired carve-out. */}
                <div
                  className={`${RESPONSIVE_WRAPPER_CLASS} ${RESPONSIVE_SCROLL_SHADOW_CLASS}`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region needs a focus stop (WCAG 2.1.1) — see the comment above; the autofix would remove keyboard access
                  tabIndex={0}
                  role="region"
                  aria-label="Balance entries table"
                >
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
                          label={SORT_COLUMN_LABELS.contribution}
                          ariaSort={sort.ariaSort('contribution')}
                          onToggle={() => sort.toggle('contribution')}
                        />
                        {/* Not sortable: no button, and no `aria-sort` at all. */}
                        <th className={RESPONSIVE_HEADER_CELL_RIGHT_CLASS}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={RESPONSIVE_TBODY_CLASS}>
                      {sortedRows.map((entry) => {
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
                              <FieldLabel>Current Balance/Value</FieldLabel>
                              <div className="text-muted text-sm">
                                {formatAmount(entry.currentBalance)}
                              </div>
                            </td>
                            <td className={RESPONSIVE_CELL_CLASS}>
                              <FieldLabel>Contribution</FieldLabel>
                              {/* The amount and its cadence sub-label are ONE field.
                                Wrapped together so the cell has exactly two flex
                                children below `sm` (label + value), not three —
                                otherwise `justify-between` would fling the cadence
                                to the far edge as a third column. */}
                              {/* Story 43.4 (D2): an asset carries no contribution,
                                  so show an em-dash rather than a literal
                                  "$0.00 / Monthly", which would contradict a form
                                  that never asked. `table-sort-keys.ts` nulls the
                                  matching sort key so the column sorts by what the
                                  CELL SHOWS. (The em-dash convention was shared with
                                  the Remaining Room cell, removed by story 49.1.) */}
                              {entry.type === 'asset' ? (
                                <div className="text-muted text-sm">—</div>
                              ) : (
                                <div>
                                  <div className="text-muted text-sm">
                                    {formatAmount(entry.monthlyContribution)}
                                  </div>
                                  <div className="text-faint text-xs">
                                    {frequencyLabel(entry.frequency)}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className={RESPONSIVE_ACTIONS_CELL_CLASS}>
                              <FieldLabel>Actions</FieldLabel>
                              {/* `p-1` is the DESKTOP tap target — see RESPONSIVE_ACTION_BUTTON_CLASS,
                                  which owns the full rationale (story 50.1). */}
                              <div className={RESPONSIVE_ACTIONS_GROUP_CLASS}>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(entry)}
                                  aria-label={`Edit ${entry.name}`}
                                  className={`mr-4 p-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  <PencilIcon className="h-5 w-5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(entry.id)}
                                  aria-label={`Delete ${entry.name}`}
                                  className={`p-1 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500 ${RESPONSIVE_ACTION_BUTTON_CLASS}`}
                                >
                                  <TrashIcon className="h-5 w-5" />
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
                // ⚠️ The `??` is NOT dead code. `type` is typed `FinanceType`, but nothing
                // validates it on the way IN: the persist `migrate` (balanceStore) and the
                // sync-pull path both write stored rows verbatim, so a legacy or newer-peer
                // value reaches this index and yields `undefined` — which React drops, leaving
                // the field with no example at all. Before story 52.1 it always showed one.
                // Mirrors `getTypeDisplay`'s unknown-type fallback in this same file.
                placeholder={NAME_PLACEHOLDERS[type] ?? NAME_PLACEHOLDERS.investment}
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
                Current Balance/Value *
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
                  modal card measures 2.54:1, below WCAG AA.

                  Story 49.2 (UX-DR40, amended) adds the RECIPROCAL half. 36.3
                  and 43.4 each told one arm where its counterpart goes, but
                  neither arm named the OTHER kind of entry, so a homeowner who
                  recorded a mortgage had no way to learn the property is a
                  second entry — the discoverability defect this story exists
                  to close. Deliberately debt/asset-scoped: it must never read
                  as "entering the same money twice is fine" in general, which
                  is TRUE for a mortgage and FALSE as a generalisation (FR72,
                  fixed by story 45.1 — see deferred-work.md).

                  ⚠️ Plain `<a>`, not `<Link>`. 36.3's Expenses hint used prose
                  precisely because `<Link>` needs a router this file never
                  imports and `BalancePage.test.tsx` never provides
                  (`renderWithProviders`). The anchor at :465-470 is the
                  in-file precedent that satisfies "link to the guidance"
                  without either. Classes are that anchor's, minus its `text-xs`
                  — redundant inside an already-`text-xs` paragraph.

                  Contrast measured for story 49.2, BOTH THEMES, all AA-passing
                  for small text. ⚠️ Every row below names its theme: quoting only
                  the light figure led a reviewer to conclude, reasonably, that the
                  dark card fails — `.text-muted` is `text-gray-500 dark:text-gray-400`
                  (global.css), so the light number alone does not describe it.

                    the new LINK   blue-600 #2563eb on white #ffffff      5.17:1
                                   blue-400 #60a5fa on gray-800 #1f2937   5.77:1
                    link hover     blue-800 on white / blue-300 on gray-800
                                                              8.72:1 / 8.14:1
                    the HINT text  text-muted = gray-500 on white         4.83:1
                                   text-muted = gray-400 on gray-800      5.78:1

                  ⚠️ `text-faint` is IDENTICAL to `text-muted` in dark (both resolve
                  to gray-400), so it fails in LIGHT ONLY, at 2.54:1 — 36.3's figure,
                  reproduced here by an independent routine. The token choice is
                  therefore load-bearing in exactly one theme, which is why it is
                  pinned rather than left to style review. */}
              {type === 'debt' && (
                <p className="mt-1 text-xs text-muted" data-testid="balance-debt-hint">
                  Enter what you still owe today. Record the recurring payment on the Expenses page
                  — that's where it counts against your cash flow. If the loan bought something you
                  still have, record that as an Asset entry too, so your net worth reflects both
                  sides.{' '}
                  <a
                    href="/docs/where-a-mortgage-belongs"
                    className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Where a mortgage belongs
                  </a>{' '}
                  works through a full example.
                </p>
              )}
              {/* Story 43.4 (Q3): the asset arm gets a hint for the same reason
                  the debt arm does — the form hides a field the user may expect,
                  so it must say where that money goes instead.

                  Story 49.2 adds the loan pointer and the DOWN PAYMENT clause.
                  The down payment is the step the reported user actually got
                  stuck on, and before this story the phrase appeared nowhere in
                  the app or its docs (verified at 6e2bd59; the one hit repo-wide
                  is a savings-goal fixture name in a core test). It is not an
                  entry anywhere: it is already reflected in the gap between what
                  the property is worth and what is still owed, and the doc
                  explains why. The clause lives HERE as well as in the doc
                  because the confused user is looking at this form, not at
                  /docs. */}
              {type === 'asset' && (
                <p className="mt-1 text-xs text-muted" data-testid="balance-asset-hint">
                  Enter what it's worth today. Money you put aside toward it belongs on the Savings
                  page — an asset's value here changes as it appreciates, not as you contribute. A
                  loan against it is recorded separately as a Debt entry, and your down payment is
                  not entered anywhere.{' '}
                  <a
                    href="/docs/where-a-mortgage-belongs"
                    className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Where a mortgage belongs
                  </a>{' '}
                  works through a full example.
                </p>
              )}
            </div>

            {/* Story 43.4 (D2): an asset has no contribution concept, so the
                Contribution amount and its Frequency are both hidden for it. The
                persistence gate writes
                `monthlyContribution: 0` / `frequency: 'monthly'` (both columns
                are NOT NULL), so hiding the field never omits the value. */}
            {type !== 'asset' && (
              <>
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
                      onChange={(e) =>
                        setMonthlyContribution(sanitizeMoneyChange(e.target, locale))
                      }
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

                {/* Story 45.1 (FR72, D8): investment-only. A debt's contribution
                    never reaches the distributable pool (SavingsPage filters on
                    `type === 'investment'`), so offering the control there would
                    advertise an effect that does not exist. Assets never get here
                    at all — the whole block is hidden for them. */}
                {type === 'investment' && (
                  <div>
                    {/* ⚠️ Story 47.1 (FR73, D2): the STORED name below is
                        `contributionRecordedAsExpense`, which describes only ONE of the two
                        situations this control now covers. That mismatch is DELIBERATE and must
                        not be "fixed" by renaming the field. The label asks the broader question
                        — money that never reached you, OR money you also typed onto Expenses —
                        because both need the identical treatment: skip the row from the savings
                        pool. Renaming the field would be a five-gate sync change (core sync
                        types, the server schema, syncBridge, the db column and its migration,
                        and the balanceTracking validator) plus hand-written DDL, because
                        drizzle-kit 0.23 does not track CHECK constraints — all for no
                        user-visible gain. Pinned by `contribution-flag-naming.guard.test.ts`. */}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        id="contributionRecordedAsExpense"
                        checked={contributionRecordedAsExpense}
                        onChange={(e) => setContributionRecordedAsExpense(e.target.checked)}
                        className="mt-0.5 border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-purple-500 w-4 h-4 text-purple-600"
                        aria-describedby="contribution-recorded-as-expense-help"
                        data-testid="balance-contribution-recorded-as-expense"
                      />
                      <label
                        htmlFor="contributionRecordedAsExpense"
                        className="font-medium text-label text-sm"
                      >
                        Not taken from the money left over
                      </label>
                    </div>
                    <p
                      id="contribution-recorded-as-expense-help"
                      className="mt-1 text-muted text-xs"
                    >
                      Tick this if the contribution comes out of your pay and the income you entered
                      is the amount that reaches your bank account — or if you also list this
                      contribution on your Expenses page. Either way your figures already allow for
                      it, and counting it again would reduce the money left over on the Savings page
                      twice. If both are true, take the line off your Expenses page as well.
                    </p>
                  </div>
                )}
              </>
            )}

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
