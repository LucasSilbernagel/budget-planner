/**
 * Atomic DB-backed rate limiter tests (Story SEC-2 — AC-3, AC-4, AC-6).
 *
 * The Drizzle `db` is mocked to a controllable fake insert-chain (no database,
 * per project testing rules). The fake captures the values / conflict-target it
 * is handed so the atomic-upsert SHAPE is asserted, and can either return a fixed
 * count, act as a serialised atomic counter (concurrency), or throw (degrade).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mode = 'fixed' | 'atomic' | 'throw' | 'empty'

const state = vi.hoisted(() => ({
  mode: 'fixed' as Mode,
  fixedCount: 1,
  serverCount: 0,
  captured: {
    values: undefined as Record<string, unknown> | undefined,
    conflictTarget: undefined as unknown,
    returning: undefined as Record<string, unknown> | undefined,
  },
}))

vi.mock('@budget-planner/db', () => {
  // Column sentinels — identity is enough to assert the conflict target.
  const rateLimits = {
    scope: 'col:scope',
    subject: 'col:subject',
    windowStart: 'col:windowStart',
    requestCount: 'col:requestCount',
  }
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        state.captured.values = v
        return {
          onConflictDoUpdate: vi.fn((c: { target: unknown }) => {
            state.captured.conflictTarget = c.target
            return {
              returning: vi.fn((r: Record<string, unknown>) => {
                state.captured.returning = r
                if (state.mode === 'throw') return Promise.reject(new Error('db down'))
                if (state.mode === 'empty') return Promise.resolve([])
                const count = state.mode === 'atomic' ? ++state.serverCount : state.fixedCount
                return Promise.resolve([{ count }])
              }),
            }
          }),
        }
      }),
    })),
  }
  return { db, rateLimits }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { checkDbRateLimit } from './db-window'

beforeEach(() => {
  vi.clearAllMocks()
  state.mode = 'fixed'
  state.fixedCount = 1
  state.serverCount = 0
  state.captured = { values: undefined, conflictTarget: undefined, returning: undefined }
})

describe('checkDbRateLimit — atomic upsert shape (AC-4)', () => {
  it('writes the row keyed by scope/subject and floors windowStart to the bucket boundary', async () => {
    const windowMs = 60_000
    const now = 1_700_000_123_456 // arbitrary; not a bucket boundary
    await checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs, maxAttempts: 5, now })

    const v = state.captured.values
    expect(v?.scope).toBe('ip')
    expect(v?.subject).toBe('203.0.113.5')
    // Floored to the enclosing window, NOT `now`.
    expect((v?.windowStart as Date).getTime()).toBe(Math.floor(now / windowMs) * windowMs)
    expect(v?.requestCount).toBe(1)
  })

  it('uses (scope, subject, windowStart) as the ON CONFLICT target and returns the count', async () => {
    await checkDbRateLimit({ scope: 'sync', subject: 'u1', windowMs: 60_000, maxAttempts: 100 })
    expect(state.captured.conflictTarget).toEqual(['col:scope', 'col:subject', 'col:windowStart'])
    expect(state.captured.returning).toEqual({ count: 'col:requestCount' })
  })

  it('leaves userId NULL for IP/email buckets but sets it for the sync scope (erasure/FK)', async () => {
    await checkDbRateLimit({ scope: 'email', subject: 'a@b.com', windowMs: 60_000, maxAttempts: 5 })
    expect(state.captured.values?.userId).toBeNull()

    await checkDbRateLimit({
      scope: 'sync',
      subject: 'u9',
      userId: 'u9',
      windowMs: 60_000,
      maxAttempts: 100,
    })
    expect(state.captured.values?.userId).toBe('u9')
  })
})

describe('checkDbRateLimit — decision boundary on the returned count (AC-4)', () => {
  it('allows while count <= maxAttempts and rejects the (max+1)th', async () => {
    state.fixedCount = 5
    expect(
      await checkDbRateLimit({ scope: 'ip', subject: 'x', windowMs: 60_000, maxAttempts: 5 })
    ).toEqual({
      allowed: true,
      remaining: 0,
    })

    state.fixedCount = 6
    expect(
      await checkDbRateLimit({ scope: 'ip', subject: 'x', windowMs: 60_000, maxAttempts: 5 })
    ).toEqual({
      allowed: false,
      remaining: 0,
    })
  })

  it('reports remaining from the atomic total', async () => {
    state.fixedCount = 2
    const r = await checkDbRateLimit({
      scope: 'ip',
      subject: 'x',
      windowMs: 60_000,
      maxAttempts: 5,
    })
    expect(r).toEqual({ allowed: true, remaining: 3 })
  })

  it('under a serialised atomic counter, exactly maxAttempts of N concurrent requests pass', async () => {
    // Simulates Postgres serialising the conflicting upserts: each call gets a
    // unique incremented total. This is what defeats the read-then-write race.
    state.mode = 'atomic'
    const maxAttempts = 5
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkDbRateLimit({ scope: 'login-verify', subject: 'ip', windowMs: 60_000, maxAttempts })
      )
    )
    expect(results.filter((r) => r.allowed).length).toBe(maxAttempts)
    expect(results.filter((r) => !r.allowed).length).toBe(3)
  })
})

describe('checkDbRateLimit — scope isolation (AC-3)', () => {
  it('two scopes with the same subject write distinct buckets (no cross-scope collision)', async () => {
    await checkDbRateLimit({ scope: 'ip', subject: 'same', windowMs: 60_000, maxAttempts: 5 })
    const ipScope = state.captured.values?.scope
    await checkDbRateLimit({
      scope: 'sync',
      subject: 'same',
      userId: 'same',
      windowMs: 60_000,
      maxAttempts: 100,
    })
    const syncScope = state.captured.values?.scope
    expect(ipScope).toBe('ip')
    expect(syncScope).toBe('sync')
    expect(ipScope).not.toBe(syncScope)
  })
})

describe('checkDbRateLimit — DB-error degrade (AC-6)', () => {
  it('fails CLOSED (deny, degraded) when the DB throws and no fallback is given', async () => {
    state.mode = 'throw'
    const r = await checkDbRateLimit({
      scope: 'ip',
      subject: 'x',
      windowMs: 60_000,
      maxAttempts: 5,
    })
    expect(r).toEqual({ allowed: false, remaining: 0, degraded: true })
  })

  it('fails CLOSED (deny, degraded) when the upsert returns no row — never a fresh budget', async () => {
    state.mode = 'empty'
    const r = await checkDbRateLimit({
      scope: 'paddle-cb',
      subject: 'x',
      windowMs: 60_000,
      maxAttempts: 5,
    })
    expect(r).toEqual({ allowed: false, remaining: 0, degraded: true })
  })

  it('routes an empty-row result through the fallback when one is provided', async () => {
    state.mode = 'empty'
    const onDbError = vi.fn(() => ({ allowed: true, remaining: 7 }))
    const r = await checkDbRateLimit({
      scope: 'sync',
      subject: 'u1',
      userId: 'u1',
      windowMs: 60_000,
      maxAttempts: 100,
      onDbError,
    })
    expect(onDbError).toHaveBeenCalledOnce()
    expect(r).toEqual({ allowed: true, remaining: 7, degraded: true })
  })

  it('uses the provided fallback (flagged degraded) when the DB throws', async () => {
    state.mode = 'throw'
    const onDbError = vi.fn(() => ({ allowed: true, remaining: 42 }))
    const r = await checkDbRateLimit({
      scope: 'sync',
      subject: 'u1',
      userId: 'u1',
      windowMs: 60_000,
      maxAttempts: 100,
      onDbError,
    })
    expect(onDbError).toHaveBeenCalledOnce()
    expect(r).toEqual({ allowed: true, remaining: 42, degraded: true })
  })
})
