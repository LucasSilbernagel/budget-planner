import type { ReactNode } from 'react'

/**
 * Lean shell for a standalone legal/commercial page (story 5-13).
 *
 * Unlike `DocsLayout`, this has no sidebar/TOC — these pages (Pricing, Terms,
 * Privacy, Refund) are standalone documents, not a navigable section. It
 * provides the page header (the single `<h1>`), an optional one-line
 * description, and a `<main>` landmark containing the page body, so the heading
 * outline and landmarks stay accessible.
 */

export interface LegalPageLayoutProps {
  /** Page title, rendered as the page's single `<h1>`. */
  title: string
  /** Optional one-line subtitle shown under the title. */
  description?: string
  /** Page body. */
  children: ReactNode
}

export function LegalPageLayout({ title, description, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to app
          </a>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{title}</h1>
          {description ? <p className="mt-2 text-gray-600">{description}</p> : null}
        </header>

        <main>
          <section className="rounded-lg bg-white p-6 shadow-md">{children}</section>
        </main>
      </div>
    </div>
  )
}
