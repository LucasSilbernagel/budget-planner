/**
 * Sync Changes Pull Route Boundary Tests (Story 4-18)
 *
 * Drives the actual served GET handler end-to-end: real Request → query parsing
 * → server-side auth/premium gate → getSyncChanges → JSON Response with the
 * correct HTTP status and the EXACT shape the client's fetchServerChanges
 * consumes (`{ success, changes: ServerChange[], lastPullTimestamp }`).
 *
 * The db layer is mocked out by mocking getSyncChanges (which owns the Drizzle
 * query); the assertions instead pin the security-critical contract: the delta
 * is requested with the SESSION user id (never a client-supplied one) plus the
 * parsed `since`/`limit`/`profileId`. The premium gate is exercised with the
 * REAL PAID_SYNC_STATUSES (active|past_due — matching push, not calculations).
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the session lookup the route imports (resolved via the '@' alias).
vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

// Fully mock the sync module so the test needs no database (and does not load
// the real sync.ts, which transitively imports db/zod). PAID_SYNC_STATUSES is
// reproduced verbatim from the source — the route's premium gate (active|
// past_due, matching push, NOT calculations' active-only) is exercised through
// it below.
vi.mock('@/server/api/sync', () => ({
  PAID_SYNC_STATUSES: ['active', 'past_due'],
  getSyncChanges: vi.fn(),
  checkRateLimit: vi.fn(),
}))

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { checkRateLimit, getSyncChanges } from '@/server/api/sync'
import { GET } from '../changes'

type SessionResult = Awaited<ReturnType<typeof getCurrentUserSession>>

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function mockSession(result: SessionResult) {
  ;(getCurrentUserSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(result)
}

function mockChanges(changes: ServerChange[]) {
  ;(getSyncChanges as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(changes)
}

function mockRateLimit(allowed: boolean) {
  ;(checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    allowed,
    remaining: allowed ? 99 : 0,
  })
}

const paidSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'active' },
} as unknown as SessionResult

const pastDueSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'past_due' },
} as unknown as SessionResult

const freeSession = {
  success: true,
  data: { userId: SESSION_USER_ID, subscriptionStatus: 'free' },
} as unknown as SessionResult

const noSession = {
  success: false,
  error: 'No user session',
} as unknown as SessionResult

function getRequest(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/sync/changes${query}`, {
    method: 'GET',
    headers,
  })
}

const sampleChange: ServerChange = {
  entityType: 'incomeSource',
  entityId: '42',
  data: { id: 42, name: 'Salary', amount: 500000, frequency: 'monthly', isDeleted: false },
  updatedAt: 1700,
  isDeleted: false,
}

describe('GET /api/sync/changes served boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChanges([])
    mockRateLimit(true)
  })

  it('returns 401 for an unauthenticated request', async () => {
    mockSession(noSession)
    const response = await GET({ request: getRequest() })
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('No user session')
    expect(getSyncChanges).not.toHaveBeenCalled()
  })

  it('returns 401 when the session resolves but has no user', async () => {
    mockSession({ success: true, data: null } as unknown as SessionResult)
    const response = await GET({ request: getRequest() })
    expect(response.status).toBe(401)
    expect(getSyncChanges).not.toHaveBeenCalled()
  })

  it('returns 403 for an authenticated free-tier user (premium gate)', async () => {
    mockSession(freeSession)
    const response = await GET({ request: getRequest() })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('Premium')
    expect(getSyncChanges).not.toHaveBeenCalled()
  })

  it('allows a past_due subscriber (sync gate ⊇ calculations gate)', async () => {
    mockSession(pastDueSession)
    mockChanges([sampleChange])
    const response = await GET({ request: getRequest() })

    expect(response.status).toBe(200)
    expect(getSyncChanges).toHaveBeenCalledTimes(1)
  })

  it('returns 429 when the per-user rate limit is exceeded (review D3)', async () => {
    mockSession(paidSession)
    mockRateLimit(false)
    const response = await GET({ request: getRequest() })
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('Rate limit')
    // Gated before touching the database.
    expect(getSyncChanges).not.toHaveBeenCalled()
  })

  it('returns 200 with the exact client-consumed shape for a paid user', async () => {
    mockSession(paidSession)
    mockChanges([sampleChange])

    const response = await GET({ request: getRequest('?since=1000') })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    // The shape fetchServerChanges() consumes: { success, changes[], lastPullTimestamp }
    expect(Array.isArray(payload.changes)).toBe(true)
    expect(payload.changes).toEqual([sampleChange])
    expect(payload.changes[0]).toMatchObject({
      entityType: 'incomeSource',
      entityId: '42',
      updatedAt: 1700,
      isDeleted: false,
    })
    // lastPullTimestamp = max updatedAt of the returned batch.
    expect(payload.lastPullTimestamp).toBe(1700)
  })

  it('scopes the delta to the SESSION user id and forwards since/limit/profileId', async () => {
    mockSession(paidSession)
    const response = await GET({
      request: getRequest('?since=1234&limit=25', { 'x-profile-id': 'profile-xyz' }),
    })

    expect(response.status).toBe(200)
    // SECURITY: getSyncChanges is called with the session user id, never a
    // client-supplied one, plus the parsed cursor/limit/profile.
    expect(getSyncChanges).toHaveBeenCalledWith(SESSION_USER_ID, 1234, 25, 'profile-xyz')
  })

  it('treats an absent since as a full snapshot (null cursor)', async () => {
    mockSession(paidSession)
    await GET({ request: getRequest() })
    expect(getSyncChanges).toHaveBeenCalledWith(SESSION_USER_ID, null, 100, undefined)
  })

  it('returns lastPullTimestamp = since when there are no changes', async () => {
    mockSession(paidSession)
    mockChanges([])
    const response = await GET({ request: getRequest('?since=999') })
    const payload = await response.json()

    expect(payload.success).toBe(true)
    expect(payload.changes).toEqual([])
    expect(payload.lastPullTimestamp).toBe(999)
  })

  it('rejects a malformed since with 400 (not a 500)', async () => {
    mockSession(paidSession)
    const response = await GET({ request: getRequest('?since=-5') })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(getSyncChanges).not.toHaveBeenCalled()
  })

  it('maps an unexpected getSyncChanges failure to 500', async () => {
    mockSession(paidSession)
    ;(getSyncChanges as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('db exploded')
    )
    const response = await GET({ request: getRequest('?since=1') })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('db exploded')
  })
})
