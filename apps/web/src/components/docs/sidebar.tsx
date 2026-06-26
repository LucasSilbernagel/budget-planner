import { DOC_PAGES } from '../../content/docs'

/**
 * Documentation table-of-contents sidebar (story 4-10, AC-1).
 *
 * Lists every documentation page in registry order and highlights the page the
 * reader is currently on. Plain anchors are used for navigation to match the
 * rest of the app (e.g. the home page nav), keeping the component router-free
 * and easy to test; the destinations are real TanStack Router routes.
 */

export interface DocsSidebarProps {
  /** Slug of the page currently being viewed; omitted on the docs index. */
  activeSlug?: string
}

export function DocsSidebar({ activeSlug }: DocsSidebarProps) {
  return (
    <nav aria-label="Documentation" className="sm:sticky sm:top-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Documentation
      </h2>
      <ul className="space-y-1">
        {DOC_PAGES.map((page) => {
          const isActive = page.slug === activeSlug
          return (
            <li key={page.slug}>
              <a
                href={`/docs/${page.slug}`}
                aria-current={isActive ? 'page' : undefined}
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 font-medium text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {page.title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
