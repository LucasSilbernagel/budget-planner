import { Link } from '@tanstack/react-router'

/**
 * Persistent global navigation (story 11-1, Epic 11 UX review P0-a).
 *
 * Mounted once in `routes/__root.tsx` so every route carries the same primary
 * navigation — replacing the ad-hoc, inconsistent per-page "Back to Home / View
 * X" footer link blocks each page used to hand-roll. Exposes the eight top-level
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
 * ## Responsive: ONE DOM subtree, switched by CSS alone (story 31.4)
 *
 * There is exactly one `<nav>`, one `<ul>` and eight `<a>` in the DOM at every
 * viewport. Desktop (>= 640px) is the unprefixed cascade — an in-flow top bar;
 * below `sm` the SAME elements become a fixed bottom tab bar via `max-sm:`
 * utilities. No JavaScript decides the layout, so the first painted frame is
 * already the final frame and there is no hydration race left to lose.
 *
 * ⚠️ That last claim is engine-independent BY CONSTRUCTION, not by test
 * coverage: the automated gate is chromium-only (`playwright.config.ts:24-29`).
 * Gecko was checked once by hand (Firefox 153.0.3, 320px: `matchMedia` true,
 * `position: fixed`, geometry matching Chromium) but nothing re-checks it on
 * every run. Treat cross-engine parity as reasoned, not regression-tested.
 *
 * This replaced a `useIsNarrowViewport()` branch that returned two different
 * subtrees. That hook is `false` on the server AND on the first client render,
 * so a phone painted the desktop top bar, then hydration unmounted it and
 * mounted the bottom bar: a measured 133px vertical jump at 320px (the header
 * wrapper 165px -> 32px, the page `<h1>` from y=181 to y=48). That is the reflow
 * logged in `deferred-work.md:500` on day one, which prescribed exactly this
 * fix. The hook itself is KEPT and unchanged — four Recharts call sites take
 * numeric/enum props CSS cannot drive — this component simply stopped being one
 * of its consumers.
 *
 * Two alternatives are rejected and must not be reintroduced (the same pair
 * `ui/ResponsiveTable.tsx:19-30` rejects for the finance tables): a DUAL-RENDER
 * (`hidden sm:block` top bar + `sm:hidden` bottom bar) would put two
 * `<nav aria-label="Primary">` landmarks in the DOM — an a11y regression, a
 * Playwright strict-mode violation, and a multi-match failure in jsdom, which
 * applies no media queries; and any viewport hook re-creates the flash. Only one
 * `<nav>` landmark is ever in the DOM.
 *
 * Composition rule (`ui/ResponsiveTable.tsx:31-39`): mobile-only styling on a
 * shared element is a `max-sm:` variant APPENDED to the unchanged desktop
 * string. Never neutralise a base class with an unprefixed override — that is
 * what keeps ">= 640px is unchanged" provable by reading the diff.
 *
 * ⚠️ On the LINKS, keep every colour unprefixed. Tailwind emits all `max-sm:`
 * rules AFTER the unprefixed utilities, so a `max-sm:` colour would beat the
 * links' unprefixed `hover:bg-gray-100` / `hover:text-gray-900` below 640px and
 * silently invert mobile hover behaviour; scope only layout/position/spacing/
 * typography there. The `<nav>` itself is the deliberate exception — it has no
 * unprefixed colour state to lose, and its `max-sm:` background/border are
 * required precisely because the bar is out of flow below `sm` (see below).
 *
 * The bottom bar is a 4-column grid (4x2) so eight destinations stay legible at
 * 320px; the root layout reserves `pb-[calc(6rem_+_env(safe-area-inset-bottom))]`
 * on narrow viewports so the two-row fixed bar never covers the footer, and the
 * bar itself pads by that same inset so its bottom row clears the home
 * indicator. `e2e/nav-responsive-css.spec.ts` is the guard for all of it.
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
  return (
    <nav
      aria-label="Primary"
      // At >= 640px the nav carries NO chrome of its own: the border + background
      // live on the `__root.tsx` wrapper so the nav and the account indicator
      // read as ONE bar (story 19-3). Below `sm` the bar is `fixed` — out of
      // flow, and therefore beyond the reach of that `sm:`-gated wrapper chrome
      // — so it owns its border-top and background there.
      className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:pb-[env(safe-area-inset-bottom)] dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {/* `flex-wrap` is LOAD-BEARING at >= 640px — do not remove it. It arrived
          (commit d4f3ffb) to contain the eight items during the old
          pre-hydration flash, but the desktop bar is already two rows in its own
          right from 640px to ~830px. Measured with the class removed: the row
          wants 778px, so a 640px viewport overflows by 138px, 700px by 78px and
          760px by 18px, clearing only at 800px. Nothing used to catch that —
          `responsive-320.spec.ts` and `global-nav.spec.ts` both sweep 320px only
          — so `e2e/nav-responsive-css.spec.ts` now measures 640/700/760px.

          Below `sm` the list becomes the 4-column grid (4x2, story 18-2): the
          eight destinations in one flex row at 320px give ~40px cells, where
          every label ("Net Worth", "Retirement", even "Overview"/"Expenses")
          overflowed its cell and overlapped its neighbour. A 4-column grid gives
          80px cells, so each label stays single-line, legible and tappable
          (>=44px). `max-sm:gap-0 max-sm:px-0 max-sm:py-0` neutralise the desktop
          `gap-1 px-4 py-2`, which the mobile bar has never carried: with them
          live the tracks compute to 69px instead of 80px and the labels
          re-overflow.

          Coupling to watch when NAV_ITEMS changes: `grid-cols-4` fixes 8 items
          at exactly 2 rows (4x2 ~= 89px). A ninth item would spill to a third
          row (~133px) and re-cover the Footer, so a count change means
          revisiting BOTH `max-sm:grid-cols-4` here and the
          `pb-[calc(6rem_+_env(safe-area-inset-bottom))]` reserve in
          `__root.tsx` — `e2e/chrome-320.spec.ts` guards that footer clearance.
          The nav's `max-sm:pb-[env(safe-area-inset-bottom)]` lifts the bottom
          row above the iOS home indicator (0 on non-notched devices, so the
          ~89px is exact there); the root reserve adds the same inset to stay in
          lockstep. */}
      <ul className="flex flex-wrap gap-1 px-4 py-2 max-sm:grid max-sm:grid-cols-4 max-sm:gap-0 max-sm:px-0 max-sm:py-0">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="max-sm:min-w-0">
            <Link
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              // `max-sm:rounded-none` and `max-sm:focus-visible:ring-inset` are
              // not cosmetic, and both were measured. `rounded-md` is
              // unprefixed, so without the first every mobile tab cell picks up
              // 6px corners it has never had. And the grid tracks are 80px x 4
              // flush to x=0..320, so without the second the 2px focus ring
              // paints OUTSET at x=-2/x=322 — clipped off-screen on 4 of the 8
              // cells. Both are ink: `border-radius` and `box-shadow` never move
              // `scrollWidth`, height or line count, so the geometry assertions
              // elsewhere in the suite are structurally blind to them.
              className="inline-block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 max-sm:flex max-sm:h-full max-sm:min-h-[44px] max-sm:items-center max-sm:justify-center max-sm:break-words max-sm:rounded-none max-sm:px-1 max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:focus-visible:ring-inset dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
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
