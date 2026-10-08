import { describe, expect, it } from 'vitest'
import { DOC_PAGES } from '@/content/docs'
import { render, screen } from '@/test/utils'
import { DocsIndex } from '../docs-index'

describe('DocsIndex', () => {
	it('renders a link with description for every documentation page', () => {
		render(<DocsIndex />)
		for (const page of DOC_PAGES) {
			const link = screen.getByRole('link', { name: new RegExp(page.title, 'i') })
			expect(link).toHaveAttribute('href', `/docs/${page.slug}`)
			expect(screen.getByText(page.description)).toBeInTheDocument()
		}
	})
})

describe('DocsIndex theming', () => {
	it('uses the surface + text tokens on the card and its heading', () => {
		const { container } = render(<DocsIndex />)
		const section = container.querySelector('section')
		if (!section) throw new Error('missing section')
		expect([...section.classList]).toContain('surface')
		expect([...section.classList]).not.toContain('bg-white')
		expect([...section.classList]).toContain('rounded-lg')
		expect([...section.classList]).toContain('shadow-md')

		const heading = container.querySelector('h2')
		if (!heading) throw new Error('missing h2')
		expect([...heading.classList]).toContain('text-subheading')
		expect([...heading.classList]).not.toContain('text-gray-800')
	})

	it('gives each tile the interactive surface token with no raw bg/hover pair', () => {
		const { container } = render(<DocsIndex />)
		const tiles = [...container.querySelectorAll('li a')]
		expect(tiles.length).toBeGreaterThan(0)

		for (const tile of tiles) {
			const tokens = [...tile.classList]
			expect(tokens).toContain('surface-interactive')
			expect(tokens).not.toContain('bg-gray-50')
			expect(tokens).not.toContain('hover:bg-gray-100')
			// The two background tokens collide by source order, so never both.
			expect(tokens).not.toContain('surface-inset')

			const title = tile.querySelector('h3')
			if (!title) throw new Error('missing tile title')
			expect([...title.classList]).toContain('text-accent')
			expect([...title.classList]).not.toContain('text-blue-600')

			const description = tile.querySelector('p')
			if (!description) throw new Error('missing tile description')
			expect([...description.classList]).toContain('text-body')
			expect([...description.classList]).not.toContain('text-gray-600')
		}
	})
})
