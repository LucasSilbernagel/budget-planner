import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { NotFoundPage } from './components/NotFoundPage'
import { routeTree } from './routeTree.gen'
import { CSP_NONCE_GLOBAL_KEY } from './server/csp-nonce-key'

/** A plain global read so this isomorphic file never imports the node-only nonce module. */
function readServerCspNonce(): string | undefined {
	const getter = (globalThis as Record<string, unknown>)[CSP_NONCE_GLOBAL_KEY]
	return typeof getter === 'function' ? (getter as () => string | undefined)() : undefined
}

export function getRouter() {
	// `import.meta.env.SSR` folds to false on the client, dropping the server-only global from the bundle.
	const nonce = import.meta.env.SSR ? readServerCspNonce() : undefined

	const router = createTanStackRouter({
		routeTree,
		defaultPreload: 'intent',
		scrollRestoration: true,
		defaultNotFoundComponent: NotFoundPage,
		ssr: { nonce },
	})

	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
