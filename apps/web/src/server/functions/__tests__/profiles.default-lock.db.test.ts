// @vitest-environment node
/**
 * `createDefaultProfileForUser` writes the default profile under the per-user
 * writer lock, and only when a lock-free read finds no live profile (story 80.2,
 * FR130(2), decision D2).
 *
 * It runs on EVERY pull (`routes/api/sync/changes.ts`) and after the Paddle
 * webhook commits (`routes/api/webhooks/paddle.ts`). Before 80.2 its insert was
 * autocommit and unlocked, so it could race the post-batch repair, a promotion
 * or a sync profile create.
 *
 * ⚠️ PGlite is one connection and runs a transaction exclusively, so no test
 * here can show the lock BLOCKING. The lock is guarded by statement order; its
 * blocking is REASONED (`lockUserProfileSet`'s docblock), as in 76.3 and 80.1.
 * The `beforeTransaction` test below re-proves the SEQUENTIAL case only: a
 * profile committed between the lock-free read and the transaction is seen by
 * the re-check under the lock. It is not a race proof.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get db() {
      return holder.db
    },
  }
})

vi.mock('../../api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { createDefaultProfileForUser } from '../profiles'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const WRITER = {
  sql: 'select "id" from "users" where "users"."id" = $1 for no key update',
  params: [USER],
}

let pg: PGlite
let db: ReturnType<typeof drizzle>

/** Runs before a TOP-LEVEL `db.transaction` opens; never inside one. */
const seams = { beforeTransaction: null as null | (() => Promise<void>) }

/** Every statement with its parameters; `BEGIN`/`END` mark top-level transactions. */
const statements: { sql: string; params: unknown[] }[] = []

function withSeams(target: ReturnType<typeof drizzle>) {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === 'transaction') {
        return async (...args: Parameters<typeof obj.transaction>) => {
          const hook = seams.beforeTransaction
          if (hook) await hook()
          statements.push({ sql: 'BEGIN', params: [] })
          try {
            return await obj.transaction(...args)
          } finally {
            statements.push({ sql: 'END', params: [] })
          }
        }
      }
      return Reflect.get(obj, prop, receiver)
    },
  })
}

async function liveProfiles() {
  return db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, USER), eq(userProfiles.isDeleted, false)))
}

const isProfileInsert = (sql: string) => sql.startsWith('insert into "userProfiles"')

beforeAll(async () => {
  pg = new PGlite()
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
  ) as { entries: { idx: number; tag: string }[] }
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await pg.exec(statement)
      }
    }
  }
  db = drizzle(pg)
  const logged = drizzle(pg, {
    logger: {
      logQuery: (query: string, params: unknown[]) => {
        statements.push({ sql: query, params })
      },
    },
  })
  holder.db = withSeams(logged)

  // The lock SELECTs this row, and `userProfiles.userId` references it.
  await db.insert(users).values({
    id: USER,
    email: 'a@example.test',
    paddleId: 'ctm_a',
    subscriptionStatus: 'lifetime',
    currency: 'EUR',
  })
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  await db.delete(userProfiles)
  statements.length = 0
})

afterEach(() => {
  seams.beforeTransaction = null
})

describe('a user with NO live profile: the slow path runs under the writer lock (AC-1)', () => {
  it('creates the default "Main Profile" in the user\'s currency (return shape unchanged)', async () => {
    const result = await createDefaultProfileForUser(USER)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      userId: USER,
      name: 'Main Profile',
      isDefault: true,
      isDeleted: false,
      currency: 'EUR',
    })
    expect((await liveProfiles()).map((row) => row.id)).toEqual([result.data?.id])
  })

  it('the lock is the FIRST statement of the transaction', async () => {
    await createDefaultProfileForUser(USER)

    const begin = statements.findIndex((statement) => statement.sql === 'BEGIN')
    // On `main` there is no transaction at all.
    expect(begin, 'a transaction opened').toBeGreaterThanOrEqual(0)
    expect(statements[begin + 1]).toEqual(WRITER)
  })

  it('WHOLE LOG: one lock-free read, then everything else inside BEGIN..END', async () => {
    await createDefaultProfileForUser(USER)

    const begin = statements.findIndex((statement) => statement.sql === 'BEGIN')
    const end = statements.findIndex((statement) => statement.sql === 'END')
    const insert = statements.findIndex((statement) => isProfileInsert(statement.sql))
    expect(insert, 'the profile INSERT ran').toBeGreaterThanOrEqual(0)
    expect(begin, 'a transaction opened').toBeGreaterThanOrEqual(0)
    expect(insert).toBeGreaterThan(begin + 1)
    expect(insert).toBeLessThan(end)

    // Before BEGIN: exactly the fast-path read, a SELECT (it writes nothing).
    const before = statements.slice(0, begin)
    expect(before).toHaveLength(1)
    expect(before[0]?.sql).toMatch(/^select .* from "userProfiles"/)
    // After END: nothing.
    expect(statements.slice(end + 1)).toEqual([])
    expect(statements.filter((statement) => statement.sql === 'BEGIN')).toHaveLength(1)
  })

  it('stamps updatedAt from the app AFTER the lock, not the transaction-start `now()` default', async () => {
    // ⚠️ Asserted on what reaches the driver, not on the read-back value: in a
    // transaction `now()` is the transaction START (before the lock wait), and a
    // row of the user committed during the wait could move a device's pull cursor
    // (`updatedAt > since`) past this profile (code review 80.2).
    await createDefaultProfileForUser(USER)

    const insert = statements.find((statement) => isProfileInsert(statement.sql))
    expect(insert, 'the profile INSERT ran').toBeDefined()
    const columns = [
      ...(insert?.sql.match(/^insert into "userProfiles" \(([^)]*)\)/)?.[1] ?? '').matchAll(
        /"(\w+)"/g
      ),
    ].map((match) => match[1])
    const values = (insert?.sql.match(/values \(([^)]*)\)/)?.[1] ?? '')
      .split(',')
      .map((v) => v.trim())
    expect(columns).toContain('updatedAt')
    expect(values).toHaveLength(columns.length)
    expect(
      values[columns.indexOf('updatedAt')],
      'updatedAt is a bound value, not `default`'
    ).toMatch(/^\$\d+$/)
  })

  it('re-checks under the lock: a profile committed after the lock-free read is returned, not joined by a second one', async () => {
    // SEQUENTIAL, not a race (see the file docblock): the seam commits a live
    // NON-default profile after the fast path read zero and before the
    // transaction opens. A non-default one, so the unique index cannot absorb
    // a missing re-check: without it, "Main Profile" is inserted beside P.
    let fired = 0
    seams.beforeTransaction = async () => {
      fired++
      seams.beforeTransaction = null
      await db
        .insert(userProfiles)
        .values({ id: P, userId: USER, name: 'Synced', isDefault: false })
    }

    const result = await createDefaultProfileForUser(USER)

    expect(fired, 'the seam fired between the read and the transaction').toBe(1)
    expect((await liveProfiles()).map((row) => row.id)).toEqual([P])
    expect(result).toMatchObject({ success: true, data: { id: P } })
    expect(statements.some((statement) => isProfileInsert(statement.sql))).toBe(false)
  })
})

describe('a user WITH a live profile: the read-only fast path (AC-1 control, D2)', () => {
  it('opens NO transaction and writes nothing', async () => {
    await db.insert(userProfiles).values({ id: P, userId: USER, name: 'Main', isDefault: true })
    statements.length = 0

    const result = await createDefaultProfileForUser(USER)

    expect(result).toMatchObject({ success: true, data: { id: P } })
    // Every pull calls this. A lock here would make each pull conflict with
    // every child create's `FOR SHARE` of the user (story 79.3's reason for
    // `accountLacksLiveDefault`).
    expect(statements.map((statement) => statement.sql)).toHaveLength(1)
    expect(statements[0]?.sql).toMatch(/^select .* from "userProfiles"/)
  })

  it('a tombstoned profile does not count as provisioned (slow path runs)', async () => {
    await db
      .insert(userProfiles)
      .values({ id: P, userId: USER, name: 'Gone', isDefault: true, isDeleted: true })
    statements.length = 0

    const result = await createDefaultProfileForUser(USER)

    expect(result.data).toMatchObject({ name: 'Main Profile', isDefault: true })
    expect(result.data?.id).not.toBe(P)
    expect(statements.filter((statement) => statement.sql === 'BEGIN')).toHaveLength(1)
  })
})
