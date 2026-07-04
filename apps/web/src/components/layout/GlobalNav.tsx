import { Link } from '@tanstack/react-router'
import { useIsNarrowViewport } from '../../hooks/useIsNarrowViewport'

/**
 * Persistent global navigation (story 11-1, Epic 11 UX review P0-a).
 *
 * Mounted once in `routes/__root.tsx` so every route carries the same primary
 * navigation — replacing the ad-hoc, inconsistent per-page "Back to Home / View
 * X" footer link blocks each page used to hand-roll. Exposes the six top-level
 * sections. The premium *Forecasting* entry is intentionally NOT duplicated
 * here: it stays surfaced-but-locked on the Home dashboard via the Story 7-2
 * `PremiumFeatureGate`, so the primary nav needs no second premium gate to
 * maintain (scope decision, 2026-07-03).
 *
 * Active state is driven by TanStack Router `<Link>` `activeProps` (not a
 * hand-rolled `useLocation` comparison), which applies both the active styling
 * and `aria-current="page"` when the link matches the current route. The
 * Overview (`/`) link uses `activeOptions={{ exact: true }}` so it is not marked
 * active on every sub-route (every path is prefixed by `/`).
 *
 * Responsive (AC-3): desktop renders a top bar; narrow/PWA viewports render a
 * fixed bottom tab bar (the pattern Task 3 recommends), switched via the shared
 * `useIsNarrowViewport` hook. That hook is SSR-safe and returns `false` on the
 * server and first client render, so SSR always emits the top bar and mobile
 * swaps to the bottom bar after hydration with no hydration mismatch. The root
 * layout reserves `pb-16` on narrow viewports so the fixed bar never covers the
 * footer. Only one `<nav>` landmark is ever in the DOM at a time.
 */

/** Registered route paths the nav links to — a subset of the app's route tree. */
type NavPath = '/' | '/income' | '/expenses' | '/savings' | '/balance' | '/net-worth-projection'

interface NavItem {
  label: string
  to: NavPath
  /**
   * Match this route exactly. Only `/` needs it: without `exact`, the Overview
   * link would be considered active on every route (all paths start with `/`).
   */
  exact?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', to: '/', exact: true },
  { label: 'Income', to: '/income' },
  { label: 'Expenses', to: '/expenses' },
  { label: 'Savings', to: '/savings' },
  { label: 'Balance', to: '/balance' },
  { label: 'Projections', to: '/net-worth-projection' },
]

export function GlobalNav() {
  const isNarrow = useIsNarrowViewport()

  if (isNarrow) {
    return (
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      >
        <ul className="flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="min-w-0 flex-1">
              <Link
                to={item.to}
                activeOptions={item.exact ? { exact: true } : undefined}
                className="flex min-h-[44px] items-center justify-center break-words px-1 py-2 text-center text-[11px] font-medium leading-tight text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                activeProps={{
                  'aria-current': 'page',
                  className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav
      aria-label="Primary"
      className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
    >
      {/* `flex-wrap`: SSR + the first client render always emit this top bar
          (useIsNarrowViewport is false until after mount), so on a phone it is
          briefly visible before hydration swaps in the bottom bar. Without
          wrapping, the six items overflow a 320px viewport and push the document
          wider than the screen during that flash. Wrapping keeps it contained. */}
      <ul className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 py-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className="inline-block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
              activeProps={{
                'aria-current': 'page',
                className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
              }}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
