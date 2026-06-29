/**
 * Financial calc hardening tests (Story 5.8 — AC-15, AC-16, AC-17)
 *
 * - AC-15: route boundary rejects string-typed / wrong-shape bodies with 400.
 * - AC-16: netWorthProjection rejects non-finite, non-safe-integer, oversized,
 *   and overflowing inputs (tested at the function level since JSON cannot carry
 *   NaN/Infinity — they serialize to null).
 * - AC-17: httpStatusForResult maps status from the discriminated `code`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(),
}))

import { POST as netWorthPOST } from '@/routes/api/calculations/net-worth'
import { POST as retirementPOST } from '@/routes/api/calculations/retirement'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { httpStatusForResult, netWorthProjection } from '../financial'

type SessionResult = Awaited<ReturnType<typeof getCurrentUserSession>>

function mockPaid() {
  ;(getCurrentUserSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    data: { subscriptionStatus: 'active' },
  } as unknown as SessionResult)
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validNetWorth = {
  currentAssets: 1_000_000,
  currentLiabilities: 0,
  monthlySavings: 50_000,
  expectedReturnRate: 0.07,
  timeHorizonYears: 10,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPaid()
})

describe('AC-15: boundary input validation', () => {
  it('rejects a string-typed number with 400 before any calculation', async () => {
    const response = await retirementPOST({
      request: postRequest('/api/calculations/retirement', {
        monthlyIncome: '5000', // string, not number
        annualReturnRate: 0.07,
      }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).success).toBe(false)
  })

  it('rejects a wrong-shape net-worth body with 400', async () => {
    const response = await netWorthPOST({
      request: postRequest('/api/calculations/net-worth', { currentAssets: 100 }),
    })
    expect(response.status).toBe(400)
  })

  it('still accepts a well-formed body (200)', async () => {
    const response = await netWorthPOST({
      request: postRequest('/api/calculations/net-worth', validNetWorth),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).success).toBe(true)
  })
})

describe('AC-16: netWorthProjection numeric guards', () => {
  const req = new Request('http://localhost/api/calculations/net-worth', { method: 'POST' })

  it('rejects a non-finite (NaN) input', async () => {
    const result = await netWorthProjection(req, { ...validNetWorth, currentAssets: Number.NaN })
    expect(result.success).toBe(false)
    expect(result.code).toBe('VALIDATION')
    expect(result.error).toMatch(/finite/)
  })

  it('rejects a non-safe-integer monetary input', async () => {
    const result = await netWorthProjection(req, { ...validNetWorth, currentAssets: 1.5 })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/safe integer/)
  })

  it('rejects an oversized time horizon (DoS guard)', async () => {
    const result = await netWorthProjection(req, { ...validNetWorth, timeHorizonYears: 5000 })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/exceed/)
  })

  it('rejects a projection that overflows the safe-integer range', async () => {
    const result = await netWorthProjection(req, {
      ...validNetWorth,
      currentAssets: 9_000_000_000_000_000, // safe int, but compounds past MAX_SAFE_INTEGER
      expectedReturnRate: 0.5,
      timeHorizonYears: 5,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/numeric range/)
  })
})

describe('AC-17: httpStatusForResult uses the discriminated code', () => {
  it('maps AUTH→401, PREMIUM→403, VALIDATION→400, success→200', () => {
    expect(httpStatusForResult({ success: true })).toBe(200)
    expect(httpStatusForResult({ success: false, code: 'AUTH' })).toBe(401)
    expect(httpStatusForResult({ success: false, code: 'PREMIUM' })).toBe(403)
    expect(httpStatusForResult({ success: false, code: 'VALIDATION' })).toBe(400)
  })

  it('does not misclassify a validation message that contains "Premium" as 403', () => {
    // With code-driven mapping, the message text no longer determines the status.
    expect(
      httpStatusForResult({
        success: false,
        code: 'VALIDATION',
        error: 'The word Premium appears in this validation message',
      })
    ).toBe(400)
  })

  it('falls back to message classification when no code is present (back-compat)', () => {
    expect(httpStatusForResult({ success: false, error: 'No user session' })).toBe(401)
    expect(httpStatusForResult({ success: false, error: 'Premium feature' })).toBe(403)
    expect(httpStatusForResult({ success: false, error: 'something else' })).toBe(400)
  })
})
