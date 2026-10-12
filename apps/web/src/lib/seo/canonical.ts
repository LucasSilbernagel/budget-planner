import { SITE_ORIGIN } from './site-origin'

export type CanonicalLink = {
	readonly rel: 'canonical'
	readonly href: string
}

// Lowercase slug segments only: anything else is a URL variant that would split ranking.
const CANONICAL_PATH = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?)?$/

function canonicalPath(path: string): string {
	if (!CANONICAL_PATH.test(path)) {
		throw new Error(
			`canonicalLink: expected a lowercase absolute path without query or hash, got "${path}"`
		)
	}
	return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function canonicalLink(path: string): CanonicalLink {
	return { rel: 'canonical', href: `${SITE_ORIGIN}${canonicalPath(path)}` }
}
