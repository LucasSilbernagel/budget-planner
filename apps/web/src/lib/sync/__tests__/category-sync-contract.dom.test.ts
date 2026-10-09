/**
 * Drives the real core service: the queue gate's zod parse silently strips undeclared keys,
 * which mocked-queue tests can't see.
 */

// Barrel, not the `/sync` subpath: the subpath doesn't resolve for tsc, so `service` would be `any`.
import { createSynchronizationService } from '@budget-planner/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSyncOperation } from '../../../features/api/client'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CATEGORY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function ok(): Response {
	return new Response(
		JSON.stringify({ success: true, processedCount: 1, failedCount: 0, conflictCount: 0 }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	)
}

let service: ReturnType<typeof createSynchronizationService>

function sentData(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
	const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
	const body = JSON.parse((init?.body as string) ?? '{}')
	return body.operations[0].data as Record<string, unknown>
}

beforeEach(async () => {
	localStorage.clear()
	service = createSynchronizationService(USER_ID, {
		autoSync: false,
		processOperation: sendSyncOperation,
		profileId: 'profile-1',
	})
	await service.initialize()
})

afterEach(() => {
	service.destroy()
	vi.unstubAllGlobals()
})

describe('category sync contract — the payload AFTER syncOperationDataSchema', () => {
	it('a cashflow row keeps its categoryId through the queue gate', async () => {
		const fetchMock = vi.fn(async () => ok())
		vi.stubGlobal('fetch', fetchMock)

		await service.queueCreate(
			'incomeSource',
			ROW_ID,
			{
				name: 'Salary',
				amount: 500000,
				frequency: 'monthly',
				categoryId: CATEGORY_ID,
				userId: USER_ID,
			},
			USER_ID
		)
		await service.forceSync()

		expect(sentData(fetchMock).categoryId).toBe(CATEGORY_ID)
	})

	it('an explicit null categoryId survives — un-categorizing must propagate', async () => {
		// An omit-when-null bridge would leave the previous category server-side (partial .set()).
		const fetchMock = vi.fn(async () => ok())
		vi.stubGlobal('fetch', fetchMock)

		await service.queueUpdate(
			'expense',
			ROW_ID,
			{ name: 'Rent', amount: 150000, frequency: 'monthly', categoryId: null, userId: USER_ID },
			USER_ID
		)
		await service.forceSync()

		const data = sentData(fetchMock)
		expect(data).toHaveProperty('categoryId')
		expect(data.categoryId).toBeNull()
	})

	it('a category entity keeps its name and kind through the queue gate', async () => {
		const fetchMock = vi.fn(async () => ok())
		vi.stubGlobal('fetch', fetchMock)

		await service.queueCreate(
			'category',
			CATEGORY_ID,
			{ name: 'Groceries', kind: 'expense', userId: USER_ID },
			USER_ID
		)
		await service.forceSync()

		const data = sentData(fetchMock)
		expect(data.name).toBe('Groceries')
		expect(data.kind).toBe('expense')
	})

	it('the category entity type reaches the wire intact', async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => ok())
		vi.stubGlobal('fetch', fetchMock)

		await service.queueCreate(
			'category',
			CATEGORY_ID,
			{ name: 'Groceries', kind: 'expense', userId: USER_ID },
			USER_ID
		)
		await service.forceSync()

		const init = fetchMock.mock.calls[0]?.[1]
		const body = JSON.parse((init?.body as string) ?? '{}')
		expect(body.operations[0].entityType).toBe('category')
	})

	it('a genuinely unknown field is still stripped — the gate is narrowed, not disabled', async () => {
		// Negative control: fails if the schema is loosened to passthrough.
		const fetchMock = vi.fn(async () => ok())
		vi.stubGlobal('fetch', fetchMock)

		await service.queueCreate(
			'incomeSource',
			ROW_ID,
			{
				name: 'Salary',
				amount: 500000,
				frequency: 'monthly',
				userId: USER_ID,
				totallyUndeclaredField: 'should not reach the server',
			},
			USER_ID
		)
		await service.forceSync()

		expect(sentData(fetchMock)).not.toHaveProperty('totallyUndeclaredField')
	})
})
