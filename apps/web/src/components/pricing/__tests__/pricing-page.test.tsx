import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSeedProvider } from '../../../context/session-seed'
import { PREMIUM_BENEFIT_IDS } from '../../../lib/premium/benefits'
import { PricingPageView } from '../pricing-page'

// Stub the CTA's mount-time config fetch; these tests never click it.
const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ isConfigured: false }), { status: 200 }))
  ) as typeof global.fetch
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function card(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name, level: 2 })
  const el = heading.closest('div')
  if (!el) throw new Error(`No card container found for the "${name}" plan`)
  return el
}

describe('PricingPageView benefit lists', () => {
  it('lists exactly the canonical Premium benefit set — no Dark mode, no No ads', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    // Derived from PREMIUM_BENEFIT_IDS, so an extra bullet fails.
    expect(premium.getAllByRole('listitem')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

    expect(premium.getByText('Multi-device sync, securely stored in the EU')).toBeInTheDocument()
    expect(
      premium.getByText('Advanced forecasting — save, search, and reload what-if scenarios')
    ).toBeInTheDocument()
    expect(premium.getByText('Custom profiles (e.g. personal vs. household)')).toBeInTheDocument()
    expect(
      premium.getByText(
        'Financial summary report — save your budget, net worth and savings as a PDF from your browser'
      )
    ).toBeInTheDocument()
    expect(
      premium.getByText(
        'Custom income and expense categories, with a breakdown of what each one totals'
      )
    ).toBeInTheDocument()

    expect(premium.queryByText(/dark mode/i)).not.toBeInTheDocument()
    expect(premium.queryByText(/no ads/i)).not.toBeInTheDocument()
  })

  it('does not list dark mode under the Free plan either (story 95.1, FR154)', () => {
    render(<PricingPageView />)
    const free = within(card('Free'))
    expect(free.getByText('Retirement modelling')).toBeInTheDocument()
    expect(free.queryByText(/dark mode/i)).not.toBeInTheDocument()
  })
})

describe('PricingPageView pricing (stories 25-2, 5-20)', () => {
  it('anchors on €39 / year and offers monthly and lifetime alongside it', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    expect(premium.getByText('€39')).toBeInTheDocument()
    expect(premium.getByText('/ year')).toBeInTheDocument()
    expect(premium.getByText(/€99 once — lifetime license/)).toBeInTheDocument()
    expect(premium.getByText(/€5\.99 \/ month/)).toBeInTheDocument()

    // Derived, not a literal: a literal would stay green if the prices changed.
    const savingPct = Math.round((1 - 39 / (5.99 * 12)) * 100)
    expect(premium.getByText(new RegExp(`annual saves ${savingPct}%`))).toBeInTheDocument()

    expect(premium.queryByText('€10')).not.toBeInTheDocument()
    expect(premium.queryByText(/two months free/)).not.toBeInTheDocument()
  })

  it('does not raise the pinned €39 and €99 figures (5-20 AC-2)', () => {
    render(<PricingPageView />)
    const premium = within(card('Premium'))

    expect(premium.getByText('€39')).toBeInTheDocument()
    expect(premium.getByText(/€99 once/)).toBeInTheDocument()
    expect(premium.queryByText(/€49|€59|€129|€149/)).not.toBeInTheDocument()
  })
})

describe('PricingPageView forecasting honesty (story 20-1, re-homed in 20-4, updated in 30-2)', () => {
  it('states the reload claim exactly once and never overpromises side-by-side', () => {
    render(<PricingPageView />)

    expect(
      within(card('Premium')).getByText(
        'Advanced forecasting — save, search, and reload what-if scenarios'
      )
    ).toBeInTheDocument()

    expect(screen.getAllByText(/reload/i)).toHaveLength(1)

    expect(screen.queryByText(/side[\s-]by[\s-]side/i)).not.toBeInTheDocument()
  })
})

describe('PricingPageView de-duplication + billing disclaimer (story 20-4)', () => {
  it('states each plan/price once — the Free/Premium feature lists are not repeated in the prose', () => {
    render(<PricingPageView />)

    expect(
      screen.getByText('Track income, expenses, savings goals, and balances')
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Track income, expenses/i)).toHaveLength(1)
    expect(screen.getAllByText(/Everything in Free, plus/i)).toHaveLength(1)
  })

  it('keeps the balanced disclaimer line with its Paddle Merchant-of-Record + EUR disclosure', () => {
    render(<PricingPageView />)

    expect(
      screen.getByText(/Billed\s+securely by Paddle, our Merchant of Record/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Prices shown in EUR/i)).toBeInTheDocument()
  })
})

/** Classes only: a duplicate text label would break the count assertions above. */
const RETIRED_BY_PROPERTY = {
  bg: ['bg-white', 'bg-gray-50', 'bg-gray-100'],
  text: [
    'text-gray-900',
    'text-gray-800',
    'text-gray-700',
    'text-gray-600',
    'text-gray-500',
    'text-gray-400',
  ],
  border: ['border-gray-200', 'border-gray-300'],
} as const

const VARIANT_PREFIXES = ['', 'hover:', 'focus:', 'active:'] as const

/** Paired by property and variant: `bg-white` is legitimate on the outlined CTA, which has its own dark fill. */
function lightOnlyLeaks(root: HTMLElement): string[] {
  const leaks: string[] = []
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const tokens = [...element.classList]
    for (const [property, retired] of Object.entries(RETIRED_BY_PROPERTY)) {
      for (const variant of VARIANT_PREFIXES) {
        const hit = retired.find((token) => tokens.includes(`${variant}${token}`))
        if (!hit) continue
        const counter = `dark:${variant}${property}-`
        if (!tokens.some((token) => token.startsWith(counter))) {
          leaks.push(`${variant}${hit} on <${element.tagName.toLowerCase()}> (want ${counter}*)`)
        }
      }
    }
  }
  return leaks
}

describe('PricingPageView theming', () => {
  it('uses the semantic tokens for the page shell, disclaimer and prose card', () => {
    const { container } = render(<PricingPageView />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing page root')

    expect([...root.classList]).toContain('surface-sunken')

    const backLink = root.querySelector('a[href="/"]')
    if (!(backLink instanceof HTMLElement)) throw new Error('missing back link')
    expect([...backLink.classList]).toContain('text-accent')

    const heading = root.querySelector('h1')
    if (!heading) throw new Error('missing h1')
    expect([...heading.classList]).toContain('text-heading')

    const disclaimer = screen.getByText(/Prices shown in EUR/i)
    expect([...disclaimer.classList]).toContain('text-muted')
    expect([...disclaimer.classList]).toContain('text-balance')

    // Anchored structurally, not by text: "Merchant of Record" appears in BOTH
    // the disclaimer <p> and the rendered prose, so a text query is ambiguous.
    const proseCard = container.querySelector('article.prose')?.closest('section')
    if (!proseCard) throw new Error('missing prose card')
    expect([...proseCard.classList]).toContain('surface')
    expect([...proseCard.classList]).not.toContain('bg-white')
  })

  it('keeps the recommended plan visually ranked in BOTH themes', () => {
    render(<PricingPageView />)

    const premium = [...card('Premium').classList]
    expect(premium).toContain('surface')
    expect(premium).not.toContain('bg-white')
    expect(premium).toContain('border-blue-500')
    expect(premium).toContain('ring-1')
    expect(premium).toContain('ring-blue-500')
    expect(premium).toContain('dark:border-blue-400')
    expect(premium).toContain('dark:ring-blue-400')

    const free = [...card('Free').classList]
    expect(free).toContain('surface')
    expect(free).toContain('border-default')
    expect(free).not.toContain('border-gray-200')
    expect(free).not.toContain('ring-1')

    const badge = screen.getByText('Recommended')
    expect([...badge.classList]).toContain('bg-blue-600')
    expect([...badge.classList]).toContain('text-white')
  })

  it('themes the plan card body text and the positive check glyph', () => {
    render(<PricingPageView />)
    const premium = card('Premium')
    // Scoped to the card: the €99 lifetime line also appears in the prose below,
    // so a page-level text query is ambiguous.
    const inCard = within(premium)

    const name = premium.querySelector('h2')
    if (!name) throw new Error('missing plan name')
    expect([...name.classList]).toContain('text-heading')

    expect([...inCard.getByText('€39').classList]).toContain('text-heading')
    expect([...inCard.getByText('/ year').classList]).toContain('text-muted')
    expect([...inCard.getByText(/€99 once/).classList]).toContain('text-muted')
    expect([...inCard.getByText('Everything in Free, plus:').classList]).toContain('text-label')

    const feature = inCard.getByText('Custom profiles (e.g. personal vs. household)').closest('li')
    if (!feature) throw new Error('missing feature row')
    expect([...feature.classList]).toContain('text-body')

    const glyph = feature.querySelector('svg')
    if (!glyph) throw new Error('missing check glyph')
    expect([...glyph.classList]).toContain('text-green-600')
    expect([...glyph.classList]).toContain('dark:text-green-400')
  })

  it('gives the solid CTA a fixed blue-600 fill and the outlined CTA a gray-700 dark fill', () => {
    // A `null` seed means unverified and hides the CTA; the real page carries an authoritative
    // signed-out seed.
    render(
      <SessionSeedProvider
        seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
      >
        <PricingPageView />
      </SessionSeedProvider>
    )

    const primary = [...screen.getByRole('button', { name: 'Get Premium' }).classList]
    expect(primary).toContain('bg-blue-600')
    expect(primary).toContain('hover:bg-blue-700')
    expect(primary).toContain('text-white')
    // The invariant, not one token: any dark background override reintroduces the AA failure.
    expect(primary.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
    expect(primary.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])

    const outlined = [...screen.getByRole('link', { name: 'Start for free' }).classList]
    expect(outlined).toContain('dark:border-gray-600')
    expect(outlined).toContain('dark:text-gray-200')
    expect(outlined).toContain('dark:hover:bg-gray-600')
    expect(outlined.filter((token) => token.startsWith('dark:bg-'))).toEqual(['dark:bg-gray-700'])

    for (const tokens of [primary, outlined]) {
      expect(tokens).toContain('focus-visible:ring-2')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      expect(tokens).toContain('focus-visible:ring-offset-2')
      expect(tokens).toContain('dark:focus-visible:ring-offset-gray-800')
    }
  })

  it('leaves no light-only colour value without a dark counterpart', () => {
    const { container } = render(<PricingPageView />)
    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing page root')
    expect(lightOnlyLeaks(root)).toEqual([])
  })
})
