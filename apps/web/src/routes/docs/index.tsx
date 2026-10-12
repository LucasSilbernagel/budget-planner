import { createFileRoute } from '@tanstack/react-router'
import { DocsIndex } from '../../components/docs/docs-index'
import { DocsLayout } from '../../components/docs/docs-layout'
import { canonicalLink } from '../../lib/seo/canonical'

export const Route = createFileRoute('/docs/')({
	head: () => ({
		meta: [
			{ title: 'Documentation · Longhand Budget' },
			{
				name: 'description',
				content: 'Guides and answers for getting the most out of Longhand Budget.',
			},
		],
		links: [canonicalLink('/docs')],
	}),
	component: DocsIndexPage,
})

function DocsIndexPage() {
	return (
		<DocsLayout
			title="Documentation"
			description="Guides and answers for getting the most out of Longhand Budget."
		>
			<DocsIndex />
		</DocsLayout>
	)
}
