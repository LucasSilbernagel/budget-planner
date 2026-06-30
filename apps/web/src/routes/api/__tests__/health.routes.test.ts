/**
 * Health & readiness route boundary tests (story 5-5, AC-1)
 *
 * Drives the served GET handlers end-to-end:
 *  - /api/health is liveness — always 200, NO DB dependency (safe for
 *    scale-to-zero / SSR boot, NFR8).
 *  - /api/ready is readiness — 200 when the DB connects, 503 when it does not
 *    (this is the endpoint 5-2's Knative readiness probe is pointed at).
 * Neither leaks internal detail (versions / stack / secrets).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@budget-planner/db', () => ({
  testDbConnection: vi.fn(),
}))

import { testDbConnection } from '@budget-planner/db'
import { GET as healthGET } from '../health'
import { GET as readyGET } from '../ready'

const mockDb = testDbConnection as unknown as ReturnType<typeof vi.fn>

describe('GET /api/health (liveness)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 with a minimal status payload', async () => {
    const res = await healthGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('never touches the database', async () => {
    await healthGET()
    expect(mockDb).not.toHaveBeenCalled()
  })
})

describe('GET /api/ready (readiness)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 200 when the database connection succeeds', async () => {
    mockDb.mockResolvedValue(true)
    const res = await readyGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready' })
  })

  it('returns 503 when the database connection fails', async () => {
    mockDb.mockResolvedValue(false)
    const res = await readyGET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: 'not-ready' })
  })

  it('returns 503 (never throws) when the DB check rejects', async () => {
    mockDb.mockRejectedValue(new Error('boom'))
    const res = await readyGET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('not-ready')
    // does not leak the underlying error message / stack
    expect(JSON.stringify(body)).not.toContain('boom')
  })

  it('fails closed to 503 when the DB check hangs past the timeout', async () => {
    vi.useFakeTimers()
    try {
      // a black-hole DB: the connection check never settles
      mockDb.mockReturnValue(new Promise<boolean>(() => {}))
      const resPromise = readyGET()
      await vi.advanceTimersByTimeAsync(2000)
      const res = await resPromise
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ status: 'not-ready' })
    } finally {
      vi.useRealTimers()
    }
  })
})
