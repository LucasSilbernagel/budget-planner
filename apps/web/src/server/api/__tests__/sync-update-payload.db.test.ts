// @vitest-environment node
/**
 * A sync UPDATE cannot delete, revive or re-date a row, and a sync CREATE cannot
 * insert a tombstone or a back-dated row (story 80.1, FR131 rider; the create half
 * was added by its code review, decision Lucas 2026-09-29).
 *
 * `updatePayload` spreads the op's `data` into `.set()`. The per-entity schemas
 * validate but do not strip, so before 80.1 a hand-crafted update carrying
 * `isDeleted: true` tombstoned a profile WITHOUT its cascade or the last-profile
 * rule (`deleteProfileWithChildren`), and `createdAt` reached the column that
 * orders the default repair's successor. A legitimate client never sends either
 * key (core's `syncOperationDataSchema` strips both on the way out).
 *
 * Harness (PGlite + full migration chain via a `vi.hoisted` holder) copied from
 * `sync-profile-concurrency.db.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { incomeSources, userProfiles, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW_P = '10000000-0000-4000-8000-000000000001'
const ROW_Q = '10000000-0000-4000-8000-000000000002'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const
const Q_CREATED = new Date('2020-02-01T00:00:00.000Z')
const NEW_ROW = '10000000-0000-4000-8000-000000000003'
const NEW_PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

function op(overrides: Record<string, unknown>) {
  opCounter++
  return {
    id: `op-${opCounter}`,
    type: 'update',
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    ...overrides,
  }
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
}

const updateProfileQ = (extra: Record<string, unknown>) =>
  op({
    entityType: 'userProfile',
    entityId: Q,
    data: { name: 'Q renamed', isDefault: false, currency: 'NONE', userId: USER, ...extra },
  })

const updateIncome = (id: string, profileId: string, extra: Record<string, unknown>) =>
  op({
    entityType: 'incomeSource',
    entityId: id,
    profileId,
    data: {
      name: 'Renamed',
      amount: 600_000,
      frequency: 'monthly',
      sortOrder: 0,
      userId: USER,
      ...extra,
    },
  })

async function row<T extends typeof userProfiles | typeof incomeSources>(table: T, id: string) {
  const [found] = await db.select().from(table).where(eq(table.id, id))
  return found
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
  holder.db = db

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
  await db.delete(incomeSources)
  await db.delete(userProfiles)
  await db.insert(userProfiles).values([
    { id: P, userId: USER, name: 'Main', isDefault: true, createdAt: new Date('2020-01-01') },
    { id: Q, userId: USER, name: 'Q', isDefault: false, createdAt: Q_CREATED },
  ])
  await db.insert(incomeSources).values([
    {
      id: ROW_P,
      userId: USER,
      profileId: P,
      name: 'Salary',
      amount: 500_000,
      frequency: 'monthly',
    },
    { id: ROW_Q, userId: USER, profileId: Q, name: 'Side', amount: 100_000, frequency: 'monthly' },
  ])
})

describe('a sync update cannot delete a row (AC-3)', () => {
  it('a profile update carrying isDeleted: true leaves the profile and its children live', async () => {
    const result = await push([updateProfileQ({ isDeleted: true })])

    // Positive anchor: the update itself was applied.
    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    expect((await row(userProfiles, Q))?.name).toBe('Q renamed')

    // MECHANISM: on `main` Q was tombstoned with no cascade, its child still live.
    expect((await row(userProfiles, Q))?.isDeleted, 'profile tombstoned by an update').toBe(false)
    expect((await row(incomeSources, ROW_Q))?.isDeleted).toBe(false)
  })

  it('a child update carrying isDeleted: true leaves the child live', async () => {
    const result = await push([updateIncome(ROW_P, P, { isDeleted: true })])

    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    expect((await row(incomeSources, ROW_P))?.name).toBe('Renamed')
    expect((await row(incomeSources, ROW_P))?.isDeleted, 'child tombstoned by an update').toBe(
      false
    )
  })
})

describe('a sync update cannot revive a tombstoned child (AC-3, guard)', () => {
  // ⚠️ A GUARD, not a RED: sequentially the update never reaches `updatePayload`
  // (`checkConflict` answers `update-delete` for a tombstone), so this is green
  // on `main` too. Revival was reachable only in the window between that check
  // and the autocommit UPDATE (deferred-work, 76.3 review), which a single
  // PGlite connection cannot open. Stripping `isDeleted` closes the REVIVAL by
  // construction; the write landing on the tombstone in that window stays open
  // (deferred-work, "Profile-scoped child UPDATE/DELETE…").
  it('an update carrying isDeleted: false leaves the tombstone in place', async () => {
    await db.update(incomeSources).set({ isDeleted: true }).where(eq(incomeSources.id, ROW_P))

    const result = await push([updateIncome(ROW_P, P, { isDeleted: false })])

    expect(result.conflictCount).toBe(1)
    expect((await row(incomeSources, ROW_P))?.isDeleted).toBe(true)
  })
})

describe('a sync update cannot re-date a row (AC-3)', () => {
  it('a profile update carrying createdAt is applied and leaves createdAt unchanged', async () => {
    const result = await push([updateProfileQ({ createdAt: '2000-01-01T00:00:00.000Z' })])

    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    const profile = await row(userProfiles, Q)
    expect(profile?.name).toBe('Q renamed')
    expect(profile?.createdAt.toISOString()).toBe(Q_CREATED.toISOString())
  })
})

describe('a sync create cannot insert a tombstone or a back-dated row (AC-3, code review)', () => {
  const createIncome = (extra: Record<string, unknown>) =>
    op({
      type: 'create',
      entityType: 'incomeSource',
      entityId: NEW_ROW,
      profileId: P,
      data: {
        name: 'Bonus',
        amount: 50_000,
        frequency: 'monthly',
        sortOrder: 1,
        userId: USER,
        ...extra,
      },
    })
  const createProfile = (extra: Record<string, unknown>) =>
    op({
      type: 'create',
      entityType: 'userProfile',
      entityId: NEW_PROFILE,
      data: { name: 'R', isDefault: false, currency: 'NONE', userId: USER, ...extra },
    })

  it('a profile-scoped create carrying isDeleted: true inserts a LIVE row', async () => {
    const result = await push([createIncome({ isDeleted: true })])

    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    expect((await row(incomeSources, NEW_ROW))?.isDeleted, 'create inserted a tombstone').toBe(
      false
    )
  })

  it('a profile create carrying isDeleted: true inserts a LIVE profile', async () => {
    const result = await push([createProfile({ isDeleted: true })])

    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    expect((await row(userProfiles, NEW_PROFILE))?.isDeleted, 'create inserted a tombstone').toBe(
      false
    )
  })

  it('a create carrying createdAt is applied, stamped by the server', async () => {
    const result = await push([createIncome({ createdAt: '2000-01-01T00:00:00.000Z' })])

    // MECHANISM: on `main` the string reached drizzle's timestamp mapper and the
    // INSERT threw with no SQLSTATE: a kept-queued failure, replayed for ever.
    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    // Not back-dated. ⚠️ Not compared with `Date.now()`: the column is
    // `timestamp` WITHOUT time zone, and PGlite's `now()` read back through it
    // differed from the JS clock by ~5 h (MEASURED), a harness artifact.
    const created = await row(incomeSources, NEW_ROW)
    expect(created?.createdAt.getUTCFullYear()).toBeGreaterThan(2020)
  })
})
