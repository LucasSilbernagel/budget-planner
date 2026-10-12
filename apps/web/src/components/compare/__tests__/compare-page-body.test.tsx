import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/utils'
import {
	COMPARE_PAGES,
	type ComparePage,
	getComparePage,
	TRADEMARK_LINE,
} from '../../../content/compare'
import { ComparePageBody, siblingLinks } from '../compare-page-body'

const page = getComparePage('longhand-vs-spreadsheet')
if (!page) throw new Error('spreadsheet page missing')

function headings(): string[] {
	return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
}

describe('ComparePageBody', () => {
	it('orders the sections: verdict, table, competitor-better, Longhand-better, switching, FAQ', () => {
		render(<ComparePageBody page={page} />)
		const order = headings()
		const index = (label: string) => order.findIndex((h) => h.includes(label))
		expect(index('The short answer')).toBe(0)
		expect(index('Side by side')).toBeGreaterThan(index('The short answer'))
		expect(index(`Where ${page.competitorName} is better`)).toBeGreaterThan(index('Side by side'))
		expect(index('Where Longhand Budget is better')).toBeGreaterThan(
			index(`Where ${page.competitorName} is better`)
		)
		expect(index('Switching')).toBeGreaterThan(index('Where Longhand Budget is better'))
		expect(index('FAQ')).toBeGreaterThan(index('Switching'))
	})

	it('reads naturally mid-sentence: the competitor name is lowercase in the heading', () => {
		render(<ComparePageBody page={page} />)
		const heading = screen.getByRole('heading', {
			level: 2,
			name: `Where ${page.competitorName} is better`,
		})
		expect(heading.textContent).toMatch(/^Where a spreadsheet/)
	})

	it('shows the verdict and a dated line linking the named pricing page', () => {
		render(<ComparePageBody page={page} />)
		expect(screen.getByText(page.verdict)).toBeInTheDocument()
		const time = document.querySelector('time')
		expect(time).toHaveAttribute('dateTime', '2026-10-11')
		expect(time?.textContent).toBe('11 October 2026')
		const link = screen.getByRole('link', {
			name: `${page.competitorPricingLabel} (opens in a new tab)`,
		})
		expect(link).toHaveAttribute('href', page.competitorPricingUrl)
		expect(link).toHaveAttribute('rel', 'noopener noreferrer')
	})

	it('renders the verification date unformatted when it does not parse', () => {
		render(<ComparePageBody page={{ ...page, verifiedOn: 'not-a-date' }} />)
		expect(document.querySelector('time')?.textContent).toBe('not-a-date')
	})

	it('renders between four and six FAQ entries as h3 + paragraph', () => {
		render(<ComparePageBody page={page} />)
		const questions = screen
			.getAllByRole('heading', { level: 3 })
			.filter((h) => page.faq.some((f) => f.q === h.textContent))
		expect(questions.length).toBe(page.faq.length)
		expect(questions.length).toBeGreaterThanOrEqual(4)
		expect(questions.length).toBeLessThanOrEqual(6)
		expect(document.querySelector('dl')).toBeNull()
	})

	it('links the hub, pricing, privacy, two onward links, every source, and the trademark line', () => {
		render(<ComparePageBody page={page} />)
		expect(screen.getByRole('link', { name: 'Longhand Budget pricing' })).toHaveAttribute(
			'href',
			'/pricing'
		)
		expect(screen.getByRole('link', { name: 'Longhand Budget privacy policy' })).toHaveAttribute(
			'href',
			'/privacy'
		)
		for (const link of siblingLinks(page)) {
			expect(screen.getByRole('link', { name: link.label })).toHaveAttribute('href', link.href)
		}
		for (const source of page.sources) {
			expect(
				screen.getByRole('link', { name: `${source.label} (opens in a new tab)` })
			).toHaveAttribute('href', source.url)
		}
		expect(screen.getByText(TRADEMARK_LINE)).toBeInTheDocument()
	})

	it('shows no competitor imagery', () => {
		render(<ComparePageBody page={page} />)
		expect(document.querySelectorAll('img')).toHaveLength(0)
	})
})

describe('siblingLinks', () => {
	it('falls back to the hub and the features doc while this is the only spoke', () => {
		expect(COMPARE_PAGES.length).toBe(1)
		expect(siblingLinks(page)).toEqual([
			{ href: '/compare', label: 'All comparisons' },
			{ href: '/docs/features', label: 'Why Longhand Budget has no bank sync' },
		])
	})

	it('prefers real sibling spokes once they exist, in list order', () => {
		const a: ComparePage = { ...page, slug: 'longhand-vs-a', title: 'Longhand Budget vs A' }
		const b: ComparePage = { ...page, slug: 'longhand-vs-b', title: 'Longhand Budget vs B' }
		const c: ComparePage = { ...page, slug: 'longhand-vs-c', title: 'Longhand Budget vs C' }
		expect(siblingLinks(page, [page, a, b, c])).toEqual([
			{ href: '/compare/longhand-vs-a', label: 'Longhand Budget vs A' },
			{ href: '/compare/longhand-vs-b', label: 'Longhand Budget vs B' },
		])
		expect(siblingLinks(page, [page, a])).toEqual([
			{ href: '/compare/longhand-vs-a', label: 'Longhand Budget vs A' },
			{ href: '/compare', label: 'All comparisons' },
		])
	})
})
