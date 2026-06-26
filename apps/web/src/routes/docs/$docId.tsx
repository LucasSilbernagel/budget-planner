import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsLayout } from '../../components/docs/docs-layout'
import { MarkdownRenderer } from '../../components/docs/markdown-renderer'
import { getDocPage } from '../../content/docs'

/**
 * Individual documentation page route — `/docs/$docId` (story 4-10, AC-2).
 *
 * The page is resolved in a loader so an unknown slug throws `notFound()` and
 * renders the route's `notFoundComponent` with a real 404 status (correct for
 * crawlers/SEO) rather than a 200 "soft" not-found.
 */
export const Route = createFileRoute('/docs/$docId')({
  loader: ({ params }) => {
    const doc = getDocPage(params.docId)
    if (!doc) {
      throw notFound()
    }
    return { doc }
  },
  component: DocPage,
  notFoundComponent: DocNotFound,
})

function DocPage() {
  const { doc } = Route.useLoaderData()

  return (
    <DocsLayout title={doc.title} description={doc.description} activeSlug={doc.slug}>
      <section className="rounded-lg bg-white p-6 shadow-md">
        <MarkdownRenderer content={doc.content} />
      </section>
    </DocsLayout>
  )
}

function DocNotFound() {
  return (
    <DocsLayout title="Page not found">
      <section className="rounded-lg bg-white p-6 shadow-md">
        <p className="text-gray-600">
          We couldn't find that documentation page.{' '}
          <a href="/docs" className="text-blue-600 hover:underline">
            Return to the documentation index
          </a>
          .
        </p>
      </section>
    </DocsLayout>
  )
}
