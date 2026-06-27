import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { PRICING_PAGE } from '../content/legal'

/**
 * Public pricing page — `/pricing` (story 5-13, AC-1/AC-4).
 *
 * Required for Paddle (Merchant of Record) seller approval. Public + static: no
 * auth, no premium gate, no DB.
 */
export const Route = createFileRoute('/pricing')({
  head: () => ({ meta: [{ title: `${PRICING_PAGE.title} · Budget Planner` }] }),
  component: PricingPage,
})

function PricingPage() {
  return <LegalPageView page={PRICING_PAGE} />
}
