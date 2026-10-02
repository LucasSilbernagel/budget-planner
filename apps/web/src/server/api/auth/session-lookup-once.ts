/**
 * One session lookup per request.
 *
 * During SSR of `/login` the root loader and the route's `beforeLoad` guard
 * both call `getSessionSeed` in-process for the SAME request, and with a
 * session cookie each lookup is a `users` query. Keyed on the request object,
 * so every client navigation (its own RPC request) still resolves fresh, and
 * nothing outlives the request.
 */

const lookups = new WeakMap<Request, Promise<unknown>>()

export function lookupSessionOnce<T>(request: Request, lookup: (request: Request) => Promise<T>) {
  let pending = lookups.get(request) as Promise<T> | undefined
  if (!pending) {
    pending = lookup(request)
    lookups.set(request, pending)
  }
  return pending
}
