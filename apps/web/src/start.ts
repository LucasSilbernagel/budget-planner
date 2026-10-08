import { getSiteUrl } from '@budget-planner/config'
import { createMiddleware, createStart } from '@tanstack/react-start'
import { generateCspNonce, runWithCspNonce } from './server/csp-nonce'
import {
	applyHeadersToNextResult,
	isCanonicalHttpsRequest,
	isConfirmedHttps,
	paddleEnvironmentFromProcessEnv,
} from './server/middleware/security-headers'

/**
 * getSiteUrl() throws in production on a bad SITE_URL; degrade to no canonical origin
 * rather than turning every page into a 500.
 */
function canonicalSiteUrl(): string | undefined {
	try {
		return getSiteUrl()
	} catch {
		return undefined
	}
}

const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(
	({ next, request }) => {
		const isDev = process.env['NODE_ENV'] === 'development'
		// TLS terminates at the edge, so x-forwarded-proto is the scheme signal, but the custom domain's
		// ingress omits it: a request to our configured https origin also counts as HTTPS.
		const isHttps =
			isConfirmedHttps(request.headers.get('x-forwarded-proto')) ||
			isCanonicalHttpsRequest(
				request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
				canonicalSiteUrl()
			)

		// One nonce shared by the render (via AsyncLocalStorage) and the CSP header.
		const nonce = generateCspNonce()
		const paddleEnvironment = paddleEnvironmentFromProcessEnv()
		return runWithCspNonce(nonce, () =>
			applyHeadersToNextResult(next, { isDev, isHttps, nonce, paddleEnvironment })
		)
	}
)

export const startInstance = createStart(() => ({
	requestMiddleware: [securityHeadersMiddleware],
}))
