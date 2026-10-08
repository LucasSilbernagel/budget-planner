import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * The screen-reader contract every finance table's sortable headers share (story
 * 120.1, FR188), asserted on a RENDERED PAGE so each page's own wiring is under
 * test: a page that forgets `useSortHeaderAnnouncements` or one header's
 * `onActivate` fails here, not only in `SortableColumnHeader.test.tsx`.
 */

/** The sort live region: the ONE polite region with no role (the page's skeleton
 * `role="status"` region is a different one, story 38.2 AC-8). */
export function sortLiveRegion(): HTMLElement {
  const regions = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-live="polite"]:not([role])')
  )
  expect(regions, 'exactly one sort live region on the page').toHaveLength(1)
  const region = regions[0] as HTMLElement
  expect(region).toHaveAttribute('aria-atomic', 'true')
  expect(region.closest('table'), 'the live region is outside the table').toBeNull()
  return region
}

/**
 * Assumes the page is rendered, in default (unsorted) order, with a sortable
 * `Name` column and the mobile picker named `pickerName`.
 */
export async function expectSortHeaderAnnouncements(
  user: UserEvent,
  pickerName: string
): Promise<void> {
  const header = () => screen.getByRole('columnheader', { name: 'Name' })
  const button = () => within(header()).getByRole('button', { name: 'Name' })
  const region = sortLiveRegion()

  // Focus: the name is just the label; the description says it sorts.
  expect(button()).toHaveAccessibleDescription('Sortable column, not sorted')
  expect(region.textContent).toBe('')

  // A header click announces the RESULTING state.
  await user.click(button())
  expect(header()).toHaveAttribute('aria-sort', 'ascending')
  expect(button()).toHaveAccessibleDescription('Sortable column, sorted ascending')
  expect(region.textContent).toBe('Sorted by Name, ascending')

  await user.click(button())
  expect(button()).toHaveAccessibleDescription('Sortable column, sorted descending')
  expect(region.textContent).toBe('Sorted by Name, descending')

  await user.click(button())
  expect(button()).toHaveAccessibleDescription('Sortable column, not sorted')
  expect(region.textContent).toBe('Sort cleared')

  // The mobile picker changes the sort WITHOUT announcing: its <select> already
  // speaks (story 120.1, D2). The description still follows the state.
  await user.selectOptions(screen.getByRole('combobox', { name: pickerName }), 'name:desc')
  expect(header()).toHaveAttribute('aria-sort', 'descending')
  expect(button()).toHaveAccessibleDescription('Sortable column, sorted descending')
  // ...and EMPTIES the region (code review 120.1): the old "Sort cleared" would
  // contradict the table, and would swallow the identical announcement below.
  expect(region.textContent).toBe('')

  // desc -> none by header click: the same string as before the picker, and it
  // still reaches the region (it was a React no-op before the review fix).
  await user.click(button())
  expect(region.textContent).toBe('Sort cleared')
}
