import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { PRICING_PAGE, PRIVACY_PAGE, REFUND_PAGE, TERMS_PAGE } from '../../../content/legal'
import { LegalPageView } from '../legal-page-view'

/**
 * LegalPageView tests (story 5-13, AC-1/AC-2/AC-4/AC-5).
 *
 * The four routes are thin wrappers over this view, so rendering the view with
 * each page object exercises what those routes render: a single `<h1>` from the
 * page title, a `<main>` landmark, and the Markdown body via the shared
 * `MarkdownRenderer`.
 */
describe('LegalPageView', () => {
  it('renders the page title as the single h1', () => {
    renderWithProviders(<LegalPageView page={TERMS_PAGE} />)
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Terms of Service')
  })

  it('renders a main landmark', () => {
    renderWithProviders(<LegalPageView page={PRIVACY_PAGE} />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders the markdown body content', () => {
    renderWithProviders(<LegalPageView page={REFUND_PAGE} />)
    // The page <h1> (title) is owned by the layout; the body contributes its
    // own h2 sections — assert one of those renders (and is not a repeat of the
    // title, which the registry test enforces separately).
    expect(
      screen.getByRole('heading', { level: 2, name: /cancelling your subscription/i })
    ).toBeInTheDocument()
  })

  it('surfaces the Merchant-of-Record disclosure on the pricing page (AC-4)', () => {
    renderWithProviders(<LegalPageView page={PRICING_PAGE} />)
    expect(screen.getByText(/Merchant of Record/i)).toBeInTheDocument()
  })
})
