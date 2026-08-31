import { assertHasFocusRing } from '@/test/responsive-table-tokens'
import { fireEvent, renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { SortableColumnHeader } from '../SortableColumnHeader'

/**
 * The sortable column header (story 34.2, FR61).
 *
 * ⚠️ `TableSortNotice`'s four tests used to live in this file. Story 48.1
 * replaced that component with `TableSortControl`, and each of the four has a
 * direct successor in `TableSortControl.test.tsx` — the sorted-column report,
 * the `sm:hidden` + 44px pair, the focus ring, and "renders no table markup".
 * They were MIGRATED, not dropped.
 */

function renderHeader(ariaSort: 'ascending' | 'descending' | 'none') {
  const onToggle = vi.fn()
  const { container } = renderWithProviders(
    <table>
      <thead>
        <tr>
          <SortableColumnHeader label="Amount" ariaSort={ariaSort} onToggle={onToggle} />
        </tr>
      </thead>
    </table>
  )
  const th = container.querySelector('th')
  if (!th) throw new Error('no <th> rendered')
  return { onToggle, th }
}

describe('SortableColumnHeader', () => {
  it('reports its state on the <th>, not on the button', () => {
    // `aria-sort` is defined on the column header role. Putting it on the button
    // would leave the columnheader announcing nothing.
    expect(renderHeader('none').th).toHaveAttribute('aria-sort', 'none')
    expect(renderHeader('ascending').th).toHaveAttribute('aria-sort', 'ascending')
    expect(renderHeader('descending').th).toHaveAttribute('aria-sort', 'descending')
  })

  it('keeps the <th> text content EXACTLY the column label, in every state', () => {
    // ⚠️ `category-assignment.test.tsx` reads every `<th>` with
    // `th.textContent?.trim()` and pins the result as an exact array, on two
    // pages, for both tier variants. An sr-only span or a textual arrow here
    // breaks four assertions there. The direction indicator must stay an
    // aria-hidden <svg>, which contributes no text.
    for (const state of ['none', 'ascending', 'descending'] as const) {
      const { th } = renderHeader(state)
      expect(th.textContent?.trim()).toBe('Amount')
    }
  })

  it('exposes a button whose accessible name is just the label', () => {
    renderHeader('ascending')
    expect(screen.getByRole('button', { name: 'Amount' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
  })

  it('renders a decorative, non-announced indicator for the ACTIVE column only', () => {
    // ⚠️ Width, not aesthetics. A persistent per-column chevron cost ~16px each
    // and pushed the free-tier 4-column table over
    // `categories-premium.spec.ts`'s 768px wrapper-overflow guard (688 vs a
    // 656 + 24 limit) on both /income and /expenses. Unsorted must render no
    // icon at all.
    expect(renderHeader('none').th.querySelector('svg')).toBeNull()
    for (const state of ['ascending', 'descending'] as const) {
      const svg = renderHeader(state).th.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('draws a DIFFERENT indicator for ascending and descending', () => {
    // Without this the two states would be visually identical and only a screen
    // reader could tell them apart.
    const asc = renderHeader('ascending').th.querySelector('svg path')?.getAttribute('d')
    const desc = renderHeader('descending').th.querySelector('svg path')?.getAttribute('d')
    expect(asc).toBeTruthy()
    expect(desc).toBeTruthy()
    expect(asc).not.toBe(desc)
  })

  it('calls onToggle when activated', () => {
    const { onToggle } = renderHeader('none')
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('carries the same visible focus ring as the row action buttons', () => {
    renderHeader('none')
    assertHasFocusRing(screen.getByRole('button', { name: 'Amount' }), 'Amount')
  })

  it('does NOT carry a mobile tap-target floor', () => {
    // ⚠️ STILL TRUE AFTER STORY 48.1, and deliberately unchanged. A phone CAN
    // now sort — but through `TableSortControl`, which sits outside the table.
    // The `<thead>` is still `display: none` below `sm`, so a
    // `max-sm:min-h-[44px]` HERE would still be dead CSS on a hidden ancestor
    // and `assertHasMobileTapTarget` would still be asserting nothing. What
    // changed is where the mobile affordance lives, not this element.
    renderHeader('none')
    const classes = screen.getByRole('button', { name: 'Amount' }).className
    expect(classes).not.toContain('min-h-[44px]')
    expect(classes).not.toContain('min-w-[44px]')
  })
})
