import { DOC_PAGES } from '../../content/docs'

export interface DocsSidebarProps {
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
                // No semantic token exists for the active pill or inactive hover, hence the hand-rolled dark: variants.
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
