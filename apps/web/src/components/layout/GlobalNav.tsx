import { Link, useRouterState } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionSeed } from '../../context/session-seed'
import { isEntitledSeed } from '../../lib/premium/entitlement'
import { useShowRetirementPlanner } from '../../stores/plannerVisibilityStore'

/**
 * Persistent global navigation (story 11-1, Epic 11 UX review P0-a).
 *
 * Mounted once in `routes/__root.tsx` so every route carries the same primary
 * navigation — replacing the ad-hoc, inconsistent per-page "Back to Home / View
 * X" footer link blocks each page used to hand-roll.
 *
 * ## How many destinations — it depends on the TIER since story 58.1
 *
 * A free or signed-out session sees SEVEN top-level sections (eight until story
 * 43.3 (FR69) removed the free Net Worth projection page). An ENTITLED session
 * sees ELEVEN: the same seven plus Forecasting, Profiles, Report and Categories.
 * Every "seven" below describes the free nav unless it says otherwise.
 *
 * ⚠️ This REVERSES a named scope decision, and the reversal is recorded rather
 * than the old text being quietly deleted. Until 2026-09-14 this docblock read:
 * "The premium *Forecasting* entry is intentionally NOT duplicated here: it stays
 * surfaced-but-locked on the Home dashboard via the Story 7-2
 * `PremiumFeatureGate`, so the primary nav needs no second premium gate to
 * maintain (scope decision, 2026-07-03)."
 *
 * That decision was correct about its cost and wrong about its benefit. A paying
 * user's ONLY route to four of the five premium features was a dashboard card
 * they had to remember, which is a discoverability failure that outweighs the
 * maintenance cost of one tier read (FR87, decision Lucas 2026-09-14). The
 * "second premium gate" it feared is deliberately not what shipped: this
 * component gates nothing. It reads the already-resolved SSR seed and chooses a
 * LIST. Every route keeps its own server-side gate, unchanged — a user who
 * reaches `/report` by typing the URL is authorised there, not here.
 *
 * `Multi-device sync` is the one premium benefit still absent: it has no route to
 * link to, so it stays Overview-only in both tiers.
 *
 * Active state is driven by TanStack Router `<Link>` `activeProps` (not a
 * hand-rolled `useLocation` comparison), which applies both the active styling
 * and `aria-current="page"` when the link matches the current route. The
 * Overview (`/`) link uses `activeOptions={{ exact: true }}` so it is not marked
 * active on every sub-route (every path is prefixed by `/`). The one exception
 * is the mobile "More" tab, which is not a route at all — see below.
 *
 * ## Responsive: ONE DOM subtree, switched by CSS alone (stories 31.4, 31.5)
 *
 * There is exactly one `<nav>`, one OUTER `<ul>`, one More `<details>` with its
 * `<summary>` (a `<button>` until story 59.2) and — since story 58.1 — seven
 * `<a>` for a free session or eleven for an entitled one, in the DOM at every
 * viewport. The COUNT varies by tier; the STRUCTURE never does.
 * Desktop (>= 640px) is the unprefixed cascade —
 * an in-flow top bar; below `sm` the SAME elements become a fixed bottom tab
 * bar via `max-sm:` utilities. No JavaScript decides the layout, so the first
 * painted frame is already the final frame and there is no hydration race left
 * to lose.
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
 * fix. The hook itself is KEPT and unchanged — three Recharts call sites take
 * numeric/enum props CSS cannot drive (it was four until story 51.1 deleted
 * `SavingsChart.tsx`) — this component simply stopped being one
 * of its consumers. It must not come back here: the sheet's open/closed state
 * below is USER-initiated, never viewport-derived, which is what keeps the
 * server render and the first client render in agreement.
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
 * string; a mobile-only ELEMENT gets base classes + `sm:hidden`. Never
 * neutralise a base class with an unprefixed override — that is what keeps
 * ">= 640px is unchanged" provable by reading the diff.
 *
 * ⚠️ On the LINKS, keep every colour unprefixed. Tailwind emits all `max-sm:`
 * rules AFTER the unprefixed utilities, so a `max-sm:` colour would beat the
 * links' unprefixed `hover:bg-gray-100` / `hover:text-gray-900` below 640px and
 * silently invert mobile hover behaviour; scope only layout/position/spacing/
 * typography there. That is also why the links keep raw `text-gray-600
 * dark:text-gray-300` instead of the `.text-body` semantic token — deliberate,
 * do not "fix" it. The `<nav>` itself is the deliberate exception — it has no
 * unprefixed colour state to lose, and its `max-sm:` background/border are
 * required precisely because the bar is out of flow below `sm` (see below).
 *
 * ## The 5-tab bar and the "More" sheet (story 31.5, UX-DR35/38)
 *
 * The bottom bar used to be a 4x2 grid of all eight destinations (~89px tall).
 * It was not defective — measured at 320/360/390/412 it had true 44px targets,
 * no overflow and single-line labels — but it cost 89px of a 568px-tall screen,
 * and adding the icons that make a tab bar recognisable would have made it
 * WORSE, not better: stacked icon-over-label needs ~56px of height, so icons on
 * a 4x2 grid give a ~112px bar. Icons and eight items are arithmetically
 * mutually exclusive at 320px (side-by-side needs 78px of an 80px cell for
 * "Retirement" alone). Measured label widths in the app's real font stack
 * decided the count: 5 columns give 64px tracks (comfortable), 8 give 40px
 * (overflowing). So the bar shows FIVE cells — Overview, Income, Expenses,
 * Savings and a "More" trigger — and the remaining destinations live in a
 * sheet that More discloses: three for a free session, seven for an entitled one
 * since story 58.1. The bar is now 56.75px, and the tier cannot change that —
 * 58.1 touched only the sheet list, never `PRIMARY_TABS`.
 *
 * ⚠️ The structure that makes this legal is a NESTED `<ul>` inside the fifth
 * `<li>`. The obvious alternative — leaving every `<li>` in the bar and
 * re-listing the sheet's share in a mobile-only sheet — puts those destination
 * labels in the DOM TWICE, which is the dual-render rejected above.
 *
 * ## The same disclosure at EVERY width (story 59.2, FR90)
 *
 * Until story 59.2 the nested list was DISSOLVED at >= 640px (`sm:contents` on
 * the wrapper `<li>` and on the `<ul>`, `sm:hidden` on the trigger), so every
 * destination was an item of one flat desktop row. That is what broke: story
 * 58.1 added four premium anchors, and a paid user's row wrapped to TWO rows at
 * every desktop width, which was measured and could not be closed by
 * shrinking. The dissolve is gone. The row is Overview · Income · Expenses ·
 * Savings · More at every width, in both tiers, and the other destinations are
 * a disclosure panel: a sheet above the bar below `sm`, a dropdown under the
 * trigger at `sm` and up. Accepted cost (decision, Lucas 2026-09-21): a free
 * desktop user reaches Balances, Retirement and Settings in two clicks, not
 * one. The row's measured widths live in ONE place,
 * `e2e/nav-responsive-css.spec.ts`. Do not restate them here.
 *
 * ⚠️⚠️ It is a native `<details>`/`<summary>`, and that is the FAIL-OPEN
 * requirement, not a styling choice (decision, Lucas 2026-09-21). Since story
 * 58.2 this nav is a paying user's ONLY route to four pages, with no Overview
 * card, no `/settings` tile and no footer link. The dissolve used to keep the
 * desktop destinations reachable with JavaScript broken or not yet hydrated. A
 * React-only disclosure would have lost that. The native toggle works with
 * zero JavaScript, so it keeps it. `e2e/nav-more-disclosure{,.paid}.spec.ts`
 * prove it with `javaScriptEnabled: false`.
 *
 * ⚠️⚠️ EVERY ICON CARRIES `sm:hidden`. Icons are a mobile-only concern, and
 * the suite was provably blind to losing the token: measured, icons without
 * `sm:hidden` grow the desktop nav 52px -> 76px at 1280px (212 computed diffs)
 * and zero tests went red, including the one named "the desktop cascade is
 * untouched", because the merged-style partition never read `height`. It reads
 * `height` and `flex-direction` now, and `e2e/nav-responsive-css.spec.ts`
 * carries a full differential dump. Do not remove the token.
 *
 * ⚠️ The sheet is `max-sm:absolute`, NOT `max-sm:fixed`. `bottom: 100%` on a
 * `fixed` box resolves against the VIEWPORT, not the nav: measured, that renders
 * the sheet at `{x: 0, y: -279}` — entirely above the top edge of the screen —
 * and Playwright's `toBeVisible()` PASSES on it, because it only checks for a
 * non-empty box. `absolute` resolves against the `max-sm:fixed` nav, which is
 * its containing block, putting it flush on top of the bar at y=385.25.
 *
 * ⚠️ The bar is `max-sm:z-50`, not `z-40`. At z-40 the `InstallPrompt` banner
 * (z-50) painted OVER the open sheet: measured at 320x640,
 * `elementFromPoint(160, 476)` landed inside the banner and the "Retirement" row
 * was completely un-tappable while having a perfect rect and passing
 * `toBeVisible()` — occlusion is invisible to every geometry and visibility
 * assertion. The nav renders AFTER `<InstallPrompt/>` in `__root.tsx`, so an
 * equal z-index breaks the tie in the nav's favour; `Modal` renders later still,
 * so modals stay above the nav.
 *
 * The bar's height and the root layout's reserve are a THREE-way coupling, all
 * of which must move together: `pb-[calc(3.75rem_+_env(safe-area-inset-bottom))]`
 * at `__root.tsx`, `bottom-[calc(3.75rem_+_env(safe-area-inset-bottom))]` at
 * `InstallPrompt.tsx`, and the nav's own `max-sm:pb-[env(safe-area-inset-bottom)]`.
 * Both existing clearance guards are one-directional (they fail only if the
 * reserve is too SMALL), so an over-large reserve ships a dead gap above the
 * footer with every test greener than before — the guards are two-sided now.
 * `e2e/nav-responsive-css.spec.ts` and `e2e/chrome-320.spec.ts` guard all of it.
 */

/**
 * Registered route paths the nav links to — a subset of the app's route tree.
 *
 * ⚠️ Closed on purpose. Adding a destination without extending this union is a
 * `tsc` error, which is how exhaustiveness is proven here rather than by review
 * (the pattern stories 35.2 and 43.3 both record).
 */
type NavPath =
  | '/'
  | '/income'
  | '/expenses'
  | '/savings'
  | '/balance'
  | '/retirement'
  | '/forecasting'
  | '/profiles'
  | '/report'
  | '/categories'
  | '/settings'

interface NavItem {
  label: string
  to: NavPath
  /**
   * Match this route exactly. Only `/` needs it: without `exact`, the Overview
   * link would be considered active on every route (all paths start with `/`).
   */
  exact?: boolean
  /** Mobile-only glyph. Rendered with `sm:hidden` — see the docblock. */
  Icon: (props: { className: string }) => React.ReactElement
}

/**
 * The four destinations that keep a cell in the mobile bar.
 *
 * Chosen by the ratified UX evaluation as the highest-frequency surfaces; their
 * labels are also the ones that fit a 56px content box at 11px (Overview 47.98,
 * Income 38.95, Expenses 48.45, Savings 39.47 — "Retirement", the longest label
 * in the set at 57.6px, moved into the sheet and no longer constrains a cell).
 */
const PRIMARY_TABS: readonly NavItem[] = [
  { label: 'Overview', to: '/', exact: true, Icon: HomeIcon },
  { label: 'Income', to: '/income', Icon: IncomeIcon },
  { label: 'Expenses', to: '/expenses', Icon: ExpensesIcon },
  { label: 'Savings', to: '/savings', Icon: SavingsIcon },
]

/**
 * The three destinations behind the mobile "More" trigger for a FREE session.
 *
 * ⚠️ Since story 58.1 this is the free-tier BASE, not the whole sheet. An
 * entitled session renders `MORE_DESTINATIONS_ENTITLED` below, which splices four
 * premium destinations into this list. Keep this array literally unchanged when
 * adding a premium destination — that is what makes "the free nav did not move"
 * provable by reading the diff.
 *
 * Since story 59.2 they sit behind More at EVERY width. Until then,
 * `sm:contents` dissolved them into the one desktop row.
 *
 * ⚠️ Was FOUR until story 43.3 removed `/net-worth-projection` (FR69). Every
 * "eight anchors" figure in this file dates from before that removal; the ones
 * describing the CURRENT nav now say seven, and the ones narrating the former
 * 4x2 grid are left as history.
 */
const MORE_DESTINATIONS: readonly NavItem[] = [
  // ⚠️ Story 59.1 (FR89): label shortened "Balance Tracking" -> "Balances",
  // REVERSING story 43.2 / UX-DR48, which had lengthened it from "Balance" so
  // the nav would match the page's own H1. That reversal is the decision, not an
  // oversight (Lucas, 2026-09-21): this nav label now deliberately DIVERGES from
  // `BalancePage.tsx`'s H1, which still reads "Balance Tracking" and stays that
  // way, as does every "Balance Tracking page" prose reference and both docs
  // pages. The grounds are story 58.1's decision D1 — a paid user's desktop row
  // is width-critical, and a nav label tracks the DESTINATION, not the page
  // title. Do NOT "restore consistency" by lengthening this again.
  // The route (`to`) is unchanged, so active-state/aria-current is unaffected.
  { label: 'Balances', to: '/balance', Icon: BalanceIcon },
  // Retirement Planner (story 15-1): promoted from a docs-only, nav-orphan route
  // to a first-class destination. Story 43.3 (FR69) removed the free Net Worth
  // projection page it used to sit beside, so this is now the only
  // forward-looking planning surface in the nav. Stays FREE (Epic 15 is UX-only,
  // no premium gate).
  { label: 'Retirement', to: '/retirement', Icon: RetirementIcon },
  // Consolidated settings surface (story 11-6): the single home for the currency
  // and dark-mode controls that used to be scattered across page headers and the
  // footer.
  { label: 'Settings', to: '/settings', Icon: SettingsIcon },
]

/**
 * The four premium destinations an ENTITLED session additionally sees (story
 * 58.1, FR87).
 *
 * ⚠️ The labels are deliberately SHORTER than these features' names elsewhere in
 * the app (decision D1, 2026-09-20). `OVERVIEW_BENEFITS[*].featureName` calls
 * them "Custom Profiles", "Financial Summary Report" and "Custom Categories";
 * the nav calls them Profiles, Report and Categories. That is not drift:
 *
 *   - A nav label names the DESTINATION as briefly as it can be named, not the
 *     benefit pitch. This nav has always spoken that way (`Savings`, not
 *     "Savings Goals"; `Income`, not "Income Sources").
 *     ⚠️ This bullet used to cite story 43.2's "match the page's own H1" rule as
 *     its precedent. Story 59.1 (FR89) REVERSED that rule for the very label
 *     43.2 applied it to (`Balance Tracking` -> `Balances`), so the rule can no
 *     longer be cited here — the brevity principle above is the live one, and
 *     matching an H1 is not a constraint on this file.
 *   - The benefit names carry 67 characters against these 35. When D1 was
 *     decided these labels were items of the desktop row, so label text was row
 *     height for every paying user on every page. Since story 59.2 they are
 *     rows of the More panel, which is as wide as its longest label. Brevity
 *     still pays; it no longer decides the row count.
 *
 * Verified when this shipped: `benefit-set-parity.test.tsx` polices the canonical
 * benefit set across /pricing, the upgrade prompt, the Overview grid, the route
 * map, `features.md` and `pricing.md` — it does not reference this file, so the
 * two vocabularies cannot collide. Do not "fix" them into agreement.
 *
 * ⚠️ `Multi-device sync` is NOT here and cannot be: it has `activation: 'prompt'`
 * with no route to link to (`HomePage.tsx`), so it stays Overview-only in both
 * tiers.
 */
const PREMIUM_DESTINATIONS: readonly NavItem[] = [
  { label: 'Forecasting', to: '/forecasting', Icon: ForecastingIcon },
  { label: 'Profiles', to: '/profiles', Icon: ProfilesIcon },
  { label: 'Report', to: '/report', Icon: ReportIcon },
  { label: 'Categories', to: '/categories', Icon: CategoriesIcon },
]

/**
 * The four premium ROUTES this nav carries for an entitled session — exported
 * for one test, deliberately (story 58.2, AC-1).
 *
 * ⚠️⚠️ WHY THIS EXPORT EXISTS. Story 58.2 removed the Overview cards and the
 * `/settings` tiles that used to link these same four pages, so **this nav is now
 * the ONLY route a paying user has to any of them.** The same four routes are
 * still written out twice in the codebase — here, and as `OVERVIEW_BENEFITS`'
 * `href` values in `HomePage.tsx` — with nothing tying the two lists together.
 * Rename a route on one side and a paid user loses the nav entry while the free
 * tier keeps advertising a page that no longer resolves; nothing else in the
 * suite can see that.
 *
 * `__tests__/premium-route-parity.test.ts` is what ties them. Re-deriving this
 * list inside that test instead would assert nothing, which is why the export is
 * the right call here rather than a smell.
 *
 * Exported as the routes alone, not the items: the LABELS deliberately diverge
 * from the Overview's `featureName` strings (decision D1 of story 58.1 — see
 * `PREMIUM_DESTINATIONS`' docblock), and a test that pinned those together would
 * fail on correct code.
 */
export const PREMIUM_NAV_ROUTES: readonly string[] = PREMIUM_DESTINATIONS.map((item) => item.to)

/**
 * The sheet an entitled session gets: the free list with the premium block
 * spliced in BEFORE Settings (decision D3).
 *
 * ⚠️ Not a concatenation. FR87 said "appended", which would leave Settings
 * stranded in the middle of a paying user's list; Settings stays last, where it
 * is for everyone else. The insertion point is found by route rather than by a
 * hard-coded index so reordering `MORE_DESTINATIONS` cannot silently move it.
 */
const SETTINGS_POSITION = MORE_DESTINATIONS.findIndex((item) => item.to === '/settings')
if (SETTINGS_POSITION === -1) {
  // ⚠️ Not defensive noise. `findIndex` returning -1 makes `slice(0, -1)` and
  // `slice(-1)` still "work" — they would splice the premium block before
  // whatever happens to be last, silently, with no crash and no missing item.
  // The by-route lookup above protects against REORDERING; only this protects
  // against REMOVAL. Throwing at module load turns a silent misplacement into an
  // immediate, obvious failure.
  throw new Error('GlobalNav: MORE_DESTINATIONS must contain a /settings entry')
}
const MORE_DESTINATIONS_ENTITLED: readonly NavItem[] = [
  ...MORE_DESTINATIONS.slice(0, SETTINGS_POSITION),
  ...PREMIUM_DESTINATIONS,
  ...MORE_DESTINATIONS.slice(SETTINGS_POSITION),
]

/**
 * The desktop appearance of a nav anchor, shared by a bar tab, a sheet row and
 * (since story 59.2) the More trigger. The sheet row adds `sm:block` on top,
 * because at >= 640px it is a row of a vertical panel, not an item of the bar.
 *
 * ⚠️ The two mobile variants below are built as SEPARATE strings from this
 * shared base; they are NOT produced by appending overrides to each other.
 * Measured: appending `max-sm:flex-row` to a string already carrying
 * `max-sm:flex-col` computes to `column` — every appended override LOSES —
 * while `max-sm:text-sm` DOES beat `max-sm:text-[11px]`. Tailwind source order
 * decides, not className order, and `apps/web` has no clsx/tailwind-merge, so
 * "later in the string" means nothing.
 */
const NAV_LINK_BASE =
  'inline-block rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

/**
 * A bar tab: a centred icon-over-label stack filling its 64px grid cell.
 *
 * `max-sm:rounded-none` and `max-sm:focus-visible:ring-inset` are not cosmetic,
 * and both were measured. `rounded-md` is unprefixed, so without the first every
 * mobile tab cell picks up 6px corners it has never had. And the grid tracks are
 * 64px x 5 flush to x=0..320, so without the second the 2px focus ring paints
 * OUTSET at x=-2/x=322 — clipped off-screen on the 1st and 5th cells. Both are
 * ink: `border-radius` and `box-shadow` never move `scrollWidth`, height or line
 * count, so the geometry assertions elsewhere in the suite are structurally
 * blind to them.
 *
 * `max-sm:text-[11px]` is load-bearing twice over: at 12px the widest label's
 * slack falls from 3.8px to 1.55px per side inside the 56px content box that
 * `max-sm:px-1` leaves, AND the bar's 56.75px height depends on the 11px line
 * box (py-2 16 + icon 24 + gap-0.5 2 + leading-tight 13.75 + border-t 1).
 */
const TAB_LINK_CLASS = `${NAV_LINK_BASE} max-sm:flex max-sm:h-full max-sm:min-h-[44px] max-sm:flex-col max-sm:items-center max-sm:justify-center max-sm:gap-0.5 max-sm:break-words max-sm:rounded-none max-sm:px-1 max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:focus-visible:ring-inset`

/**
 * A sheet row: a full-width, left-aligned icon-beside-label row.
 *
 * At >= 640px (story 59.2) it is a row of the dropdown panel: `sm:block` makes
 * it fill the panel's width so the hover and active backgrounds span the row,
 * and `sm:whitespace-nowrap` keeps a label on one line, so the panel sizes to
 * its longest label instead of wrapping it. Both are `min-width: 640px`
 * utilities, so neither applies to the mobile sheet at all.
 *
 * Deliberately omits `max-sm:flex-row` / `max-sm:justify-start` /
 * `max-sm:text-left` — a flex container defaults to `row`, `normal` and `start`
 * respectively, so those tokens would be no-ops with no observable consequence
 * to guard, which is the "token with no possible assertion" this suite treats as
 * a missing guard rather than as coverage.
 */
const SHEET_ROW_CLASS = `${NAV_LINK_BASE} sm:block sm:whitespace-nowrap max-sm:flex max-sm:min-h-[44px] max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:px-4 max-sm:py-3 max-sm:text-sm max-sm:leading-tight max-sm:focus-visible:ring-inset`

/**
 * The active treatment, applied by `<Link activeProps>` on every destination anchor and
 * by hand on the More trigger (which is not a route — see `isMoreActive`).
 */
const ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/**
 * The More trigger, a `<summary>`, at EVERY width since story 59.2.
 *
 * Until 59.2 it was a mobile-only ELEMENT (base classes + `sm:hidden`) and must
 * not reach the desktop row. It is a SHARED element now, so the composition rule
 * for shared elements applies: the desktop look is `NAV_LINK_BASE` unprefixed,
 * exactly like every desktop anchor, and the mobile bar cell it has always been
 * is `max-sm:` variants APPENDED to it. That is `TAB_LINK_CLASS`'s mobile half
 * with two differences: it adds `max-sm:w-full` (the cell is a grid track, not a
 * link box) and omits `max-sm:break-words` ("More" is one short word). Its
 * computed style in the 320px bar was diffed before and after the change: 30
 * properties each of the cell, trigger, label and icon, plus every cell rect,
 * byte-identical. The table is in story 59.2's completion notes.
 *
 * The disclosure triangle a `<summary>` draws by default comes from
 * `display: list-item` in Chromium and Gecko, and from a
 * `::-webkit-details-marker` pseudo-element in WebKit. This summary is never
 * `list-item` (it is `inline-block` at >= 640px and `flex` below), so
 * `list-none` is INERT today. It is kept as a guard in case a future display
 * change makes it `list-item`. `[&::-webkit-details-marker]:hidden` is the one
 * doing work, in WebKit only, and nothing in this chromium-only suite can
 * observe it.
 *
 * ⚠️ No role, no `aria-expanded`, no `aria-controls`. Chromium already exposes a
 * `<summary>` as a named, expandable disclosure (`DisclosureTriangle "More"`,
 * `expanded`), measured through CDP, so hand-rolled ARIA would only
 * duplicate it. Tests find it by selector, because Playwright and
 * `@testing-library/dom` give `<summary>` NO role. See `e2e/helpers/nav-more.ts`.
 *
 * ⚠️ The desktop row's widths live in ONE place, `e2e/nav-responsive-css.spec.ts`.
 * This comment used to carry a copy ("the eight-item row already wants 778px")
 * that was stale twice over by story 43.3. Do not restate a width here.
 */
const MORE_TRIGGER_CLASS = `${NAV_LINK_BASE} cursor-pointer list-none [&::-webkit-details-marker]:hidden max-sm:flex max-sm:h-full max-sm:min-h-[44px] max-sm:w-full max-sm:flex-col max-sm:items-center max-sm:justify-center max-sm:gap-0.5 max-sm:rounded-none max-sm:px-1 max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:focus-visible:ring-inset`

/**
 * The sheet panel itself: an out-of-flow overlay at EVERY width since story 59.2.
 *
 * Two halves, deliberately separate strings of tokens. The `sm:` half is the
 * desktop dropdown, anchored under the trigger by the cell's `sm:relative`. The
 * `max-sm:` half is the mobile sheet, anchored to the top edge of the bar, and it
 * is BYTE-IDENTICAL to what it was before 59.2 (pinned token-for-token in
 * `GlobalNav.test.tsx`). So "the mobile sheet did not move" is provable by
 * reading the diff. Until 59.2 the desktop half was `sm:contents`, which
 * dissolved the panel into the row.
 *
 * Both halves need their own OPAQUE background in both themes for the same
 * reason the bar does: the panel is `absolute`, so page content passes
 * underneath it. A dropped background computes to `rgba(0, 0, 0, 0)` and the
 * destinations sit on whatever scrolls past.
 *
 * ⚠️ `sm:z-40` IS LOAD-BEARING, and it was measured. Without it the desktop
 * panel is a positioned box at `z-index: auto`, so positioned page content later
 * in the DOM paints OVER it. `elementFromPoint` on the open panel's rows landed
 * on `/pricing`'s plan cards and `/forecasting`'s page header, at 640px and at
 * 1280px, while those rows had perfect rects and passed `toBeVisible()`.
 * `e2e/nav-more-disclosure.paid.spec.ts` sweeps 13 routes for it at the top of
 * each page, which is not every scroll position or overlay state. 40, not 50:
 * `Modal` (z-50, rendered later) must stay above it, and at >= 640px the
 * `InstallPrompt` banner sits at the bottom of the screen, nowhere near a
 * dropdown hanging off the top bar. Below `sm` the stacking comes from the
 * nav's own `max-sm:z-50` (see the component docblock).
 *
 * ⚠️ THE CAP AND THE SCROLL ARE NOT OPTIONAL, and code review caught their
 * absence. The panel's height is content-driven and it is anchored to the bar's
 * top edge, so with no cap it simply grows off the TOP of the screen — and
 * because it is out of flow, page scrolling cannot reach what it pushes away.
 * Measured at 568x320 with a 24px root font: the panel was 301px tall, its top
 * was at y=-57.75, and the "Balance" row sat at y=-51 — off-screen, un-tappable
 * and unscrollable. The cap is expressed against the small viewport unit so a
 * mobile URL bar cannot invalidate it, and leaves room for the bar itself.
 * The repo's other disclosed panel does the same (`Modal.tsx:113`). A third,
 * `profiles/switch-profile.tsx`, also did, until story 63.1 deleted it.
 *
 * ⚠️ `overflow-y-auto` computes `overflow-x` to `auto` as well, which makes this
 * panel a HORIZONTAL scroll container that would silently absorb an overflowing
 * row label (31.2's absorption trap). `e2e/nav-responsive-css.spec.ts` asserts
 * `panel.scrollWidth <= panel.clientWidth` element-level precisely so that
 * absorption cannot hide a regression.
 */
const SHEET_PANEL_CLASS =
  'sm:absolute sm:left-0 sm:top-full sm:z-40 sm:mt-1 sm:min-w-[10rem] sm:max-h-[calc(100svh-6rem)] sm:overflow-y-auto sm:rounded-md sm:border sm:border-gray-200 sm:bg-white sm:py-1 sm:shadow-lg dark:sm:border-gray-700 dark:sm:bg-gray-800 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-full max-sm:max-h-[calc(100svh-5rem)] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:py-1 dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800'

export function GlobalNav() {
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  /**
   * Whether the in-flight pointer gesture STARTED outside the nav.
   *
   * Mutable gesture state is the thing that actually goes stale across
   * open/close cycles (`isMoreOpen` gates the render, not the mount, so refs
   * persist) — 31.3 shipped exactly this bug. It is reset on every terminal
   * path, including `pointercancel`: a touch that turns into a scroll fires
   * `pointercancel` and never a `click`. The `triggerRef` above is NOT at risk
   * for the same reason — the More `<summary>` is always mounted, at every width
   * and in both states.
   */
  const outsidePressRef = useRef(false)

  /**
   * The More tab's active state CANNOT come from `<Link activeProps>`: More is
   * not a route, so `activeProps` would silently mark nothing and the bar would
   * show NO active tab on three of seven destinations — worse orientation than
   * the grid this replaced. Since story 59.2 the same is true on DESKTOP, where
   * those destinations moved behind More too, so this cue now carries "you are
   * here" at every width. `useRouterState` reads `router.stores.location`, the
   * same store `<Link>`'s own active computation reads, through a `useStore`
   * whose `getServerSnapshot` and `getSnapshot` are the same synchronous read.
   * The store is seeded from `history.location` at router construction, BEFORE
   * the first React render, so this derivation is exactly as hydration-safe as
   * the `activeProps` this component already ships.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  /**
   * The sheet's destinations after the Retirement visibility preference (story
   * 35.2, FR55).
   *
   * ⚠️⚠️ ONE list, read TWICE — deliberately. The rendered rows and
   * `isMoreActive` below both derive from this, so the trigger cannot claim a
   * destination the sheet no longer holds. Deriving the active state from
   * `MORE_DESTINATIONS` instead would light the More tab on `/retirement` while
   * the sheet it discloses is empty of it: an orientation cue pointing at
   * nothing. Keeping the two in agreement by discipline is exactly the kind of
   * invariant that rots, so they are not separately computable.
   *
   * This is the post-hydration half of the feature. The FIRST frame is handled
   * before React runs, by the `<head>` script in
   * `lib/nav/no-flash-planner-visibility-script` plus the `[data-hide-retirement]`
   * rule in `styles/global.css` — because every persisted store here is
   * `skipHydration: true`, so the server and the first client render must both
   * paint the deterministic default (visible).
   */
  const showRetirementPlanner = useShowRetirementPlanner()

  /**
   * Whether this session sees the four premium destinations (story 58.1, FR87).
   *
   * ⚠️ Read from the SSR seed as a `useState` INITIALIZER, never reactively —
   * `session-seed.tsx` states that contract, and here it is what makes the first
   * painted frame already correct. The seed is resolved server-side by the root
   * loader, so SSR and the first client render agree and there is no flash.
   *
   * ⚠️⚠️ `usePremiumAccess()` is the obvious reuse and is WRONG here. Its no-seed
   * path fires a client round-trip in an effect and its status is `setState`-
   * driven, so the nav would paint 7 items and then flip to 11 — reintroducing
   * exactly the hydration reflow story 31.4 removed, on the element whose whole
   * design premise is "the first painted frame is the final frame". Mirror its
   * PREDICATE, do not call the hook.
   *
   * The predicate itself now lives in `lib/premium/entitlement.ts` (story 58.2):
   * story 58.2 needed the same rule on the Overview and on `/settings`, and four
   * hand-written copies of a fail-closed check is how they drift apart. The
   * behaviour here is unchanged — this is the same expression, imported.
   *
   * Fail-closed in all three directions: a `null` seed means the resolver could
   * not verify the session (unverified, NOT entitled), an unauthenticated seed
   * never qualifies however its status reads, and only `active`/`lifetime` count
   * — `free`/`past_due`/`canceled` get the free nav. A paid user hitting a
   * transient resolver error sees the free nav for that page load and self-heals
   * on the next, which is the right way round.
   *
   * ⚠️ The NAV fails closed; the Overview and Settings gates added by story 58.2
   * fail OPEN with the same predicate, because hiding their sections from an
   * unverified paid session would leave it no route to those pages at all. Both
   * are fail-safe and they point opposite ways on purpose — see
   * `entitlement.ts`. Do not "harmonise" the two directions.
   *
   * ⚠️ Accepted consequence: the root loader caches the seed with
   * `staleTime: Infinity`, so a user who upgrades MID-SESSION keeps the free nav
   * until a full reload. Every other seed consumer already behaves this way. Do
   * not "fix" it with a reactive read — that is the flash above.
   */
  const seed = useSessionSeed()
  const [isEntitled] = useState(() => isEntitledSeed(seed))

  const visibleMoreDestinations = useMemo(() => {
    const destinations = isEntitled ? MORE_DESTINATIONS_ENTITLED : MORE_DESTINATIONS
    return showRetirementPlanner
      ? destinations
      : destinations.filter((item) => item.to !== '/retirement')
  }, [isEntitled, showRetirementPlanner])

  const isMoreActive = visibleMoreDestinations.some((item) => item.to === pathname)

  /**
   * Close the sheet.
   *
   * ⚠️ `restoreFocus` is NOT always true, and getting that wrong is a real
   * defect that code review caught. Hiding a subtree containing
   * `document.activeElement` drops focus to `<body>`, so restoring focus to the
   * trigger is right for Escape and for choosing a destination. It is WRONG for
   * a light-dismiss: the mouse order is `pointerdown -> mousedown (which focuses
   * the pressed element) -> pointerup`, so restoring focus from the document
   * `pointerup` handler YANKS focus off whatever the user just clicked.
   * Measured: with the sheet open, pressing the "Sign in" link left
   * `document.activeElement` on the More trigger rather than the link — a mouse
   * user could not focus a form field in one click while the sheet was open.
   * The outside-press path therefore restores focus only when focus is still
   * inside the nav (i.e. nothing else claimed it), which keeps the
   * no-orphaned-focus guarantee without stealing.
   */
  const closeMore = useCallback((restoreFocus = true) => {
    setIsMoreOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  /**
   * ⚠️ Close on ANY navigation. Code review caught this: the dismissal guard
   * correctly does not fire for a press that starts and ends inside the nav —
   * which is exactly what tapping a BAR tab is — and the bar tabs carry no
   * `onClick`. Measured on the unfixed build: with the sheet open, tapping
   * "Income" landed on `/income` with the sheet still `display: block`, covering
   * 201px of the new page. Deriving this from the pathname rather than adding
   * per-link handlers also covers browser back/forward, programmatic redirects,
   * and keyboard activation of an outside link (Tab + Enter fires no pointer
   * events at all, so the dismissal guard never runs).
   *
   * Done as a render-phase adjustment, not an effect, for two reasons: it closes
   * BEFORE paint, so the new route never shows a frame with the stale sheet over
   * it; and an effect would have to list `pathname` as a dependency it does not
   * read, which is a lint violation for exactly the reason it looks wrong.
   * This is React's documented "adjusting state when a prop changes" pattern.
   *
   * Focus is deliberately NOT restored here — the user has navigated, and the
   * sheet-row path has already restored it by the time this runs.
   */
  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setIsMoreOpen(false)
  }

  /**
   * Adopt a disclosure the user opened BEFORE hydration (story 59.2, AC-5).
   *
   * ⚠️ Measured at 59.2's context time, not reasoned. The server renders the
   * `<details>` closed, and the native toggle works before React runs. That is
   * the point of using `<details>`. A user who clicks More in that window leaves
   * the DOM `open` while `useState(false)` hydrates as closed: React does not
   * patch attribute mismatches, and the `toggle` event fired before any handler
   * was attached. The panel is then visibly open with `isMoreOpen === false`, so
   * the Escape and outside-press listeners above are never armed. (It self-heals
   * on the next summary click, but only on that click.) Reading the DOM once on
   * mount closes the gap. `e2e/nav-more-disclosure.spec.ts` holds every script
   * back to put the click in that window.
   */
  useEffect(() => {
    if (detailsRef.current?.open) setIsMoreOpen(true)
  }, [])

  useEffect(() => {
    if (!isMoreOpen) return

    const isOutside = (target: EventTarget | null): boolean =>
      !(target instanceof Node) || !navRef.current?.contains(target)

    // Whether a real focusable OUTSIDE the nav holds focus. `<body>`, `<html>`
    // and null do not count: they are orphaned focus, which the trigger should
    // reclaim. See the pointer handler below for why "is focus inside the
    // nav?" is the wrong question.
    const focusClaimedOutside = (): boolean => {
      const active = document.activeElement
      return (
        active instanceof Node &&
        active !== document.body &&
        active !== document.documentElement &&
        !navRef.current?.contains(active)
      )
    }

    // ⚠️ Escape restores focus only if focus is in the nav or orphaned (story
    // 59.2 code review). On desktop the panel is a small dropdown, so a keyboard
    // user can Tab past it into the page with it still open. An unconditional
    // restore then yanked focus from page content back to More whenever they
    // pressed Escape, which was verified by probe on `/income`.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMore(!focusClaimedOutside())
    }
    // Both halves are load-bearing: press-origin alone leaves an
    // outside-press -> inside-release gesture closing the sheet, and
    // release-origin alone lets a press that began on a sheet row close it.
    const handlePointerDown = (event: PointerEvent) => {
      outsidePressRef.current = isOutside(event.target)
    }
    const handlePointerUp = (event: PointerEvent) => {
      const closedByGesture = outsidePressRef.current && isOutside(event.target)
      outsidePressRef.current = false
      if (closedByGesture) {
        // Restore focus unless something OUTSIDE the nav genuinely claimed it.
        //
        // ⚠️ "Is focus still inside the nav?" is the obvious condition and it is
        // WRONG — pressing non-focusable page content blurs the trigger to
        // `<body>`, which is not inside the nav, so that condition would decline
        // to restore and leave focus orphaned on `<body>`: precisely the defect
        // the restoration exists to prevent. Only a real focusable target
        // outside should win, so `<body>`/`<html>`/null all still restore.
        closeMore(!focusClaimedOutside())
      }
    }
    const handlePointerCancel = () => {
      outsidePressRef.current = false
    }

    // Gated on `isMoreOpen`. This is structurally the always-mounted document
    // listener pattern, and it is acceptable here ONLY because it is gated. The
    // repo's counter-example was `profiles/switch-profile.tsx`, whose Escape
    // listener was attached unconditionally for the component's whole lifetime;
    // story 63.1 deleted that component, so the warning is stated rather than
    // pointed at.
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerCancel)
      outsidePressRef.current = false
    }
  }, [isMoreOpen, closeMore])

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      // At >= 640px the nav carries NO chrome of its own: the border + background
      // live on the `__root.tsx` wrapper so the nav and the account indicator
      // read as ONE bar (story 19-3). Below `sm` the bar is `fixed` — out of
      // flow, and therefore beyond the reach of that `sm:`-gated wrapper chrome
      // — so it owns its border-top and background there. `max-sm:z-50` (not
      // z-40) is what keeps the open sheet above the InstallPrompt banner; see
      // the docblock.
      //
      // ⚠️⚠️ `sm:shrink-0` is what makes the row ONE row for a SIGNED-IN user
      // (story 59.2 code review, measured). The nav shares the header row with
      // `AuthIndicator`, and both are flex items. Without it, a signed-in
      // cluster (avatar + email + Premium pill, 399px at 640px with a long
      // email) out-weighed the nav's flex basis. The nav absorbed the
      // shortfall by WRAPPING, to 3 rows at 640px and 2 up to ~849px, and the
      // email's `truncate` never engaged. With the nav held at its content
      // width, the cluster yields instead (it is `sm:min-w-0`, in
      // `auth-indicator.tsx`), so the email truncates. The e2e suite has no real
      // session, so it only ever measured the signed-out "Sign in" cluster and
      // was blind to this. `e2e/nav-more-disclosure.paid.spec.ts` now mocks
      // `/api/auth/me` to render a signed-in cluster, and pins it.
      className="sm:shrink-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:pb-[env(safe-area-inset-bottom)] dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {/* `flex-wrap` at >= 640px: INERT since story 59.2, and kept on purpose.
          It arrived (commit d4f3ffb) to contain the eight items the nav then
          had, and until 59.2 the desktop bar was two rows below a single-row
          threshold. Since 59.2's code review the <nav> is `sm:shrink-0`, so the
          list always gets its full content width and never wraps. At >= 640px
          the thing that yields is now the account cluster, whose email
          truncates. If the row ever outgrows the viewport minus the cluster's
          minimum, the DOCUMENT overflows sideways; it does not wrap. That is
          what the no-overflow assertions in `e2e/nav-responsive-css.spec.ts`
          (640/700/760px) and the paid signed-in sweep catch. The measured
          headroom lives there, in ONE place; do not restate it here.
          `responsive-320.spec.ts` and `global-nav.spec.ts` both sweep 320px
          only.

          ⚠️ This comment carried its own copy of the "row wants 778px …
          clearing only at 800px" figures until story 43.3. It was the THIRD copy
          in the repo and, like the other two, stale: 43.2 measured 753 -> 815px
          intrinsic and 857 -> 920px single-row under CI fonts, and 43.3 then
          removed an item. The one live measurement is in
          `e2e/nav-responsive-css.spec.ts`; do not copy it back here.

          Below `sm` the list becomes the 5-column grid (story 31.5): four
          destinations plus the More trigger, 64px tracks at 320px, each cell an
          icon-over-label stack. `max-sm:gap-0 max-sm:px-0 max-sm:py-0`
          neutralise the desktop `gap-1 px-4 py-2`, which the mobile bar has
          never carried: with them live the tracks shrink and the labels
          re-overflow.

          Coupling to watch when the item split changes: `grid-cols-5` fixes the
          bar at exactly ONE row (~56.75px). Moving a destination out of the
          sheet and into the bar means revisiting BOTH `max-sm:grid-cols-5` here
          and the `pb-[calc(3.75rem_+_env(safe-area-inset-bottom))]` reserve in
          `__root.tsx` AND the matching offset in `pwa/InstallPrompt.tsx` —
          `e2e/chrome-320.spec.ts` guards that footer clearance in BOTH
          directions (too small covers the footer; too large strands it above a
          dead gap). The nav's `max-sm:pb-[env(safe-area-inset-bottom)]` lifts
          the bar above the iOS home indicator (0 on non-notched devices, so the
          56.75px is exact there); the root reserve adds the same inset to stay
          in lockstep. */}
      <ul className="flex flex-wrap gap-1 px-4 py-2 max-sm:grid max-sm:grid-cols-5 max-sm:gap-0 max-sm:px-0 max-sm:py-0">
        {PRIMARY_TABS.map((item) => (
          <li key={item.to} className="max-sm:min-w-0" data-nav-path={item.to}>
            <Link
              to={item.to}
              activeOptions={item.exact ? { exact: true } : undefined}
              className={TAB_LINK_CLASS}
              activeProps={{ 'aria-current': 'page', className: ACTIVE_CLASS }}
              // Closes the panel even when the tab is the CURRENT route (story
              // 59.2 code review). The pathname-change close below never fires
              // for a same-route click, and the press starts and ends inside
              // the nav, so the outside-press guard correctly declines. The
              // result was an open dropdown that survived a click on "Income"
              // while on /income. `false`: the clicked link keeps its focus.
              onClick={() => closeMore(false)}
            >
              <item.Icon className="h-6 w-6 sm:hidden" />
              {/* The label is wrapped so the line-count probe in
                  `e2e/chrome-320.spec.ts` can scope a Range to the TEXT. Ranged
                  over the whole anchor it measures 3 rects on a correct cell
                  (the icon box, the label, and the SVG's own line box), not the
                  1 a "labels stay single-line" assertion means. */}
              <span data-nav-label>{item.label}</span>
            </Link>
          </li>
        ))}
        {/* The fifth cell: the More disclosure, at every width (story 59.2).
            Below `sm` it is the bar's fifth grid cell, and it is deliberately NOT
            positioned there. The sheet must keep resolving `max-sm:absolute`
            against the `max-sm:fixed` <nav>, which is what makes it full-width
            and flush on top of the bar. At `sm` and up, `sm:relative` makes this
            cell the containing block the dropdown hangs from. */}
        <li className="max-sm:min-w-0 sm:relative">
          <details
            ref={detailsRef}
            open={isMoreOpen}
            onToggle={(event) => setIsMoreOpen(event.currentTarget.open)}
            // `open` is controlled. Once hydrated, a click never toggles the DOM
            // natively (the summary's `onClick` cancels it, below), so
            // `onToggle` is NOT what keeps a click honest. Its job is every
            // OTHER way the DOM `open` can change without React knowing: the
            // browser opening a `<details>` for find-in-page, script setting
            // `.open`, and a native toggle whose `toggle` task lands after
            // hydration. React never writes `open` back unless the PROP
            // changes, so without this such a change would leave the panel
            // open with the dismissal listeners unarmed. Pinned by
            // `GlobalNav.test.tsx` ("adopts an open it did not cause").
            //
            // `suppressHydrationWarning` is for ONE case: the pre-hydration
            // click the mount effect above adopts. The server sent no `open`,
            // the DOM has one, and React (dev only) reports the mismatch it
            // will not patch. The suppression covers this element's own
            // attributes, one level deep, so it cannot hide a mismatch
            // anywhere else in the nav.
            suppressHydrationWarning
            className="max-sm:h-full"
          >
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: a <summary> is natively keyboard-operable — Enter and Space dispatch this same click (e2e/nav-more-disclosure.spec.ts and global-nav.spec.ts prove it at 1280px and 320px); a keydown handler would double-toggle */}
            <summary
              ref={triggerRef}
              // ⚠️ Once hydrated, React owns the toggle, and the native one is
              // cancelled. Measured, and caught by e2e: left native, a click
              // opens the DOM synchronously, but `isMoreOpen` (and with it the
              // Escape and outside-press listeners it gates) arrives only after
              // the async `toggle` event and a paint. A press in that window
              // was ignored. Driving the state from the click gives the timing
              // the old `<button>` had. `e2e/nav-more-disclosure.spec.ts` pins it
              // deterministically ("an outside press in the SAME task…"), which
              // fails 5/5 without this handler. Keyboard activation of a `<summary>`
              // dispatches this same `click`, so Enter and Space still work.
              // Before hydration, and with JavaScript off, no handler is
              // attached and the native toggle does the work. That is the whole
              // reason this is a `<details>`.
              onClick={(event) => {
                event.preventDefault()
                setIsMoreOpen((open) => !open)
              }}
              className={
                isMoreActive ? `${MORE_TRIGGER_CLASS} ${ACTIVE_CLASS}` : MORE_TRIGGER_CLASS
              }
            >
              <MoreIcon className="h-6 w-6 sm:hidden" />
              <span data-nav-label>More</span>
            </summary>
            <ul className={SHEET_PANEL_CLASS}>
              {visibleMoreDestinations.map((item) => (
                <li key={item.to} className="max-sm:min-w-0" data-nav-path={item.to}>
                  <Link
                    to={item.to}
                    className={SHEET_ROW_CLASS}
                    activeProps={{ 'aria-current': 'page', className: ACTIVE_CLASS }}
                    // Wrapped, NOT passed by reference: `closeMore` takes an
                    // optional `restoreFocus` flag, and React would pass its
                    // MouseEvent into it — a truthy object, so it would happen to
                    // work today and break silently the moment the default flips.
                    onClick={() => closeMore()}
                  >
                    <item.Icon className="h-6 w-6 sm:hidden" />
                    <span data-nav-label>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </li>
      </ul>
    </nav>
  )
}

// Icon Components
//
// Co-located here rather than in a shared module: 13 components across the app
// hand-roll their inline SVG the same way and there is no icons package to add
// one to. House style is pinned by `src/components/premium/PremiumLockBadge.tsx`.
//
// ⚠️⚠️ EVERY ONE IS RENDERED WITH `sm:hidden` BY ITS CALLER. Icons are a
// mobile-only element; without that token the desktop nav grows 52px -> 76px at
// 1280px and every anchor 36px -> 60px, for 212 computed diffs and ZERO failing
// tests in the pre-31.5 suite.

function HomeIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  )
}

function IncomeIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}

function ExpensesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
      />
    </svg>
  )
}

function SavingsIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function MoreIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
      />
    </svg>
  )
}

function BalanceIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
      />
    </svg>
  )
}

function RetirementIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

// The four premium destinations' glyphs (story 58.1). Same house style as every
// icon above — decorative, stroked, 24x24 — and rendered with `sm:hidden` by the
// same sheet-row call site, so they carry the identical desktop-growth risk.

function ForecastingIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>
  )
}

function ProfilesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  )
}

function ReportIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )
}

function CategoriesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
      />
    </svg>
  )
}

function SettingsIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}
