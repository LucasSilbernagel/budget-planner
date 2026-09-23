/**
 * `endsBeforeRetirement` — a REAL round trip against PostgreSQL (Story 65.2, AC-5).
 *
 * ## Why a contract test was not enough
 *
 * AC-5 refuses a green unit suite as proof, and it is right to. The sync-push
 * root cause on record is exactly this shape: the SERVER push schema stripped
 * `profileId`, every gate passed its own test, and the failure looked
 * client-side for days. Four of this field's five failure modes are green on a
 * full unit run. Only a write that comes back out of a database separates them.
 *
 * ## What this runs against
 *
 * PGlite — genuine PostgreSQL compiled to WebAssembly, reporting the same MAJOR
 * version as the managed instance, running in-process with no server, no Docker
 * and no credentials (see `packages/db/src/migration-replay.test.ts` for the
 * full rationale; this file reuses its journal-replay approach). The DDL applied
 * here is the committed migration chain, including `0019`, not a hand-written
 * CREATE TABLE — so the column under test is the one a deploy would create.
 *
 * ## What it exercises, and what it does not
 *
 * Exercised, in production code: `toServerPayload` (the push payload),
 * `syncOperationSchema` (the server's ingest gate), the field destructuring
 * `updateEntity` performs, and drizzle's real INSERT/UPDATE/SELECT against the
 * migrated schema — in both directions, set AND clear.
 *
 * NOT exercised: HTTP, auth, the `db` client singleton, the queue's retry and
 * circuit-breaker behaviour, and the managed instance's own minor version,
 * extensions and TLS. Those stay live verifications. This is a round trip
 * through the schema and the sync contract, not through the deployment.
 */

import { readFileSync } from 'node:fs'
import { expenses } from '@budget-planner/db'
import { PGlite } from '@electric-sql/pglite'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import { useExpenseStore } from '../../../stores/expenseStore'
import { applyServerChangesToStores } from '../applyServerChanges'
import { clearSyncBridge, registerSyncBridge, syncEntityUpdate } from '../syncBridge'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '99999999-9999-4999-8999-999999999999'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

interface JournalEntry {
  idx: number
  tag: string
}

const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
  entries: JournalEntry[]
}

/** Statements for one migration, split on drizzle's own breakpoint marker. */
function statementsFor(tag: string): string[] {
  return readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
}

let pg: PGlite
let db: ReturnType<typeof drizzle>

beforeAll(async () => {
  pg = await PGlite.create()
  // The whole committed chain, in one transaction, mirroring drizzle's migrator.
  await pg.exec('BEGIN')
  for (const entry of journal.entries) {
    for (const statement of statementsFor(entry.tag)) {
      await pg.exec(statement)
    }
  }
  await pg.exec('COMMIT')
  db = drizzle(pg)

  // Minimal owning rows for the two NOT NULL foreign keys.
  await pg.exec(`
    INSERT INTO "users" ("id", "email", "paddleId")
      VALUES ('${USER_ID}', 'roundtrip@example.com', 'ctm_roundtrip_65_2');
    INSERT INTO "userProfiles" ("id", "userId", "name", "currency")
      VALUES ('${PROFILE_ID}', '${USER_ID}', 'Main Profile', 'USD');
  `)
}, 120_000)

afterAll(async () => {
  await pg?.close()
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

const clientRow = (endsBeforeRetirement: boolean | undefined) => ({
  id: ROW_ID,
  userId: 0,
  name: 'Mortgage',
  amount: 180_000,
  frequency: 'monthly' as const,
  categoryId: null,
  sortOrder: 0,
  endsBeforeRetirement,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** Push one client-side update through the real payload + server gate, then write. */
async function pushUpdate(endsBeforeRetirement: boolean | undefined): Promise<void> {
  syncEntityUpdate('expense', clientRow(endsBeforeRetirement))
  const payload = handle.queueUpdate.mock.calls[0]?.[2] as Record<string, unknown>

  const parsed = syncOperationSchema.parse({
    id: '22222222-2222-4222-8222-222222222222',
    type: 'update' as const,
    entityType: 'expense' as const,
    entityId: ROW_ID,
    data: { ...payload, userId: USER_ID },
    timestamp: 1_700_000_000_000,
    deviceId: 'device-a',
    userId: USER_ID,
    profileId: PROFILE_ID,
  })

  // `updateEntity`'s own destructuring: drop the identity columns a client must
  // never be able to rewrite, re-stamp userId and updatedAt.
  const data = parsed.data as Record<string, unknown>
  const { id: _id, profileId: _p, userId: _u, ...fields } = data
  await db
    .update(expenses)
    // @ts-expect-error - dynamic update, exactly as at the production call site
    .set({ ...fields, userId: USER_ID, updatedAt: new Date() })
    .where(and(eq(expenses.userId, USER_ID), eq(expenses.id, ROW_ID)))
}

/** What a second device would pull: the row as the database actually holds it. */
async function pullRow() {
  const rows = await db.select().from(expenses).where(eq(expenses.id, ROW_ID))
  return rows[0]
}

/**
 * The row as it reaches device B's STORE, through the real client pull applier.
 *
 * ⚠️ ADDED BY CODE REVIEW 65.2. `pullRow` above is a bare `SELECT` — it proves
 * the column holds the value, but it bypasses both halves of the pull direction,
 * and all six gates this story enumerated are PUSH-direction. The review was
 * right that "round trip" overstated what was being exercised.
 *
 * Both halves were also checked by reading, and neither needs a seventh gate:
 * the server pull is a bare `.select()` with no column list (`sync.ts:1698`), and
 * `applyOne` spreads the server row wholesale (`applyServerChanges.ts:97`). This
 * asserts that rather than asserting it in a comment.
 */
async function pullIntoStore(): Promise<Record<string, unknown> | undefined> {
  const row = await pullRow()
  useExpenseStore.setState({ expenses: [] })
  applyServerChangesToStores([
    {
      entityType: 'expense',
      entityId: ROW_ID,
      // The server serializes whole rows; this is that payload.
      data: row as unknown as Record<string, unknown>,
      updatedAt: Date.now(),
      isDeleted: false,
    },
  ])
  return useExpenseStore.getState().expenses[0] as unknown as Record<string, unknown>
}

describe('endsBeforeRetirement — device A writes, the database answers', () => {
  it('⚠️ the column exists on a freshly migrated database and defaults FALSE', async () => {
    await db.insert(expenses).values({
      id: ROW_ID,
      userId: USER_ID,
      profileId: PROFILE_ID,
      name: 'Mortgage',
      amount: 180_000,
      frequency: 'monthly',
    })
    // The default is the whole migration-safety property: every row that existed
    // before 0019 stays counted in the retirement target.
    expect((await pullRow())?.endsBeforeRetirement).toBe(false)
  })

  it('a TICK pushed from device A is what device B pulls back', async () => {
    await pushUpdate(true)
    expect((await pullRow())?.endsBeforeRetirement).toBe(true)
  })

  it('⚠️⚠️ an UNTICK pushed from device A actually CLEARS it for device B', async () => {
    // THE direction that breaks when the payload is built behind an `if`, or
    // when the key is omitted: `updateEntity` does a PARTIAL `.set()`, so the
    // previous `true` would survive and every other device would go on excluding
    // the expense from the user's retirement target. Forever, with no error.
    await pushUpdate(true)
    expect((await pullRow())?.endsBeforeRetirement).toBe(true)

    handle.queueUpdate.mockClear()
    await pushUpdate(false)
    expect((await pullRow())?.endsBeforeRetirement).toBe(false)
  })

  it('⚠️ an UNSTAMPED row (pre-65.2, no key at all) clears rather than leaving a stale true', async () => {
    // Rows persisted before this story carry no key, and `JSON.stringify` drops
    // an undefined-valued one — so without the bridge's coercion to a real
    // boolean this push would silently leave the server's `true` in place.
    await pushUpdate(true)
    expect((await pullRow())?.endsBeforeRetirement).toBe(true)

    handle.queueUpdate.mockClear()
    await pushUpdate(undefined)
    expect((await pullRow())?.endsBeforeRetirement).toBe(false)
  })

  it('⚠️ device B\u2019s STORE receives the flag through the real pull applier', async () => {
    await pushUpdate(true)
    expect((await pullIntoStore())?.['endsBeforeRetirement']).toBe(true)

    handle.queueUpdate.mockClear()
    await pushUpdate(false)
    expect((await pullIntoStore())?.['endsBeforeRetirement']).toBe(false)
  })

  it('the flag does not disturb the rest of the row', async () => {
    await pushUpdate(true)
    const row = await pullRow()
    expect(row?.name).toBe('Mortgage')
    expect(row?.amount).toBe(180_000)
    expect(row?.frequency).toBe('monthly')
    expect(row?.profileId).toBe(PROFILE_ID)
  })
})
