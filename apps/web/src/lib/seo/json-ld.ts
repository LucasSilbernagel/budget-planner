import { canonicalLink } from './canonical'
import { SITE_ORIGIN } from './site-origin'

export type JsonLdScript = {
	readonly type: 'application/ld+json'
	readonly children: string
}

// `<` is escaped so a string value can never close the script element early.
export function jsonLdScript(data: object): JsonLdScript {
	return { type: 'application/ld+json', children: JSON.stringify(data).replace(/</g, '\\u003c') }
}

export type BreadcrumbItem = {
	readonly name: string
	readonly path: string
}

export function breadcrumbList(items: readonly BreadcrumbItem[]): object {
	if (items.length === 0) throw new Error('breadcrumbList: at least one item is required')
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: item.name,
			item: canonicalLink(item.path).href,
		})),
	}
}

const LONGHAND_OFFERS = [
	{ name: 'Free', price: '0' },
	{ name: 'Premium, monthly', price: '5.99' },
	{ name: 'Premium, yearly', price: '39' },
	{ name: 'Premium, lifetime', price: '99' },
] as const

export function longhandSoftwareApplication(): object {
	return {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Longhand Budget',
		url: `${SITE_ORIGIN}/`,
		applicationCategory: 'FinanceApplication',
		operatingSystem: 'Web',
		description:
			'A budget planner without bank sync. Plan income, expenses, savings and debts from the figures you enter; the free tier runs entirely in your browser.',
		offers: LONGHAND_OFFERS.map((offer) => ({
			'@type': 'Offer',
			name: offer.name,
			price: offer.price,
			priceCurrency: 'EUR',
			url: `${SITE_ORIGIN}/pricing`,
		})),
	}
}
