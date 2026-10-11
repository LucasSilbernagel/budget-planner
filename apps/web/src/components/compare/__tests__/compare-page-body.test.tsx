import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/utils'
import { COMPARE_PAGES, type ComparePage, getComparePage } from '../../../content/compare'
import { ComparePageBody, siblingLinks, TRADEMARK_LINE } from '../compare-page-body'

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

	it('shows the verdict and a dated, linked verification line', () => {
		render(<ComparePageBody page={page} />)
		expect(screen.getByText(page.verdict)).toBeInTheDocument()
		const time = document.querySelector('time')
		expect(time).toHaveAttribute('dateTime', '2026-10-11')
		expect(time?.textContent).toBe('11 October 2026')
		const link = screen.getByRole('link', {
			name: `${page.competitorName} pricing (opens in a new tab)`,
		})
		expect(link).toHaveAttribute('href', page.competitorPricingUrl)
		expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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
	it('falls back to two distinct hub links while this is the only spoke', () => {
		expect(COMPARE_PAGES.length).toBe(1)
		const links = siblingLinks(page)
		expect(links).toHaveLength(2)
		expect(links.map((l) => l.href)).toEqual(['/compare', '/compare'])
		expect(new Set(links.map((l) => l.label)).size).toBe(2)
	})

	it('prefers real sibling spokes once they exist', () => {
		const other: ComparePage = {
			...page,
			slug: 'longhand-vs-other',
			title: 'Longhand Budget vs Other',
		}
		const links = siblingLinks({ ...page, slug: 'longhand-vs-nobody' })
		// COMPARE_PAGES holds only the spreadsheet page, so it is the one real sibling of a stranger.
		expect(links[0]).toEqual({ href: `/compare/${page.slug}`, label: page.title })
		expect(links[1]?.href).toBe('/compare')
		expect(other.slug).not.toBe(page.slug)
	})
})
