// @vitest-environment node
/**
 * The server's profile-deletion rules hold when two pushes interleave (story
 * 76.3, FR122).
 *
 * ## ⚠️⚠️ WHAT THIS FILE CAN AND CANNOT PROVE
 *
 * PGlite is ONE connection, so this is not two PostgreSQL transactions racing.
 * What it CAN do is interleave two request HANDLERS: `processBatchSync` awaits
 * every statement, so two pushes run with `Promise.all` interleave at statement
 * granularity wherever they are OUTSIDE a transaction. That is the defect
 * class: both rules used to be checked outside the transaction that acted on
 * them. The seams below force the interleaving deterministically, and each test
 * asserts its seam was CONSUMED, so a test cannot pass because the interleaving
 * never happened.
 *
 * What it CANNOT do is prove the per-user LOCK (`lockUserProfileSet` in
 * `sync.ts`). PGlite runs a whole transaction exclusively (MEASURED 2026-09-28:
 * a query issued while a transaction is open waits for it to end), so once a
 * check moves INSIDE the transaction these tests go green with or without the
 * lock. On real PostgreSQL under READ COMMITTED, an unlocked in-transaction
 * count is still racy. The lock is therefore guarded by the statement-order
 * tests at the bottom of this file, and its blocking behaviour is REASONED from
 * the PostgreSQL row-lock matrix (see the helper's docblock), NOT measured.
 * Decision D1 (Lucas, 2026-09-28): no real-PostgreSQL harness.
 *
 * Harness (PGlite + full migration chain via a `vi.hoisted` holder) copied from
 * `sync-delete-idempotent.db.test.ts`.
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

vi.mock('@/server/rate-limit/db-window', () => ({
  checkDbRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  balanceTracking,
  categories,
  expenses,
  incomeSources,
  savingsGoals,
  userProfiles,
  users,
} from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW = '10000000-0000-4000-8000-000000000001'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

/**
 * Hooks the proxy below runs before a TOP-LEVEL `db.transaction` or a top-level
 * `db.insert(...).values(...)`. A `tx.*` call never reaches them: the handle a
 * transaction callback receives is drizzle's own object, not this proxy. So a
 * hook only ever fires OUTSIDE a transaction, where awaiting another push
 * cannot deadlock PGlite's exclusive transaction.
 */
const seams = {
  beforeTransaction: null as null | (() => Promise<void>),
  beforeInsert: null as null | (() => Promise<void>),
}

/**
 * Statement log for the lock-order guard, with each statement's parameters;
 * `BEGIN`/`END` mark top-level transactions.
 */
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
      if (prop === 'insert') {
        return (table: Parameters<typeof obj.insert>[0]) => {
          const builder = obj.insert(table)
          return new Proxy(builder, {
            get(b, key, r) {
              if (key !== 'values') return Reflect.get(b, key, r)
              return (values: never) => {
                const query = b.values(values)
                const hook = seams.beforeInsert
                if (!hook) return query
                // `createEntity` only awaits the query, so a thenable is enough.
                return {
                  then: (ok: never, ko: never) =>
                    hook()
                      .then(() => query)
                      .then(ok, ko),
                }
              }
            },
          })
        }
      }
      return Reflect.get(obj, prop, receiver)
    },
  })
}

function op(overrides: Record<string, unknown>) {
  opCounter++
  return {
    id: `op-${opCounter}`,
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    data: { userId: USER },
    ...overrides,
  }
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
}

const deleteProfile = (id: string) =>
  op({ type: 'delete', entityType: 'userProfile', entityId: id })

const createIncome = (profileId: string) =>
  op({
    type: 'create',
    entityType: 'incomeSource',
    entityId: ROW,
    profileId,
    data: { name: 'Salary', amount: 500_000, frequency: 'monthly', sortOrder: 0, userId: USER },
  })

async function profiles() {
  return db
    .select({
      id: userProfiles.id,
      isDeleted: userProfiles.isDeleted,
      isDefault: userProfiles.isDefault,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, USER))
}

/**
 * A two-party barrier: the first caller waits until the second arrives, then
 * both proceed. Returns how many parties have arrived, so a test can prove the
 * barrier was reached by BOTH pushes.
 */
function barrier() {
  let arrived = 0
  let release: () => void = () => {}
  const open = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    arrived: () => arrived,
    async wait() {
      arrived++
      if (arrived >= 2) release()
      await open
    },
  }
}

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

  await db.insert(users).values({
    id: USER,
    email: 'a@example.test',
    paddleId: 'ctm_a',
    subscriptionStatus: 'lifetime',
  })
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  for (const table of [incomeSources, expenses, categories, savingsGoals, balanceTracking]) {
    await db.delete(table)
  }
  await db.delete(userProfiles)
  // A 2-profile account: the shape where two concurrent deletes used to leave ZERO.
  await db.insert(userProfiles).values([
    { id: P, userId: USER, name: 'Main', isDefault: true, createdAt: new Date('2020-01-01') },
    { id: Q, userId: USER, name: 'Q', isDefault: false, createdAt: new Date('2020-02-01') },
  ])
  statements.length = 0
})

afterEach(() => {
  seams.beforeTransaction = null
  seams.beforeInsert = null
})

describe('two devices delete the two profiles of a 2-profile account at once (AC-1)', () => {
  it('exactly one delete takes effect; the account keeps one live profile and one default', async () => {
    // Both pushes are held at their first transaction until BOTH have arrived
    // there, i.e. both have finished everything they do outside a transaction.
    // Before 76.3 that included the last-profile count, so both counted 2.
    const gate = barrier()
    let calls = 0
    seams.beforeTransaction = async () => {
      calls++
      // Only the two pushes' first transactions; later ones (the post-batch
      // repair) pass straight through.
      if (calls <= 2) await gate.wait()
    }

    const [first, second] = await Promise.all([push([deleteProfile(P)]), push([deleteProfile(Q)])])

    // Positive anchor: both pushes reached the barrier, so both were past their
    // out-of-transaction checks before either transaction ran.
    expect(gate.arrived()).toBe(2)

    // MECHANISM FIRST: which profiles are tombstoned. On `main` this names both.
    const rows = await profiles()
    const tombstoned = rows.filter((row) => row.isDeleted).map((row) => row.id)
    expect(tombstoned, 'profiles tombstoned by the two concurrent deletes').toHaveLength(1)

    const live = rows.filter((row) => !row.isDeleted)
    expect(live).toHaveLength(1)
    expect(live[0]?.isDefault).toBe(true)

    // Both envelopes are acknowledgements: the loser gets the existing
    // last-profile outcome (acknowledged, not tombstoned; 66.3), never a failure
    // that would wedge the device's queue.
    for (const result of [first, second]) {
      expect(result.failedCount).toBe(0)
      expect(result.conflictCount).toBe(0)
      expect(result.processedCount).toBe(1)
    }
  })
})

describe('two devices delete the SAME profile at once (AC-3)', () => {
  it('the second delete re-checks the target under the lock and writes nothing', async () => {
    // A 3-profile account, so the last-profile count cannot mask a missing
    // re-check: without it, the second delete counts 2 live profiles and sweeps
    // and tombstones Q a second time.
    await db.insert(userProfiles).values({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      userId: USER,
      name: 'R',
      isDefault: false,
      createdAt: new Date('2020-03-01'),
    })
    const gate = barrier()
    let calls = 0
    seams.beforeTransaction = async () => {
      calls++
      if (calls <= 2) await gate.wait()
    }

    const results = await Promise.all([push([deleteProfile(Q)]), push([deleteProfile(Q)])])

    // Positive anchor: both pushes passed their out-of-transaction checks (Q was
    // live for both) before either transaction ran.
    expect(gate.arrived()).toBe(2)

    // MECHANISM FIRST: how many times was Q tombstoned?
    const tombstoneWrites = statements.filter((statement) =>
      statement.sql.startsWith('update "userProfiles" set "isDeleted"')
    )
    expect(tombstoneWrites, 'profile tombstone statements across both deletes').toHaveLength(1)

    const rows = await profiles()
    expect(rows.filter((row) => row.isDeleted).map((row) => row.id)).toEqual([Q])
    for (const result of results) {
      expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    }
  })
})

describe('a child create interleaves with the cascade of its profile (AC-2)', () => {
  it('a cascade that commits after the create passed its out-of-transaction checks leaves no live orphan', async () => {
    // Fire the cascade of P at the create's first top-level WRITE step: its first
    // transaction or its first INSERT, whichever comes first. Everything the
    // create checks OUTSIDE a transaction has run by then (before 76.3 that
    // included the profile check, and the INSERT came next, unguarded). Since
    // 76.3 the hook fires as the create's transaction opens, so the create's own
    // in-transaction re-check is what must see the cascade.
    let consumed = 0
    let cascade: Awaited<ReturnType<typeof push>> | undefined
    const runCascade = async () => {
      consumed++
      seams.beforeInsert = null
      seams.beforeTransaction = null
      // ⚠️ No `expect` in here: this runs INSIDE the create's call, and a throw
      // would be turned into the create's failure result, hiding the assertion.
      cascade = await push([deleteProfile(P)])
    }
    seams.beforeInsert = runCascade
    seams.beforeTransaction = runCascade

    const result = await push([createIncome(P)])

    // Positive anchors: the cascade ran inside the create's window, and succeeded.
    expect(consumed).toBe(1)
    expect(cascade).toMatchObject({ processedCount: 1, failedCount: 0 })
    const [profile] = (await profiles()).filter((row) => row.id === P)
    expect(profile?.isDeleted).toBe(true)

    // MECHANISM FIRST: is there a LIVE row under the tombstoned profile?
    const liveOrphans = await db
      .select({ id: incomeSources.id })
      .from(incomeSources)
      .where(and(eq(incomeSources.profileId, P), eq(incomeSources.isDeleted, false)))
    expect(liveOrphans, 'live row under tombstoned profile').toEqual([])

    // Refused as today: kept queued (no permanent rejection), so 76.2's pull
    // drops it on the device instead of raising a refusal notice.
    expect(result.failedCount).toBe(1)
    expect(result.rejections).toEqual([])
  })

  it('a create that lands BEFORE the cascade is swept by it', async () => {
    expect(await push([createIncome(P)])).toMatchObject({ processedCount: 1, failedCount: 0 })
    expect(await push([deleteProfile(P)])).toMatchObject({ processedCount: 1, failedCount: 0 })

    const [row] = await db.select().from(incomeSources).where(eq(incomeSources.id, ROW))
    expect(row?.isDeleted).toBe(true)
  })
})

/**
 * The ONLY automated protection of the per-user lock (AC-6). The race tests
 * above stay green with the lock deleted, because PGlite runs a transaction
 * exclusively (see this file's docblock). So this asserts, per path, that the
 * FIRST statement inside each transaction is the `users` row lock, with the
 * strength `lockUserProfileSet`'s docblock justifies.
 */
describe('every transaction that depends on the live-profile set locks the user first (AC-6)', () => {
  const WRITER = {
    sql: 'select "id" from "users" where "users"."id" = $1 for no key update',
    params: [USER],
  }
  const READER = {
    sql: 'select "id" from "users" where "users"."id" = $1 for share',
    params: [USER],
  }

  /**
   * The first statement of each top-level transaction, in order, WITH its
   * parameters: a lock on the wrong id (a profile id, say) must not pass
   * (code review 76.3).
   */
  function firstStatementOfEachTransaction() {
    const firsts: { sql: string; params: unknown[] }[] = []
    statements.forEach((statement, index) => {
      if (statement.sql === 'BEGIN') {
        firsts.push(statements[index + 1] ?? { sql: '(empty transaction)', params: [] })
      }
    })
    return firsts
  }

  it('the profile cascade and the post-batch repair take the writer lock', async () => {
    expect(await push([deleteProfile(Q)])).toMatchObject({ processedCount: 1, failedCount: 0 })
    expect(firstStatementOfEachTransaction(), '[cascade, repair]').toEqual([WRITER, WRITER])
  })

  it('a promotion and the post-batch repair take the writer lock', async () => {
    const promote = op({
      type: 'update',
      entityType: 'userProfile',
      entityId: Q,
      data: { name: 'Q', isDefault: true, currency: 'NONE', userId: USER },
    })
    expect(await push([promote])).toMatchObject({ processedCount: 1, failedCount: 0 })
    expect(firstStatementOfEachTransaction(), '[promoteProfile, repair]').toEqual([WRITER, WRITER])
  })

  it('a profile-scoped child create takes the reader lock', async () => {
    expect(await push([createIncome(P)])).toMatchObject({ processedCount: 1, failedCount: 0 })
    expect(firstStatementOfEachTransaction(), '[child create]').toEqual([READER])
  })
})
