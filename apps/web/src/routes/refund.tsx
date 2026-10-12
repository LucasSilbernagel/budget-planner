import { createFileRoute } from '@tanstack/react-router'
import { LegalPageView } from '../components/legal/legal-page-view'
import { REFUND_PAGE } from '../content/legal'
import { canonicalLink } from '../lib/seo/canonical'

export const Route = createFileRoute('/refund')({
	head: () => ({
		meta: [
			{ title: `${REFUND_PAGE.title} · Longhand Budget` },
			{ name: 'description', content: REFUND_PAGE.description },
		],
		links: [canonicalLink('/refund')],
	}),
	component: RefundPage,
})

function RefundPage() {
	return <LegalPageView page={REFUND_PAGE} />
}
