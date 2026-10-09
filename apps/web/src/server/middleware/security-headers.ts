import { createHash } from 'node:crypto'
import { getPaddleConfig } from '@budget-planner/config/schema'
import { NO_FLASH_PLANNER_SCRIPT } from '../../lib/nav/no-flash-planner-visibility-script'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../../lib/overview/no-flash-account-notice-script'
import { NO_FLASH_OVERVIEW_DATA_SCRIPT } from '../../lib/overview/no-flash-overview-data-script'
import {
	PADDLE_CHECKOUT_FRAME_ORIGIN,
	PADDLE_LOADER_STYLE_TEXT,
} from '../../lib/paddle/paddle-js-internals'

/**
 * Bootstraps are authorized by hash, derived from the imported script constant so it
 * cannot drift. Framework inline scripts use the per-request nonce (dynamic content).
 */
export const PLANNER_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
	.update(NO_FLASH_PLANNER_SCRIPT, 'utf8')
	.digest('base64')}`

/** `script-src` only: a `script-src-elem` directive would override `script-src` for every script. */
export const ACCOUNT_NOTICE_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
	.update(NO_FLASH_ACCOUNT_NOTICE_SCRIPT, 'utf8')
	.digest('base64')}`

export const OVERVIEW_DATA_SCRIPT_CSP_HASH = `sha256-${createHash('sha256')
	.update(NO_FLASH_OVERVIEW_DATA_SCRIPT, 'utf8')
	.digest('base64')}`

/**
 * Production `style-src-elem` only: a hash in a list carrying 'unsafe-inline' switches
 * that off (CSP3). Paddle.js is unversioned, so the text can drift any day.
 */
export const PADDLE_LOADER_STYLE_CSP_HASH = `sha256-${createHash('sha256')
	.update(PADDLE_LOADER_STYLE_TEXT, 'utf8')
	.digest('base64')}`

export type PaddleCspEnvironment = 'sandbox' | 'production'

/** The sandbox host is granted only to a sandbox-configured deployment. */
export function paddleStyleHosts(paddleEnvironment: PaddleCspEnvironment): string[] {
	return paddleEnvironment === 'sandbox'
		? ['https://cdn.paddle.com', 'https://sandbox-cdn.paddle.com']
		: ['https://cdn.paddle.com']
}

/**
 * Unset/empty PADDLE_ENVIRONMENT or a config load failure gives 'production': the schema's
 * sandbox default must not widen the policy, and a CSP must never 500 every page.
 */
export function paddleEnvironmentForCsp(
	explicitEnvironment: string | undefined,
	resolveConfiguredEnvironment: () => string
): PaddleCspEnvironment {
	if (!explicitEnvironment) return 'production'
	try {
		return resolveConfiguredEnvironment() === 'sandbox' ? 'sandbox' : 'production'
	} catch {
		return 'production'
	}
}

export function paddleEnvironmentFromProcessEnv(): PaddleCspEnvironment {
	return paddleEnvironmentForCsp(
		process.env['PADDLE_ENVIRONMENT'],
		() => getPaddleConfig().environment
	)
}

/**
 * `style-src` is only the fallback for browsers lacking style-src-elem/attr (Paddle's overlay needs
 * inline style attributes). `worker-src` must be explicit: it falls back to child-src, not default-src.
 */
export function buildContentSecurityPolicy(
	nonce: string,
	paddleEnvironment: PaddleCspEnvironment,
	isDev: boolean
): string {
	// The nonce is interpolated raw, so reject anything that could break out of the source expression.
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
		throw new Error('buildContentSecurityPolicy: nonce must be a non-empty base64 token')
	}
	const paddleHosts = paddleStyleHosts(paddleEnvironment).join(' ')
	// Dev: any inline <style> (Vite). Production: Paddle's spinner <style> only, by hash.
	// Never both: a hash would switch 'unsafe-inline' off.
	const inlineStyleElementSource = isDev ? `'unsafe-inline'` : `'${PADDLE_LOADER_STYLE_CSP_HASH}'`
	return [
		`default-src 'self'`,
		`script-src 'self' 'nonce-${nonce}' '${PLANNER_SCRIPT_CSP_HASH}' '${ACCOUNT_NOTICE_SCRIPT_CSP_HASH}' '${OVERVIEW_DATA_SCRIPT_CSP_HASH}' https://cdn.paddle.com https://cdn.counter.dev`,
		`style-src 'self' 'unsafe-inline' ${paddleHosts}`,
		`style-src-elem 'self' ${inlineStyleElementSource} ${paddleHosts}`,
		`style-src-attr 'unsafe-inline'`,
		`img-src 'self' data:`,
		`font-src 'self' data:`,
		`connect-src 'self' https://submit-form.com https://counter.dev https://*.counter.dev https://*.paddle.com`,
		'frame-src https://*.paddle.com',
		'child-src https://*.paddle.com',
		`worker-src 'self'`,
		`manifest-src 'self'`,
		`base-uri 'self'`,
		`form-action 'self'`,
		`object-src 'none'`,
		`frame-ancestors 'none'`,
	].join('; ')
}

export function paddleCheckoutFrameOrigins(paddleEnvironment: PaddleCspEnvironment): string[] {
	return paddleEnvironment === 'sandbox'
		? [PADDLE_CHECKOUT_FRAME_ORIGIN.production, PADDLE_CHECKOUT_FRAME_ORIGIN.sandbox]
		: [PADDLE_CHECKOUT_FRAME_ORIGIN.production]
}

/**
 * `payment` needs both `self` and the frame origin: a frame gets a feature only if the
 * parent's policy enables it for the parent's own origin and for the frame's.
 */
export function buildPermissionsPolicy(paddleEnvironment: PaddleCspEnvironment): string {
	const paymentAllowlist = [
		'self',
		...paddleCheckoutFrameOrigins(paddleEnvironment).map((origin) => `"${origin}"`),
	].join(' ')
	return `camera=(), microphone=(), geolocation=(), payment=(${paymentAllowlist})`
}

export const REFERRER_POLICY = 'strict-origin-when-cross-origin'

/** `preload` deliberately omitted: the HSTS preload list is a near-irreversible commitment. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'

/** First hop of x-forwarded-proto, compared case-insensitively (schemes are, per RFC 3986). */
export function isConfirmedHttps(forwardedProto: string | null | undefined): boolean {
	return forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https'
}

/**
 * The custom-domain ingress omits x-forwarded-proto, so HSTS also keys on Host matching the
 * https SITE_URL. Host is client-controlled but can only match an origin already asserted https.
 */
export function isCanonicalHttpsRequest(
	requestHost: string | null | undefined,
	siteUrl: string | null | undefined
): boolean {
	if (!requestHost || !siteUrl) return false

	let canonical: URL
	try {
		canonical = new URL(siteUrl)
	} catch {
		return false
	}
	if (canonical.protocol !== 'https:') return false

	// `URL.host` drops a default port, so normalizing through it makes `:443` equal a bare host.
	const normalizedRequestHost = requestHost.trim().toLowerCase()
	if (!normalizedRequestHost) return false

	let requested: URL
	try {
		requested = new URL(`https://${normalizedRequestHost}`)
	} catch {
		return false
	}

	return requested.host === canonical.host
}

export type SecurityHeaderOptions = {
	isDev: boolean
	/** HSTS is emitted only when TLS is confirmed; the container itself speaks plain HTTP. */
	isHttps: boolean
	nonce: string
	/** Required, so no caller can silently default to the wider sandbox grant. */
	paddleEnvironment: PaddleCspEnvironment
}

export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions): void {
	const { isDev, isHttps, nonce, paddleEnvironment } = options

	headers.set('X-Content-Type-Options', 'nosniff')
	// Legacy signal kept alongside CSP frame-ancestors for user agents that ignore CSP.
	headers.set('X-Frame-Options', 'DENY')
	headers.set('X-XSS-Protection', '1; mode=block')

	headers.set(
		'Content-Security-Policy',
		buildContentSecurityPolicy(nonce, paddleEnvironment, isDev)
	)
	headers.set('Referrer-Policy', REFERRER_POLICY)
	headers.set('Permissions-Policy', buildPermissionsPolicy(paddleEnvironment))

	if (isHttps && !isDev) {
		headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
	}

	if (isDev) {
		headers.set('Access-Control-Allow-Origin', '*')
	}
}

export async function applyHeadersToNextResult<R extends { response: Response }>(
	next: () => R | Promise<R>,
	options: SecurityHeaderOptions
): Promise<R> {
	const result = await next()
	applySecurityHeaders(result.response.headers, options)
	return result
}
