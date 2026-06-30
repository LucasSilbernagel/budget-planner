import type { ReactNode } from 'react'
import { DocsSidebar } from './sidebar'

/**
 * Shared shell for every documentation page (story 4-10, AC-1).
 *
 * Renders the page header (with the single `<h1>` for the page), the sidebar
 * table of contents, and the page body. Both the docs index and individual doc
 * pages wrap their content in this layout so navigation and chrome stay
 * consistent across the `/docs` section.
 */

export interface DocsLayoutProps {
  /** Page title, rendered as the page's single `<h1>`. */
  title: string
  /** Optional one-line subtitle shown under the title. */
  description?: string
  /** Slug of the active page, forwarded to the sidebar for highlighting. */
  activeSlug?: string
  /** Page body. */
  children: ReactNode
}

export function DocsLayout({ title, description, activeSlug, children }: DocsLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to app
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{title}</h1>
          {description ? <p className="mt-2 text-gray-600">{description}</p> : null}
        </header>

        <div className="flex flex-col gap-8 sm:flex-row">
          <aside className="sm:w-56 sm:flex-shrink-0">
            <DocsSidebar activeSlug={activeSlug} />
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  )
}
