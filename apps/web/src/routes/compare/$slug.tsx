import { createFileRoute, notFound } from '@tanstack/react-router'
import { CompareLayout } from '../../components/compare/compare-layout'
import { CompareNotFound } from '../../components/compare/compare-not-found'
import { ComparePageBody } from '../../components/compare/compare-page-body'
import { getComparePage } from '../../content/compare'
import { canonicalLink } from '../../lib/seo/canonical'
import { breadcrumbList, jsonLdScript } from '../../lib/seo/json-ld'

// `Route` must stay the only export: any other export defeats the router's code splitting.
export const Route = createFileRoute('/compare/$slug')({
	loader: ({ params }) => {
		const page = getComparePage(params.slug)
		if (!page) {
			throw notFound()
		}
		return { page }
	},
	// `loaderData` is undefined while pending and after notFound(), so fall back to the hub copy.
	head: ({ loaderData }) => {
		const page = loaderData?.page
		if (!page) {
			return {
				meta: [
					{ title: 'Compare · Longhand Budget' },
					{
						name: 'description',
						content: 'How Longhand Budget compares with other ways to budget.',
					},
				],
			}
		}
		return {
			meta: [
				{ title: `${page.title} · Longhand Budget` },
				{ name: 'description', content: page.description },
			],
			links: [canonicalLink(`/compare/${page.slug}`)],
			scripts: [
				jsonLdScript(
					breadcrumbList([
						{ name: 'Home', path: '/' },
						{ name: 'Compare', path: '/compare' },
						{ name: page.title, path: `/compare/${page.slug}` },
					])
				),
			],
		}
	},
	component: ComparePage,
	notFoundComponent: CompareNotFound,
})

function ComparePage() {
	const { page } = Route.useLoaderData()

	return (
		<CompareLayout title={page.title} description={page.description} activeSlug={page.slug}>
			<ComparePageBody page={page} />
		</CompareLayout>
	)
}
