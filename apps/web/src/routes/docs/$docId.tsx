import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocNotFound } from '../../components/docs/doc-not-found'
import { DocsLayout } from '../../components/docs/docs-layout'
import { MarkdownRenderer } from '../../components/docs/markdown-renderer'
import { getDocPage } from '../../content/docs'

/**
 * Individual documentation page route — `/docs/$docId` (story 4-10, AC-2).
 *
 * The page is resolved in a loader so an unknown slug throws `notFound()` and
 * renders the route's `notFoundComponent` with a real 404 status (correct for
 * crawlers/SEO) rather than a 200 "soft" not-found.
 *
 * `Route` is the ONLY export in this file. A non-route export here is left
 * un-code-split by the router plugin and warned about at every `pnpm dev`
 * (BUG-C, story 39-1) — `DocNotFound` lives in `components/docs/` for that
 * reason, and `e2e/docs-not-found.spec.ts` guards the wiring below.
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
      <section className="rounded-lg surface p-6 shadow-md">
        <MarkdownRenderer content={doc.content} />
      </section>
    </DocsLayout>
  )
}
