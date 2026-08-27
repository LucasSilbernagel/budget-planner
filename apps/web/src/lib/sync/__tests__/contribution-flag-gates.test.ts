/**
 * `contributionRecordedAsExpense` sync-contract gates (Story 45.1, FR72, AC-10).
 *
 * ## Why this file exists
 *
 * Sync is TRIPLE-GATED and none of the three gates is checked by the compiler:
 *
 *   1. the client sync-queue schema  — `packages/core/src/sync/types.ts`
 *   2. the server ingest schema      — `apps/web/src/server/api/sync.ts`
 *   3. the syncBridge payload        — `apps/web/src/lib/sync/syncBridge.ts`
 *
 * `z.object` STRIPS unknown keys by default, and `buildPayload` returns
 * `Record<string, unknown>`, so a forgotten field is not a type error anywhere.
 * Miss any one gate and the flag silently does not round-trip: the user unticks
 * "already recorded as an expense" on one device, the local pool corrects, and
 * every other device keeps deducting the money twice. Forever, with no error.
 *
 * ⚠️ The silent-drop path makes this worse than an ordinary contract gap.
 * `syncOperationDataSchema.parse()` runs inside `queueCreate` BEFORE `queue.add()`
 * and `syncBridge`'s `onQueueError` swallows the ZodError into a bare
 * `console.error` — the local edit persists visibly and simply never leaves.
 *
 * ⚠️ NOTHING HERE CLAIMS A LIVE ROUND-TRIP SUCCEEDS. Server-side sync CREATE is
 * broken for all four financial entities today (`syncOperationSchema` declares no
 * `profileId`, so `createEntity` inserts `undefined` against a NOT NULL column —
 * pre-existing; see `finance-type-gates.test.ts` and `sort-order-gates.test.ts`).
 * These are contract tests on each gate individually, which is the strongest
 * claim this harness supports. Structure follows `finance-type-gates.test.ts`.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'

const USER_ID = '11111111-1111-4111-8111-111111111111'

/** A minimal, otherwise-valid investment balanceTracking row. */
const baseRow = {
  type: 'investment' as const,
  name: 'TFSA',
  currentBalance: 1_000_000,
  monthlyContribution: 50_000,
  frequency: 'monthly' as const,
  userId: USER_ID,
}

// ⚠️ The OPERATION's own `type` is create/update/delete and collides by name with
// the BALANCE ROW's `type`, which lives inside `data`. Getting this wrong makes
// the whole op invalid and a rejection assertion then passes for the wrong
// reason — the trap `finance-type-gates.test.ts` records having fallen into.
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
    // ⚠️ `false` is the arm that matters most. A schema that dropped the key
    // would look correct in the `true` case (the server default is false) and
    // silently fail to UNTICK — the direction a user takes to restore a real
    // deduction. Asserting `toBe(false)` is not the same as asserting the key
    // survived, so check presence explicitly too.
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
    // Acceptance partner over the SAME fixture, so a malformed base row cannot
    // make the rejection pass vacuously (story 43.4's recorded failure).
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
    // ⚠️⚠️ MEASURED, and it is the reason syncBridge stamps `?? false`.
    // `syncOperationSchema` declares `data: z.record(z.unknown())` and validates
    // the entity shape inside a `superRefine`, which throws on bad input but
    // throws away the parsed (defaulted, stripped) value. So the server's
    // `balanceTrackingSchema.default(false)` NEVER reaches `parsed.data`.
    //
    // Consequence: the wire value is exactly what the bridge sent. If gate 3
    // ever stopped stamping the key, an omitted flag would arrive `undefined`
    // and `updateEntity`'s PARTIAL `.set()` would leave the previous server
    // value in place — an untick that silently never lands on other devices.
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
