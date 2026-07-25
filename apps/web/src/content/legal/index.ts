/**
 * Legal & commercial content registry (story 5-13).
 *
 * These are the public pages Paddle (our Merchant of Record) requires before it
 * will approve the seller account and activate billing: a pricing page, Terms of
 * Service, Privacy Policy, and a Refund/Cancellation policy.
 *
 * Following the documentation system (story 4-10), each page's body is authored
 * as a real static Markdown file and imported here as a raw string via Vite's
 * `?raw` suffix, then rendered through the shared `MarkdownRenderer`. Titles and
 * descriptions live here (not in Markdown front matter) so they are strongly
 * typed and so each `.md` body can start at an `<h2>` — the single `<h1>` per
 * page is the route header, which keeps the heading outline accessible.
 *
 * Unlike `/docs`, these live at top-level URLs (`/pricing`, `/terms`,
 * `/privacy`, `/refund`) because `login.tsx` already links to `/terms` and
 * `/privacy`, and Merchant-of-Record onboarding expects clean top-level URLs.
 */

import pricing from './pricing.md?raw'
import privacy from './privacy.md?raw'
import refund from './refund.md?raw'
import terms from './terms.md?raw'

export interface LegalPage {
  /** URL slug; also the top-level route path (e.g. `pricing` → `/pricing`). */
  readonly slug: string
  /** Human-readable title shown as the page's single `<h1>`. */
  readonly title: string
  /** One-line summary shown under the title and usable for metadata. */
  readonly description: string
  /** Raw Markdown body, loaded from the corresponding static `.md` file. */
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
  description: 'The terms that govern your use of SoluBudget.',
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

/** Canonical ordering used by the footer and any index listing. */
export const LEGAL_PAGES: readonly LegalPage[] = [
  PRICING_PAGE,
  TERMS_PAGE,
  PRIVACY_PAGE,
  REFUND_PAGE,
]

/** Look up a legal page by its slug, or `undefined` if none matches. */
export function getLegalPage(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((page) => page.slug === slug)
}
