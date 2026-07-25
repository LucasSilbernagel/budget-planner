import { Link } from '@tanstack/react-router'

/**
 * Branded 404 / not-found page (story 6-4, UX-DR12).
 *
 * Registered as the router-level `defaultNotFoundComponent` (see
 * `src/router.tsx`), so any unmatched route renders it. It is rendered inside
 * the root route's `<Outlet>` (`routes/__root.tsx`), which already supplies the
 * global `<Footer>`, ad slot, and `flex min-h-screen flex-col` shell — this
 * component therefore renders only the page's own content and must NOT re-mount
 * the footer or a second document shell.
 *
 * Branding matches the app's per-page idiom: the "SoluBudget" wordmark plus
 * the `bg-gray-50` / `p-4 sm:p-8` / `max-w-6xl` shell used by every page header
 * (e.g. `HomePage`). There is no shared layout component to import, so the
 * idiom is reproduced here rather than abstracted.
 *
 * Theme: this page is part of story 7.3's guaranteed dark-mode surface set (AC-2)
 * and carries `dark:` variants keyed off Tailwind's class strategy (the `.dark`
 * class the theme toggle sets on `<html>`). The variants are `dark:`
 * (class-driven) rather than `prefers-color-scheme`-driven, so the page follows
 * the in-app theme, not the OS. On the very first paint the no-flash `<head>`
 * script applies whatever theme is persisted; dark mode is free for every user
 * (story 25-3), so the chosen theme is simply honored — no tier check reverts it.
 *
 * Scope note: the docs section keeps its own contextual not-found (`DocNotFound`
 * in `routes/docs/$docId.tsx`, rendered inside `DocsLayout`) by design. This
 * component is the global fallback for every other unmatched route.
 *
 * A11y: exactly one `<h1>` (the "Page not found" subject); the decorative "404"
 * and the brand wordmark are non-heading text; the recovery control is a
 * keyboard-focusable `Link` with a visible focus ring.
 */
export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          {/* Brand wordmark — mirrors every page header's <h1>SoluBudget</h1>
              styling, but stays a non-heading node so the page keeps a single
              <h1> ("Page not found"). */}
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">SoluBudget</p>
        </header>

        <main className="flex flex-col items-center py-16 text-center sm:py-24">
          <p className="text-base font-semibold text-blue-600 dark:text-blue-400">404</p>
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-gray-100 sm:text-4xl">
            Page not found
          </h1>
          <p className="mt-4 max-w-md text-gray-600 dark:text-gray-400">
            Sorry, we couldn’t find the page you’re looking for.
          </p>
          <Link
            to="/"
            className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          >
            Go home
          </Link>
        </main>
      </div>
    </div>
  )
}
