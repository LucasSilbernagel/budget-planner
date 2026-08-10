/**
 * Category links are deliberately NOT pushed to the server (code review 30.4b).
 *
 * ⚠️ THIS FILE EXISTS TO MAKE A REVERT DISCOVERABLE. `toServerPayload` pins
 * `categoryId` to `null` because `categories.id` is a REAL foreign key on both
 * cashflow tables while category rows cannot reach the server at all (the server
 * strips `profileId` on create, and the missing client `id` escalates to a
 * permanent 23503 — see `deferred-work.md`). Forwarding a real category uuid
 * therefore points that FK at a row which cannot exist: the op fails 23503,
 * taking the name/amount edit bundled into the same update with it, and because
 * the failure is not marked `retryable: false` the client burns its retry
 * budget, pins status FAILED and OPENS THE CIRCUIT BREAKER — suppressing sync
 * for EVERY OTHER ENTITY.
 *
 * 30.4a added the column; 30.4b's picker is what first makes a non-null value
 * reachable by a real user, which is why the pin lives here.
 *
 * **When the sync-create repair lands**: restore `entity['categoryId'] ?? null`
 * in `toServerPayload` and rewrite this file to assert the value round-trips.
 * These tests go red the moment you do, which is the point.
 *
 * Asserted through the real `syncEntityCreate`/`syncEntityUpdate` entry points
 * rather than a test-only export, so the payload builder is exercised the way
 * production reaches it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSyncBridge,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
  return {
    userId: SESSION_USER_ID,
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

const row = (categoryId: string | null) => ({
  id: 'row-1',
  userId: 0,
  name: 'Tesco run',
  amount: 8000,
  frequency: 'monthly',
  categoryId,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** The `data` payload of the single queued op. */
function queuedData(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1)
  const call = mock.mock.calls[0] as unknown[]
  // The op envelope is the argument carrying a `data` bag.
  const envelope = call.find(
    (arg) => typeof arg === 'object' && arg !== null && 'data' in (arg as object)
  ) as { data: Record<string, unknown> } | undefined
  if (envelope) {
    return envelope.data
  }
  // Otherwise the payload itself is passed positionally.
  const payload = call.find(
    (arg) => typeof arg === 'object' && arg !== null && 'name' in (arg as object)
  )
  expect(payload, `no payload found in queue call: ${JSON.stringify(call)}`).toBeDefined()
  return payload as Record<string, unknown>
}

beforeEach(() => {
  handle = makeHandle()
  registerSyncBridge(handle)
})

afterEach(() => {
  clearSyncBridge()
  vi.restoreAllMocks()
})

describe('categoryId is pinned to null in the sync payload until the repair lands', () => {
  it.each(['incomeSource', 'expense'] as const)(
    'never forwards a real category uuid on CREATE for %s',
    (entityType) => {
      syncEntityCreate(entityType, row('cat-uuid-1'))

      const data = queuedData(handle.queueCreate)
      // The KEY must still be PRESENT: `updateEntity` does a partial `.set()`,
      // so omitting it would leave any prior server value untouched.
      expect(data).toHaveProperty('categoryId')
      expect(data['categoryId']).toBeNull()
      // ...and nothing else about the row may be disturbed by the pin.
      expect(data['name']).toBe('Tesco run')
      expect(data['amount']).toBe(8000)
    }
  )

  it.each(['incomeSource', 'expense'] as const)(
    'never forwards a real category uuid on UPDATE for %s — the path that trips the breaker',
    (entityType) => {
      syncEntityUpdate(entityType, row('cat-uuid-1'), row(null))

      const data = queuedData(handle.queueUpdate)
      expect(data['categoryId']).toBeNull()
      expect(data['name']).toBe('Tesco run')
    }
  )

  it('is null for an already-uncategorized row too', () => {
    syncEntityCreate('expense', row(null))
    expect(queuedData(handle.queueCreate)['categoryId']).toBeNull()
  })
})
