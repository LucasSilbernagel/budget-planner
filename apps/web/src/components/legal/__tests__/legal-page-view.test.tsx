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

/**
 * Theming guards (story 31-1, AC-4/AC-7/AC-8).
 *
 * `LegalPageLayout` is the single funnel for `/privacy`, `/terms` and `/refund`
 * — none of those route files carries a className — so asserting the view here
 * covers all three. Class-TOKEN membership, never substring.
 */

/**
 * The retired light-only set, kept IDENTICAL across every subtree sweep in this
 * story. A code review found this list had silently omitted `text-gray-700` and
 * `border-gray-200` that the docs sweep carried, so a legal page could reacquire
 * either and stay green. Any addition here must be made in all four sweeps.
 */
const RETIRED_LIGHT_ONLY_TOKENS = [
  'bg-white',
  'bg-gray-50',
  'text-gray-900',
  'text-gray-800',
  'text-gray-700',
  'text-gray-600',
  'text-gray-500',
  'text-blue-600',
  'text-blue-700',
  'border-gray-200',
] as const
describe('LegalPageView theming', () => {
  it('uses the semantic tokens for canvas, header chrome and the document card', () => {
    const { container } = renderWithProviders(<LegalPageView page={TERMS_PAGE} />)

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing layout root')
    expect([...root.classList]).toContain('surface-sunken')
    expect([...root.classList]).toContain('min-h-screen')

    const backLink = root.querySelector('a[href="/"]')
    if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
    expect([...backLink.classList]).toContain('text-accent')

    const heading = root.querySelector('h1')
    if (!heading) throw new Error('missing h1')
    expect([...heading.classList]).toContain('text-heading')

    const description = root.querySelector('header p')
    if (!description) throw new Error('missing description')
    expect([...description.classList]).toContain('text-body')

    const card = root.querySelector('main section')
    if (!card) throw new Error('missing document card')
    expect([...card.classList]).toContain('surface')
    expect([...card.classList]).not.toContain('bg-white')
    expect([...card.classList]).toContain('shadow-md')
  })

  it('leaves no light-only colour token anywhere on a legal page', () => {
    const { container } = renderWithProviders(<LegalPageView page={PRIVACY_PAGE} />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing layout root')
    const classes = [root, ...root.querySelectorAll('*')].flatMap((element) => [
      ...element.classList,
    ])

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
    // The prose body inverts with the page rather than staying light on a dark card.
    expect(classes).toContain('dark:prose-invert')
  })
})
