import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { TERMS_PAGE } from '../content/legal'

/**
 * Public Terms of Service page — `/terms` (story 5-13, AC-1).
 *
 * Required for Paddle (Merchant of Record) seller approval; also resolves the
 * existing `/terms` link in `login.tsx`. Public + static: no auth, no DB.
 */
export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: `${TERMS_PAGE.title} · Budget Planner` }] }),
  component: TermsPage,
})

function TermsPage() {
  return <LegalPageView page={TERMS_PAGE} />
}
