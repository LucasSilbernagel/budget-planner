import { DOC_PAGES } from '@/content/docs'
import { render, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { DocsIndex } from '../docs-index'

/**
 * DocsIndex tests (story 4-10, AC-1).
 *
 * Confirms the index lists a navigable entry, with description, for every
 * documentation page.
 */
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
