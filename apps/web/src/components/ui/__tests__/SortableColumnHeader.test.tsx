import { assertHasFocusRing } from '@/test/responsive-table-tokens'
import { fireEvent, renderWithProviders, screen } from '@/test/utils'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  type AriaSortValue,
  type SortState,
  ariaSortFor,
  nextSortState,
} from '../../../lib/table-sort'
import { SortableColumnHeader, useSortHeaderAnnouncements } from '../SortableColumnHeader'

/**
 * The sortable column header (story 34.2, FR61).
 *
 * ⚠️ `TableSortNotice`'s four tests used to live in this file. Story 48.1
 * replaced that component with `TableSortControl`, and each of the four has a
 * direct successor in `TableSortControl.test.tsx` — the sorted-column report,
 * the `sm:hidden` + 44px pair, the focus ring, and "renders no table markup".
 * They were MIGRATED, not dropped.
 */

function HeaderHarness({
  ariaSort,
  onToggle,
  onActivate,
}: {
  ariaSort: AriaSortValue
  onToggle: () => void
  onActivate?: () => void
}) {
  const a11y = useSortHeaderAnnouncements(null)
  return (
    <>
      <table>
        <thead>
          <tr>
            <SortableColumnHeader
              label="Amount"
              ariaSort={ariaSort}
              onToggle={onToggle}
              describedBy={a11y.describedBy(ariaSort)}
              onActivate={onActivate ?? a11y.markActivated}
            />
          </tr>
        </thead>
      </table>
      {a11y.nodes}
    </>
  )
}

function renderHeader(ariaSort: AriaSortValue, onActivate?: () => void) {
  const onToggle = vi.fn()
  const { container, unmount } = renderWithProviders(
    <HeaderHarness ariaSort={ariaSort} onToggle={onToggle} onActivate={onActivate} />
  )
  const th = container.querySelector('th')
  if (!th) throw new Error('no <th> rendered')
  return { onToggle, th, unmount }
}

/**
 * A table whose sort the test drives directly: `toggle` is the header path (it
 * cycles like `nextSortState`), `restore` is any other writer (the mobile picker,
 * a rehydrated store), which must NOT announce (story 120.1, D2).
 */
function AnnouncingTable() {
  const [state, setState] = useState<SortState<'amount'> | null>(null)
  const a11y = useSortHeaderAnnouncements(
    state ? { label: 'Amount', direction: state.direction } : null
  )
  const ariaSort = ariaSortFor(state, 'amount')
  return (
    <>
      <button type="button" onClick={() => setState({ key: 'amount', direction: 'desc' })}>
        restore
      </button>
      <table>
        <thead>
          <tr>
            <SortableColumnHeader
              label="Amount"
              ariaSort={ariaSort}
              onToggle={() => setState((s) => nextSortState(s, 'amount'))}
              describedBy={a11y.describedBy(ariaSort)}
              onActivate={a11y.markActivated}
            />
          </tr>
        </thead>
      </table>
      {a11y.nodes}
    </>
  )
}

function liveRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]')
  if (!region) throw new Error('no live region rendered')
  return region
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

describe('sortable header screen-reader state (story 120.1, FR188)', () => {
  it('describes the button as sortable plus its current state, keeping name and <th> text', () => {
    // ⚠️ `aria-sort="none"` is generally NOT announced, so before 120.1 an
    // unsorted header read as "Amount, button". The description says it sorts.
    const expected = {
      none: 'Sortable column, not sorted',
      ascending: 'Sortable column, sorted ascending',
      descending: 'Sortable column, sorted descending',
    } as const
    for (const state of ['none', 'ascending', 'descending'] as const) {
      const { th, unmount } = renderHeader(state)
      const button = screen.getByRole('button', { name: 'Amount' })
      expect(button).toHaveAccessibleDescription(expected[state])
      // The description node is OUTSIDE the <th>: its text content is unchanged.
      expect(th.textContent?.trim()).toBe('Amount')
      unmount()
    }
  })

  it('runs onActivate BEFORE onToggle, so the resulting change is announced', () => {
    const calls: string[] = []
    const { onToggle } = renderHeader('none', () => calls.push('activate'))
    onToggle.mockImplementation(() => calls.push('toggle'))
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }))
    expect(calls).toEqual(['activate', 'toggle'])
  })

  it('announces each header click in a polite live region, from an empty start', () => {
    const { container } = renderWithProviders(<AnnouncingTable />)
    const region = liveRegion(container)
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).not.toHaveAttribute('role')
    expect(region.textContent).toBe('')
    // Never inside the table (AC 6).
    expect(region.closest('table')).toBeNull()

    const header = () => screen.getByRole('button', { name: 'Amount' })
    fireEvent.click(header())
    expect(region.textContent).toBe('Sorted by Amount, ascending')
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(header())
    expect(region.textContent).toBe('Sorted by Amount, descending')
    fireEvent.click(header())
    expect(region.textContent).toBe('Sort cleared')
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  it('stays silent when the sort changes WITHOUT a header click (picker, rehydrate)', () => {
    const { container } = renderWithProviders(<AnnouncingTable />)
    fireEvent.click(screen.getByRole('button', { name: 'restore' }))
    // The description follows the state; the live region does not speak.
    expect(screen.getByRole('button', { name: 'Amount' })).toHaveAccessibleDescription(
      'Sortable column, sorted descending'
    )
    expect(liveRegion(container).textContent).toBe('')
  })

  it('empties the region on a silent change, so a repeat of the last message is still announced (code review)', () => {
    const { container } = renderWithProviders(<AnnouncingTable />)
    const region = liveRegion(container)
    const header = () => screen.getByRole('button', { name: 'Amount' })
    fireEvent.click(header())
    fireEvent.click(header())
    fireEvent.click(header())
    expect(region.textContent).toBe('Sort cleared')

    // A silent writer re-sorts: the stale "Sort cleared" would now contradict
    // the table, so the region empties.
    fireEvent.click(screen.getByRole('button', { name: 'restore' }))
    expect(region.textContent).toBe('')

    // desc -> none by header click: the SAME string as before. Without the
    // emptying it was a React no-op and nothing was spoken (MEASURED in review).
    fireEvent.click(header())
    expect(region.textContent).toBe('Sort cleared')
  })
})
