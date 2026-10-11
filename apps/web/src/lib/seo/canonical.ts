import { SITE_ORIGIN } from './site-origin'

export type CanonicalLink = {
	readonly rel: 'canonical'
	readonly href: string
}

export function canonicalLink(path: string): CanonicalLink {
	if (!path.startsWith('/') || /[?#]/.test(path)) {
		throw new Error(`canonicalLink: expected an absolute path without query or hash, got "${path}"`)
	}
	const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
	return { rel: 'canonical', href: `${SITE_ORIGIN}${trimmed}` }
}
