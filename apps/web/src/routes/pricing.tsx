import { createFileRoute } from '@tanstack/react-router'
import { PricingPageView } from '../components/pricing/pricing-page'
import { PRICING_PAGE } from '../content/legal'

/**
 * Public pricing page — `/pricing` (story 5-13, AC-1/AC-4; UX review #5).
 *
 * Required for Paddle (Merchant of Record) seller approval. Public + static: no
 * auth, no premium gate, no DB. Renders the two-plan comparison + CTA view; the
 * authoritative billing/legal prose it shows still comes from `PRICING_PAGE`.
 */
export const Route = createFileRoute('/pricing')({
  head: () => ({ meta: [{ title: `${PRICING_PAGE.title} · Longhand Budget` }] }),
  component: PricingPage,
})

function PricingPage() {
  return <PricingPageView />
}
