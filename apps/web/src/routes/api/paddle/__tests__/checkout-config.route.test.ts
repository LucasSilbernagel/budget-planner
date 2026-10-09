import { resetConfig } from '@budget-planner/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentUserSession } = vi.hoisted(() => ({ getCurrentUserSession: vi.fn() }))
vi.mock('@/server/api/auth/paddle', () => ({ getCurrentUserSession }))
vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '../checkout-config'

function GETWith(request = new Request('https://app.test/api/paddle/checkout-config')) {
	return GET({ request })
}

const PADDLE_KEYS = [
	'NODE_ENV',
	'PADDLE_ENVIRONMENT',
	'PADDLE_API_KEY',
	'PADDLE_CLIENT_TOKEN',
	'PADDLE_WEBHOOK_SECRET',
	'PADDLE_ANNUAL_PRICE_ID',
	'PADDLE_LIFETIME_PRICE_ID',
	'PADDLE_MONTHLY_PRICE_ID',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
	for (const k of PADDLE_KEYS) saved[k] = process.env[k]
	for (const k of PADDLE_KEYS) delete process.env[k]
	resetConfig()
	getCurrentUserSession.mockReset()
	getCurrentUserSession.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
	for (const k of PADDLE_KEYS) {
		if (saved[k] === undefined) delete process.env[k]
		else process.env[k] = saved[k]
	}
	resetConfig()
})

function withEnv(env: Partial<Record<(typeof PADDLE_KEYS)[number], string>>) {
	for (const [k, v] of Object.entries(env)) process.env[k] = v
	resetConfig()
}

describe('GET /api/paddle/checkout-config', () => {
	it('returns the public config in development, never the server API key or webhook secret', async () => {
		withEnv({
			NODE_ENV: 'development',
			PADDLE_ENVIRONMENT: 'sandbox',
			PADDLE_API_KEY: 'pdl_sandbox_secret',
			PADDLE_CLIENT_TOKEN: 'test_client_token',
			PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
			PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
			PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
			PADDLE_MONTHLY_PRICE_ID: 'pri_monthly',
		})

		const response = await GETWith()
		expect(response.status).toBe(200)
		const body = await response.json()

		expect(body).toEqual({
			isConfigured: true,
			environment: 'sandbox',
			clientToken: 'test_client_token',
			monthlyPriceId: 'pri_monthly',
			annualPriceId: 'pri_annual',
			lifetimePriceId: 'pri_lifetime',
		})
		expect(JSON.stringify(body)).not.toContain('secret')
	})

	it('returns isConfigured:false with null fields when PADDLE_ENVIRONMENT is explicitly sandbox but nothing else is set', async () => {
		withEnv({ PADDLE_ENVIRONMENT: 'sandbox' })
		const response = await GETWith()
		expect(response.status).toBe(200)
		const body = await response.json()

		expect(body).toEqual({
			isConfigured: false,
			environment: 'sandbox',
			clientToken: null,
			monthlyPriceId: null,
			annualPriceId: null,
			lifetimePriceId: null,
		})
	})

	it('FAILS CLOSED (500) in production when the monthly price is unset', async () => {
		// The monthly price is advertised on the legal pricing page, so production without it must fail.
		withEnv({
			NODE_ENV: 'production',
			PADDLE_ENVIRONMENT: 'production',
			PADDLE_API_KEY: 'pdl_live_secret',
			PADDLE_CLIENT_TOKEN: 'live_client_token',
			PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
			PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
			PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
		})

		const response = await GETWith()
		expect(response.status).toBe(500)
		const body = await response.json()
		expect(body.success).toBe(false)
		expect(JSON.stringify(body)).not.toContain('PADDLE_MONTHLY_PRICE_ID')
	})

	it('serves null (never an empty string) for a declared-but-empty monthly id', async () => {
		withEnv({
			NODE_ENV: 'development',
			PADDLE_ENVIRONMENT: 'sandbox',
			PADDLE_CLIENT_TOKEN: 'test_client_token',
			PADDLE_MONTHLY_PRICE_ID: '   ',
		})

		const response = await GETWith()
		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.monthlyPriceId).toBeNull()
	})

	it('fails loudly (500) rather than silently when production is misconfigured, without leaking which var is missing', async () => {
		withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })

		const response = await GETWith()
		expect(response.status).toBe(500)
		const body = await response.json()
		expect(body.success).toBe(false)
		expect(body.error).not.toMatch(/PADDLE_API_KEY/)
		expect(body.error).toBe('Checkout is not available right now.')
	})

	it('fails loudly (500) when PADDLE_ENVIRONMENT itself was never set — never silently defaults', async () => {
		// No `withEnv()`: PADDLE_ENVIRONMENT stays unset, the case the schema default must not cover.
		const response = await GETWith()
		expect(response.status).toBe(500)
		const body = await response.json()
		expect(body.success).toBe(false)
		expect(body.error).toMatch(/PADDLE_ENVIRONMENT is not set/)
	})

	it('fails loudly (500) when PADDLE_ENVIRONMENT is declared with an EMPTY value — same as unset', async () => {
		withEnv({ PADDLE_ENVIRONMENT: '' })
		const response = await GETWith()
		expect(response.status).toBe(500)
		const body = await response.json()
		expect(body.error).toMatch(/PADDLE_ENVIRONMENT is not set/)
	})

	it('trims a price ID before handing it to the browser', async () => {
		withEnv({
			NODE_ENV: 'development',
			PADDLE_ENVIRONMENT: 'sandbox',
			PADDLE_API_KEY: 'pdl_sandbox_secret',
			PADDLE_CLIENT_TOKEN: 'test_client_token',
			PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
			PADDLE_ANNUAL_PRICE_ID: '  pri_annual\n',
			PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime\t',
			PADDLE_MONTHLY_PRICE_ID: '\n pri_monthly  ',
		})

		const response = await GETWith()
		const body = await response.json()

		expect(body.annualPriceId).toBe('pri_annual')
		expect(body.lifetimePriceId).toBe('pri_lifetime')
		expect(body.monthlyPriceId).toBe('pri_monthly')
	})

	it('never lets an intermediary cache the response, success or failure', async () => {
		withEnv({ NODE_ENV: 'development', PADDLE_ENVIRONMENT: 'sandbox' })
		const ok = await GETWith()
		expect(ok.status).toBe(200)
		expect(ok.headers.get('cache-control')).toBe('no-store')

		withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })
		const failed = await GETWith()
		expect(failed.status).toBe(500)
		expect(failed.headers.get('cache-control')).toBe('no-store')
	})
})

describe('GET /api/paddle/checkout-config — already-entitled guard', () => {
	function configured() {
		withEnv({
			NODE_ENV: 'development',
			PADDLE_ENVIRONMENT: 'sandbox',
			PADDLE_API_KEY: 'pdl_sandbox_secret',
			PADDLE_CLIENT_TOKEN: 'test_client_token',
			PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
			PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
			PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
		})
	}

	it.each(['active', 'past_due', 'lifetime'])(
		'refuses (403) to mint checkout config for a %s session, and hands back no client token',
		async (subscriptionStatus) => {
			configured()
			getCurrentUserSession.mockResolvedValue({
				success: true,
				data: { userId: 'u1', email: 'a@example.test', subscriptionStatus },
			})

			const response = await GETWith()

			expect(response.status).toBe(403)
			const body = await response.json()
			expect(body.alreadyEntitled).toBe(true)
			expect(body.clientToken).toBeUndefined()
			expect(body.annualPriceId).toBeUndefined()
			expect(body.lifetimePriceId).toBeUndefined()
		}
	)

	it('still serves a canceled subscriber — resubscribing is the intended path', async () => {
		configured()
		getCurrentUserSession.mockResolvedValue({
			success: true,
			data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'canceled' },
		})

		const response = await GETWith()

		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.clientToken).toBe('test_client_token')
	})

	it('still serves a free signed-in user', async () => {
		configured()
		getCurrentUserSession.mockResolvedValue({
			success: true,
			data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'free' },
		})

		const response = await GETWith()
		expect(response.status).toBe(200)
	})

	it('FAILS CLOSED (503) when the session cannot be resolved — never sells on a guess', async () => {
		configured()
		getCurrentUserSession.mockResolvedValue({ success: false, error: 'db down' })

		const response = await GETWith()

		expect(response.status).toBe(503)
		const body = await response.json()
		expect(body.success).toBe(false)
		expect(body.clientToken).toBeUndefined()
	})

	it('never lets an intermediary cache a refusal', async () => {
		configured()
		getCurrentUserSession.mockResolvedValue({
			success: true,
			data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'lifetime' },
		})

		const response = await GETWith()
		expect(response.headers.get('cache-control')).toBe('no-store')
	})
})
