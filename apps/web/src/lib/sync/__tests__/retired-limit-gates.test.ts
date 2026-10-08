/**
 * The client schema strips unknown keys; the server schema validates inside a superRefine that
 * discards its parse result, so absence there shows as a formerly rejected value now passing.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'

const USER_ID = '11111111-1111-4111-8111-111111111111'

const baseRow = {
  type: 'investment' as const,
  name: 'TFSA',
  currentBalance: 1_000_000,
  monthlyContribution: 50_000,
  frequency: 'monthly' as const,
  userId: USER_ID,
}

const op = (data: Record<string, unknown>) => ({
  id: '22222222-2222-4222-8222-222222222222',
  type: 'create' as const,
  entityType: 'balanceTracking' as const,
  entityId: '33333333-3333-4333-8333-333333333333',
  data,
  timestamp: 1_700_000_000_000,
  deviceId: 'device-1',
  userId: USER_ID,
})

describe('Gate 1 — the client sync-queue schema no longer declares the limit', () => {
  it('STRIPS a maxContributionLimit that a stale client still sends', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, maxContributionLimit: 500_000 })

    expect(parsed).not.toHaveProperty('maxContributionLimit')
  })

  it('still accepts the row itself — the strip is not a rejection', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, maxContributionLimit: 500_000 })

    expect(parsed.name).toBe('TFSA')
    expect(parsed.currentBalance).toBe(1_000_000)
    expect(parsed.monthlyContribution).toBe(50_000)
  })

  it('strips it on an UPDATE-shaped partial payload too', () => {
    const parsed = syncOperationDataSchema.parse({
      currentBalance: 42,
      maxContributionLimit: 500_000,
    })

    expect(parsed).not.toHaveProperty('maxContributionLimit')
    expect(parsed.currentBalance).toBe(42)
  })
})

describe('Gate 2 — the server ingest schema no longer validates the limit', () => {
  it('accepts a payload whose limit value the old declaration would have REJECTED', () => {
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, maxContributionLimit: 1.5 }))
    ).not.toThrow()
  })

  it('still REJECTS a genuinely malformed row, so the acceptance above is not blanket', () => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, currentBalance: 'lots' }))).toThrow()
    expect(() => syncOperationSchema.parse(op(baseRow))).not.toThrow()
  })
})
