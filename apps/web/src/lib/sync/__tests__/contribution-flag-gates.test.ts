/**
 * Sync is triple-gated (queue schema, server schema, bridge payload) and z.object strips unknown keys,
 * so a missed gate is not a type error.
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

// The op's `type` (create/update/delete) collides with the balance row's `type` inside `data`.
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

describe('Gate 1 — the client sync-queue schema (the SILENT one)', () => {
  it('preserves contributionRecordedAsExpense: true rather than stripping it', () => {
    const parsed = syncOperationDataSchema.parse({
      ...baseRow,
      contributionRecordedAsExpense: true,
    })
    expect(parsed.contributionRecordedAsExpense).toBe(true)
  })

  it('preserves contributionRecordedAsExpense: false rather than stripping it', () => {
    // `false` matters most: a dropped key looks right for `true` (server default) but can't untick.
    const parsed = syncOperationDataSchema.parse({
      ...baseRow,
      contributionRecordedAsExpense: false,
    })
    expect(parsed).toHaveProperty('contributionRecordedAsExpense')
    expect(parsed.contributionRecordedAsExpense).toBe(false)
  })

  it('leaves the key absent when the payload omits it (partial update)', () => {
    const parsed = syncOperationDataSchema.parse(baseRow)
    expect(parsed.contributionRecordedAsExpense).toBeUndefined()
  })

  it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
    // Acceptance partner on the same fixture, so the rejection can't pass vacuously.
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, contributionRecordedAsExpense: 'yes' })
    ).toThrow()
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, contributionRecordedAsExpense: true })
    ).not.toThrow()
  })
})

describe('Gate 2 — the server ingest schema', () => {
  it('passes contributionRecordedAsExpense: true through UNSTRIPPED', () => {
    const parsed = syncOperationSchema.parse(
      op({ ...baseRow, contributionRecordedAsExpense: true })
    )
    expect((parsed.data as Record<string, unknown>).contributionRecordedAsExpense).toBe(true)
  })

  it('⚠️ does NOT default an omitted flag — the superRefine DISCARDS its parse result', () => {
    // superRefine discards the parsed value, so the server default never reaches data; the bridge must stamp the key.
    const parsed = syncOperationSchema.parse(op(baseRow))
    expect((parsed.data as Record<string, unknown>).contributionRecordedAsExpense).toBeUndefined()
  })

  it('passes an explicit false through unchanged', () => {
    const parsed = syncOperationSchema.parse(
      op({ ...baseRow, contributionRecordedAsExpense: false })
    )
    expect(parsed.data as Record<string, unknown>).toHaveProperty('contributionRecordedAsExpense')
    expect((parsed.data as Record<string, unknown>).contributionRecordedAsExpense).toBe(false)
  })

  it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, contributionRecordedAsExpense: 1 }))
    ).toThrow()
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, contributionRecordedAsExpense: false }))
    ).not.toThrow()
  })
})
