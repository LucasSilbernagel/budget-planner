/**
 * `maxContributionLimit` is RETIRED from the sync contract (story 49.1, FR75, AC-7).
 *
 * ## Why this file exists — it was forced by a code review, not planned
 *
 * Story 49.1's mutation arm M5 read: *"Re-add `maxContributionLimit` to
 * `syncOperationDataSchema` only. → A gate-inventory assertion. ⚠️ If nothing is
 * red, the sync removal is unguarded — add a gate test modelled on
 * `contribution-flag-gates.test.ts`."*
 *
 * The dev recorded M5 as RED. **It is not.** The mutation that was actually run
 * changed `syncBridge.ts`'s payload — a different arm — and its red result was
 * filed under M5's name. The review re-ran M5 as DEFINED and got GREEN across all
 * 118 sync tests, which is mechanically inevitable: adding an optional key to a
 * non-strict `z.object` changes no parse result, and the test cited as proof pins
 * the BRIDGE payload, which this schema does not shape.
 *
 * ⚠️⚠️ **A red arm on the wrong file lies exactly as a green one does** (story
 * 48.1's HIGH), and mislabelling it made the record worse than silence: it
 * asserted coverage that did not exist. This file is M5's green-branch
 * instruction, executed late.
 *
 * ## The two gates, and why each needs a DIFFERENT assertion shape
 *
 * The removal spans four gates. Two are already guarded elsewhere and are named
 * here so the inventory is complete rather than partial:
 *
 *   1. client sync-queue schema — `packages/core/src/sync/types.ts`   ← HERE
 *   2. server ingest schema     — `apps/web/src/server/api/sync.ts`   ← HERE
 *   3. syncBridge payload       — pinned by the exact-key-set assertion in
 *      `syncBridge.test.ts` ("puts exactly the balanceTracking columns on the wire")
 *   4. the `packages/db` column — pinned by the exact-column-set assertion in
 *      `packages/db/src/schema.test.ts`
 *
 * ⚠️ Gates 1 and 2 behave differently and a single assertion shape cannot cover
 * both. Gate 1 is a plain `z.object`, which **STRIPS** unknown keys — so absence
 * is proven by parsing a payload that carries the key and finding it gone from the
 * RESULT. Gate 2 validates inside a `superRefine` that **DISCARDS** its parse
 * result (see `contribution-flag-gates.test.ts` for the measurement), so nothing
 * is ever stripped there; absence is proven instead by showing a value that the
 * OLD declaration would have REJECTED is now accepted.
 *
 * ⚠️ Every assertion below is paired with an acceptance partner over the SAME
 * fixture, so a malformed base row cannot make a rejection-or-acceptance claim
 * pass for the wrong reason — the trap `finance-type-gates.test.ts` records
 * falling into.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { describe, expect, it } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'

const USER_ID = '11111111-1111-4111-8111-111111111111'

/** A minimal, otherwise-valid investment balanceTracking row (post-49.1 shape). */
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
  /**
   * MUTATION KILLED (M5b): re-add
   * `maxContributionLimit: z.number().int().positive().max(PG_INT32_MAX).optional()`
   * to `syncOperationDataSchema`. The key then SURVIVES the parse and this fails.
   */
  it('STRIPS a maxContributionLimit that a stale client still sends', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, maxContributionLimit: 500_000 })

    expect(parsed).not.toHaveProperty('maxContributionLimit')
  })

  it('still accepts the row itself — the strip is not a rejection', () => {
    // The acceptance partner. Without it, a base row broken for some unrelated
    // reason would make the assertion above pass by throwing before it matters.
    const parsed = syncOperationDataSchema.parse({ ...baseRow, maxContributionLimit: 500_000 })

    expect(parsed.name).toBe('TFSA')
    expect(parsed.currentBalance).toBe(1_000_000)
    expect(parsed.monthlyContribution).toBe(50_000)
  })

  it('strips it on an UPDATE-shaped partial payload too', () => {
    // A partial op carries only the changed fields; the retired key must not
    // survive on that path either, since `updateEntity` does a partial `.set()`.
    const parsed = syncOperationDataSchema.parse({
      currentBalance: 42,
      maxContributionLimit: 500_000,
    })

    expect(parsed).not.toHaveProperty('maxContributionLimit')
    expect(parsed.currentBalance).toBe(42)
  })
})

describe('Gate 2 — the server ingest schema no longer validates the limit', () => {
  /**
   * ⚠️ The server gate VALIDATES rather than strips, so "the key is gone" cannot
   * be shown by inspecting `parsed.data` — the superRefine discards its parse
   * result and `data` comes back raw. What CAN be shown is the loss of the
   * declaration's REJECTION power.
   *
   * The retired declaration was `z.number().int().optional()` on the entity
   * schema, so a NON-INTEGER limit used to be rejected at this boundary. It is
   * now waved through as an unknown key.
   *
   * MUTATION KILLED (M5c): re-add `maxContributionLimit: z.number().int()` to
   * `balanceTrackingSchema` in `server/api/sync.ts` — the first case starts
   * throwing again and this fails.
   */
  it('accepts a payload whose limit value the old declaration would have REJECTED', () => {
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, maxContributionLimit: 1.5 }))
    ).not.toThrow()
  })

  it('still REJECTS a genuinely malformed row, so the acceptance above is not blanket', () => {
    // The partner assertion. If the server gate had stopped validating
    // `balanceTracking` altogether, the case above would pass for the wrong
    // reason — this proves the gate is still live on the surviving fields.
    expect(() => syncOperationSchema.parse(op({ ...baseRow, currentBalance: 'lots' }))).toThrow()
    expect(() => syncOperationSchema.parse(op(baseRow))).not.toThrow()
  })
})
