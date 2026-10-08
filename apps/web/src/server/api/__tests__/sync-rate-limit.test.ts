import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkDbRateLimit } = vi.hoisted(() => ({ checkDbRateLimit: vi.fn() }))
vi.mock('@/server/rate-limit/db-window', () => ({ checkDbRateLimit }))

import { checkRateLimit } from '../sync'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sync checkRateLimit wiring (AC-4)', () => {
  it('delegates to the shared primitive with the exact sync scope/limit and an onDbError fallback', async () => {
    checkDbRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    const result = await checkRateLimit('user-abc')

    expect(result).toEqual({ allowed: true, remaining: 99 })
    expect(checkDbRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'sync',
        subject: 'user-abc',
        userId: 'user-abc', // populated so account erasure can clear the counter
        windowMs: 60_000,
        maxAttempts: 100,
        onDbError: expect.any(Function),
      })
    )
  })
})

describe('sync DB-error degrade — syncInMemoryFallback boundary (AC-6)', () => {
  it('enforces 100/60s per user in the bounded in-memory fallback (100 allowed, 101st blocked)', async () => {
    checkDbRateLimit.mockImplementation(
      async ({
        onDbError,
      }: { onDbError: (now: number) => { allowed: boolean; remaining: number } }) => ({
        ...onDbError(Date.now()),
        degraded: true,
      })
    )

    const userId = 'fallback-user-unique'
    const results = []
    for (let i = 0; i < 101; i++) {
      results.push(await checkRateLimit(userId))
    }

    expect(results.filter((r) => r.allowed).length).toBe(100)
    expect(results[100]).toEqual({ allowed: false, remaining: 0 })
  })

  it('keeps separate users in independent fallback buckets', async () => {
    checkDbRateLimit.mockImplementation(
      async ({
        onDbError,
      }: { onDbError: (now: number) => { allowed: boolean; remaining: number } }) => ({
        ...onDbError(Date.now()),
        degraded: true,
      })
    )
    const a = await checkRateLimit('user-A-unique')
    const b = await checkRateLimit('user-B-unique')
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })
})
