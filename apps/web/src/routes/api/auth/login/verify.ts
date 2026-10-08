/**
 * The token is consumed only on POST: link scanners auto-GET links. The GET plants a
 * double-submit CSRF cookie so a cross-site POST cannot sign a victim in.
 */

import crypto from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { captureError } from '@/lib/error-tracking'
import { logger } from '@/lib/logger'
import { peekMagicLink, verifyMagicLink } from '@/server/api/auth/magic-link'
import { signSession } from '@/server/api/auth/session'
import { buildHasSessionCookie, buildSessionCookie } from '@/server/api/auth/session-cookies'
import { clientIpForRateLimit } from '@/server/rate-limit/client-ip'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'

const CSRF_MAX_AGE = 15 * 60
const CSRF_COOKIE_PATH = '/api/auth/login/verify'
const INVALID_REDIRECT = '/login?error=invalid_or_expired'

// Token guessing is infeasible at 256-bit; this bounds DB-write churn on the consuming POST.
const VERIFY_LIMIT = { windowMs: 60 * 1000, maxAttempts: 10 } as const

function isProduction(): boolean {
	return process.env['NODE_ENV'] === 'production'
}

function secureFlag(): string {
	return isProduction() ? '; Secure' : ''
}

function invalidRedirect(): Response {
	return new Response(null, { status: 302, headers: { Location: INVALID_REDIRECT } })
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string
	)
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get('cookie')
	if (!header) {
		return null
	}
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (key === name) {
			return rest.join('=')
		}
	}
	return null
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a)
	const bb = Buffer.from(b)
	return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

function htmlPage(title: string, inner: string): string {
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(
		title
	)}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#111"><h1 style="font-size:1.5rem">Longhand Budget</h1>${inner}</body></html>`
}

function confirmPage(token: string, email: string, csrf: string): string {
	const inner = `<p>You're about to sign in as <strong>${escapeHtml(
		email
	)}</strong>.</p><form method="POST" action="${CSRF_COOKIE_PATH}"><input type="hidden" name="token" value="${escapeHtml(
		token
	)}"><input type="hidden" name="csrf" value="${escapeHtml(
		csrf
	)}"><button type="submit" style="background:#2563eb;color:#fff;border:none;border-radius:.5rem;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Sign in to this account</button></form><p style="margin-top:1rem;font-size:.85rem;color:#666">If this isn't you, just close this page — no one is signed in until you click the button.</p>`
	return htmlPage('Confirm sign-in', inner)
}

function invalidPage(): string {
	const inner = `<p>This sign-in link is invalid or has expired.</p><p><a href="/login">Request a new link</a></p>`
	return htmlPage('Link invalid or expired', inner)
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers)
	headers.set('Content-Type', 'text/html; charset=utf-8')
	return new Response(body, { ...init, status: init.status ?? 200, headers })
}

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
	const token = new URL(request.url).searchParams.get('token') ?? ''

	let peeked: Awaited<ReturnType<typeof peekMagicLink>>
	try {
		peeked = await peekMagicLink(token)
	} catch (error) {
		logger.error('Magic-link peek failed', { error })
		captureError(error, { scope: 'magic-link-peek' })
		return htmlResponse(invalidPage())
	}

	if (!peeked) {
		return htmlResponse(invalidPage())
	}

	const csrf = crypto.randomBytes(32).toString('hex')
	return htmlResponse(confirmPage(token, peeked.email, csrf), {
		headers: {
			'Set-Cookie': `ml_csrf=${csrf}; Path=${CSRF_COOKIE_PATH}; HttpOnly; SameSite=Lax${secureFlag()}; Max-Age=${CSRF_MAX_AGE}`,
		},
	})
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
	const ip = clientIpForRateLimit(request)
	if (ip) {
		const limit = await checkDbRateLimit({ scope: 'login-verify', subject: ip, ...VERIFY_LIMIT })
		if (!limit.allowed) {
			return new Response('Too many requests. Please try again later.', { status: 429 })
		}
	}

	let form: FormData
	try {
		form = await request.formData()
	} catch {
		return invalidRedirect()
	}

	const token = String(form.get('token') ?? '')
	const csrfField = String(form.get('csrf') ?? '')
	const csrfCookie = readCookie(request, 'ml_csrf')

	// A cross-site POST cannot carry the SameSite=Lax `ml_csrf` cookie, so a mismatch is rejected.
	if (!csrfCookie || !csrfField || !safeEqual(csrfCookie, csrfField)) {
		return invalidRedirect()
	}

	let verified: Awaited<ReturnType<typeof verifyMagicLink>>
	try {
		verified = await verifyMagicLink(token)
	} catch (error) {
		logger.error('Magic-link verify failed', { error })
		captureError(error, { scope: 'magic-link-verify' })
		return invalidRedirect()
	}

	if (!verified) {
		return invalidRedirect()
	}

	// `signSession` throws on a missing or weak SESSION_SECRET in production; degrade to the
	// generic redirect, not a 500. The token is already consumed by now.
	let sessionToken: string
	try {
		sessionToken = signSession({
			userId: verified.userId,
			paddleId: verified.paddleId,
			email: verified.email,
		})
	} catch (error) {
		logger.error('Session signing failed during magic-link verify', { error })
		captureError(error, { scope: 'magic-link-verify-sign-session' })
		return invalidRedirect()
	}

	const headers = new Headers({ Location: '/' })
	headers.append('Set-Cookie', buildSessionCookie(sessionToken, isProduction()))
	// Non-HttpOnly and secret-free: only its presence tells client code a session probably exists.
	headers.append('Set-Cookie', buildHasSessionCookie(isProduction()))
	headers.append(
		'Set-Cookie',
		`ml_csrf=; Path=${CSRF_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`
	)
	return new Response(null, { status: 302, headers })
}

export const Route = createFileRoute('/api/auth/login/verify')({
	server: {
		handlers: {
			GET,
			POST,
		},
	},
})
