/**
 * `asset` finance-type sync-contract gates (Story 43.4, FR70, AC-6).
 *
 * ## Why this file exists
 *
 * Adding a third value to `financeTypeEnum` produced **exactly one** TypeScript
 * error across the entire monorepo — in `getTypeDisplayProperties`'s
 * `Record<FinanceType, …>`, a core function no production code calls. Every
 * other place that constrains the finance type does so with a construct the
 * compiler cannot check against the enum:
 *
 *   - `z.enum([...])` infers its OWN literal union, unrelated to `FinanceType`
 *   - `const validTypes: FinanceType[] = ['investment', 'debt']` is a legal SUBSET
 *   - `KNOWN_FINANCE_TYPES: ReadonlySet<string>` erases the union entirely
 *
 * And before this file, **nothing in the suite pinned an enum VALUE at any gate**
 * (`schema.test.ts` asserted only `expect(financeTypeEnum).toBeDefined()`). So a
 * missed gate left all 2084 web tests and all 858 core tests green while asset
 * rows silently never left the device.
 *
 * ⚠️ The silent-drop path is the reason this matters more than a normal contract
 * test. `syncOperationDataSchema.parse()` runs inside `queueCreate` BEFORE
 * `queue.add()`, and `syncBridge`'s `onQueueError` catches the ZodError into a
 * bare `console.error`. The local edit persists to localStorage and succeeds
 * visibly; the row simply never syncs, with no toast, no error state, no retry
 * and nothing in the sync status UI. Forever.
 *
 * ⚠️ NOTHING HERE CLAIMS A LIVE ROUND-TRIP SUCCEEDS. Server-side sync CREATE is
 * broken for all four financial entities today (`syncOperationSchema` declares no
 * `profileId`, so `createEntity` inserts `undefined` against a NOT NULL column —
 * pre-existing, see `sort-order-gates.test.ts:4-11`). These are contract tests on
 * each gate individually, which is the strongest claim this harness supports.
 * Structure follows `sort-order-gates.test.ts`.
 */

import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { ALL_FINANCE_TYPES, financeTypeEnum } from '@budget-planner/db/src/schema'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'

/** A minimal, otherwise-valid balanceTracking row. */
const baseRow = {
  name: 'Condo',
  currentBalance: 40_000_000,
  monthlyContribution: 0,
  frequency: 'monthly' as const,
  userId: '11111111-1111-4111-8111-111111111111',
}

// ⚠️ The OPERATION's own `type` is create/update/delete and collides by name with
// the BALANCE ROW's `type`, which lives inside `data`. Getting this wrong makes
// the whole op invalid, and a "rejects an unknown type" assertion then passes for
// entirely the wrong reason — which is exactly what the first draft of this file
// did until the accept-cases went red beside it.
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
    // ⚠️ core restates this list rather than importing the db barrel at runtime:
    // the barrel re-exports `client.ts`, which THROWS when `window` is defined,
    // and core is client-bundled. The compile-time `Exclude` check in
    // `balanceTracking.ts` catches omissions; this catches drift in ORDER and
    // VALUE that the type system cannot see.
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
    // The gate must stay a gate. If widening it to accept `asset` had instead
    // loosened it to `z.string()`, this test is what notices.
    expect(() => syncOperationDataSchema.parse({ ...baseRow, type: 'crypto' })).toThrow()
  })
})

describe('Gate 3 — the server ingest schema', () => {
  it.each([...ALL_FINANCE_TYPES])('accepts a balanceTracking op of type %s', (type) => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, type }))).not.toThrow()
  })

  it('passes the asset type through UNSTRIPPED to the insert path', () => {
    // `superRefine` discards its callback's return value, so `data` survives
    // unstripped and `applyOperation` reads this raw record — see
    // `sort-order-gates.test.ts`'s correction note.
    const parsed = syncOperationSchema.parse(op({ ...baseRow, type: 'asset' }))
    expect((parsed.data as Record<string, unknown>).type).toBe('asset')
  })

  it('still REJECTS a genuinely unknown type', () => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, type: 'crypto' }))).toThrow()
  })
})
