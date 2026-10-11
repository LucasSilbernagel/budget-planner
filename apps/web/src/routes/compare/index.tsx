import { createFileRoute } from '@tanstack/react-router'
import { CompareHub, HUB_DESCRIPTION, HUB_TITLE } from '../../components/compare/compare-hub'
import { CompareLayout } from '../../components/compare/compare-layout'
import { canonicalLink } from '../../lib/seo/canonical'
import { breadcrumbList, jsonLdScript, longhandSoftwareApplication } from '../../lib/seo/json-ld'

export const Route = createFileRoute('/compare/')({
	head: () => ({
		meta: [
			{ title: 'Compare · Longhand Budget' },
			{ name: 'description', content: HUB_DESCRIPTION },
		],
		links: [canonicalLink('/compare')],
		scripts: [
			jsonLdScript(
				breadcrumbList([
					{ name: 'Home', path: '/' },
					{ name: 'Compare', path: '/compare' },
				])
			),
			jsonLdScript(longhandSoftwareApplication()),
		],
	}),
	component: CompareIndexPage,
})

function CompareIndexPage() {
	return (
		<CompareLayout title={HUB_TITLE} description={HUB_DESCRIPTION}>
			<CompareHub />
		</CompareLayout>
	)
}
