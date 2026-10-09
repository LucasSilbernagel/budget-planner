import type { SyncOperation } from '@budget-planner/core/sync/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendSyncOperation } from '../client'

const operation: SyncOperation = {
	id: 'op-1',
	type: 'create',
	entityType: 'incomeSource',
	entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	data: { name: 'Salary', amount: 500000, frequency: 'monthly', userId: 'u-1' },
	timestamp: 1690,
	deviceId: 'device-1',
	userId: 'u-1',
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
	vi.stubGlobal('fetch', vi.fn(impl))
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('sendSyncOperation', () => {
	it('POSTs the operation wrapped in a single-op batch to /api/sync/batch', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			jsonResponse({ success: true, processedCount: 1, failedCount: 0, conflictCount: 0 })
		)
		vi.stubGlobal('fetch', fetchMock)

		await sendSyncOperation(operation)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('/api/sync/batch')
		expect(init?.method).toBe('POST')
		const sent = JSON.parse((init?.body as string) ?? '{}')
		expect(sent.operations).toHaveLength(1)
		expect(sent.operations[0].id).toBe('op-1')
		expect(sent.deviceId).toBe('device-1')
	})

	it('maps a processed op to success', async () => {
		stubFetch(async () =>
			jsonResponse({ success: true, processedCount: 1, failedCount: 0, conflictCount: 0 })
		)
		expect(await sendSyncOperation(operation)).toEqual({ success: true })
	})

	it('maps a server conflict to { success: false, conflict: true }', async () => {
		stubFetch(async () =>
			jsonResponse({ success: false, processedCount: 0, failedCount: 0, conflictCount: 1 })
		)
		expect(await sendSyncOperation(operation)).toEqual({ success: false, conflict: true })
	})

	it('maps a server-side validation failure to a NON-retryable error', async () => {
		stubFetch(async () =>
			jsonResponse({
				success: false,
				processedCount: 0,
				failedCount: 1,
				conflictCount: 0,
				error: 'Entity already exists',
			})
		)
		const result = await sendSyncOperation(operation)
		expect(result.success).toBe(false)
		expect(result.retryable).toBe(false)
		expect(result.error).toContain('Entity already exists')
	})

	it('maps an op the server listed in `rejections` to statusCode 422', async () => {
		stubFetch(async () =>
			jsonResponse({
				success: false,
				processedCount: 0,
				failedCount: 1,
				conflictCount: 0,
				rejections: [{ operationId: 'op-1', reason: 'constraint' }],
			})
		)
		const result = await sendSyncOperation(operation)
		expect(result).toEqual({
			success: false,
			error: 'Refused by the server (constraint)',
			retryable: false,
			statusCode: 422,
		})
	})

	it('a failure for an op NOT in `rejections` keeps the no-status path (stays queued)', async () => {
		stubFetch(async () =>
			jsonResponse({
				success: false,
				processedCount: 0,
				failedCount: 1,
				conflictCount: 0,
				error: 'Profile not found',
				rejections: [{ operationId: 'some-other-op', reason: 'constraint' }],
			})
		)
		const result = await sendSyncOperation(operation)
		expect(result.retryable).toBe(false)
		expect(result.statusCode).toBeUndefined()
	})

	it("code review 75.2: a 400 carrying the server's own `invalid-request` refusal keeps its permanent status", async () => {
		stubFetch(async () =>
			jsonResponse(
				{
					success: false,
					processedCount: 0,
					failedCount: 1,
					conflictCount: 0,
					refusal: 'invalid-request',
				},
				400
			)
		)
		const result = await sendSyncOperation(operation)
		expect(result.retryable).toBe(false)
		expect(result.statusCode).toBe(400)
	})

	it.each([
		[
			"the route's own bad-JSON 400 (no `refusal`)",
			400,
			{ success: false, error: 'Invalid request body: x' },
		],
		['a proxy/CDN 404 with an HTML body', 404, '<html>Not Found</html>'],
		['a 409 from something that is not the sync server', 409, {}],
		['a 422 with no refusal', 422, { error: 'nope' }],
	])(
		'code review 75.2: WITHHOLDS the permanent status for %s — kept queued, never dropped',
		async (_label, status, body) => {
			stubFetch(async () =>
				typeof body === 'string'
					? new Response(body, { status, headers: { 'Content-Type': 'text/html' } })
					: jsonResponse(body, status)
			)
			const result = await sendSyncOperation(operation)
			expect(result.success).toBe(false)
			expect(result.retryable).toBe(false)
			expect(result.statusCode).toBeUndefined()
		}
	)

	it("a 413 carrying the sync route's own `too-large` refusal maps to 422 (dropped, not replayed)", async () => {
		stubFetch(async () =>
			jsonResponse({ success: false, error: 'Request too large', refusal: 'too-large' }, 413)
		)
		expect(await sendSyncOperation(operation)).toEqual({
			success: false,
			error: 'Request too large',
			retryable: false,
			statusCode: 422,
		})
	})

	it.each([
		['a proxy/ingress 413 with an HTML body', '<html>413 Request Entity Too Large</html>'],
		['a 413 with an empty JSON body', {}],
		['a 413 with NO body at all', null],
		['a 413 with an unknown refusal', { error: 'Request too large', refusal: 'something-else' }],
		['a 413 with the 400 refusal', { error: 'Request too large', refusal: 'invalid-request' }],
	])('an UNPROVEN 413 keeps statusCode 413 (kept queued) — %s', async (_label, body) => {
		stubFetch(async () =>
			body === null
				? new Response(null, { status: 413 })
				: typeof body === 'string'
					? new Response(body, { status: 413, headers: { 'Content-Type': 'text/html' } })
					: jsonResponse(body, 413)
		)
		const result = await sendSyncOperation(operation)
		expect(result.success).toBe(false)
		expect(result.retryable).toBe(false)
		expect(result.statusCode).toBe(413)
	})

	it('classifies a 401 as a permanent (non-retryable) failure', async () => {
		stubFetch(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401))
		const result = await sendSyncOperation(operation)
		expect(result.success).toBe(false)
		expect(result.retryable).toBe(false)
		expect(result.statusCode).toBe(401)
	})

	it('classifies a 429 rate limit as retryable', async () => {
		stubFetch(async () => jsonResponse({ success: false, error: 'Rate limit exceeded' }, 429))
		const result = await sendSyncOperation(operation)
		expect(result.retryable).toBe(true)
		expect(result.statusCode).toBe(429)
	})

	it('classifies a 5xx as retryable', async () => {
		stubFetch(async () => jsonResponse({ success: false, error: 'boom' }, 500))
		const result = await sendSyncOperation(operation)
		expect(result.retryable).toBe(true)
		expect(result.statusCode).toBe(500)
	})

	it('classifies a network throw as retryable', async () => {
		stubFetch(async () => {
			throw new TypeError('Failed to fetch')
		})
		const result = await sendSyncOperation(operation)
		expect(result.success).toBe(false)
		expect(result.retryable).toBe(true)
	})

	it('does NOT treat a 200 envelope with nothing processed as success (review P4)', async () => {
		stubFetch(async () =>
			jsonResponse({ success: true, processedCount: 0, failedCount: 0, conflictCount: 0 })
		)
		const result = await sendSyncOperation(operation)
		expect(result.success).toBe(false)
		expect(result.retryable).toBe(true)
	})
})
