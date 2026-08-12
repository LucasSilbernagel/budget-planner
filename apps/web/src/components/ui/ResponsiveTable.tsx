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
  'px-6 py-4 whitespace-nowrap max-sm:flex max-sm:justify-between max-sm:gap-3 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

/** A data `<td>`: label left, value right below `sm`. */
export const RESPONSIVE_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:items-baseline`

/** The trailing Edit/Delete `<td>`. Centred rather than baseline-aligned
 * because its children are >= 44px tap targets, not text. */
export const RESPONSIVE_ACTIONS_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:items-center text-right text-sm`

/** A `<td>` whose content is full-width (the Savings progress bar) and so must
 * stack under its label instead of sitting beside it. */
export const RESPONSIVE_STACKED_CELL_CLASS =
  'px-6 py-4 whitespace-nowrap max-sm:block max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

/** Wraps the two row action buttons so the actions cell has exactly two flex
 * children (label + button group) below `sm`. Inert on desktop: an unclassed
 * block `<div>` leaves the inline buttons right-aligned exactly as before. */
export const RESPONSIVE_ACTIONS_GROUP_CLASS = 'max-sm:flex max-sm:items-center'

/** Mobile tap-target sizing for a row action button (>= 44px both dimensions).
 * Breakpoint-scoped on purpose — an unprefixed `min-h-[44px]` would change the
 * desktop rendering. `inline-flex` centres the label inside the enlarged box;
 * it is not what makes the box 44px (a `<button>` is `inline-block` by default,
 * so `min-h`/`min-w` already apply — measured: dropping `inline-flex` keeps the
 * 44px rect and only shifts the label). */
export const RESPONSIVE_ACTION_BUTTON_CLASS =
  'max-sm:inline-flex max-sm:items-center max-sm:justify-center max-sm:min-h-[44px] max-sm:min-w-[44px]'

/** `<tfoot>` for the one table that has a summary row (the Balance page's
 * Investment Accounts breakdown). It must switch to `block` alongside the
 * `<tbody>`: leaving it as `table-footer-group` while the body is `block`
 * would leave one table holding both block and table-internal subtrees. */
export const RESPONSIVE_TFOOT_CLASS = 'surface-inset max-sm:block'

/** The `<tfoot>` `<tr>`. A summary strip, not a card — label and total on one
 * line, no border, no card padding. */
export const RESPONSIVE_FOOTER_ROW_CLASS = 'max-sm:flex max-sm:justify-between max-sm:gap-3'

/** A `<tfoot>` cell. Takes the same wrap relief as a data cell, not just the
 * padding: the total is the one string in the converted subtree that can grow
 * without bound (a near-`MAX_SAFE_INTEGER` balance in symbol mode), and the
 * call site adds an unprefixed `whitespace-nowrap` on top. Without this it was
 * the only unguarded nowrap left below `sm`. */
export const RESPONSIVE_FOOTER_CELL_CLASS =
  'px-6 py-3 max-sm:px-3 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]'

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
