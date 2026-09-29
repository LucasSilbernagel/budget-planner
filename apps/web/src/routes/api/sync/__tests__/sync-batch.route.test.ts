/**
 * Sync Batch Push Route Boundary Tests (Story 5-15)
 *
 * Drives the actual served POST handler end-to-end: real Request → auth/premium
 * gate → body parse → processBatchSync → JSON Response with the correct HTTP
 * status and the BatchSyncResponse shape the client's sendSyncOperation consumes.
 *
 * The db layer is mocked out by mocking processBatchSync (which owns the Drizzle
 * writes); the assertions pin the security-critical contract: the batch is
 * processed under the SESSION user id mapped to `id` (never a client-supplied
 * one), the premium gate uses the REAL `hasPaidAccess` (active|past_due|lifetime
 * — the same function as pull, not the premium-features gate), and a rate-limit
 * rejection surfaces as 429.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the session lookup the route imports (resolved via the '@' alias).
vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

// Fully mock the sync module so the test needs no database (and does not load the
// real sync.ts, which transitively imports db/zod). The paid-access gate is NOT
// mocked: the route imports `hasPaidAccess` from `lib/premium/access-statuses`,
// so these cases exercise the real rule. (Until Story 78.3 this mock carried its
// own `['active', 'past_due']` "verbatim" copy — missing `lifetime`, so no route
// test ever let a lifetime session through.)
vi.mock('@/server/api/sync', () => ({
  processBatchSync: vi.fn(),
}))

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { processBatchSync } from '@/server/api/sync'
import { POST } from '../batch'

type SessionResult = Awaited<ReturnType<typeof getCurrentUserSession>>

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function mockSession(result: SessionResult) {
  ;(getCurrentUserSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(result)
}

function mockBatchResult(result: Record<string, unknown>) {
  ;(processBatchSync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(result)
}

const okResult = {
  success: true,
  processedCount: 1,
  failedCount: 0,
  conflictCount: 0,
  conflicts: [],
  failedOperationIds: [],
  serverTimestamp: 1700,
  status: 'COMPLETED',
}

const paidSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'active' },
} as unknown as SessionResult

const pastDueSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'past_due' },
} as unknown as SessionResult

const lifetimeSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'lifetime' },
} as unknown as SessionResult

const canceledSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'canceled' },
} as unknown as SessionResult

const freeSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'free' },
} as unknown as SessionResult

const noSession = {
  success: false,
  error: 'No user session',
} as unknown as SessionResult

const sampleOperation = {
  id: 'op-1',
  type: 'create',
  entityType: 'incomeSource',
  entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  data: { name: 'Salary', amount: 500000, frequency: 'monthly', userId: SESSION_USER_ID },
  timestamp: 1690,
  deviceId: 'device-1',
  userId: SESSION_USER_ID,
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sync/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const sampleBatch = {
  operations: [sampleOperation],
  clientTimestamp: 1700,
  deviceId: 'device-1',
}

describe('POST /api/sync/batch served boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBatchResult(okResult)
  })

  it('returns 401 for an unauthenticated request', async () => {
    mockSession(noSession)
    const response = await POST({ request: postRequest(sampleBatch) })
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.success).toBe(false)
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  it('returns 401 when the session resolves but has no user', async () => {
    mockSession({ success: true, data: null } as unknown as SessionResult)
    const response = await POST({ request: postRequest(sampleBatch) })
    expect(response.status).toBe(401)
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  it('returns 403 for an authenticated free-tier user (premium gate)', async () => {
    mockSession(freeSession)
    const response = await POST({ request: postRequest(sampleBatch) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toContain('Premium')
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  it('allows a past_due subscriber (sync gate ⊇ calculations gate)', async () => {
    mockSession(pastDueSession)
    const response = await POST({ request: postRequest(sampleBatch) })

    expect(response.status).toBe(200)
    expect(processBatchSync).toHaveBeenCalledTimes(1)
  })

  it('allows a lifetime buyer (Story 30.4a — untested at this boundary until 78.3)', async () => {
    mockSession(lifetimeSession)
    const response = await POST({ request: postRequest(sampleBatch) })

    expect(response.status).toBe(200)
    expect(processBatchSync).toHaveBeenCalledTimes(1)
  })

  it('refuses a canceled subscriber with 403', async () => {
    mockSession(canceledSession)
    const response = await POST({ request: postRequest(sampleBatch) })

    expect(response.status).toBe(403)
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON body with 400 (not a 500)', async () => {
    mockSession(paidSession)
    const response = await POST({ request: postRequest('{ not json') })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  // Story 79.3 (D1): the route stamps its OWN 413 with a refusal discriminant, so
  // the client can tell it from a proxy's 413 (which proves nothing about the op).
  // The limit is 512 KiB (code review 79.3, decision — Lucas): BELOW nginx's 1 MiB
  // default, so the route's labelled 413 answers before a common ingress limit.
  const LIMIT = 512 * 1024
  it('refuses a body over 512 KiB with 413 + `refusal: too-large`, before reading it', async () => {
    mockSession(paidSession)
    const response = await POST({
      request: postRequest(sampleBatch, { 'content-length': String(LIMIT + 1) }),
    })
    const payload = await response.json()

    expect(response.status).toBe(413)
    expect(payload).toEqual({ success: false, error: 'Request too large', refusal: 'too-large' })
    expect(processBatchSync).not.toHaveBeenCalled()
  })

  it('accepts a body of exactly 512 KiB (the guard is strictly greater-than)', async () => {
    mockSession(paidSession)
    const response = await POST({
      request: postRequest(sampleBatch, { 'content-length': String(LIMIT) }),
    })
    expect(response.status).toBe(200)
  })

  it.each([
    ['no session', 401, noSession],
    ['a free-tier session', 403, freeSession],
  ] as const)(
    'keeps the order auth → paid gate → size: an oversize body with %s is still %i',
    async (_label, status, session) => {
      mockSession(session)
      const response = await POST({
        request: postRequest(sampleBatch, { 'content-length': String(LIMIT + 1) }),
      })
      expect(response.status).toBe(status)
      expect((await response.json()).refusal).toBeUndefined()
    }
  )

  it('processes the batch under the SESSION user id mapped to `id`', async () => {
    mockSession(paidSession)
    const response = await POST({ request: postRequest(sampleBatch) })

    expect(response.status).toBe(200)
    // SECURITY: processBatchSync receives { id: <session userId>, subscriptionStatus }.
    // A client-supplied userId is never trusted as the authoritative identity.
    expect(processBatchSync).toHaveBeenCalledWith(sampleBatch, {
      id: SESSION_USER_ID,
      subscriptionStatus: 'active',
    })
  })

  it('returns the BatchSyncResponse envelope the client transport consumes', async () => {
    mockSession(paidSession)
    const response = await POST({ request: postRequest(sampleBatch) })
    const payload = await response.json()

    expect(payload).toMatchObject({
      success: true,
      processedCount: 1,
      failedCount: 0,
      conflictCount: 0,
    })
  })

  it('surfaces a rate-limit rejection as HTTP 429', async () => {
    mockSession(paidSession)
    mockBatchResult({
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: 1700,
      status: 'FAILED',
      error: 'Rate limit exceeded',
      // Story 75.1: the route keys statuses on this discriminant, not on `error`.
      refusal: 'rate-limit',
    })
    const response = await POST({ request: postRequest(sampleBatch) })
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(payload.error).toContain('Rate limit')
  })

  // Story 75.1: request-level refusals get statuses core can classify. 400 is in
  // core's PERMANENT_REJECT_STATUS_CODES (the op is dropped). Ownership is 401 —
  // kept queued, because the op may be another account's pending edit (code
  // review) — and deliberately not 403, which core files as tier-blocked.
  it.each([
    ['invalid-request', 400],
    ['ownership', 401],
    ['tier', 403],
    ['rate-limit', 429],
  ] as const)('maps a %s refusal to HTTP %i', async (refusal, status) => {
    mockSession(paidSession)
    mockBatchResult({
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: 1700,
      status: 'FAILED',
      error: 'whatever',
      refusal,
    })
    const response = await POST({ request: postRequest(sampleBatch) })
    expect(response.status).toBe(status)
  })

  it('does NOT pick a status from the error TEXT (story 75.1)', async () => {
    // Before 75.1 the 429 arm string-matched 'Rate limit exceeded'. A message with
    // no discriminant is an ordinary 200 envelope.
    mockSession(paidSession)
    mockBatchResult({
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: 1700,
      status: 'FAILED',
      error: 'Rate limit exceeded',
    })
    const response = await POST({ request: postRequest(sampleBatch) })
    expect(response.status).toBe(200)
  })

  it('returns a 200 envelope (not an HTTP error) for a per-op conflict', async () => {
    mockSession(paidSession)
    mockBatchResult({
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 1,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: 1700,
      status: 'PARTIAL',
    })
    const response = await POST({ request: postRequest(sampleBatch) })
    const payload = await response.json()

    // Conflicts are a normal sync outcome conveyed in the body, not a transport error.
    expect(response.status).toBe(200)
    expect(payload.conflictCount).toBe(1)
  })
})
