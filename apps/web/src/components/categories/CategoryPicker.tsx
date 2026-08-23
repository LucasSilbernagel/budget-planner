/**
 * Category picker for the income and expense add/edit forms (story 30.4b, FR54).
 *
 * Three tier states, fail-closed, matching {@link PremiumFeatureGate}'s contract
 * without USING it — see the AC-5 note below:
 *   - `status.isLoading` (SSR + first client paint) → an inert, aria-hidden
 *     placeholder in the resolved control's footprint. Never category content,
 *     so a not-yet-verified tier cannot see another user's category names for a
 *     frame and the layout does not jump when the tier resolves.
 *   - resolved `!hasAccess` (free / past_due / canceled / unauthenticated / an
 *     ERRORED check) → inert locked content plus a {@link PremiumLockBadge}, so
 *     the feature is discoverable rather than hidden (FR24).
 *   - resolved `hasAccess` → the real `<select>`.
 *
 * ⚠️ THIS DELIBERATELY DOES NOT USE `PremiumFeatureGate` (AC-5). The gate's
 * locked branch renders `<button onClick=…>` plus `<PremiumPrompt asDialog>`,
 * and `PremiumPrompt asDialog` renders a `<Modal>` — but this picker lives
 * INSIDE the Add/Edit `<Modal>`, and `Modal` states outright that it assumes a
 * single modal is open at a time (per-instance Escape listener, out-of-order
 * scroll-lock restore). Under AC-4 the locked branch is the DEFAULT experience
 * for every non-premium visitor, so a nested modal here would not be an edge
 * case — it would be what most users hit. The locked state is therefore inert
 * content: nothing to click, nothing to open.
 *
 * ⚠️ The field is NEVER `required`, unlike every other select on these two
 * pages. Leaving a row uncategorized is always valid (AC-1), which is also what
 * keeps every pre-existing row valid.
 */

import type { CategoryKind } from '@budget-planner/db'
import type React from 'react'
import { useCategoriesForActiveProfile } from '../../hooks/useCategoryLabels'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumLockBadge } from '../premium'
import { Skeleton } from '../ui/Skeleton'

/**
 * Sentinel for "no category" in the `<select>`.
 *
 * ⚠️ There is no `<option value="">` anywhere else in this codebase, so this is
 * a new pattern rather than a copied one. `<select>` values are always strings,
 * so `null` cannot be one; the empty string is the only value no uuid can
 * collide with. The mapping in both directions is contained entirely in this
 * file — callers only ever see `string | null`.
 */
const UNCATEGORIZED_VALUE = ''

export const UNCATEGORIZED_LABEL = 'Uncategorized'

export interface CategoryPickerProps {
  /** Which side of the ledger this form is on; the list is filtered to it. */
  kind: CategoryKind
  /** The currently selected category, or `null` for uncategorized. */
  value: string | null
  /** Called with the new selection; `null` when the user picks uncategorized. */
  onChange: (categoryId: string | null) => void
  /** Namespaces the element id and test id, e.g. `income` → `income-category`. */
  idPrefix: string
}

const LABEL_CLASS = 'block text-sm font-medium text-label mb-1'

/**
 * Field caption for the two inert states.
 *
 * A `<span>`, not a `<label>`: the loading and locked states render no control
 * (AC-5), and a `<label>` pointing at nothing is a broken a11y promise rather
 * than a lint technicality.
 */
function InertPickerCaption(): React.ReactElement {
  return <span className={LABEL_CLASS}>Category</span>
}

export function CategoryPicker({
  kind,
  value,
  onChange,
  idPrefix,
}: CategoryPickerProps): React.ReactElement {
  const { status } = usePremiumAccess()
  // Profile-scoped and tombstone-free (code review 30.4b): reads must be scoped
  // the same way `isDuplicateName` scopes writes, or two profiles each owning
  // "Groceries" offer two identical options.
  const categories = useCategoriesForActiveProfile()
  const selectId = `${idPrefix}-category`

  if (status.isLoading) {
    // Story 38.2: the bar is now `ui/Skeleton`'s `Skeleton`, which owns the
    // (`motion-safe:`) pulse and its own `aria-hidden`; the 42px height and the
    // border classes stay here because the FOOTPRINT belongs to the caller — it
    // is the height of the `<select>` this stands in for.
    // ⚠️ The wrapper KEEPS its own `aria-hidden` so the caption goes with it, so
    // the attribute is now nested. That is harmless (hiding a hidden subtree) but
    // it is no longer true to say "the wrapper owns it" — both do. Noted in code
    // review. Trigger unchanged: premium tier, not store rehydration.
    return (
      <div aria-hidden="true" data-testid={`${idPrefix}-category-skeleton`}>
        <InertPickerCaption />
        <Skeleton className="block h-[42px] w-full rounded-md border border-gray-300 dark:border-gray-600 surface-inset" />
      </div>
    )
  }

  if (!status.hasAccess) {
    return (
      <div data-testid={`${idPrefix}-category-locked`}>
        <InertPickerCaption />
        {/* Inert: a <div>, not a <button>. See the AC-5 note in the file header. */}
        <div className="flex w-full items-center justify-between gap-3 rounded-md border border-gray-300 dark:border-gray-600 surface-inset px-3 py-2">
          <span className="text-sm text-muted">Organize entries with your own categories</span>
          <PremiumLockBadge />
        </div>
      </div>
    )
  }

  const options = categories.filter((category) => category.kind === kind)

  /**
   * A `categoryId` this device cannot resolve DISPLAYS as uncategorized (AC-3) —
   * a `<select>` whose value matches no option would otherwise show the first
   * option while React warns, i.e. show "Uncategorized" by accident rather than
   * on purpose.
   *
   * ⚠️ Only the DISPLAY is normalized. The parent's form state keeps the
   * original id, so submitting an untouched form preserves it. That is
   * deliberate: two of AC-3's three causes are transient (a not-yet-pulled page,
   * a category that may still arrive), and silently clearing the reference on an
   * unrelated edit would destroy an assignment the next pull would have restored.
   */
  const selectedValue =
    value && options.some((category) => category.id === value) ? value : UNCATEGORIZED_VALUE

  return (
    <div>
      <label htmlFor={selectId} className={LABEL_CLASS}>
        Category
      </label>
      <select
        id={selectId}
        value={selectedValue}
        onChange={(e) => onChange(e.target.value === UNCATEGORIZED_VALUE ? null : e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        data-testid={`${idPrefix}-category-select`}
      >
        <option value={UNCATEGORIZED_VALUE}>{UNCATEGORIZED_LABEL}</option>
        {options.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  )
}
