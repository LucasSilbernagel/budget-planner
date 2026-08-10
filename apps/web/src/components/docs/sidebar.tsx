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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
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
                // No semantic token exists for the blue-50 active pill or the
                // inactive hover, so those two keep hand-rolled `dark:` variants
                // following the shipped info-panel convention
                // (`routes/profiles.tsx:101`). The text colours use the tokens.
                className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/40 font-medium text-accent'
                    : 'text-label hover:bg-gray-100 dark:hover:bg-gray-700/40'
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
