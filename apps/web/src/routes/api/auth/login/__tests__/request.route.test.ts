import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit, buckets, logger, captureError, MagicLinkStageError } = vi.hoisted(() => {
	// Same class shape, so the route's `instanceof` check runs against the constructor the tests throw.
	class MagicLinkStageError extends Error {
		readonly stage: string
		constructor(stage: string, cause: unknown) {
			super(`Magic-link request failed at stage '${stage}'`, { cause })
			this.stage = stage
		}
	}
	const buckets = new Map<string, number>()
	const checkDbRateLimit = vi.fn(
		async ({
			scope,
			subject,
			maxAttempts,
		}: {
			scope: string
			subject: string
			maxAttempts: number
		}) => {
			const key = `${scope}:${subject}`
			const count = (buckets.get(key) ?? 0) + 1
			buckets.set(key, count)
			return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
		}
	)
	return {
		checkDbRateLimit,
		buckets,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		captureError: vi.fn(),
		MagicLinkStageError,
	}
})

vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))
vi.mock('@/server/api/auth/magic-link', () => ({
	requestMagicLink: vi.fn().mockResolvedValue(undefined),
	MagicLinkStageError,
}))
vi.mock('@/lib/logger', () => ({ logger }))
vi.mock('@/lib/error-tracking', () => ({ captureError }))

import { requestMagicLink } from '@/server/api/auth/magic-link'
import { POST } from '../request'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// With the default trusted-hop count (0 = rightmost), a single XFF value resolves to the client IP.
const CLIENT_IP = { 'x-forwarded-for': '203.0.113.5' }

const post = (body: unknown, headers: Record<string, string> = {}) =>
	POST({
		request: new Request('https://app.test/api/auth/login/request', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: typeof body === 'string' ? body : JSON.stringify(body),
		}),
	})

beforeEach(() => {
	vi.clearAllMocks()
	buckets.clear()
	asMock(requestMagicLink).mockResolvedValue({ branch: 'no-such-user' })
})

describe('POST /api/auth/login/request', () => {
	it('returns the same generic 200 for a known and an unknown email (no enumeration)', async () => {
		const known = await post({ email: 'known@example.com' })
		const unknown = await post({ email: 'ghost@example.com' })

		expect(known.status).toBe(200)
		expect(unknown.status).toBe(200)
		expect(await known.clone().json()).toEqual(await unknown.clone().json())
		expect(requestMagicLink).toHaveBeenCalledWith('known@example.com', 'https://app.test')
	})

	it('still returns the generic 200 when the send throws (failure is not observable)', async () => {
		asMock(requestMagicLink).mockRejectedValueOnce(new Error('mailer down'))
		const res = await post({ email: 'known@example.com' })
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
	})

	it('400s when the email field is missing or not a string', async () => {
		expect((await post({})).status).toBe(400)
		expect((await post({ email: 123 })).status).toBe(400)
		expect(requestMagicLink).not.toHaveBeenCalled()
	})

	it('400s on an unparseable body', async () => {
		expect((await post('not json{')).status).toBe(400)
	})

	it('returns the generic 200 for a blank or over-long email without sending or unbounded keys', async () => {
		const blank = await post({ email: '   ' })
		const huge = await post({ email: `${'a'.repeat(300)}@x.com` })
		expect(blank.status).toBe(200)
		expect(huge.status).toBe(200)
		expect(requestMagicLink).not.toHaveBeenCalled()
	})

	it('rate-limits per IP through the shared store (429 after 5/60s from one IP)', async () => {
		let last: Response | undefined
		for (let i = 0; i < 6; i++) {
			last = await post({ email: `u${i}@example.com` }, CLIENT_IP)
		}
		expect(last?.status).toBe(429)
		expect(checkDbRateLimit).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'ip',
				subject: '203.0.113.5',
				windowMs: 60_000,
				maxAttempts: 5,
			})
		)
	})

	it('rate-limits per email (stops sending for one address) while staying generic 200', async () => {
		let last: Response | undefined
		for (let i = 0; i < 7; i++) {
			last = await post({ email: 'spammed@example.com' })
		}
		expect(last?.status).toBe(200)
		expect(asMock(requestMagicLink).mock.calls.length).toBeLessThan(7)
		expect(checkDbRateLimit).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'email',
				subject: 'spammed@example.com',
				windowMs: 15 * 60_000,
				maxAttempts: 5,
			})
		)
	})

	it('still applies the email limit when the IP is unknown (email never skippable)', async () => {
		let last: Response | undefined
		for (let i = 0; i < 7; i++) {
			last = await post({ email: 'noip@example.com' })
		}
		expect(last?.status).toBe(200)
		const scopes = checkDbRateLimit.mock.calls.map((c) => (c[0] as { scope: string }).scope)
		expect(scopes).not.toContain('ip')
		expect(scopes).toContain('email')
		expect(asMock(requestMagicLink).mock.calls.length).toBeLessThan(7)
	})
})

describe('one outcome line per request', () => {
	const OUTCOME = 'Magic-link request outcome'

	const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

	function outcomeLines() {
		return [logger.info, logger.warn, logger.error, logger.debug].flatMap((fn) =>
			fn.mock.calls
				.filter((call) => call[0] === OUTCOME)
				.map((call) => call[1] as Record<string, unknown>)
		)
	}

	it('logs `sent` with the userId and messageRef', async () => {
		asMock(requestMagicLink).mockResolvedValueOnce({
			branch: 'sent',
			userId: 'u-1',
			messageRef: '202609271234.12345678901',
		})
		await post({ email: 'known@example.com' })
		await settle()
		expect(outcomeLines()).toEqual([
			{ branch: 'sent', userId: 'u-1', messageRef: '202609271234.12345678901' },
		])
	})

	it('logs `no-such-user` and `invalid-shape` from inside the chain', async () => {
		await post({ email: 'ghost@example.com' })
		await settle()
		asMock(requestMagicLink).mockResolvedValueOnce({ branch: 'invalid-shape' })
		await post({ email: 'not-an-email' })
		await settle()
		expect(outcomeLines()).toEqual([{ branch: 'no-such-user' }, { branch: 'invalid-shape' }])
	})

	it('logs `invalid-shape` for a blank or over-long address, without reaching the sender', async () => {
		await post({ email: '   ' })
		await post({ email: `${'a'.repeat(300)}@x.com` })
		await settle()
		expect(requestMagicLink).not.toHaveBeenCalled()
		expect(outcomeLines()).toEqual([{ branch: 'invalid-shape' }, { branch: 'invalid-shape' }])
	})

	it('logs `throttled` (scope email) on the throttle path — exactly one line per request', async () => {
		for (let i = 0; i < 6; i++) await post({ email: 'spammed@example.com' })
		await settle()
		const lines = outcomeLines()
		expect(lines).toHaveLength(6)
		expect(lines.slice(0, 5)).toEqual(Array(5).fill({ branch: 'no-such-user' }))
		expect(lines[5]).toEqual({ branch: 'throttled', scope: 'email' })
	})

	it.each(['lookup', 'token', 'send'])(
		'logs `send-failed` with stage %s and the ORIGINAL error, and reports it',
		async (stage) => {
			const cause = new Error('boom')
			asMock(requestMagicLink).mockRejectedValueOnce(new MagicLinkStageError(stage, cause))
			await post({ email: 'known@example.com' })
			await settle()
			expect(outcomeLines()).toEqual([{ branch: 'send-failed', stage, error: cause }])
			expect(logger.error).toHaveBeenCalledTimes(1)
			expect(captureError).toHaveBeenCalledWith(cause, { scope: 'magic-link-request', stage })
		}
	)

	it('the provider status survives the REAL redact() on a send failure (review)', async () => {
		const { redact } = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger')
		asMock(requestMagicLink).mockRejectedValueOnce(
			new MagicLinkStageError(
				'send',
				new Error('Email provider returned 401 sending the magic link')
			)
		)
		await post({ email: 'known@example.com' })
		await settle()

		expect(redact(outcomeLines()[0])).toEqual({
			branch: 'send-failed',
			stage: 'send',
			error: { name: 'Error', message: 'Email provider returned 401 sending the magic link' },
		})
	})

	it('logs the IP throttle and both 400s too (review: one line per answered request)', async () => {
		for (let i = 0; i < 6; i++) await post({ email: `u${i}@example.com` }, CLIENT_IP)
		await post('not json{')
		await post({ email: 123 })
		await settle()
		const lines = outcomeLines()
		expect(lines).toHaveLength(8)
		expect(lines[5]).toEqual({ branch: 'throttled', scope: 'ip' })
		expect(lines.slice(6)).toEqual([{ branch: 'bad-request' }, { branch: 'bad-request' }])
	})

	it('a logger that THROWS inside the chain does not become an unhandled rejection (review)', async () => {
		const unhandled = vi.fn()
		process.on('unhandledRejection', unhandled)
		try {
			logger.info.mockImplementationOnce(() => {
				throw new Error('stdout closed')
			})
			const res = await post({ email: 'known@example.com' })
			await settle()
			await settle()
			expect(res.status).toBe(200)
			expect(unhandled).not.toHaveBeenCalled()
		} finally {
			process.off('unhandledRejection', unhandled)
		}
	})

	it('an untagged failure still logs `send-failed`, with no stage to guess', async () => {
		asMock(requestMagicLink).mockRejectedValueOnce(new Error('unexpected'))
		await post({ email: 'known@example.com' })
		await settle()
		expect(outcomeLines()).toEqual([
			{ branch: 'send-failed', stage: undefined, error: new Error('unexpected') },
		])
	})

	it('the response is byte-identical across sent, no-such-user, throttled and send-failed', async () => {
		const bodies: string[] = []
		const statuses: number[] = []
		const record = async (res: Response) => {
			statuses.push(res.status)
			bodies.push(await res.text())
		}

		asMock(requestMagicLink).mockResolvedValueOnce({ branch: 'sent', userId: 'u-1' })
		await record(await post({ email: 'sent@example.com' }))
		await record(await post({ email: 'ghost@example.com' }))
		asMock(requestMagicLink).mockRejectedValueOnce(new MagicLinkStageError('send', 'down'))
		await record(await post({ email: 'failing@example.com' }))
		for (let i = 0; i < 5; i++) await post({ email: 'capped@example.com' })
		await record(await post({ email: 'capped@example.com' }))
		await settle()

		expect(statuses).toEqual([200, 200, 200, 200])
		expect(new Set(bodies)).toEqual(new Set(['{"success":true}']))
		// The throttled request really was throttled, otherwise this compares four copies of one branch.
		expect(outcomeLines()).toContainEqual({ branch: 'throttled', scope: 'email' })
	})

	it('does NOT await the send: the response returns while the lookup is still pending', async () => {
		let release!: (value: unknown) => void
		asMock(requestMagicLink).mockReturnValueOnce(
			new Promise((resolve) => {
				release = resolve
			})
		)
		const res = await post({ email: 'known@example.com' })
		expect(res.status).toBe(200)
		expect(outcomeLines()).toEqual([])
		release({ branch: 'sent', userId: 'u-1' })
		await settle()
		expect(outcomeLines()).toEqual([{ branch: 'sent', userId: 'u-1' }])
	})

	it('the logged messageRef survives the REAL redact()', async () => {
		const { redact } = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger')
		const { toMessageRef } = await vi.importActual<typeof import('@/server/api/auth/magic-link')>(
			'@/server/api/auth/magic-link'
		)
		const brevoMessageId = '<202609271234.12345678901@smtp-relay.mailin.fr>'
		asMock(requestMagicLink).mockResolvedValueOnce({
			branch: 'sent',
			userId: 'u-1',
			messageRef: toMessageRef(brevoMessageId),
		})
		await post({ email: 'known@example.com' })
		await settle()

		const [line] = outcomeLines()
		expect(redact(line)).toEqual({
			branch: 'sent',
			userId: 'u-1',
			messageRef: '202609271234.12345678901',
		})
	})
})
