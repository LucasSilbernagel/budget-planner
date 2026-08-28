/**
 * Category picker for the income and expense add/edit forms (story 30.4b, FR54).
 *
 * Three tier states, fail-closed, matching {@link PremiumFeatureGate}'s contract
 * without USING it — see the AC-5 note below:
 *   - `status.isLoading` (SSR + first client paint) → an inert, aria-hidden
 *     placeholder in the `<select>`'s footprint. Never category content, so a
 *     not-yet-verified tier cannot see another user's category names for a frame.
 *     ⚠️ **The "no layout jump" half of this is now only true of the ENTITLED
 *     resolution.** The skeleton pins `h-[42px]`, the `<select>`'s height; story
 *     41.2 gave the LOCKED branch a second `text-xs` line, and the resulting
 *     locked ROW measures 78px in Chromium (measured 2026-08-28, not estimated —
 *     re-measured after the review shrank the link to the CTA text alone, which
 *     changed the anchor's size but not the row's). So a loading → locked
 *     resolution shifts everything below it by ~36px. Reachable
 *     when there is no SSR session seed (resolver error, or rendered outside the
 *     provider) and the client check resolves while the entry modal is already
 *     open. Left as-is deliberately: matching the footprints would mean either
 *     dropping the AC-4 data-loss warning or padding the skeleton to a height
 *     that is wrong for the entitled case, which is the common one. Recorded in
 *     `deferred-work.md` rather than papered over.
 *   - resolved `!hasAccess` (free / past_due / canceled / unauthenticated / an
 *     ERRORED check) → a locked LINK to `/pricing` plus a
 *     {@link PremiumLockBadge}, so the feature is discoverable rather than
 *     hidden (FR24) and the lock is an invitation rather than a dead end (FR66).
 *   - resolved `hasAccess` → the real `<select>`.
 *
 * ⚠️ THIS DELIBERATELY DOES NOT USE `PremiumFeatureGate` (30.4b AC-5, upheld by
 * story 41.2). The gate's locked branch renders `<button onClick=…>` plus
 * `<PremiumPrompt asDialog>`, and `PremiumPrompt asDialog` renders a `<Modal>` —
 * but this picker lives INSIDE the Add/Edit `<Modal>`, and a nested modal here
 * would not be an edge case: the locked branch is the DEFAULT experience for
 * every non-premium visitor.
 *
 * ⚠️⚠️ **THE REASON HAS CHANGED; THE RULE HAS NOT.** This comment used to cite
 * `Modal`'s "per-instance Escape listener, out-of-order scroll-lock restore".
 * **Story 41.1 FIXED BOTH** — `Modal.tsx:120-174` now has a shared modal stack
 * that owns the body scroll-lock and gives Escape to the topmost dialog only.
 * If you are here to check whether the constraint still applies: it does, for a
 * DIFFERENT and still-unfixed reason. `Modal.tsx:38-40` — *"Stacked modals are
 * SAFE, not supported: the background is not inerted, so a dialog behind
 * another is still keyboard-reachable."* Background inerting needs a portal plus
 * `inert` and is tracked separately. Until it lands, do not open a second
 * `<Modal>` from inside this one.
 *
 * ⚠️ Story 41.2 (FR66) therefore made the locked state a NAVIGATION OUT of the
 * form rather than a dialog inside it — a link is what makes "the lock leads
 * somewhere" compatible with the constraint above. It REVERSES 30.4b's
 * "inert content: nothing to click, nothing to open".
 *
 * ⚠️ Leaving the route DISCARDS the entry form's unsaved input: the form's state
 * is component-local `useState` in `IncomePage`/`ExpensesPage` and this app has
 * no draft-persistence mechanism. That is the recorded decision, and it is
 * deliberately NOT silent — the control's own copy says the form will close, so
 * the consequence is legible BEFORE activation. The copy lives in the link's
 * text (not an `aria-label`), because `aria-label` REPLACES the subtree and
 * would hide the warning from exactly the users least able to recover from it.
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
 * Field caption for the two non-`<select>` states.
 *
 * A `<span>`, not a `<label>`: neither state renders a labelable form control.
 * The loading state renders nothing at all, and since story 41.2 the locked
 * state renders an `<a>` — which `<label for>` cannot target either (HTML
 * restricts it to form controls). A `<label>` pointing at nothing is a broken
 * a11y promise rather than a lint technicality.
 *
 * ⚠️ The reason narrowed in 41.2; the conclusion did not. Do not "fix" this into
 * a `<label>` on the strength of the locked state now being interactive.
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
        {/*
          An <a>, not a <button>: a button here would have to open a dialog, and
          a dialog here would have to be a second <Modal>. See the file header.

          A plain <a href>, not a TanStack <Link>: this matches the unlocked
          branch of the two gated Settings entries (`categories-section.tsx`,
          `report-section.tsx`), and it needs no router in scope — this picker is
          unit-tested with a bare `render()`, as are both pages that host it. The
          resulting full document load also makes the entry modal's scroll-lock
          release unconditional rather than dependent on unmount ordering.
        */}
        <div className="flex w-full items-center justify-between gap-3 rounded-md border border-gray-300 dark:border-gray-600 surface-inset px-3 py-2">
          <span className="text-sm text-muted">
            Organize entries with your own categories
            {/*
              ⚠️ ONLY THIS TEXT IS THE LINK — the surrounding row is deliberately
              inert. The row was briefly the whole anchor (76px tall, full width),
              which put a navigation target the size of a form field directly
              between the last input and the Submit button: one mis-click, or one
              Enter on a tabbed-to link, discarded the entry form with no undo.
              Raised in the 41.2 code review; the fix is a small, obviously-a-link
              target rather than removing it from the tab order, because a
              keyboard-unreachable interactive control would be a WCAG 2.1.1
              failure — strictly worse than the mis-click it would prevent.
            */}
            <a
              href="/pricing"
              className="mt-0.5 inline-block text-xs font-medium text-accent underline rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              See Premium plans — closes this form
            </a>
          </span>
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
