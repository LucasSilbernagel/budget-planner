/**
 * Push Transport Tests (Story 5-15)
 *
 * Pins the contract between the served POST /api/sync/batch route and the core
 * SynchronizationService: sendSyncOperation maps the BatchSyncResponse envelope
 * to a ProcessOperationResult and classifies failures as retryable/permanent so
 * the queue retries transient errors but not permanent rejects.
 *
 * `fetch` is stubbed — no real network (NFR8).
 */

import type { SyncOperation } from '@budget-planner/core/sync'
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
    const fetchMock = vi.fn(async () =>
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
    // success:true but processedCount:0 — must be a retryable failure, not a silent
    // drop of the op from the queue with nothing persisted.
    stubFetch(async () =>
      jsonResponse({ success: true, processedCount: 0, failedCount: 0, conflictCount: 0 })
    )
    const result = await sendSyncOperation(operation)
    expect(result.success).toBe(false)
    expect(result.retryable).toBe(true)
  })
})
