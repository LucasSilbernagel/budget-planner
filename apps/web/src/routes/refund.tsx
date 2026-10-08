import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { REFUND_PAGE } from '../content/legal'

export const Route = createFileRoute('/refund')({
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
