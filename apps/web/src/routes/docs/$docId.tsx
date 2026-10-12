import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocNotFound } from '../../components/docs/doc-not-found'
import { DocsLayout } from '../../components/docs/docs-layout'
import { MarkdownRenderer } from '../../components/docs/markdown-renderer'
import { getDocPage } from '../../content/docs'

// `Route` must stay the only export: any other export defeats the router's code splitting.
export const Route = createFileRoute('/docs/$docId')({
	loader: ({ params }) => {
		const doc = getDocPage(params.docId)
		if (!doc) {
			throw notFound()
		}
		return { doc }
	},
	// `loaderData` is undefined while pending and after notFound(), so fall back to the section.
	head: ({ loaderData }) => {
		const doc = loaderData?.doc
		if (!doc) {
			return {
				meta: [
					{ title: 'Documentation · Longhand Budget' },
					{
						name: 'description',
						content: 'Guides and answers for getting the most out of Longhand Budget.',
					},
				],
			}
		}
		return {
			meta: [
				{ title: `${doc.title} · Longhand Budget` },
				{ name: 'description', content: doc.description },
			],
		}
	},
	component: DocPage,
	notFoundComponent: DocNotFound,
})

function DocPage() {
	const { doc } = Route.useLoaderData()

	return (
		<DocsLayout title={doc.title} description={doc.description} activeSlug={doc.slug}>
			<section className="rounded-lg surface p-6 shadow-md">
				<MarkdownRenderer content={doc.content} />
			</section>
		</DocsLayout>
	)
}
