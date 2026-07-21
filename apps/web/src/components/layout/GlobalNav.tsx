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
 * swaps to the bottom bar after hydration with no hydration mismatch. The bottom
 * bar is a 4-column grid (4x2) so eight destinations stay legible at 320px; the
 * root layout reserves `pb-24` (plus the iOS `safe-area-inset-bottom`) on narrow
 * viewports so the two-row fixed bar never covers the footer, and the bar itself
 * pads by that same inset so its bottom row clears the home indicator. Only one
 * `<nav>` landmark is ever in the DOM at a time.
 */

/** Registered route paths the nav links to — a subset of the app's route tree. */
type NavPath =
  | '/'
  | '/income'
  | '/expenses'
  | '/savings'
  | '/balance'
  | '/net-worth-projection'
  | '/retirement'
  | '/settings'

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
  // Story 19-2: label renamed "Projections" -> "Net Worth" so the nav matches the
  // page's own H1 ("Net Worth Projection") and the app's "Net Worth" vocabulary.
  // The route (`to`) is unchanged, so active-state/aria-current is unaffected.
  { label: 'Net Worth', to: '/net-worth-projection' },
  // Retirement Planner (story 15-1): promoted from a docs-only, nav-orphan route
  // to a first-class destination. Grouped with the other forward-looking planning
  // surface (Net Worth); stays FREE (Epic 15 is UX-only, no premium gate).
  { label: 'Retirement', to: '/retirement' },
  // Consolidated settings surface (story 11-6): the single home for the currency
  // and dark-mode controls that used to be scattered across page headers and the
  // footer.
  { label: 'Settings', to: '/settings' },
]

export function GlobalNav() {
  const isNarrow = useIsNarrowViewport()

  if (isNarrow) {
    return (
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-gray-700 dark:bg-gray-800"
      >
        {/* 4-column grid (4x2), not a single flex row (story 18-2). Eight
            destinations across a 320px viewport give a one-row flex layout only
            ~40px per cell, where every label ("Net Worth", "Retirement", even
            "Overview"/"Expenses") overflowed its cell and overlapped its
            neighbours. A 4-column grid gives ~80px cells at 320px, so each label
            stays single-line, legible and tappable (≥44px). The bar becomes two
            rows (~89px tall) — the root layout reserves `pb-24` on narrow
            viewports so the fixed bar still clears the Footer.

            Coupling to watch when NAV_ITEMS changes: `grid-cols-4` fixes 8 items
            at exactly 2 rows (4×2 ≈ 89px). A ninth item would spill to a third
            row (~133px) and re-cover the Footer, so a count change means
            revisiting BOTH `grid-cols-4` here and the `pb-24` reserve in
            `__root.tsx` — `e2e/chrome-320.spec.ts` guards that footer clearance.
            The `pb-[env(safe-area-inset-bottom)]` lifts the bottom row above the
            iOS home indicator (0 on non-notched devices, so the ~89px is exact
            there); the root reserve adds the same inset to stay in lockstep. */}
        <ul className="grid grid-cols-4">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="min-w-0">
              <Link
                to={item.to}
                activeOptions={item.exact ? { exact: true } : undefined}
                className="flex h-full min-h-[44px] items-center justify-center break-words px-1 py-2 text-center text-[11px] font-medium leading-tight text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
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
          wrapping, the eight items overflow a 320px viewport and push the
          document wider than the screen during that flash. Wrapping keeps it
          contained. */}
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
