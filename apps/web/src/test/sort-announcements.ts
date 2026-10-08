import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

// The ONE polite region with no role; the skeleton's `role="status"` region is a different one.
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

export async function expectSortHeaderAnnouncements(
	user: UserEvent,
	pickerName: string
): Promise<void> {
	const header = () => screen.getByRole('columnheader', { name: 'Name' })
	const button = () => within(header()).getByRole('button', { name: 'Name' })
	const region = sortLiveRegion()

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

	// The mobile picker sorts WITHOUT announcing (its <select> already speaks).
	await user.selectOptions(screen.getByRole('combobox', { name: pickerName }), 'name:desc')
	expect(header()).toHaveAttribute('aria-sort', 'descending')
	expect(button()).toHaveAccessibleDescription('Sortable column, sorted descending')
	// ...and empties the region: a stale "Sort cleared" would contradict the table and swallow the
	// identical announcement below.
	expect(region.textContent).toBe('')

	await user.click(button())
	expect(region.textContent).toBe('Sort cleared')
}
