/**
 * z.enum, subset arrays and Set<string> don't track the FinanceType union, so a missed gate is no compile error;
 * the queue gate's ZodError is swallowed, so the row just never syncs.
 */

import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { ALL_FINANCE_TYPES, financeTypeEnum } from '@budget-planner/db/src/schema'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'

const baseRow = {
  name: 'Condo',
  currentBalance: 40_000_000,
  monthlyContribution: 0,
  frequency: 'monthly' as const,
  userId: '11111111-1111-4111-8111-111111111111',
}

// The op's `type` (create/update/delete) collides with the balance row's `type` inside `data`.
const op = (data: Record<string, unknown>) => ({
  id: '22222222-2222-4222-8222-222222222222',
  type: 'create' as const,
  entityType: 'balanceTracking' as const,
  entityId: '33333333-3333-4333-8333-333333333333',
  data,
  timestamp: 1_700_000_000_000,
  deviceId: 'device-1',
  userId: baseRow.userId,
})

describe('Gate 1 — the enum itself, and every list derived from it', () => {
  it('the pgEnum carries all three values', () => {
    expect(financeTypeEnum.enumValues).toEqual(['investment', 'debt', 'asset'])
  })

  it('core FINANCE_TYPES matches the enum exactly, in order', () => {
    // Core restates the list because the db barrel throws when `window` is defined; this catches order/value drift.
    expect([...FINANCE_TYPES]).toEqual([...ALL_FINANCE_TYPES])
    expect([...FINANCE_TYPES]).toEqual([...financeTypeEnum.enumValues])
  })
})

describe('Gate 2 — the client sync-queue schema (the SILENT one)', () => {
  it.each([...ALL_FINANCE_TYPES])('accepts type %s', (type) => {
    expect(() => syncOperationDataSchema.parse({ ...baseRow, type })).not.toThrow()
  })

  it('preserves the asset type rather than stripping it', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, type: 'asset' })
    expect(parsed.type).toBe('asset')
  })

  it('still REJECTS a genuinely unknown type', () => {
    // Fails if the gate is loosened to z.string().
    expect(() => syncOperationDataSchema.parse({ ...baseRow, type: 'crypto' })).toThrow()
  })
})

describe('Gate 3 — the server ingest schema', () => {
  it.each([...ALL_FINANCE_TYPES])('accepts a balanceTracking op of type %s', (type) => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, type }))).not.toThrow()
  })

  it('passes the asset type through UNSTRIPPED to the insert path', () => {
    // superRefine discards its result, so `data` survives unstripped.
    const parsed = syncOperationSchema.parse(op({ ...baseRow, type: 'asset' }))
    expect((parsed.data as Record<string, unknown>).type).toBe('asset')
  })

  it('still REJECTS a genuinely unknown type', () => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, type: 'crypto' }))).toThrow()
  })
})
