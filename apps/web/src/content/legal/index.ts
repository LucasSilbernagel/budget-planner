import pricing from './pricing.md?raw'
import privacy from './privacy.md?raw'
import refund from './refund.md?raw'
import terms from './terms.md?raw'

export interface LegalPage {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly content: string
}

export const PRICING_PAGE: LegalPage = {
  slug: 'pricing',
  title: 'Pricing',
  description: 'Free and Premium plans, and how billing works.',
  content: pricing,
}

export const TERMS_PAGE: LegalPage = {
  slug: 'terms',
  title: 'Terms of Service',
  description: 'The terms that govern your use of Longhand Budget.',
  content: terms,
}

export const PRIVACY_PAGE: LegalPage = {
  slug: 'privacy',
  title: 'Privacy Policy',
  description: 'What data we handle and how we protect it.',
  content: privacy,
}

export const REFUND_PAGE: LegalPage = {
  slug: 'refund',
  title: 'Refund & Cancellation Policy',
  description: 'How cancellations and refunds work.',
  content: refund,
}

export const LEGAL_PAGES: readonly LegalPage[] = [
  PRICING_PAGE,
  TERMS_PAGE,
  PRIVACY_PAGE,
  REFUND_PAGE,
]

export function getLegalPage(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((page) => page.slug === slug)
}
