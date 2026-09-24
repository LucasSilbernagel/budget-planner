/**
 * `endsBeforeRetirement` sync-contract gates (Story 65.2, FR101).
 *
 * ## Why this file exists
 *
 * A new persisted field on a synced entity is a **SIX-gate** change, and the
 * epic's own AC enumerated only five. The omitted one is the gate that fires
 * FIRST and fails SILENTLY:
 *
 *   1. the db column + migration        — `packages/db/src/schema.ts` (pinned in that package)
 *   2. core's per-entity mirror         — `packages/core/src/sync/types.ts` `expenseSchema`
 *   3. core's RUNTIME queue gate        — `packages/core/src/sync/types.ts` `syncOperationDataSchema`  ← the omitted one
 *   4. the server ingest schema         — `apps/web/src/server/api/sync.ts` `expenseSchema`
 *   5. the syncBridge payload whitelist — `apps/web/src/lib/sync/syncBridge.ts`
 *   6. the client types                 — `apps/web/src/stores/expenseStore.ts` (compile-level)
 *
 * `z.object` STRIPS undeclared keys and `toServerPayload` returns
 * `Record<string, unknown>`, so a forgotten field is **not a type error
 * anywhere**. Miss gate 3 and the flag never even reaches the queue: the user
 * ticks "ends before I retire", the row persists locally, and the tick simply
 * never leaves the device. Structure follows `contribution-flag-gates.test.ts`
 * (story 45.1), the boolean precedent this field copies.
 *
 * ⚠️ NOTHING HERE CLAIMS A LIVE ROUND-TRIP SUCCEEDS. These are contract tests on
 * each gate individually, which is the strongest claim this harness supports.
 * The live round trip is recorded separately in the story's Dev Agent Record.
 */

import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
  clearSyncBridge,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityUpdate,
} from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** A minimal, otherwise-valid expense row. */
const baseRow = {
  name: 'Mortgage',
  amount: 180_000,
  frequency: 'monthly' as const,
  userId: USER_ID,
}

const op = (data: Record<string, unknown>) => ({
  id: '22222222-2222-4222-8222-222222222222',
  type: 'create' as const,
  entityType: 'expense' as const,
  entityId: ROW_ID,
  data,
  timestamp: 1_700_000_000_000,
  deviceId: 'device-1',
  userId: USER_ID,
})

function makeHandle() {
  return {
    userId: USER_ID,
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
  clearSyncBridge()
  handle = makeHandle()
  registerSyncBridge(handle)
})

const expenseRow = (extra: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  userId: 0,
  name: 'Mortgage',
  amount: 180_000,
  frequency: 'monthly' as const,
  categoryId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

/**
 * GATE 3 — `syncOperationDataSchema` (packages/core/src/sync/types.ts).
 *
 * ⚠️⚠️ THE ONE THE EPIC OMITTED, and the most dangerous of the six: this gate
 * STRIPS undeclared keys, and it runs inside `validateOperationData`
 * (`synchronization.ts:116-117`) BEFORE the operation is queued.
 */
describe('Gate 3 — core’s runtime queue gate does not strip the flag', () => {
  it('preserves endsBeforeRetirement: true rather than stripping it', () => {
    const parsed = syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: true })
    expect(parsed.endsBeforeRetirement).toBe(true)
  })

  it('preserves endsBeforeRetirement: false rather than stripping it', () => {
    // ⚠️ `false` is the arm that matters most. A schema that dropped the key
    // would look correct in the `true` case (the column defaults to false) and
    // silently fail to UNTICK — the direction that restores the user's real
    // retirement figure. `toBe(false)` alone does not prove the key survived.
    const parsed = syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: false })
    expect(parsed).toHaveProperty('endsBeforeRetirement')
    expect(parsed.endsBeforeRetirement).toBe(false)
  })

  it('leaves the key absent when the payload omits it (partial update)', () => {
    const parsed = syncOperationDataSchema.parse(baseRow)
    expect(parsed.endsBeforeRetirement).toBeUndefined()
  })

  it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
    // Acceptance partner over the SAME fixture, so a malformed base row cannot
    // make the rejection pass vacuously (story 43.4's recorded failure).
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: 'yes' })
    ).toThrow()
    expect(() =>
      syncOperationDataSchema.parse({ ...baseRow, endsBeforeRetirement: true })
    ).not.toThrow()
  })
})

/**
 * GATE 4 — the server ingest schema (`apps/web/src/server/api/sync.ts`).
 */
describe('Gate 4 — the server ingest schema validates the flag and keeps it in data', () => {
  it('passes endsBeforeRetirement: true through UNSTRIPPED', () => {
    const parsed = syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: true }))
    expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBe(true)
  })

  it('passes an explicit false through unchanged', () => {
    const parsed = syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: false }))
    expect(parsed.data as Record<string, unknown>).toHaveProperty('endsBeforeRetirement')
    expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBe(false)
  })

  it('⚠️ does NOT default an omitted flag — the superRefine DISCARDS its parse result', () => {
    // MEASURED for `contributionRecordedAsExpense` in story 45.1 and re-asserted
    // here for this field: `syncOperationSchema` declares `data:
    // z.record(z.unknown())` and validates the entity shape inside a
    // `superRefine`, which throws on bad input but throws away the parsed
    // (defaulted) value. So the server's `.default(false)` NEVER reaches
    // `parsed.data`. That is precisely why gate 5 must stamp the value itself
    // (with `=== true`; see the Gate 5 block below for why NOT `?? false`).
    const parsed = syncOperationSchema.parse(op(baseRow))
    expect((parsed.data as Record<string, unknown>)['endsBeforeRetirement']).toBeUndefined()
  })

  it('REJECTS a non-boolean, while the same fixture is otherwise accepted', () => {
    expect(() => syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: 1 }))).toThrow()
    expect(() =>
      syncOperationSchema.parse(op({ ...baseRow, endsBeforeRetirement: false }))
    ).not.toThrow()
  })
})

/**
 * GATE 5 — `toServerPayload` (syncBridge.ts).
 *
 * ⚠️ The flag is emitted UNCONDITIONALLY, never behind an `if`. `updateEntity`
 * does a PARTIAL `.set()` and `JSON.stringify` DROPS an `undefined`-valued key,
 * so an omitted key leaves the previous server value in place — ticking would
 * work while unticking silently would not.
 *
 * ⚠️⚠️ The coercion is `=== true`, NOT `?? false`, and the difference is the
 * whole point of the last test in this block. `?? false` only coerces
 * null/undefined, so a persisted non-boolean (`"false"` is a truthy STRING, and
 * localStorage is user-editable) rode through to `syncOperationDataSchema`'s
 * `z.boolean()` and was REJECTED inside `validateOperationData` before
 * `queue.add` — silently stopping sync for that row entirely, including edits
 * that merely spread the bad value through. Code review 65.2 found that the
 * `=== true` fix had NO test and that reverting it left the whole suite green,
 * so the revert test below exists to make that impossible.
 */
describe('Gate 5 — the push payload carries the flag, in both directions', () => {
  it('update forwards a ticked flag', () => {
    syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: true }))
    expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(payload['endsBeforeRetirement']).toBe(true)
    // The rest of the row still rides along — a new field must not displace the
    // existing ones.
    expect(payload['name']).toBe('Mortgage')
    expect(payload['amount']).toBe(180_000)
    expect(payload['frequency']).toBe('monthly')
  })

  it('create forwards a ticked flag', () => {
    syncEntityCreate('expense', expenseRow({ endsBeforeRetirement: true }))
    expect(handle.queueCreate).toHaveBeenCalledTimes(1)
    expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ endsBeforeRetirement: true })
  })

  it('⚠️ UNTICKING sends an explicit false — the untick actually clears the server value', () => {
    syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: false }))
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(Object.hasOwn(payload, 'endsBeforeRetirement')).toBe(true)
    expect(payload['endsBeforeRetirement']).toBe(false)
  })

  it.each([
    ['undefined', undefined],
    ['absent', 'OMIT' as const],
  ])(
    '⚠️ an UNSTAMPED row (%s) still puts an explicit false on the wire, not an undefined',
    (_label, value) => {
      const row = value === 'OMIT' ? expenseRow() : expenseRow({ endsBeforeRetirement: undefined })
      syncEntityUpdate('expense', row)
      const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
      // `JSON.stringify` drops an undefined-valued key, so "present but
      // undefined" is the same wire outcome as "absent" — both must coerce.
      expect(payload['endsBeforeRetirement']).toBe(false)
      expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('endsBeforeRetirement', false)
    }
  )

  it.each([
    ['a truthy "false" string', 'false'],
    ['a "true" string', 'true'],
    ['the number 1', 1],
    ['an empty string', ''],
  ])(
    '⚠️⚠️ coerces %s to a real boolean rather than forwarding it (code review 65.2)',
    (_label, junk) => {
      // ⚠️ THIS TEST EXISTS BECAUSE THE FIX HAD NONE. Reverting the bridge to
      // `?? false` left all 166 sync tests green — the coercion was completely
      // unprotected, while three comments still instructed the next author to
      // write `?? false`.
      //
      // Junk is reachable: localStorage is user-editable, which is the stated
      // reason every READ path checks `=== true`. Forwarded uncoerced, the
      // client queue gate rejects the whole operation before it is queued, so
      // the row reads as unmarked while ALL of its edits stop syncing.
      syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: junk }))
      const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
      expect(payload['endsBeforeRetirement']).toBe(false)
      // …and the payload still passes the gate it would otherwise have failed.
      expect(() => syncOperationDataSchema.parse({ ...payload, userId: USER_ID })).not.toThrow()
    }
  )

  it('⚠️ does NOT put the flag on an incomeSource payload — income has no such column', () => {
    // D4, MEASURED rather than assumed: drizzle silently DROPS a key that is not
    // a column (probe against `incomeSources`: `update … set "name" = $1` — the
    // unknown key never reaches the SQL), so a shared arm would not have thrown.
    // The arm is split anyway, because a payload that declares a field the
    // entity does not have is a latent trap: the server's `incomeSourceSchema`
    // does not declare it, so any future `.strict()` there would break ALL
    // income sync for a key that never meant anything.
    syncEntityUpdate('incomeSource', expenseRow({ endsBeforeRetirement: true }))
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(Object.hasOwn(payload, 'endsBeforeRetirement')).toBe(false)
    // …while the income row's own fields are untouched by the split.
    expect(payload['name']).toBe('Mortgage')
    expect(payload['amount']).toBe(180_000)
    expect(payload['frequency']).toBe('monthly')
    expect(payload['sortOrder']).toBe(0)
  })
})

/**
 * GATE 2 — core's per-entity mirror (`expenseSchema`).
 *
 * ⚠️⚠️ NO LONGER UNEXERCISED, and this test changed with it. When 65.2 wrote
 * these cases, gate 2 was parity documentation that nothing imported, so
 * `.default(false)` was harmless. Story 66.2 made gate 2 the PULL gate, and its
 * code review then found `.default()` to be a hole rather than a convenience: a
 * default makes the KEY OPTIONAL, so a server row that omitted the field passed
 * the guard and entered the store with the key absent. The rule now is
 * **required iff the column is NOT NULL**, and `expenses.endsBeforeRetirement`
 * is NOT NULL — a pulled row always carries it.
 *
 * The flag is still six-gated and the parity obligation is unchanged; what moved
 * is which behaviour is correct on the READ side. The push-side default lives on
 * in `syncOperationDataSchema` and in `toServerPayload`'s unconditional `=== true`
 * stamp, both still pinned below.
 */
describe('Gate 2 — core’s per-entity expense mirror declares the flag', () => {
  it('REFUSES a row that omits the flag (the pull gate wants a complete row)', async () => {
    const { expenseSchema } = await import('@budget-planner/core/sync/types')
    expect(expenseSchema.safeParse(baseRow).success).toBe(false)
  })

  it('accepts an explicit false', async () => {
    const { expenseSchema } = await import('@budget-planner/core/sync/types')
    expect(
      expenseSchema.parse({ ...baseRow, endsBeforeRetirement: false }).endsBeforeRetirement
    ).toBe(false)
  })

  it('preserves an explicit true', async () => {
    const { expenseSchema } = await import('@budget-planner/core/sync/types')
    expect(
      expenseSchema.parse({ ...baseRow, endsBeforeRetirement: true }).endsBeforeRetirement
    ).toBe(true)
  })
})

/**
 * GATE 1 — the column, reached through the REAL chain.
 *
 * ⚠️⚠️ THIS IS NOT THE ROUND TRIP, AND IT MUST NOT BE CITED AS ONE — but the
 * round trip DOES exist: see `ends-before-retirement-roundtrip.test.ts`, which
 * replays the committed migration chain onto PGlite (genuine PostgreSQL,
 * in-process, no server or credentials) and drives this same payload into a real
 * database, in both directions.
 *
 * ⚠️ CORRECTED BY CODE REVIEW 65.2. This docblock previously said the round trip
 * could not run here "no psql, no docker, no DATABASE_URL" and that the story
 * recorded AC-5 as NOT RUN. Both statements were FALSE by the time this file was
 * committed — the author reached that conclusion, then found PGlite already in
 * use by `packages/db/src/migration-replay.test.ts` and wrote the round trip, but
 * never came back to this comment. A false claim left in a comment is guidance,
 * and the next author would have trusted it.
 *
 * What this file DOES do is chain three gates that a green unit suite otherwise
 * checks only in isolation, using production code at every step:
 *
 *   toServerPayload()  ->  syncOperationSchema.parse()  ->  updateEntity()'s own
 *   field destructuring  ->  drizzle's real SQL builder
 *
 * and assert the column name appears in the generated SQL. That closes the
 * specific hole the `profileId` root cause fell through — where each gate passed
 * its own test and the field still never reached a column — for everything
 * except the database's own reply.
 */
describe('Gate 1 — the flag survives payload -> server schema -> generated SQL', () => {
  it('reaches the UPDATE statement as a real column', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { eq, and } = await import('drizzle-orm')
    const { expenses } = await import('@budget-planner/db')
    const db = drizzle({} as never)

    syncEntityUpdate('expense', expenseRow({ endsBeforeRetirement: true }))
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>

    // The server's own parse, then the exact destructuring `updateEntity` does
    // (`sync.ts`: drop id/profileId/userId, re-stamp userId and updatedAt).
    const parsed = syncOperationSchema.parse(op({ ...payload, userId: USER_ID }))
    const data = parsed.data as Record<string, unknown>
    const { id: _id, profileId: _p, userId: _u, ...fields } = data
    const updateData = { ...fields, userId: USER_ID, updatedAt: new Date() }

    const sql = db
      .update(expenses)
      // @ts-expect-error - the production call site is `@ts-expect-error`-free
      // only because `data` is `Record<string, unknown>`; mirror that here.
      .set(updateData)
      .where(and(eq(expenses.userId, USER_ID), eq(expenses.id, ROW_ID)))
      .toSQL().sql

    expect(sql).toContain('"endsBeforeRetirement"')
    // ⚠️ The negative control that makes this non-vacuous: drizzle SILENTLY DROPS
    // a key that is not a column (measured — see the D4 note in syncBridge.ts), so
    // a missing db column would produce valid SQL with the field absent and no
    // error anywhere. Asserting a sibling column proves the statement was built.
    expect(sql).toContain('"name"')
  })

  it('reaches the INSERT statement as a real column', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { expenses } = await import('@budget-planner/db')
    const db = drizzle({} as never)

    syncEntityCreate('expense', expenseRow({ endsBeforeRetirement: true }))
    const payload = handle.queueCreate.mock.calls[0][2] as Record<string, unknown>
    const parsed = syncOperationSchema.parse(op({ ...payload, userId: USER_ID }))

    const sql = db
      .insert(expenses)
      // @ts-expect-error - dynamic insert, as at the production call site
      .values({
        ...(parsed.data as Record<string, unknown>),
        id: ROW_ID,
        userId: USER_ID,
        profileId: USER_ID,
        updatedAt: new Date(),
      })
      .toSQL().sql

    expect(sql).toContain('"endsBeforeRetirement"')
    expect(sql).toContain('"name"')
  })
})
