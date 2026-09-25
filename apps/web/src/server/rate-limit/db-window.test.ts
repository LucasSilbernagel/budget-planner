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
/** How the mocked `db.execute` (the sweep) behaves — Story sec-3. */
type ExecuteMode = 'ok' | 'reject' | 'throwSync' | 'pending'

const state = vi.hoisted(() => ({
  mode: 'fixed' as Mode,
  executeMode: 'ok' as ExecuteMode,
  fixedCount: 1,
  serverCount: 0,
  captured: {
    values: undefined as Record<string, unknown> | undefined,
    conflictTarget: undefined as unknown,
    returning: undefined as Record<string, unknown> | undefined,
    executed: [] as unknown[],
  },
}))

vi.mock('@budget-planner/db', () => {
  // Column sentinels — identity is enough to assert the conflict target.
  const rateLimits = {
    scope: 'col:scope',
    subject: 'col:subject',
    windowStart: 'col:windowStart',
    requestCount: 'col:requestCount',
    // Present so the AC-6 "no userId term" assertion has something to detect.
    // Without this key `rateLimits.userId` is `undefined` and the guard is vacuous.
    userId: 'col:userId',
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
    execute: vi.fn((query: unknown) => {
      state.captured.executed.push(query)
      if (state.executeMode === 'throwSync') throw new Error('sweep exploded synchronously')
      if (state.executeMode === 'reject') return Promise.reject(new Error('sweep failed'))
      // Never settles — used to prove the decision does not await the sweep.
      if (state.executeMode === 'pending') return new Promise(() => {})
      return Promise.resolve(undefined)
    }),
  }
  return { db, rateLimits }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { logger } from '@/lib/logger'
import { __resetReapGateForTests, checkDbRateLimit } from './db-window'

beforeEach(() => {
  vi.clearAllMocks()
  state.mode = 'fixed'
  state.fixedCount = 1
  state.serverCount = 0
  state.executeMode = 'ok'
  state.captured = {
    values: undefined,
    conflictTarget: undefined,
    returning: undefined,
    executed: [],
  }
  // The sweep is gated to once per interval per process; without this the first
  // test to trip it would silence every later one.
  __resetReapGateForTests()
})

/**
 * Flatten a drizzle `SQL` into readable text + its interpolated params.
 *
 * Shape MEASURED, not assumed: `queryChunks` holds StringChunk objects (which
 * carry `value: string[]`) interleaved with the raw interpolated values.
 */
function renderSql(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
  let text = ''
  const params: unknown[] = []
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown } | null)?.value
    if (Array.isArray(value)) {
      text += value.join('')
    } else {
      params.push(chunk)
      text += ` $${params.length} `
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), params }
}

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
      scope: 'login-verify',
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

// ── Story sec-3: the expired-window reaper (AC-4, AC-5, AC-6) ────────────────
describe('expired-window reaper', () => {
  const ONE_HOUR_MS = 60 * 60 * 1000
  const LONGEST_CONFIGURED_WINDOW_MS = 15 * 60 * 1000 // EMAIL_LIMIT, request.ts:32
  const call = (now: number) =>
    checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs: 60_000, maxAttempts: 5, now })

  it('sweeps on the success path, with a cutoff OLDER than the longest window (AC-4)', async () => {
    const now = 1_800_000_000_000
    await call(now)

    expect(state.captured.executed).toHaveLength(1)
    const { params } = renderSql(state.captured.executed[0])

    // ⚠️ The cutoff must reach the driver as an explicit UTC STRING. A raw
    // `Date` here bypasses drizzle's column encoder and `pg` serializes it as
    // LOCAL time with an offset, which PostgreSQL then discards for a
    // `timestamp without time zone` column — MEASURED to delete every LIVE
    // bucket under Europe/Berlin (production's region). Asserting on a `Date`
    // object, as this test first did, is blind to that: the bug lives in the
    // serialization, not in the value.
    const cutoff = params.find((p): p is string => typeof p === 'string' && p.endsWith('Z'))
    expect(cutoff, 'cutoff must be an ISO-8601 UTC string, not a Date').toBeDefined()
    expect(new Date(cutoff as string).getTime()).toBe(now - ONE_HOUR_MS)
    expect(params.some((p) => p instanceof Date)).toBe(false)

    // The invariant that actually matters: a cutoff INSIDE the longest window
    // would delete live buckets and hand the subject a fresh budget. Note this
    // compares against a constant copied from `request.ts` — the REAL guard is
    // the runtime check in `checkDbRateLimit` (see "DISABLES the sweep..."),
    // because a copy asserted against itself cannot notice the original moving.
    expect(now - new Date(cutoff as string).getTime()).toBeGreaterThan(LONGEST_CONFIGURED_WINDOW_MS)
  })

  it('compares with a STRICT < so a row exactly AT the cutoff survives (AC-4 boundary)', async () => {
    await call(1_800_000_000_000)
    const { text } = renderSql(state.captured.executed[0])
    // `<=` would reap a row on the boundary. `<` errs toward keeping a row one
    // sweep longer, which is the safe direction: over-keeping costs a row,
    // over-deleting costs a subject its spent budget.
    expect(text).toContain('<')
    expect(text).not.toContain('<=')
  })

  it('carries NO userId term, so it cannot race account erasure on that predicate (AC-6)', async () => {
    await call(1_800_000_000_000)
    const { params } = renderSql(state.captured.executed[0])

    // ⚠️ MUST assert on `params`, not on the rendered text. Every interpolated
    // column arrives as a chunk that `renderSql` turns into `$n`, so a column
    // NAME never appears in the text at all — an assertion like
    // `expect(text).not.toContain('userId')` passes even with
    // `AND ${rateLimits.userId} = ...` in the predicate. Review caught this:
    // the earlier version of this test was vacuous and 20/20 stayed green
    // against exactly the mutation it claimed to guard.
    expect(params).toContain('col:windowStart')
    expect(params).not.toContain('col:userId')
  })

  it('uses FOR UPDATE SKIP LOCKED so it can never deadlock with erasure (AC-6)', async () => {
    await call(1_800_000_000_000)
    const { text } = renderSql(state.captured.executed[0])
    // Load-bearing, not an optimisation: `sync` rows carry BOTH a userId and a
    // windowStart, so the reaper and account.ts:98 DO select overlapping rows.
    // SKIP LOCKED makes the sweep step over rows erasure holds rather than wait
    // on them, so PostgreSQL can never pick erasure as a deadlock victim.
    expect(text).toContain('FOR UPDATE SKIP LOCKED')
  })

  it('sweeps at most ONCE per interval however many requests arrive (AC-5c)', async () => {
    const now = 1_800_000_000_000
    for (let i = 0; i < 25; i += 1) {
      await call(now + i * 1000)
    }
    expect(state.captured.executed).toHaveLength(1)

    // ...and sweeps again once the interval has elapsed.
    await call(now + 15 * 60 * 1000 + 1)
    expect(state.captured.executed).toHaveLength(2)
  })

  it('a REJECTED sweep does not fail the rate-limit decision (AC-5b)', async () => {
    state.executeMode = 'reject'
    state.fixedCount = 1
    await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
    await Promise.resolve()
    expect(logger.error).toHaveBeenCalledWith(
      '[RateLimit] expired-window sweep failed',
      expect.objectContaining({ error: 'sweep failed' })
    )
  })

  it('a SYNCHRONOUSLY throwing sweep does not fail the decision either (AC-5b)', async () => {
    state.executeMode = 'throwSync'
    state.fixedCount = 1
    await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
    expect(logger.error).toHaveBeenCalledWith(
      '[RateLimit] expired-window sweep failed',
      expect.objectContaining({ error: 'sweep exploded synchronously' })
    )
  })

  it('does not AWAIT the sweep — a sweep that never settles does not delay it (AC-5a)', async () => {
    state.executeMode = 'pending'
    state.fixedCount = 1
    // If the decision awaited the sweep this would hang and the test would time
    // out rather than fail — which is itself the signal.
    await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
  })

  it('does NOT sweep on the DB-error path (no extra statement during an outage)', async () => {
    state.mode = 'throw'
    await checkDbRateLimit({
      scope: 'ip',
      subject: '203.0.113.5',
      windowMs: 60_000,
      maxAttempts: 5,
      now: 1_800_000_000_000,
    })
    expect(state.captured.executed).toHaveLength(0)
  })
})

// ── Review round 1: bounds and the self-enforcing cutoff invariant ───────────
describe('reaper bounds and invariants', () => {
  const call = (now: number, windowMs = 60_000) =>
    checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs, maxAttempts: 5, now })

  it('CAPS the sweep, so a concurrent account erasure cannot be blocked unboundedly', async () => {
    await call(1_800_000_000_000)
    const { text, params } = renderSql(state.captured.executed[0])
    // SKIP LOCKED stops US waiting; it does NOT stop erasure waiting on us.
    // A cap is what bounds how long erasure can be made to queue.
    expect(text).toContain('LIMIT')
    expect(params).toContain(5000)
  })

  it('DISABLES the sweep for a caller whose window is longer than the cutoff (AC-4)', async () => {
    // Otherwise the reaper would delete that caller's LIVE buckets and hand the
    // subject a fresh budget. Enforced in code, not by a constant copied into a
    // test — a copy asserted against itself cannot catch a change to the real limit.
    await call(1_800_000_000_000, 2 * 60 * 60 * 1000)
    expect(state.captured.executed).toHaveLength(0)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('window is longer than the reap cutoff'),
      expect.objectContaining({ windowMs: 2 * 60 * 60 * 1000 })
    )
  })

  it('still sweeps for a caller at the longest window actually configured (15 min)', async () => {
    await call(1_800_000_000_000, 15 * 60 * 1000)
    expect(state.captured.executed).toHaveLength(1)
  })
})
