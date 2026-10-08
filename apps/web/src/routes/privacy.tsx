import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { PRIVACY_PAGE } from '../content/legal'

export const Route = createFileRoute('/privacy')({
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
