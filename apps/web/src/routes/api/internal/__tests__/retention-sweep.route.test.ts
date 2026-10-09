import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runRetentionSweep, getRetentionSweepToken } = vi.hoisted(() => ({
	runRetentionSweep: vi.fn(),
	getRetentionSweepToken: vi.fn(),
}))

vi.mock('@/server/retention/sweep', () => ({ runRetentionSweep }))
vi.mock('@budget-planner/config/schema', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getRetentionSweepToken,
}))
vi.mock('@/lib/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError: vi.fn() }))

import { POST } from '../retention-sweep'

const TOKEN = 't'.repeat(40)

function req(auth?: string, query = ''): Request {
	return new Request(`https://app.test/api/internal/retention-sweep${query}`, {
		method: 'POST',
		headers: auth === undefined ? {} : { authorization: auth },
	})
}

const OK = {
	dryRun: false,
	noticesDue: 1,
	noticesSent: 1,
	noticeFailures: 0,
	purgesDue: 2,
	purged: 2,
	purgesSkipped: 0,
	purgeFailures: 0,
}

beforeEach(() => {
	vi.clearAllMocks()
	getRetentionSweepToken.mockReturnValue(TOKEN)
	runRetentionSweep.mockResolvedValue(OK)
})

describe('POST /api/internal/retention-sweep', () => {
	it('FAILS CLOSED with 503 when the token is not configured — nothing runs', async () => {
		getRetentionSweepToken.mockReturnValue(undefined)

		const res = await POST({ request: req(`Bearer ${TOKEN}`) })

		expect(res.status).toBe(503)
		expect(runRetentionSweep).not.toHaveBeenCalled()
	})

	it.each([
		['no header', undefined],
		['a wrong token of the same length', `Bearer ${'x'.repeat(40)}`],
		['a different-length token (must not throw)', 'Bearer short'],
		['the token without the Bearer scheme', TOKEN],
		['an empty header', ''],
	])('401s and runs nothing for %s', async (_label, auth) => {
		const res = await POST({ request: req(auth) })

		expect(res.status).toBe(401)
		expect(runRetentionSweep).not.toHaveBeenCalled()
	})

	it('runs the sweep and returns its counts on a valid token', async () => {
		const res = await POST({ request: req(`Bearer ${TOKEN}`) })

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true, ...OK })
		expect(runRetentionSweep).toHaveBeenCalledWith({ now: expect.any(Number), dryRun: false })
	})

	it('passes dryRun=1 through', async () => {
		await POST({ request: req(`Bearer ${TOKEN}`, '?dryRun=1') })

		expect(runRetentionSweep).toHaveBeenCalledWith({ now: expect.any(Number), dryRun: true })
	})

	it.each([
		['a notice failure', { noticeFailures: 1 }],
		['a purge failure', { purgeFailures: 1 }],
	])('returns 500 with the counts on %s, so the workflow run goes red', async (_l, patch) => {
		runRetentionSweep.mockResolvedValue({ ...OK, ...patch })

		const res = await POST({ request: req(`Bearer ${TOKEN}`) })

		expect(res.status).toBe(500)
		expect(await res.json()).toMatchObject({ success: false, ...patch })
	})

	it('returns 500 when the sweep throws (database unreachable)', async () => {
		runRetentionSweep.mockRejectedValue(new Error('connection refused'))

		const res = await POST({ request: req(`Bearer ${TOKEN}`) })

		expect(res.status).toBe(500)
		expect(await res.json()).toEqual({ success: false, error: 'Retention sweep failed' })
	})

	it('reports a held lease as a 200 skip, not a failure', async () => {
		runRetentionSweep.mockResolvedValue({ ...OK, skipped: 'lease-held' })

		const res = await POST({ request: req(`Bearer ${TOKEN}`) })

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ skipped: 'lease-held' })
	})
})
