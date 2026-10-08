import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from '@/content/docs'
import { render, screen, within } from '@/test/utils'
import { DocsSidebar } from '../sidebar'

describe('DocsSidebar', () => {
	it('renders an accessible nav with a link for every documentation page', () => {
		render(<DocsSidebar />)
		const nav = screen.getByRole('navigation', { name: /documentation/i })
		for (const page of DOC_PAGES) {
			const link = within(nav).getByRole('link', { name: page.title })
			expect(link).toHaveAttribute('href', `/docs/${page.slug}`)
		}
	})

	it('marks the active page with aria-current="page"', () => {
		render(<DocsSidebar activeSlug="faq" />)
		const active = screen.getByRole('link', { current: 'page' })
		expect(active).toHaveTextContent('FAQ')
	})

	it('marks no link as current when there is no active page', () => {
		render(<DocsSidebar />)
		expect(screen.queryByRole('link', { current: 'page' })).toBeNull()
	})
})

describe('DocsSidebar theming', () => {
	it('uses the muted token for the section label', () => {
		const { container } = render(<DocsSidebar />)
		const label = container.querySelector('h2')
		if (!label) throw new Error('missing sidebar label')
		expect([...label.classList]).toContain('text-muted')
		expect([...label.classList]).not.toContain('text-gray-500')
	})

	it('themes the ACTIVE branch without losing its accent pill or aria-current', () => {
		render(<DocsSidebar activeSlug="faq" />)
		const active = screen.getByRole('link', { current: 'page' })
		const tokens = [...active.classList]

		expect(tokens).toContain('text-accent')
		expect(tokens).toContain('bg-blue-50')
		expect(tokens).toContain('dark:bg-blue-950/40')
		expect(tokens).toContain('font-medium')
		expect(tokens).not.toContain('text-blue-700')
		expect(active).toHaveAttribute('aria-current', 'page')
	})

	it('themes the INACTIVE branch, hover included', () => {
		render(<DocsSidebar activeSlug="faq" />)
		const inactive = screen
			.getAllByRole('link')
			.filter((link) => link.getAttribute('aria-current') === null)
		expect(inactive.length).toBeGreaterThan(0)

		for (const link of inactive) {
			const tokens = [...link.classList]
			expect(tokens).toContain('text-label')
			expect(tokens).toContain('hover:bg-gray-100')
			expect(tokens).toContain('dark:hover:bg-gray-700/40')
			expect(tokens).not.toContain('text-gray-700')
			expect(tokens).not.toContain('bg-blue-50')
		}
	})
})
