import type { ReactNode } from 'react'

/**
 * Shared responsive-table class layer (story 31.2, UX-DR36).
 *
 * The four finance pages (Income, Expenses, Savings, Balance — five tables in
 * total) render genuine semantic `<table>`s whose every cell carries
 * `whitespace-nowrap` and `px-6`. At 320px that is the direct cause of
 * horizontal overflow: the auto-layout table sizes to its longest unbroken run
 * and its `overflow-x-auto` wrapper silently absorbs the excess into a scroll
 * bar. This module makes those rows read as stacked cards below `sm` while
 * leaving the >= 640px rendering byte-identical.
 *
 * ## Approach: one DOM, a CSS display-mode switch
 *
 * There is exactly ONE `<table>` in the DOM at every viewport. Below `sm` the
 * table/`<tbody>`/`<tr>`/`<td>` display modes are switched with `max-sm:`
 * utilities and a mobile-only label span is added per cell. Two alternatives
 * were rejected and must not be reintroduced:
 *
 *   - **Dual-render** (`hidden sm:table` table + `sm:hidden` card list): every
 *     value would exist twice in the DOM. jsdom applies no media queries, so
 *     the existing page suites would get multi-match failures on
 *     `getByText`/`getByTestId`.
 *   - **A `useIsNarrowViewport()` branch**: that hook returns `false` on the
 *     server AND on the first client render, so SSR would emit the desktop
 *     table at 320px and hydration would swap it — the hydration reflow/CLS
 *     already logged in `deferred-work.md`. The hook is scoped to props that
 *     cannot be driven by CSS (Recharts); a layout swap is not that case.
 *
 * ## Composition rule — follow it exactly
 *
 *   - Mobile-only **styling on a shared element** -> a `max-sm:` variant
 *     APPENDED to the unchanged desktop class string. Never neutralise a base
 *     class with an unprefixed override; partition by breakpoint instead.
 *   - Mobile-only **element** (the field labels) -> base classes + `sm:hidden`.
 *
 * That keeps the >= 640px cascade untouched, which is what makes "desktop is
 * unchanged" provable by inspection rather than by screenshot.
 *
 * ## Two traps baked into these values
 *
 *   - `break-words` (`overflow-wrap: break-word`) does **not** reduce an
 *     element's min-content width, so an auto-layout table still sizes to its
 *     longest unbroken run. The cells use `[overflow-wrap:anywhere]` (Tailwind
 *     v3.4 has no `wrap-anywhere` utility) together with
 *     `max-sm:whitespace-normal`. Swapping either one out was measured at
 *     ~1134px inside a 320px viewport, so both are load-bearing.
 *   - **Never put `.surface-inset` and `.surface-interactive` on the same
 *     element.** Both set `background-color` inside `@layer components`, where
 *     the winner is whichever is declared later in `global.css` — not whichever
 *     appears later in the className. For the same reason `hover:surface-inset`
 *     compiles and lints cleanly but is a silent no-op; do not write it.
 *
 * ## Accessibility note
 *
 * Setting `display: block`/`flex` on `<tr>`/`<td>` drops table semantics from
 * the accessibility tree below `sm`. That is deliberate and accepted, because
 * every cell gains its own visible {@link FieldLabel} — the field/value
 * association moves from the column header to an adjacent label rather than
 * being lost. Do **not** re-add `role="table"`/`role="row"`/`role="cell"`:
 * re-asserting a grid the user can no longer navigate by column is worse than
 * the linearised reading. The `<thead>` stays in the DOM (hidden via
 * `display: none`, so correctly out of the a11y tree) and takes over again at
 * >= 640px.
 */

/** `<div>` wrapping the table.
 *
 * The wrapper stays a scroll container at EVERY width — deliberately, and after
 * this was reconsidered once. An earlier draft added `max-sm:overflow-x-visible`
 * so that a future regression would propagate to `documentElement` and trip the
 * document-level 320px assertion, which is otherwise unfalsifiable here (a
 * scroll container absorbs its content's overflow rather than passing it up).
 *
 * That reasoning was incomplete. Both configurations detect a regression
 * equally well — measured: with a visible wrapper the document-level check
 * fires (1134px at a 320px viewport); with a scrollable wrapper the per-wrapper
 * check fires instead (1094px vs a 240px client width) on every seeded case.
 * Since detection is a wash, the only thing the choice changes is what a real
 * user gets when a regression escapes CI: a single sideways-scrolling table, or
 * a sideways-scrolling *document* at 320px — which is the exact UX-DR9
 * violation this work exists to remove. Containment wins.
 *
 * So `e2e/responsive-320.spec.ts`'s per-wrapper assertion is the primary guard;
 * its document-level assertion is the escape hatch for overflow that bypasses
 * the wrapper entirely. */
export const RESPONSIVE_WRAPPER_CLASS = 'overflow-x-auto'

/** The `<table>`.
 *
 * ⚠️ `max-sm:block` here (and on the `<tbody>`/`<tr>` below) is DEFENSIVE, not
 * the mechanism. Measured at 320px: removing it changes nothing, because every
 * `<td>` already leaves table formatting via `max-sm:flex` / `max-sm:block`, so
 * the row's children are all non-table boxes and the browser stacks them inside
 * one generated anonymous cell. Removing `max-sm:flex` from the CELL, by
 * contrast, immediately overflows (351px at 320px). The explicit block chain is
 * kept anyway: depending on anonymous-box generation for the whole card layout
 * is far more fragile than declaring the display mode we actually want.
 *
 * `max-sm:divide-y-0` matters because `divide-y` targets `> * + *` and a
 * `display: none` `<thead>` is still counted by the `+` combinator, leaving a
 * stray rule above the first card. */
export const RESPONSIVE_TABLE_CLASS =
  'min-w-full divide-y divide-gray-200 dark:divide-gray-700 max-sm:block max-sm:min-w-0 max-sm:divide-y-0'

/** The `<thead>`. Hidden below `sm`; each cell carries its own label instead. */
export const RESPONSIVE_THEAD_CLASS = 'surface-inset max-sm:hidden'

/**
 * ## ⚠️ THE `max-lg:px-4` ON EVERY CELL CONSTANT BELOW IS A WIDTH BUDGET, NOT A
 * STYLE PREFERENCE. Do not "simplify" it back to a bare `px-6`.
 *
 * Between `sm` (640px) and `lg` (1024px) these tables are a real `<table>` with
 * no card fallback, and the four-column free-tier `/income` and `/expenses`
 * tables do not fit their `overflow-x-auto` wrapper at `px-6`. Measured on
 * `/income` at a 768px viewport (656px of wrapper client width), with the
 * long-name/12-digit-amount seed `e2e/categories-premium.spec.ts` uses:
 *
 * | build                          | Noto Sans (dev) | DejaVu Sans (CI) |
 * | ------------------------------ | --------------- | ---------------- |
 * | pre-34.1b, `px-6`              | 656 (fits)      | 658 (+2)         |
 * | post-34.1b move arrows, `px-6` | 672 (+16)       | 706 (+50)        |
 * | post-34.1b, `max-lg:px-4`      | 656 (fits)      | 656 (fits)       |
 *
 * Story 34.1b's two move chevrons cost a host-INDEPENDENT 48px in the Actions
 * column (2 x 16px icon + 2 x 8px `sm:mr-2`) — 658 + 48 = 706 exactly. Dev
 * fonts hid it: the text columns still had 32px of compressible slack, so the
 * local number landed at 672, inside the guard's 24px tolerance, and the suite
 * went green while CI went red. Dropping 8px of horizontal padding per side on
 * four columns reclaims 64px, which covers the 48px and restores the pre-34.1b
 * fit on BOTH hosts.
 *
 * ⚠️ `system-ui` DOES NOT RESOLVE TO THE SAME FACE ON THE RUNNER. GitHub's
 * ubuntu image resolves it to DejaVu Sans, which is materially wider than the
 * Noto Sans a typical dev box picks. To reproduce a CI width locally, inject
 * `* { font-family: "DejaVu Sans" !important }` — that reproduced 706 to the
 * pixel. A green local run is NOT evidence about a width budget.
 *
 * The cascade is `max-sm:px-3` (< 640) -> `max-lg:px-4` (640-1023) -> `px-6`
 * (>= 1024), and it resolves in that order because Tailwind sorts `max-*`
 * variants by DESCENDING breakpoint, so `max-sm` is emitted after `max-lg` and
 * wins on a phone. Verified by computed style at 320/640/768/1023/1024/1280.
 * `px-6` stays in every string as the `lg`-and-up base, which is also what keeps
 * `ResponsiveTable.test.tsx`'s class-TOKEN pins passing.
 */

/** A column header `<th>` (story 34.2).
 *
 * Before this story the five `<thead>`s each hand-rolled this literal, and two
 * of them wrote the same token set in a different order (`text-left text-xs
 * font-medium text-muted ...` on Income/Expenses vs `font-medium text-muted
 * text-xs text-left ...` on Savings/Balance). Identical computed output, and
 * nothing pins a `<th>` className, so collapsing them into one constant is safe
 * — and it is what lets {@link SortableColumnHeader} match a plain `<th>` on
 * every page without five per-page overrides.
 *
 * ⚠️ The `<thead>` is `display: none` below `sm` ({@link RESPONSIVE_THEAD_CLASS}),
 * so anything placed in a header cell is unreachable on a phone. That is why
 * sorting is a >= 640px affordance and why header controls deliberately do NOT
 * carry {@link RESPONSIVE_ACTION_BUTTON_CLASS}: a 44px floor on a `display: none`
 * ancestor is dead CSS, and `assertHasMobileTapTarget` would be asserting
 * nothing. */
export const RESPONSIVE_HEADER_CELL_CLASS =
  'px-6 max-lg:px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider'

/** A right-aligned column header `<th>` — the trailing `Actions` column. */
export const RESPONSIVE_HEADER_CELL_RIGHT_CLASS =
  'px-6 max-lg:px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider'

/** The `<tbody>`. */
export const RESPONSIVE_TBODY_CLASS =
  'surface divide-y divide-gray-200 dark:divide-gray-700 max-sm:block max-sm:divide-y-0'

/** A data `<tr>` — the card below `sm`. It sits inside a `.surface` `<tbody>`,
 * so it is already on the gray-800 card colour in dark mode; definition comes
 * from `border-default`, not a second background token. */
export const RESPONSIVE_ROW_CLASS =
  'hover:bg-gray-50 dark:hover:bg-gray-700/40 max-sm:block max-sm:mb-3 max-sm:rounded-lg max-sm:border max-sm:border-default max-sm:p-2'

/** Shared cell base WITHOUT a cross-axis alignment, so the variants below can
 * each pick their own without two conflicting `align-items` utilities landing
 * on one element (Tailwind resolves those by CSS source order, not className
 * order — an unreliable thing to rely on). */
const RESPONSIVE_CELL_BASE =
  'px-6 max-lg:px-4 py-4 whitespace-nowrap max-sm:flex max-sm:justify-between max-sm:gap-3 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

/** A data `<td>`: label left, value right below `sm`. */
export const RESPONSIVE_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:items-baseline`

/** The trailing row-actions `<td>`. Centred rather than baseline-aligned
 * because its children are >= 44px tap targets, not text.
 *
 * ⚠️ `max-sm:flex-col` (story 34.1b): below `sm` the label stacks ABOVE the
 * button group instead of sitting beside it. With four 44px targets in the group
 * (move up, move down, Edit, Delete) the row simply does not fit otherwise — a
 * 320px viewport leaves about 200px of inner cell width once the page, section,
 * card and cell padding are subtracted, and the "Actions" label was consuming
 * roughly a quarter of it. Stacking reclaims that width; `e2e/responsive-320.spec.ts`
 * is what proves the result actually fits.
 *
 * `max-sm:items-center` is retained and still does real work under `flex-col`,
 * where it centres the button group on the cross axis. */
export const RESPONSIVE_ACTIONS_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:flex-col max-sm:items-center text-right text-sm`

/** A `<td>` whose content is full-width (the Savings progress bar) and so must
 * stack under its label instead of sitting beside it. */
export const RESPONSIVE_STACKED_CELL_CLASS =
  'px-6 max-lg:px-4 py-4 whitespace-nowrap max-sm:block max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

/** Wraps the row action buttons so the actions cell has exactly two flex
 * children (label + button group) below `sm`. Inert on desktop: an unclassed
 * block `<div>` leaves the inline buttons right-aligned exactly as before.
 *
 * ⚠️ The group holds FOUR buttons since story 34.1b — move up, move down, Edit,
 * Delete. `max-sm:gap-1` gives them 4px of separation (4 x 44 + 3 x 4 = 188px,
 * inside the ~200px the stacked cell above makes available), and
 * `max-sm:flex-wrap` is graceful degradation rather than the expected layout: at
 * a larger root font size the label or the buttons can grow, and wrapping to a
 * second line is a better failure than overflowing the card. */
export const RESPONSIVE_ACTIONS_GROUP_CLASS =
  'max-sm:flex max-sm:items-center max-sm:flex-wrap max-sm:justify-center max-sm:gap-1'

/** Mobile tap-target sizing for a row action button (>= 44px both dimensions).
 * Breakpoint-scoped on purpose — an unprefixed `min-h-[44px]` would change the
 * desktop rendering. `inline-flex` centres the label inside the enlarged box;
 * it is not what makes the box 44px (a `<button>` is `inline-block` by default,
 * so `min-h`/`min-w` already apply — measured: dropping `inline-flex` keeps the
 * 44px rect and only shifts the label). */
export const RESPONSIVE_ACTION_BUTTON_CLASS =
  'max-sm:inline-flex max-sm:items-center max-sm:justify-center max-sm:min-h-[44px] max-sm:min-w-[44px]'

/** The mobile-only field label. */
export const FIELD_LABEL_CLASS = 'sm:hidden text-xs font-medium uppercase tracking-wider text-muted'

/**
 * The mobile-only label for a single card field (AC-4): below `sm` the column
 * header row is hidden, so each value carries the header text beside it. Hidden
 * at >= 640px, where the real `<thead>` does the job.
 *
 * Declared at MODULE scope on purpose. A component defined inside a page body
 * gets a new function identity on every render, which forces React to unmount
 * and remount its subtree — the focus-loss failure this repo has already
 * shipped once and fixed. Never move this (or any other component) inside a
 * page component.
 */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={FIELD_LABEL_CLASS}>{children}</span>
}
