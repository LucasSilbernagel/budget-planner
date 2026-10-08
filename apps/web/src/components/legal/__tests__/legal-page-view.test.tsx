import { renderWithProviders, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { PRICING_PAGE, PRIVACY_PAGE, REFUND_PAGE, TERMS_PAGE } from '../../../content/legal'
import { LegalPageView } from '../legal-page-view'

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
    expect(
      screen.getByRole('heading', { level: 2, name: /cancelling your subscription/i })
    ).toBeInTheDocument()
  })

  it('surfaces the Merchant-of-Record disclosure on the pricing page (AC-4)', () => {
    renderWithProviders(<LegalPageView page={PRICING_PAGE} />)
    expect(screen.getByText(/Merchant of Record/i)).toBeInTheDocument()
  })
})

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
    expect(classes).toContain('dark:prose-invert')
  })
})
