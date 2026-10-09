export function isExternalHref(href: string): boolean {
	// An explicit scheme or a protocol-relative URL can leave the site; relative links stay in-tab.
	return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
}
