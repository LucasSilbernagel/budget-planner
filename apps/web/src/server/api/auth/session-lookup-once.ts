// During SSR the root loader and a route's beforeLoad both resolve the session for the same request.
// Keyed on the request, so every client navigation still resolves fresh.

const lookups = new WeakMap<Request, Promise<unknown>>()

export function lookupSessionOnce<T>(request: Request, lookup: (request: Request) => Promise<T>) {
	let pending = lookups.get(request) as Promise<T> | undefined
	if (!pending) {
		pending = lookup(request)
		lookups.set(request, pending)
	}
	return pending
}
