import { DOC_PAGES } from '../../content/docs'

/**
 * Documentation index listing (story 4-10, AC-1).
 *
 * Shows a card for every documentation page so readers can navigate to any
 * section from `/docs`.
 */
export function DocsIndex() {
  return (
    <section className="rounded-lg surface p-6 shadow-md">
      <h2 className="mb-4 text-xl font-semibold text-subheading">Documentation index</h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DOC_PAGES.map((page) => (
          <li key={page.slug}>
            {/* `.surface-interactive` bakes its own hover in — writing
                `hover:surface-inset` here would compile, lint and type-check
                cleanly and be a silent no-op (`global.css:82-97`). */}
            <a
              href={`/docs/${page.slug}`}
              className="block h-full rounded-lg surface-interactive p-4 transition-colors"
            >
              <h3 className="font-medium text-accent">{page.title}</h3>
              <p className="mt-1 text-sm text-body">{page.description}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
