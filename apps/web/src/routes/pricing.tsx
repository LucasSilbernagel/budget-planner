import { createFileRoute } from '@tanstack/react-router'
import { PricingPageView } from '../components/pricing/pricing-page'
import { PRICING_PAGE } from '../content/legal'

export const Route = createFileRoute('/pricing')({
	head: () => ({
		meta: [
			{ title: `${PRICING_PAGE.title} · Longhand Budget` },
			{ name: 'description', content: PRICING_PAGE.description },
		],
	}),
	component: PricingPage,
})

function PricingPage() {
	return <PricingPageView />
}
