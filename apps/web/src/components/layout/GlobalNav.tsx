import { Link, useRouterState } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
 * There is exactly one `<nav>`, one OUTER `<ul>`, one `<button>` and — since
 * story 58.1 — seven `<a>` for a free session or eleven for an entitled one, in
 * the DOM at every viewport. The COUNT varies by tier; the STRUCTURE never does.
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
 * `<li>`, dissolved at >= 640px with `sm:contents` on BOTH the wrapper `<li>`
 * and the nested `<ul>`. The obvious alternative — leaving every `<li>` in the
 * bar and re-listing the sheet's share in a mobile-only sheet — puts those
 * destination labels in the DOM TWICE, which is the dual-render rejected above.
 * Measured against a flat control at 1280px (when the nav held EIGHT items; it
 * holds seven free / eleven entitled since 58.1), the nested structure laid out
 * all 8 anchors with ZERO geometry mismatches. It is not free, though:
 * `display: contents` flattens the LAYOUT tree but NOT the ACCESSIBILITY tree,
 * so the desktop AX tree gains one nesting level (`list > 4 listitem`, then
 * `listitem > list > 4 listitem`). A nested list inside a nav is valid and
 * commonplace; it is recorded here because it IS a desktop semantic change,
 * even though desktop geometry and computed style are byte-identical.
 *
 * ⚠️⚠️ EVERY ICON CARRIES `sm:hidden`, and the nested `<ul>` MUST keep
 * `sm:contents`. Both are mobile-only concerns, and the entire test suite is
 * provably blind to losing either: measured, icons without `sm:hidden` grow the
 * desktop nav 52px -> 76px at 1280px (212 computed diffs) and the nested `<ul>`
 * without `sm:contents` grows it 52px -> 160px (140 diffs) — and in BOTH cases
 * zero tests went red, including the one named "the desktop cascade is
 * untouched", because the merged-style partition never read `height`. It reads
 * `height` and `flex-direction` now, and `e2e/nav-responsive-css.spec.ts`
 * carries a full differential dump. Do not remove either token.
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
 * At >= 640px these are ordinary items of the one desktop row — `sm:contents`
 * dissolves both the wrapper `<li>` and this nested list, so the free nav's seven anchors
 * lay out exactly as they did before this story.
 *
 * ⚠️ Was FOUR until story 43.3 removed `/net-worth-projection` (FR69). Every
 * "eight anchors" figure in this file dates from before that removal; the ones
 * describing the CURRENT nav now say seven, and the ones narrating the former
 * 4x2 grid are left as history.
 */
const MORE_DESTINATIONS: readonly NavItem[] = [
  // Story 43.2 (UX-DR48): label renamed "Balance" -> "Balance Tracking" so the
  // nav matches the page's own H1 (`BalancePage.tsx`). The route (`to`) is
  // unchanged, so active-state/aria-current is unaffected.
  { label: 'Balance Tracking', to: '/balance', Icon: BalanceIcon },
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
 *   - A nav label tracks the PAGE, not the benefit pitch — the rule story 43.2
 *     applied when it renamed Balance -> Balance Tracking to match that page's
 *     own H1. This nav has always spoken that way (`Savings`, not "Savings
 *     Goals"; `Income`, not "Income Sources").
 *   - The benefit names carry 67 characters against these 35. The desktop row is
 *     one wrapped flex row, so label text is row height for every paying user on
 *     every page.
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
 * The desktop appearance of a nav anchor — identical for a bar tab and a sheet
 * row, which is what keeps the >= 640px cascade byte-identical.
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
 * Deliberately omits `max-sm:flex-row` / `max-sm:justify-start` /
 * `max-sm:text-left` — a flex container defaults to `row`, `normal` and `start`
 * respectively, so those tokens would be no-ops with no observable consequence
 * to guard, which is the "token with no possible assertion" this suite treats as
 * a missing guard rather than as coverage.
 */
const SHEET_ROW_CLASS = `${NAV_LINK_BASE} max-sm:flex max-sm:min-h-[44px] max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:px-4 max-sm:py-3 max-sm:text-sm max-sm:leading-tight max-sm:focus-visible:ring-inset`

/**
 * The active treatment, applied by `<Link activeProps>` on every destination anchor and
 * by hand on the More trigger (which is not a route — see `isMoreActive`).
 */
const ACTIVE_CLASS = 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'

/**
 * The More trigger is a mobile-only ELEMENT, so per the composition rule it
 * takes base classes + `sm:hidden` rather than `max-sm:`-scoped ones. It must
 * not reach the desktop row: an eighth item there changes the widest-link right
 * edge that `e2e/nav-responsive-css.spec.ts` measures, whose premise is that the
 * row already overflows a 640px viewport on its own.
 *
 * ⚠️ This sentence carried "the eight-item row already wants 778px" until story
 * 43.3. That figure was stale twice over: 43.2 measured the row at 753px (CI
 * fonts) BEFORE its own change and 815px after, and 43.3 then removed an item.
 * The live measurement lives in ONE place — `e2e/nav-responsive-css.spec.ts` —
 * so it cannot go stale in three files again. Do not restate a width here.
 */
const MORE_TRIGGER_CLASS =
  'flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-[11px] font-medium leading-tight text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 sm:hidden dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'

/**
 * The sheet panel itself.
 *
 * `sm:contents` dissolves it into the desktop row. Below `sm` it is an
 * out-of-flow panel anchored to the top edge of the bar, and it needs its own
 * OPAQUE background in both themes for the same reason the bar does: it is
 * `absolute`, so page content passes underneath it. A dropped background
 * computes to `rgba(0, 0, 0, 0)` and the destinations sit on whatever scrolls
 * past.
 *
 * ⚠️ THE CAP AND THE SCROLL ARE NOT OPTIONAL, and code review caught their
 * absence. The panel's height is content-driven and it is anchored to the bar's
 * top edge, so with no cap it simply grows off the TOP of the screen — and
 * because it is out of flow, page scrolling cannot reach what it pushes away.
 * Measured at 568x320 with a 24px root font: the panel was 301px tall, its top
 * was at y=-57.75, and the "Balance" row sat at y=-51 — off-screen, un-tappable
 * and unscrollable. The cap is expressed against the small viewport unit so a
 * mobile URL bar cannot invalidate it, and leaves room for the bar itself.
 * Both of the repo's other disclosed panels do the same (`Modal.tsx:113`,
 * `profiles/switch-profile.tsx:130`).
 *
 * ⚠️ `overflow-y-auto` computes `overflow-x` to `auto` as well, which makes this
 * panel a HORIZONTAL scroll container that would silently absorb an overflowing
 * row label (31.2's absorption trap). `e2e/nav-responsive-css.spec.ts` asserts
 * `panel.scrollWidth <= panel.clientWidth` element-level precisely so that
 * absorption cannot hide a regression.
 */
const SHEET_PANEL_CLASS =
  'sm:contents max-sm:absolute max-sm:inset-x-0 max-sm:bottom-full max-sm:max-h-[calc(100svh-5rem)] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:py-1 dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800'

export function GlobalNav() {
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /**
   * Whether the in-flight pointer gesture STARTED outside the nav.
   *
   * Mutable gesture state is the thing that actually goes stale across
   * open/close cycles (`isMoreOpen` gates the render, not the mount, so refs
   * persist) — 31.3 shipped exactly this bug. It is reset on every terminal
   * path, including `pointercancel`: a touch that turns into a scroll fires
   * `pointercancel` and never a `click`. The `triggerRef` above is NOT at risk
   * for the same reason — the More button is always mounted, at every width and
   * in both states.
   */
  const outsidePressRef = useRef(false)

  /**
   * `aria-controls` needs a stable id. React 19's `useId()` returns `_R_bd6_`
   * (no colons), so it is a legal id AND a legal CSS selector — React 18's
   * `:r0:` would not have been.
   */
  const panelId = useId()

  /**
   * The More tab's active state CANNOT come from `<Link activeProps>`: More is
   * not a route, so `activeProps` would silently mark nothing and the bar would
   * show NO active tab on three of seven destinations — worse orientation than
   * the grid this replaced. `useRouterState` reads `router.stores.location`, the
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

  useEffect(() => {
    if (!isMoreOpen) return

    const isOutside = (target: EventTarget | null): boolean =>
      !(target instanceof Node) || !navRef.current?.contains(target)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMore()
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
        const active = document.activeElement
        const claimedByOutside =
          active instanceof Node &&
          active !== document.body &&
          active !== document.documentElement &&
          !navRef.current?.contains(active)
        closeMore(!claimedByOutside)
      }
    }
    const handlePointerCancel = () => {
      outsidePressRef.current = false
    }

    // Gated on `isMoreOpen` — this is structurally the always-mounted document
    // listener that `profiles/switch-profile.tsx:59-68` gets wrong, and it is
    // acceptable here ONLY because it is gated.
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
      className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:border-t max-sm:border-gray-200 max-sm:bg-white max-sm:pb-[env(safe-area-inset-bottom)] dark:max-sm:border-gray-700 dark:max-sm:bg-gray-800"
    >
      {/* `flex-wrap` is LOAD-BEARING at >= 640px — do not remove it. It arrived
          (commit d4f3ffb) to contain the eight items the nav then had, during the
          old pre-hydration flash; the desktop bar is two rows in its own right
          from 640px up to the single-row threshold recorded in
          `e2e/nav-responsive-css.spec.ts` (821px under CI fonts as of 43.3),
          above which it is one row. Nothing used to catch that —
          `responsive-320.spec.ts` and
          `global-nav.spec.ts` both sweep 320px only — so
          `e2e/nav-responsive-css.spec.ts` now measures 640/700/760px.

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
        {/* The fifth cell. `sm:contents` dissolves this wrapper at >= 640px so
            its children rejoin the one desktop flex row; below `sm` it is the
            More grid cell and the positioning context's nearest content. */}
        <li className="max-sm:min-w-0 sm:contents">
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={isMoreOpen}
            aria-controls={panelId}
            onClick={() => setIsMoreOpen((open) => !open)}
            className={isMoreActive ? `${MORE_TRIGGER_CLASS} ${ACTIVE_CLASS}` : MORE_TRIGGER_CLASS}
          >
            <MoreIcon className="h-6 w-6 sm:hidden" />
            <span data-nav-label>More</span>
          </button>
          {/* ⚠️ The open/closed state is a `max-sm:`-scoped CLASS, never the
              `hidden` ATTRIBUTE. `hidden={!isMoreOpen}` — the textbook
              disclosure idiom — applies at EVERY width and would delete
              Balance Tracking, Retirement and Settings from the DESKTOP nav
              entirely. */}
          <ul
            id={panelId}
            className={isMoreOpen ? SHEET_PANEL_CLASS : `${SHEET_PANEL_CLASS} max-sm:hidden`}
          >
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
