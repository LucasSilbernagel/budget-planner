import { DOC_PAGES } from '../../content/docs'

/**
 * Documentation index listing (story 4-10, AC-1).
 *
 * Shows a card for every documentation page so readers can navigate to any
 * section from `/docs`.
 */
export function DocsIndex() {
  return (
    <section className="rounded-lg bg-white p-6 shadow-md">
      <h2 className="mb-4 text-xl font-semibold text-gray-800">Documentation index</h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DOC_PAGES.map((page) => (
          <li key={page.slug}>
            <a
              href={`/docs/${page.slug}`}
              className="block h-full rounded-lg bg-gray-50 p-4 transition-colors hover:bg-gray-100"
            >
              <h3 className="font-medium text-blue-600">{page.title}</h3>
              <p className="mt-1 text-sm text-gray-600">{page.description}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
