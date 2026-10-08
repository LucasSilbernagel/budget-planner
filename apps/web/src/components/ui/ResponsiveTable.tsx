import type { ReactNode } from 'react'

/**
 * Below `sm` rows become cards via appended `max-sm:` display modes: one DOM, no JS branch, so SSR matches.
 * Don't re-add table roles: each cell gains a visible label in place of column-header association.
 */

/** Stays a scroll container at every width, so an escaped overflow scrolls the table, not the page. */
export const RESPONSIVE_WRAPPER_CLASS = 'overflow-x-auto'

/**
 * Covers painted `local` and shadows painted `scroll`, so shadows show only while scrolled; `bg-local`
 * can't set per-layer values. The dark shadow is a light glow because black can't darken gray-800.
 */
export const RESPONSIVE_SCROLL_SHADOW_CLASS =
	'surface bg-[linear-gradient(to_right,white,rgba(255,255,255,0)),linear-gradient(to_left,white,rgba(255,255,255,0)),linear-gradient(to_right,rgba(0,0,0,0.25),rgba(0,0,0,0)),linear-gradient(to_left,rgba(0,0,0,0.25),rgba(0,0,0,0))] dark:bg-[linear-gradient(to_right,#1f2937,rgba(31,41,55,0)),linear-gradient(to_left,#1f2937,rgba(31,41,55,0)),linear-gradient(to_right,rgba(255,255,255,0.3),rgba(255,255,255,0)),linear-gradient(to_left,rgba(255,255,255,0.3),rgba(255,255,255,0))] bg-[length:24px_100%,24px_100%,12px_100%,12px_100%] bg-[position:left_center,right_center,left_center,right_center] [background-repeat:no-repeat] [background-attachment:local,local,scroll,scroll]'

/** `max-sm:divide-y-0`: a `display: none` `<thead>` still counts for `> * + *`. */
export const RESPONSIVE_TABLE_CLASS =
	'min-w-full divide-y divide-gray-200 dark:divide-gray-700 max-sm:block max-sm:min-w-0 max-sm:divide-y-0'

export const RESPONSIVE_THEAD_CLASS = 'surface-inset max-sm:hidden'

/**
 * `max-lg:px-4` is a width budget: at `px-6` the four-column tables overflow their wrapper
 * between `sm` and `lg` on CI's wider font.
 */

/** No 44px floor on header controls: the `<thead>` is `display: none` below `sm`, a hidden
 * ancestor, so mobile sorting lives outside the table in `TableSortControl`. */
export const RESPONSIVE_HEADER_CELL_CLASS =
	'px-6 max-lg:px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider'

export const RESPONSIVE_HEADER_CELL_RIGHT_CLASS =
	'px-6 max-lg:px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider'

/** No `surface` here: an opaque `<tbody>` would paint over the wrapper's scroll shadows. */
export const RESPONSIVE_TBODY_CLASS =
	'divide-y divide-gray-200 dark:divide-gray-700 max-sm:block max-sm:divide-y-0'

export const RESPONSIVE_ROW_CLASS =
	'hover:bg-gray-50 dark:hover:bg-gray-700/40 max-sm:block max-sm:mb-3 max-sm:rounded-lg max-sm:border max-sm:border-default max-sm:p-2'

/** No cross-axis alignment here: Tailwind resolves conflicting `items-*` by CSS order, not class order. */
const RESPONSIVE_CELL_BASE =
	'px-6 max-lg:px-4 py-4 whitespace-nowrap max-sm:flex max-sm:justify-between max-sm:gap-3 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

export const RESPONSIVE_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:items-baseline`

/** `max-sm:flex-col` stacks the label above the buttons, which don't fit beside it at 320px. */
export const RESPONSIVE_ACTIONS_CELL_CLASS = `${RESPONSIVE_CELL_BASE} max-sm:flex-col max-sm:items-center text-right text-sm`

export const RESPONSIVE_STACKED_CELL_CLASS =
	'px-6 max-lg:px-4 py-4 whitespace-nowrap max-sm:block max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] max-sm:px-3 max-sm:py-2'

/**
 * Fix the pair, never the cell: the cell's `anywhere` wrapping must stay. Protect the tag, not the free-text value.
 * `max-sm:items-start` keeps the tag on the first line when the value wraps.
 */
export const RESPONSIVE_VALUE_TAG_CLASS = 'flex items-center gap-2 max-sm:items-start'

/**
 * `whitespace-nowrap` raises the tag's min-content floor to the full string. Don't add `shrink-0`:
 * on its own it overflows the wrapper.
 */
export const RESPONSIVE_TAG_CLASS = 'whitespace-nowrap'

/**
 * Only for a `GroupedAmount` figure, never free text. `sm:[&_wbr]:hidden` is load-bearing:
 * Chromium breaks at `<wbr>` even under inherited `nowrap`, which would wrap desktop figures.
 */
export const RESPONSIVE_AMOUNT_CLASS = '[overflow-wrap:normal] sm:[&_wbr]:hidden'

/** `max-sm:flex-wrap` is graceful degradation for larger root font sizes. */
export const RESPONSIVE_ACTIONS_GROUP_CLASS =
	'max-sm:flex max-sm:items-center max-sm:flex-wrap max-sm:justify-center max-sm:gap-1'

/** Every token must stay `max-sm:`-prefixed; desktop hit-area padding belongs at the call site. */
export const RESPONSIVE_ACTION_BUTTON_CLASS =
	'max-sm:inline-flex max-sm:items-center max-sm:justify-center max-sm:min-h-[44px] max-sm:min-w-[44px]'

/**
 * `[overflow-wrap:normal]` stops the label breaking mid-word; `basis-0 grow` gives the value its full
 * width whenever it fits. Not `whitespace-nowrap` (starves the value) nor `shrink-[1000]` (still shaves it).
 */
export const FIELD_LABEL_CLASS =
	'sm:hidden text-xs font-medium uppercase tracking-wider text-muted [overflow-wrap:normal] basis-0 grow'

/** Module scope on purpose: a component defined in a page body remounts every render and loses focus. */
export function FieldLabel({ children }: { children: ReactNode }) {
	return <span className={FIELD_LABEL_CLASS}>{children}</span>
}
