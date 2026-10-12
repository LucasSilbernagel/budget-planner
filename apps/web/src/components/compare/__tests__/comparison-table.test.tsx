import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@/test/utils'
import {
	COMPARE_PAGES,
	COMPARE_ROW_IDS,
	COMPARE_ROW_LABELS,
	getComparePage,
} from '../../../content/compare'
import { ComparisonTable } from '../comparison-table'

const page = getComparePage('longhand-vs-spreadsheet')
if (!page) throw new Error('spreadsheet page missing')

describe('ComparisonTable', () => {
	it('renders every row id in tuple order with a row header', () => {
		render(<ComparisonTable page={page} />)
		const table = screen.getByRole('table')
		const rowHeaders = within(table)
			.getAllByRole('rowheader')
			.map((th) => th.textContent)
		expect(rowHeaders).toEqual(COMPARE_ROW_IDS.map((id) => COMPARE_ROW_LABELS[id]))
		expect(rowHeaders).toHaveLength(17)
	})

	it('names the table and its three columns, alternative before Longhand, capitalising the competitor only here', () => {
		render(<ComparisonTable page={page} />)
		const table = screen.getByRole('table', {
			name: `Longhand Budget compared with ${page.competitorName}`,
		})
		const headers = within(table)
			.getAllByRole('columnheader')
			.map((th) => th.textContent)
		expect(headers).toEqual([
			'Feature',
			'A spreadsheet (Excel or Google Sheets)',
			'Longhand Budget',
		])
	})

	it('gives the row dividers a dark counterpart and uses no light-only token', () => {
		const { container } = render(<ComparisonTable page={page} />)
		const tbody = container.querySelector('tbody')
		expect(tbody && [...tbody.classList]).toEqual(
			expect.arrayContaining(['divide-y', 'divide-gray-200', 'dark:divide-gray-700'])
		)
		expect(tbody && [...tbody.classList]).not.toContain('border-default')
		const classes = [...container.querySelectorAll('*')].flatMap((el) => [...el.classList])
		for (const retired of [
			'bg-white',
			'text-gray-900',
			'text-gray-700',
			'text-gray-500',
			'border-gray-200',
		]) {
			expect(classes, retired).not.toContain(retired)
		}
	})

	it('puts the table in a scroll container so an overflow scrolls the card, not the page', () => {
		const { container } = render(<ComparisonTable page={page} />)
		const wrapper = container.firstElementChild
		expect(wrapper && [...wrapper.classList]).toContain('overflow-x-auto')
	})

	it('puts the alternative in the second column and Longhand Budget in the third', () => {
		render(<ComparisonTable page={page} />)
		const firstRow = screen.getAllByRole('row')[1]
		if (!firstRow) throw new Error('no body row')
		const cells = within(firstRow)
			.getAllByRole('cell')
			.map((td) => td.textContent ?? '')
		expect(cells[0]).toContain(page.rows.priceMonthly.competitor)
		expect(cells[1]).toBe(page.rows.priceMonthly.longhand)
	})

	it('links a sourced competitor cell to its source in a new tab', () => {
		render(<ComparisonTable page={page} />)
		const source = screen.getByRole('link', {
			name: `Source for ${COMPARE_ROW_LABELS.priceAnnual} (opens in a new tab)`,
		})
		expect(source).toHaveAttribute('href', page.rows.priceAnnual.source)
		expect(source).toHaveAttribute('target', '_blank')
		expect(source).toHaveAttribute('rel', 'noopener noreferrer')
	})
})

describe.each(COMPARE_PAGES)('ComparisonTable renders $slug', (p) => {
	it('with all 17 row headers in tuple order', () => {
		render(<ComparisonTable page={p} />)
		const rowHeaders = screen.getAllByRole('rowheader').map((th) => th.textContent)
		expect(rowHeaders).toEqual(COMPARE_ROW_IDS.map((id) => COMPARE_ROW_LABELS[id]))
	})
})
