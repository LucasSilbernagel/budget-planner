/**
 * Calculation Route Boundary Tests
 *
 * Unlike financial.test.ts (which calls the calculation functions directly),
 * these tests drive the actual served POST handlers end-to-end: real Request
 * objects → JSON body parsing → server-side auth/premium gate → calculation →
 * JSON Response with the correct HTTP status. This is the "real boundary" the
 * client hits at /api/calculations/* (story 5-12, AC-1/AC-3).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the session lookup at the module path financial.ts actually imports
// (resolved via the '@' alias to src/server/api/auth/paddle).
vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { POST as aggregationPOST } from '../aggregation'
import { POST as retirementPOST } from '../retirement'
import { POST as withdrawalPOST } from '../withdrawal'

type SessionResult = Awaited<ReturnType<typeof getCurrentUserSession>>

function mockSession(result: SessionResult) {
  ;(getCurrentUserSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(result)
}

const paidSession = {
  success: true,
  data: { subscriptionStatus: 'active' },
} as unknown as SessionResult

const freeSession = {
  success: true,
  data: { subscriptionStatus: 'inactive' },
} as unknown as SessionResult

const noSession = {
  success: false,
  error: 'No user session',
} as unknown as SessionResult

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/calculations/* served boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 for an unauthenticated request', async () => {
    mockSession(noSession)
    const request = postRequest('/api/calculations/retirement', {
      monthlyIncome: 5000,
      annualReturnRate: 0.07,
    })

    const response = await retirementPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('No user session')
  })

  it('returns 403 for an authenticated free-tier user (premium gate)', async () => {
    mockSession(freeSession)
    const request = postRequest('/api/calculations/retirement', {
      monthlyIncome: 5000,
      annualReturnRate: 0.07,
    })

    const response = await retirementPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('Premium')
  })

  it('returns 200 with real data for a paid-tier user', async () => {
    mockSession(paidSession)
    const request = postRequest('/api/calculations/retirement', {
      monthlyIncome: 5000,
      annualReturnRate: 0.07,
    })

    const response = await retirementPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data).toBeDefined()
  })

  it('returns 400 when the request body is not valid JSON', async () => {
    mockSession(paidSession)
    const request = new Request('http://localhost/api/calculations/retirement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })

    const response = await retirementPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
  })

  it('returns 400 for invalid calculation input (validation surfaced over HTTP)', async () => {
    mockSession(paidSession)
    const request = postRequest('/api/calculations/aggregation', {
      values: [],
      operation: 'sum',
    })

    const response = await aggregationPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('Values array must not be empty')
  })

  it('maps the withdrawal body params (assets, annualReturnRate) into the calculation', async () => {
    mockSession(paidSession)
    const request = postRequest('/api/calculations/withdrawal', {
      assets: 1000000,
      annualReturnRate: 0.07,
    })

    const response = await withdrawalPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(typeof payload.data).toBe('number')
  })

  it('computes an aggregation sum end-to-end for a paid user', async () => {
    mockSession(paidSession)
    const request = postRequest('/api/calculations/aggregation', {
      values: [100, 200, 300],
      operation: 'sum',
    })

    const response = await aggregationPOST({ request })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.result).toBe(600)
  })
})
