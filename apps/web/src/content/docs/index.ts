/**
 * Array order is the canonical order for the docs index and sidebar. Titles live here, not in front
 * matter, so each `.md` body starts at `<h2>` (the route header is the page's `<h1>`).
 */

import faq from './faq.md?raw'
import features from './features.md?raw'
import gettingStarted from './getting-started.md?raw'
import howTotalsAreCalculated from './how-totals-are-calculated.md?raw'
import whereAMortgageBelongs from './where-a-mortgage-belongs.md?raw'

export type DocPage = {
	readonly slug: string
	readonly title: string
	readonly description: string
	readonly content: string
}

export const DOC_PAGES: readonly DocPage[] = [
	{
		slug: 'getting-started',
		title: 'Getting Started',
		description: 'Set up your income, expenses, and first overview.',
		content: gettingStarted,
	},
	{
		slug: 'features',
		title: 'Features',
		description: 'Everything Longhand Budget can do, free and premium.',
		content: features,
	},
	{
		slug: 'how-totals-are-calculated',
		title: 'How totals are calculated',
		description: 'The exact conversion between weekly, biweekly, monthly and yearly amounts.',
		content: howTotalsAreCalculated,
	},
	{
		slug: 'where-a-mortgage-belongs',
		title: 'Where a mortgage belongs',
		description:
			'Why a loan is both a recurring payment and a debt, where the property itself goes, and what each one changes.',
		content: whereAMortgageBelongs,
	},
	{
		slug: 'faq',
		title: 'FAQ',
		description: 'Answers to common questions about data, privacy, and totals.',
		content: faq,
	},
]

export function getDocPage(slug: string): DocPage | undefined {
	return DOC_PAGES.find((page) => page.slug === slug)
}
