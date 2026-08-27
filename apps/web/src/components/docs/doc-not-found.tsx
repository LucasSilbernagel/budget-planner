import { DocsLayout } from './docs-layout'

/**
 * The `notFoundComponent` for `/docs/$docId` (story 4-10, AC-2).
 *
 * The route's loader throws `notFound()` for an unknown slug, which renders
 * this component with a real HTTP 404 (correct for crawlers/SEO) rather than a
 * soft 200. It lives here rather than inside the route file so the router's
 * code splitter can split it out — a non-route export in a route file is left
 * un-split (BUG-C, story 39-1).
 *
 * In THIS file's case the splitter also printed a `[tanstack-router]` warning at
 * every `pnpm dev`, because `$docId`'s other split-eligible property (`component`)
 * was not exported and did split, so the transform ran and reached the warning.
 * That is not the general rule — see `routes/profiles.tsx` for the same defect
 * with no warning at all.
 *
 * ⚠️ Its theming is guarded by `__tests__/doc-not-found.test.tsx`, and that
 * guard exists for a reason: a code review (story 31-1) found all three of this
 * component's colour classes had been changed with zero coverage at any layer —
 * no unit test rendered it, and `theme-page-coverage.spec.ts` visits only valid
 * slugs, so no e2e ever reached it. Reverting any of the three turned nothing
 * red. Keep the guard.
 */
export function DocNotFound() {
  return (
    <DocsLayout title="Page not found">
      <section className="rounded-lg surface p-6 shadow-md">
        <p className="text-body">
          We couldn't find that documentation page.{' '}
          <a href="/docs" className="text-accent hover:underline">
            Return to the documentation index
          </a>
          .
        </p>
      </section>
    </DocsLayout>
  )
}
