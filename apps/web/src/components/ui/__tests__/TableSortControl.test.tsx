import { describe, expect, it, vi } from 'vitest'
import {
	assertHasFocusRing,
	assertHasMobileTapTarget,
	collectRetiredTokenViolations,
} from '@/test/responsive-table-tokens'
import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { TableSortControl } from '../TableSortControl'

type Key = 'name' | 'amount' | 'category'

const COLUMNS: readonly { key: Key; label: string }[] = [
	{ key: 'name', label: 'Name' },
	{ key: 'amount', label: 'Amount' },
]

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

describe('TableSortControl — the mobile sort affordance', () => {
	it('exposes one combobox named for its table', () => {
		renderControl()
		expect(screen.getByRole('combobox', { name: 'Sort income sources' })).toBeInTheDocument()
	})

	it('offers manual order plus both directions of every column, in header order', () => {
		// Exact array: a "does not offer Category" check would pass on an empty list.
		renderControl()
		expect(optionLabels(screen.getByRole('combobox', { name: 'Sort income sources' }))).toEqual([
			'Default order',
			'Name (ascending)',
			'Name (descending)',
			'Amount (ascending)',
			'Amount (descending)',
		])
	})

	it('offers nothing for a column it was not given', () => {
		// The tier gate lives at the call site; this component renders exactly the columns it is handed.
		renderControl()
		expect(
			within(screen.getByRole('combobox', { name: 'Sort income sources' })).queryByRole('option', {
				name: /^Category/,
			})
		).toBeNull()
	})

	it('shows manual order as the current value when nothing is sorted', () => {
		renderControl()
		expect(
			(screen.getByRole('combobox', { name: 'Sort income sources' }) as HTMLSelectElement).value
		).toBe('manual')
	})

	it('reflects an ALREADY-ACTIVE sort on first render', () => {
		// A persisted sort means a phone can open a table already sorted; the control must show it.
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

	it('reports the exact column and direction chosen', async () => {
		const user = userEvent.setup()
		const { onSelect } = renderControl()

		await user.selectOptions(
			screen.getByRole('combobox', { name: 'Sort income sources' }),
			'amount:desc'
		)

		// Descending from unsorted: a control wired to `toggle` would emit ascending.
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith({ key: 'amount', direction: 'desc' })
	})

	it('reports null when manual order is chosen', async () => {
		const user = userEvent.setup()
		const { onSelect } = renderControl({ state: { key: 'name', direction: 'asc' } })

		await user.selectOptions(
			screen.getByRole('combobox', { name: 'Sort income sources' }),
			'manual'
		)

		expect(onSelect).toHaveBeenCalledWith(null)
	})

	it('is hidden at >= 640px', () => {
		// Class-TOKEN membership, never a substring of `className`: `-` and `:` are
		// substring boundaries, so `hidden` false-matches `overflow-hidden`.
		const { container } = renderControl()
		const root = container.firstElementChild as HTMLElement
		expect(root.className.split(/\s+/)).toContain('sm:hidden')
	})

	it('renders whenever it is mounted, sorted or not', () => {
		renderControl({ state: null })
		expect(screen.getByRole('combobox', { name: 'Sort income sources' })).toBeVisible()
	})

	it('declares the 44px mobile tap target without leaking it onto desktop', () => {
		renderControl()
		assertHasMobileTapTarget(
			screen.getByRole('combobox', { name: 'Sort income sources' }),
			'mobile sort control'
		)
	})

	it('carries the standard visible focus ring', () => {
		renderControl()
		assertHasFocusRing(
			screen.getByRole('combobox', { name: 'Sort income sources' }),
			'mobile sort control'
		)
	})

	it('introduces no retired surface or text tokens', () => {
		// Nothing else sweeps this control: the page suites only sweep inside the `<table>`.
		const { container } = renderControl()
		expect(collectRetiredTokenViolations(container.firstElementChild as HTMLElement)).toEqual([])
	})

	it('renders no table markup', () => {
		const { container } = renderControl()
		expect(container.querySelector('th')).toBeNull()
		expect(container.querySelector('td')).toBeNull()
	})
})
