import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { REFUND_PAGE } from '../content/legal'

/**
 * Public Refund & Cancellation Policy page — `/refund` (story 5-13, AC-1).
 *
 * Required for Paddle (Merchant of Record) seller approval. Public + static: no
 * auth, no premium gate, no DB.
 */
export const Route = createFileRoute('/refund')({
  // Title and description both come from the page constant, so the tab, the
  // search result and the page's own header can never drift apart.
  head: () => ({
    meta: [
      { title: `${REFUND_PAGE.title} · Longhand Budget` },
      { name: 'description', content: REFUND_PAGE.description },
    ],
  }),
  component: RefundPage,
})

function RefundPage() {
  return <LegalPageView page={REFUND_PAGE} />
}
