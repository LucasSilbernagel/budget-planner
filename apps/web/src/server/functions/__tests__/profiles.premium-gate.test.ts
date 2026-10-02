/**
 * Profile server functions — Premium tier-boundary tests (Story 13-3, AC-2).
 *
 * The request-driven profile functions must reject any session whose
 * `subscriptionStatus` is not `active` (free / past_due / canceled), mirroring
 * `forecastingProfiles.ts`, so custom profiles is enforced at
 * the tier boundary server-side — not merely hidden in the UI. The guard fires
 * after the auth check and before any DB work, so an unauthenticated caller
 * still gets the auth error, not the premium error.
 *
 * ⚠️ `getProfiles` is NOT here since story 83.1: it became a user-scoped core
 * (`getProfiles(userId)`), and its tier boundary moved to its only caller,
 * `routes/api/profiles.ts`, where `routes/api/__tests__/profiles.route.db.test.ts`
 * pins it (free / past_due / canceled → 403).
 *
 * `getCurrentUserSession` and the Drizzle `db` are mocked; the rejection paths
 * never touch the DB (the guard short-circuits), and the one active-path check
 * uses a minimal chainable stub.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Path is relative to this test (server/functions/__tests__/) → the exact module
// profiles.ts imports (server/api/auth/paddle), so the mock intercepts.
vi.mock('../../api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

// Minimal chainable Drizzle stub: terminal calls resolve to `rows`.
const rows: unknown[] = []
function makeChain(): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['from', 'where', 'set', 'values']) chain[m] = vi.fn(() => chain)
  for (const m of ['orderBy', 'limit', 'returning']) chain[m] = vi.fn(() => Promise.resolve(rows))
  return chain
}
vi.mock('@budget-planner/db', () => ({
  db: {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    delete: vi.fn(() => makeChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ delete: vi.fn(() => makeChain()) })
    ),
  },
}))
vi.mock('@budget-planner/db/src/schema', () => ({ userProfiles: {}, users: {} }))

import { getCurrentUserSession } from '../../api/auth/paddle'
import {
  createProfile,
  deleteProfile,
  getProfile,
  setDefaultProfile,
  updateProfile,
} from '../profiles'

const req = {} as Request

function session(subscriptionStatus: string | null) {
  const mock = getCurrentUserSession as unknown as ReturnType<typeof vi.fn>
  if (subscriptionStatus === null) {
    // No error field → the function falls back to its "Authentication required" message.
    mock.mockResolvedValue({ success: false })
  } else {
    mock.mockResolvedValue({
      success: true,
      data: { userId: 'u1', email: 'a@b.co', subscriptionStatus },
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('profiles server functions — premium tier boundary (13-3 AC-2)', () => {
  const nonActive = ['free', 'past_due', 'canceled']

  describe.each(nonActive)('a %s subscription is rejected with the Premium error', (status) => {
    it('createProfile', async () => {
      session(status)
      const r = await createProfile(req, { name: 'X' })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/premium/i)
    })
    it('getProfile', async () => {
      session(status)
      const r = await getProfile(req, 'p1')
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/premium/i)
    })
    it('updateProfile', async () => {
      session(status)
      const r = await updateProfile(req, { id: 'p1', name: 'Y' })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/premium/i)
    })
    it('deleteProfile', async () => {
      session(status)
      const r = await deleteProfile(req, 'p1')
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/premium/i)
    })
    it('setDefaultProfile', async () => {
      session(status)
      const r = await setDefaultProfile(req, 'p1')
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/premium/i)
    })
  })

  it('unauthenticated → auth-required error, NOT the premium error (guard ordering)', async () => {
    session(null)
    const r = await createProfile(req, { name: 'X' })
    expect(r.success).toBe(false)
    expect(r.error).not.toMatch(/premium/i)
    expect(r.error).toMatch(/auth/i)
  })

  it('an active subscription passes the tier guard (getProfile proceeds to the lookup)', async () => {
    session('active')
    const r = await getProfile(req, 'p1')
    // The stub returns no row, so the function reached its query: past the guard.
    expect(r).toEqual({ success: false, error: 'Profile not found or not authorized' })
  })
})
