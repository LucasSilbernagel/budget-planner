/**
 * `paymentExpenseId` sync-contract gates (Story 102.1, FR169, AC-7).
 *
 * The debt→expense payment link crosses three gates the compiler cannot check:
 *
 *   1. the client sync-queue schema — `syncOperationDataSchema` (core). It STRIPS
 *      undeclared keys and runs BEFORE `queue.add()`, so a missing line drops the
 *      link silently, and a REJECTION drops the whole operation (name, balance
 *      and all) into a bare `console.error`.
 *   2. the server ingest schema — `apps/web/src/server/api/sync.ts`.
 *   3. the syncBridge payload — `toServerPayload`. It must emit the key on EVERY
 *      balance payload: `updateEntity` does a partial `.set()`, so an omitted key
 *      leaves the previous server link in place and an UNLINK never lands.
 *
 * ⚠️ A uuid that matches no expense is valid at every gate (no FK, see
 * `schema.ts`): a dangling link is a normal state. That claim is proved against
 * a real database in `payment-expense-link-roundtrip.test.ts`; this file pins
 * each gate on its own.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import { toServerPayload } from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EXPENSE_ID = '44444444-4444-4444-8444-444444444444'

/** A minimal, otherwise-valid DEBT balanceTracking row (operation payload). */
const baseRow = {
  type: 'debt' as const,
  name: 'Car loan',
  currentBalance: 1_200_000,
  monthlyContribution: 0,
  frequency: 'monthly' as const,
  userId: USER_ID,
}

// ⚠️ The operation's own `type` (create/update/delete) is not the row's `type`,
// which lives inside `data` (the trap `finance-type-gates.test.ts` records).
const op = (data: Record<string, unknown>) => ({
  id: '22222222-2222-4222-8222-222222222222',
  type: 'update' as const,
  entityType: 'balanceTracking' as const,
  entityId: '33333333-3333-4333-8333-333333333333',
  data,
  timestamp: 1_700_000_000_000,
  deviceId: 'device-1',
  userId: USER_ID,
})

describe('Gate 1: the client sync-queue schema (the SILENT one)', () => {
  it('keeps a linked expense id rather than stripping it', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: EXPENSE_ID })
    expect(parsed.paymentExpenseId).toBe(EXPENSE_ID)
  })

  it('⚠️ keeps an explicit null (the UNLINK) rather than rejecting it', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: null })
    expect(parsed).toHaveProperty('paymentExpenseId')
    expect(parsed.paymentExpenseId).toBeNull()
  })

  it('leaves the key absent when a partial payload omits it', () => {
    expect(syncOperationDataSchema.parse(baseRow).paymentExpenseId).toBeUndefined()
  })

  it('REJECTS a non-uuid string, while the same fixture with a uuid is accepted', () => {
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: 'not-a-uuid' })
    ).toThrow()
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, paymentExpenseId: EXPENSE_ID })
    ).not.toThrow()
  })
})

describe('Gate 2: the server ingest schema', () => {
  // ⚠️ This cannot fail on the new schema line: `syncOperationSchema` validates
  // `data` inside a superRefine that DISCARDS its parse result, so `parsed.data`
  // is the raw input whatever the entity schema declares (the 45.1 precedent).
  // It pins the wire contract only; the REJECTS case below exercises the line.
  it('leaves a linked id on the wire (superRefine passthrough, not the schema line)', () => {
    const parsed = syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: EXPENSE_ID }))
    expect((parsed.data as Record<string, unknown>)['paymentExpenseId']).toBe(EXPENSE_ID)
  })

  it('passes an explicit null through (the unlink)', () => {
    const parsed = syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: null }))
    expect(parsed.data as Record<string, unknown>).toHaveProperty('paymentExpenseId', null)
  })

  it('accepts a payload without the key (an older client)', () => {
    expect(() => syncOperationSchema.parse(op(baseRow))).not.toThrow()
  })

  it('REJECTS a non-uuid string, while the same fixture with a uuid is accepted', () => {
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: 'not-a-uuid' }))
    ).toThrow()
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, paymentExpenseId: EXPENSE_ID }))
    ).not.toThrow()
  })
})

describe('Gate 3: the syncBridge payload', () => {
  const entity = (paymentExpenseId: unknown) => ({
    id: '33333333-3333-4333-8333-333333333333',
    updatedAt: '2026-10-06T00:00:00.000Z',
    ...baseRow,
    userId: 0,
    paymentExpenseId,
  })

  it('forwards a linked id', () => {
    expect(toServerPayload('balanceTracking', entity(EXPENSE_ID), USER_ID)).toHaveProperty(
      'paymentExpenseId',
      EXPENSE_ID
    )
  })

  it('⚠️⚠️ emits an explicit null for an unlinked row: absent, undefined or null', () => {
    // The direction that breaks silently: without the key, `updateEntity`'s
    // partial `.set()` keeps the old link on every other device.
    for (const value of [undefined, null]) {
      const payload = toServerPayload('balanceTracking', entity(value), USER_ID)
      expect(payload).toHaveProperty('paymentExpenseId', null)
    }
    const { paymentExpenseId: _drop, ...noKey } = entity(null)
    expect(toServerPayload('balanceTracking', noKey, USER_ID)).toHaveProperty(
      'paymentExpenseId',
      null
    )
  })

  it('⚠️ sends null for a corrupt stored value, so gate 1 never refuses the whole edit', () => {
    // A hand-edited localStorage value forwarded unchanged would fail gate 1's
    // uuid check and drop the operation, rename and balance included (the 65.2
    // `"false"`-string lesson). Every reader already treats it as not linked.
    for (const bad of ['not-a-uuid', 42, true, {}, '']) {
      const payload = toServerPayload('balanceTracking', entity(bad), USER_ID)
      expect(payload).toHaveProperty('paymentExpenseId', null)
      expect(() => syncOperationDataSchema.parse(payload)).not.toThrow()
    }
  })

  it('the forwarded payload passes gate 1 with the link intact', () => {
    const payload = toServerPayload('balanceTracking', entity(EXPENSE_ID), USER_ID)
    expect(syncOperationDataSchema.parse(payload).paymentExpenseId).toBe(EXPENSE_ID)
  })
})
