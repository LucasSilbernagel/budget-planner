import { createSynchronizationService } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSyncOperation } from '../../../features/api/client'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ENTITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function okOnce(): Response {
  return new Response(
    JSON.stringify({ success: true, processedCount: 1, failedCount: 0, conflictCount: 0 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

let service: ReturnType<typeof createSynchronizationService>

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

describe('push integration — service → sendSyncOperation → /api/sync/batch', () => {
  it('AC-2: a queued create is POSTed to /api/sync/batch and then drains', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => okOnce())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueCreate(
      'incomeSource',
      ENTITY_ID,
      { name: 'Salary', amount: 500000, frequency: 'monthly', userId: USER_ID },
      USER_ID
    )
    await service.forceSync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/sync/batch')
    const sent = JSON.parse((init?.body as string) ?? '{}')
    expect(sent.operations[0]).toMatchObject({
      type: 'create',
      entityType: 'incomeSource',
      entityId: ENTITY_ID,
      userId: USER_ID,
      profileId: 'profile-1',
    })

    expect(service.getState().pendingOperations).toHaveLength(0)
  })

  it('AC-3: a transient transport failure preserves the op (durability, not data loss)', async () => {
    // A network throw is a retryable failure: the op must stay queued, not be lost.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    await service.queueCreate(
      'incomeSource',
      ENTITY_ID,
      { name: 'Salary', amount: 500000, frequency: 'monthly', userId: USER_ID },
      USER_ID
    )
    await service.forceSync()

    // failedOperations is a view of queued ops, so pending + failed would double count.
    const afterFailure = service.getState()
    expect(afterFailure.pendingOperations.map((o) => o.entityId)).toEqual([ENTITY_ID])
    expect(afterFailure.failedOperations.map((o) => o.entityId)).toEqual([ENTITY_ID])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okOnce())
    )
    await service.queueCreate(
      'expense',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      { name: 'Rent', amount: 100000, frequency: 'monthly', userId: USER_ID },
      USER_ID
    )
    await service.forceSync()
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })
})
