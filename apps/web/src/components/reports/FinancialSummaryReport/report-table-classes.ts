import { cn } from '@/lib/cn'
import { RESPONSIVE_SCROLL_SHADOW_CLASS, RESPONSIVE_WRAPPER_CLASS } from '../../ui/ResponsiveTable'

export const TABLE_CLASS = 'min-w-full divide-y divide-gray-200 dark:divide-gray-700'

// A four-column table is wider than a phone card, so it scrolls in its own region.
// The print: resets keep wide tables unclipped and the shadow gradients off paper.
export const TABLE_REGION_CLASS = cn(
	RESPONSIVE_WRAPPER_CLASS,
	RESPONSIVE_SCROLL_SHADOW_CLASS,
	'mt-3 print:overflow-visible print:bg-none'
)

// `anywhere` (not break-word) lowers min-content so long names cannot widen tables, on screen or paper;
// max-sm:min-w keeps ordinary names from splitting mid-word on phones.
export const NAME_WRAP_CLASS = '[overflow-wrap:anywhere] max-sm:min-w-[8rem]'

export const TH_CLASS =
	'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-label'
export const TH_NUMERIC_CLASS = cn(TH_CLASS, 'text-right')
export const TD_CLASS = 'px-3 py-2 text-sm text-body'
export const TD_NUMERIC_CLASS = cn(TD_CLASS, 'text-right tabular-nums')
