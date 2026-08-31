import {
  assertHasFocusRing,
  assertHasMobileTapTarget,
  collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { TableSortControl } from '../TableSortControl'

/**
 * The mobile sort control (story 48.1, UX-DR53).
 *
 * ⚠️ THIS COMPONENT REPLACES `TableSortNotice`, and the replacement is a widening,
 * not a rename. The notice existed only to EXPLAIN and ESCAPE a sort that a
 * desktop interaction had already started (story 34.2, ratified decision 7); it
 * rendered nothing at all while a table was in manual order. This control is the
 * first affordance that can START a sort below `sm`, so it renders whenever the
 * table does — and the four page suites' "only while a sort is active"
 * assertions were rewritten against that, not deleted.
 *
 * ⚠️ Every assertion here is about MARKUP AND CLASS TOKENS. jsdom computes no
 * layout, so it cannot see the one thing most likely to break this control: a
 * `<select>`'s intrinsic width is set by its longest `<option>`, which on
 * `/savings` puts the unconstrained box at exactly the card interior under CI's
 * font. That is measured and pinned in `e2e/mobile-table-sort.spec.ts`; a green
 * run of THIS file says nothing about any width.
 */

type Key = 'name' | 'amount' | 'category'

const COLUMNS: readonly { key: Key; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount' },
]

/** Every option's visible text, in DOM order. */
function optionLabels(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

function renderControl(overrides: Partial<Parameters<typeof TableSortControl>[0]> = {}) {
  const onSelect = vi.fn()
  const utils = renderWithProviders(
    <TableSortControl
      label="Sort income sources"
      columns={COLUMNS}
      state={null}
      onSelect={onSelect}
      {...overrides}
    />
  )
  return { ...utils, onSelect }
}

describe('TableSortControl — the mobile sort affordance (story 48.1)', () => {
  it('exposes one combobox named for its table (AC-6)', () => {
    renderControl()
    expect(screen.getByRole('combobox', { name: 'Sort income sources' })).toBeInTheDocument()
  })

  it('offers manual order plus both directions of every column, in header order (AC-5)', () => {
    // ⚠️ An EXACT ARRAY, not a `toContain` sweep. "does not offer Category"
    // passes against an options list that is empty for some unrelated reason,
    // and this is the assertion AC-7's tier pins lean on.
    renderControl()
    expect(optionLabels(screen.getByRole('combobox', { name: 'Sort income sources' }))).toEqual([
      'Manual order',
      'Name (ascending)',
      'Name (descending)',
      'Amount (ascending)',
      'Amount (descending)',
    ])
  })

  it('offers nothing for a column it was not given (AC-7)', () => {
    // The tier gate lives at the CALL SITE — this component renders exactly the
    // columns it is handed. Pinned here so a page that forgets the gate fails in
    // its own suite rather than silently offering a column nobody can see.
    renderControl()
    expect(
      within(screen.getByRole('combobox', { name: 'Sort income sources' })).queryByRole('option', {
        name: /^Category/,
      })
    ).toBeNull()
  })

  it('shows manual order as the current value when nothing is sorted (AC-11)', () => {
    renderControl()
    expect(
      (screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement).value
    ).toBe('manual')
  })

  it('reflects an ALREADY-ACTIVE sort on first render (AC-11)', () => {
    // ⚠️ The persisted-arrival case, and the one a "click it and see" test
    // cannot reach: story 42.1 persists the sort, so a phone can open a table
    // sorted days ago on the same device. The control must open showing it.
    renderControl({ state: { key: 'amount', direction: 'desc' } })
    const select = screen.getByRole('combobox', {
      name: 'Sort income sources',
    }) as HTMLSelectElement
    expect(select.value).toBe('amount:desc')
    expect(within(select).getByRole('option', { name: 'Amount (descending)' })).toHaveProperty(
      'selected',
      true
    )
  })

  it('reports the exact column and direction chosen (AC-2)', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderControl()

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort income sources' }),
      'amount:desc'
    )

    // ⚠️ DESCENDING FROM UNSORTED. A control wired to `toggle` would emit
    // ascending here, and would pass an assertion that only ever picked
    // ascending.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith({ key: 'amount', direction: 'desc' })
  })

  it('reports null when manual order is chosen (AC-4)', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderControl({ state: { key: 'name', direction: 'asc' } })

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Sort income sources' }),
      'manual'
    )

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('is hidden at >= 640px (AC-1)', () => {
    // Class-TOKEN membership, never a substring of `className`: `-` and `:` are
    // substring boundaries, so `hidden` false-matches `overflow-hidden`.
    const { container } = renderControl()
    const root = container.firstElementChild as HTMLElement
    expect(root.className.split(/\s+/)).toContain('sm:hidden')
  })

  it('renders whenever it is mounted, sorted or not (AC-1)', () => {
    // ⚠️ The behaviour that separates this from `TableSortNotice`. The notice
    // rendered nothing in manual order, which is exactly the state a phone user
    // needs the control in — it is how they START a sort.
    renderControl({ state: null })
    expect(screen.getByRole('combobox', { name: 'Sort income sources' })).toBeVisible()
  })

  it('declares the 44px mobile tap target without leaking it onto desktop (AC-9)', () => {
    renderControl()
    assertHasMobileTapTarget(
      screen.getByRole('combobox', { name: 'Sort income sources' }),
      'mobile sort control'
    )
  })

  it('carries the standard visible focus ring (AC-10)', () => {
    renderControl()
    assertHasFocusRing(
      screen.getByRole('combobox', { name: 'Sort income sources' }),
      'mobile sort control'
    )
  })

  it('introduces no retired surface or text tokens (AC-10)', () => {
    // ⚠️ THIS PIN EXISTS BECAUSE NOTHING ELSE SWEEPS THIS CONTROL. The four page
    // suites call `collectRetiredTokenViolations(container.querySelector('table'))`,
    // and this control is a SIBLING of the table wrapper — outside that subtree
    // at every width. `theme-page-coverage.spec.ts` asserts only the first match
    // of each selector per page, so it does not reach it either.
    const { container } = renderControl()
    expect(collectRetiredTokenViolations(container.firstElementChild as HTMLElement)).toEqual([])
  })

  it('renders no table markup (AC-12)', () => {
    // It sits OUTSIDE the `<table>`, so it cannot disturb `<th>`/`<td>` parity
    // or the mobile field-label pins. `category-assignment.test.tsx` reads every
    // `<th>`'s text content and pins it as an EXACT ARRAY on both flow pages in
    // both tiers — a stray cell here breaks four assertions across two pages.
    const { container } = renderControl()
    expect(container.querySelector('th')).toBeNull()
    expect(container.querySelector('td')).toBeNull()
  })
})
