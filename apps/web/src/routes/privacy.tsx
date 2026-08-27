import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { PRIVACY_PAGE } from '../content/legal'

/**
 * Public Privacy Policy page — `/privacy` (story 5-13, AC-1).
 *
 * Required for Paddle (Merchant of Record) seller approval; also resolves the
 * existing `/privacy` link in `login.tsx`. Public + static: no auth, no DB.
 */
export const Route = createFileRoute('/privacy')({
  // Title and description both come from the page constant, so the tab, the
  // search result and the page's own header can never drift apart.
  head: () => ({
    meta: [
      { title: `${PRIVACY_PAGE.title} · Longhand Budget` },
      { name: 'description', content: PRIVACY_PAGE.description },
    ],
  }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return <LegalPageView page={PRIVACY_PAGE} />
}
