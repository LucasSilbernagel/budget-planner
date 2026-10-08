import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { TERMS_PAGE } from '../content/legal'

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [
      { title: `${TERMS_PAGE.title} · Longhand Budget` },
      { name: 'description', content: TERMS_PAGE.description },
    ],
  }),
  component: TermsPage,
})

function TermsPage() {
  return <LegalPageView page={TERMS_PAGE} />
}
