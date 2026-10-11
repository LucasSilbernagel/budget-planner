import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@/test/utils'
import { COMPARE_ROW_IDS, COMPARE_ROW_LABELS, getComparePage } from '../../../content/compare'
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

	it('names the table and its three columns', () => {
		render(<ComparisonTable page={page} />)
		const table = screen.getByRole('table', {
			name: `Longhand Budget compared with ${page.competitorName}`,
		})
		const headers = within(table)
			.getAllByRole('columnheader')
			.map((th) => th.textContent)
		expect(headers).toEqual(['Row', 'Longhand Budget', page.competitorName])
	})

	it('puts the table in a scroll container so an overflow scrolls the card, not the page', () => {
		const { container } = render(<ComparisonTable page={page} />)
		const wrapper = container.firstElementChild
		expect(wrapper && [...wrapper.classList]).toContain('overflow-x-auto')
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
