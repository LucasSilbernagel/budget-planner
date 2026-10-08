import { DocsLayout } from './docs-layout'

// Lives outside the route file: a non-route export there stops the router code-splitting it.
export function DocNotFound() {
  return (
    <DocsLayout title="Page not found">
      <section className="rounded-lg surface p-6 shadow-md">
        <p className="text-body">
          We couldn't find that documentation page.{' '}
          <a href="/docs" className="text-accent underline">
            Return to the documentation index
          </a>
          .
        </p>
      </section>
    </DocsLayout>
  )
}
