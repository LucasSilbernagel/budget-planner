import { DOC_PAGES } from '@/content/docs'
import { render, screen, within } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { DocsSidebar } from '../sidebar'

/**
 * DocsSidebar tests (story 4-10, AC-1).
 *
 * Verifies the documentation table of contents links to every page and marks
 * the active page accessibly via `aria-current`.
 */
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
