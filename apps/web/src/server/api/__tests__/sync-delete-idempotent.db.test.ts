// @vitest-environment node

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
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const Q = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const R = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_PROFILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ROW = '10000000-0000-4000-8000-000000000001'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

let pg: PGlite
let db: ReturnType<typeof drizzle>
let opCounter = 0

function op(overrides: Record<string, unknown>) {
  opCounter++
  return {
    id: `op-${opCounter}`,
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    // Even a DELETE needs `data: { userId }`, or the whole batch is refused.
    data: { userId: USER },
    ...overrides,
  }
}

function profilePayload(name: string, isDefault: boolean) {
  return { name, isDefault, currency: 'NONE', userId: USER }
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
}

function deleteOp(entityType: string, entityId: string, profileId?: string) {
  return op({ type: 'delete', entityType, entityId, ...(profileId ? { profileId } : {}) })
}

function promoteOp(profileId: string, name: string) {
  return op({
    type: 'update',
    entityType: 'userProfile',
    entityId: profileId,
    data: profilePayload(name, true),
  })
}

async function liveDefaults() {
  const rows = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.userId, USER),
        eq(userProfiles.isDeleted, false),
        eq(userProfiles.isDefault, true)
      )
    )
  return rows.map((row) => row.id)
}

async function incomeRowDeleted() {
  const [row] = await db.select().from(incomeSources).where(eq(incomeSources.id, ROW))
  return row?.isDeleted
}

async function profileRow(id: string) {
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.id, id))
  return row
}

const ACKNOWLEDGED = { processedCount: 1, conflictCount: 0, failedCount: 0 }

// Asserted before counts, so a failure names the conflict type or unrejected failure.
function mechanism(result: Awaited<ReturnType<typeof push>>) {
  return {
    conflictTypes: result.conflicts.map((conflict) => conflict.conflictType),
    failedCount: result.failedCount,
    rejections: result.rejections,
  }
}

const NO_CONFLICT_NO_FAILURE = { conflictTypes: [], failedCount: 0, rejections: [] }

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

  await db.insert(users).values([
    { id: USER, email: 'a@example.test', paddleId: 'ctm_a', subscriptionStatus: 'lifetime' },
    { id: OTHER_USER, email: 'b@example.test', paddleId: 'ctm_b', subscriptionStatus: 'lifetime' },
  ])
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  for (const table of [incomeSources, expenses, categories, savingsGoals, balanceTracking]) {
    await db.delete(table)
  }
  await db.delete(userProfiles)
  // createdAt order disagrees with every promotion: a fallback repair would pick R, so a test
  // expecting Q cannot pass by coincidence.
  await db.insert(userProfiles).values([
    { id: P, userId: USER, name: 'Main', isDefault: true, createdAt: new Date('2020-01-01') },
    { id: R, userId: USER, name: 'R', isDefault: false, createdAt: new Date('2020-02-01') },
    { id: Q, userId: USER, name: 'Q', isDefault: false, createdAt: new Date('2020-03-01') },
    { id: OTHER_PROFILE, userId: OTHER_USER, name: 'Theirs', isDefault: true },
  ])
})

const CHILD_SEEDS = {
  incomeSource: () =>
    db.insert(incomeSources).values({
      id: ROW,
      userId: USER,
      profileId: Q,
      name: 'Salary',
      amount: 100,
      frequency: 'monthly',
    }),
  expense: () =>
    db.insert(expenses).values({
      id: ROW,
      userId: USER,
      profileId: Q,
      name: 'Rent',
      amount: 100,
      frequency: 'monthly',
    }),
  savingsGoal: () =>
    db.insert(savingsGoals).values({ id: ROW, userId: USER, profileId: Q, name: 'Fund' }),
  balanceTracking: () =>
    db
      .insert(balanceTracking)
      .values({ id: ROW, userId: USER, profileId: Q, type: 'asset', name: 'House' }),
  category: () =>
    db
      .insert(categories)
      .values({ id: ROW, userId: USER, profileId: Q, name: 'Food', kind: 'expense' }),
} as const

describe('a delete the server already applied is acknowledged (AC-1)', () => {
  it.each(Object.keys(CHILD_SEEDS) as (keyof typeof CHILD_SEEDS)[])(
    '%s: the same delete pushed twice succeeds both times',
    async (entityType) => {
      await CHILD_SEEDS[entityType]()

      const first = await push([deleteOp(entityType, ROW, Q)])
      const replay = await push([deleteOp(entityType, ROW, Q)])

      expect(first).toMatchObject(ACKNOWLEDGED)
      expect(mechanism(replay)).toEqual(NO_CONFLICT_NO_FAILURE)
      expect(replay).toMatchObject(ACKNOWLEDGED)
    }
  )

  it('userProfile: the same delete pushed twice succeeds, and the account keeps one live default', async () => {
    const first = await push([deleteOp('userProfile', R)])
    const replay = await push([deleteOp('userProfile', R)])

    expect(first).toMatchObject(ACKNOWLEDGED)
    expect(mechanism(replay)).toEqual(NO_CONFLICT_NO_FAILURE)
    expect(replay).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([P])
    expect((await profileRow(R))?.isDeleted).toBe(true)
  })

  it('a child row tombstoned by its PROFILE cascade is acknowledged too', async () => {
    await CHILD_SEEDS.incomeSource()
    expect(await push([deleteOp('userProfile', Q)])).toMatchObject(ACKNOWLEDGED)
    expect(await incomeRowDeleted()).toBe(true)

    // Queued before the device saw the profile go: its profileId names a tombstoned profile.
    const late = await push([deleteOp('incomeSource', ROW, Q)])

    expect(mechanism(late)).toEqual(NO_CONFLICT_NO_FAILURE)
    expect(late).toMatchObject(ACKNOWLEDGED)
  })
})

describe('idempotence is not "a delete of anything succeeds" (AC-2)', () => {
  it('a delete for an id that never existed is still a conflict, unchanged', async () => {
    const result = await push([deleteOp('incomeSource', ROW, Q)])

    expect(result).toMatchObject({ processedCount: 0, conflictCount: 1, failedCount: 0 })
    expect(result.conflicts[0]?.conflictType).toBe('delete-update')
  })

  it("a delete for ANOTHER user's tombstoned row is still a conflict", async () => {
    await db.insert(incomeSources).values({
      id: ROW,
      userId: OTHER_USER,
      profileId: OTHER_PROFILE,
      name: 'Theirs',
      amount: 100,
      frequency: 'monthly',
      isDeleted: true,
    })

    const result = await push([deleteOp('incomeSource', ROW, Q)])

    expect(result).toMatchObject({ processedCount: 0, conflictCount: 1, failedCount: 0 })
    expect(result.conflicts[0]?.conflictType).toBe('delete-update')
  })

  it("a delete for ANOTHER user's LIVE row is still a conflict, and the row stays live", async () => {
    await db.insert(incomeSources).values({
      id: ROW,
      userId: OTHER_USER,
      profileId: OTHER_PROFILE,
      name: 'Theirs',
      amount: 100,
      frequency: 'monthly',
    })

    const result = await push([deleteOp('incomeSource', ROW, Q)])

    expect(result).toMatchObject({ processedCount: 0, conflictCount: 1 })
    const [row] = await db.select().from(incomeSources).where(eq(incomeSources.id, ROW))
    expect(row?.isDeleted).toBe(false)
  })
})

// Returns the limit spy so a test can prove every stub was consumed.
function stubSelectsAsLive(count: number, id: string) {
  const limit = vi.fn(async () => [{ id }])
  const builder = { from: () => builder, where: () => builder, limit }
  const spy = vi.spyOn(db, 'select')
  for (let i = 0; i < count; i++) spy.mockImplementationOnce(() => builder as never)
  return { spy, limit }
}

describe('the row is tombstoned between checkConflict and applyOperation (AC-1, the race arm)', () => {
  // Simulated interleaving, not a race (PGlite is single-connection): checkConflict sees the row
  // live while the database already holds its tombstone.
  function checkConflictSeesLiveRow() {
    return stubSelectsAsLive(1, ROW)
  }

  it('a child row tombstoned in between is acknowledged, not "Entity not found"', async () => {
    await CHILD_SEEDS.incomeSource()
    await db.update(incomeSources).set({ isDeleted: true }).where(eq(incomeSources.id, ROW))
    const { spy, limit } = checkConflictSeesLiveRow()

    try {
      const result = await push([deleteOp('incomeSource', ROW, Q)])
      // The rate limiter is mocked, so the first select is checkConflict's.
      expect(limit).toHaveBeenCalledTimes(1)
      expect(mechanism(result)).toEqual(NO_CONFLICT_NO_FAILURE)
      expect(result).toMatchObject(ACKNOWLEDGED)
    } finally {
      spy.mockRestore()
    }
  })

  it('a child row whose PROFILE was cascaded in between is acknowledged, not "Profile not found"', async () => {
    await CHILD_SEEDS.incomeSource()
    expect(await push([deleteOp('userProfile', Q)])).toMatchObject(ACKNOWLEDGED)
    expect(await incomeRowDeleted()).toBe(true)
    const { spy, limit } = checkConflictSeesLiveRow()

    try {
      const result = await push([deleteOp('incomeSource', ROW, Q)])
      expect(limit).toHaveBeenCalledTimes(1)
      expect(mechanism(result)).toEqual(NO_CONFLICT_NO_FAILURE)
      expect(result).toMatchObject(ACKNOWLEDGED)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the promotion that travels with a profile delete (AC-3, AC-4; decision D1)', () => {
  it("one device: its own promotion wins over the repair's pick (the survivor was not the oldest)", async () => {
    // One op per request, so the repair gives the seat to R, the oldest survivor.
    expect(await push([deleteOp('userProfile', P)])).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([R])

    const promote = await push([promoteOp(Q, 'Q')])

    expect(mechanism(promote)).toEqual(NO_CONFLICT_NO_FAILURE)
    expect(promote).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([Q])
  })

  it('two devices, different survivors: every op succeeds and the LATER promotion holds the seat', async () => {
    expect(await push([deleteOp('userProfile', P)])).toMatchObject(ACKNOWLEDGED)
    expect(await push([promoteOp(Q, 'Q')])).toMatchObject(ACKNOWLEDGED)
    // Backdated so the updatedAt bumps are measurable: consecutive in-process pushes can tie.
    const LONG_AGO = new Date('2000-01-01')
    await db.update(userProfiles).set({ updatedAt: LONG_AGO }).where(eq(userProfiles.userId, USER))

    // Device B, which has not pulled.
    const bDelete = await push([deleteOp('userProfile', P)])
    const bPromote = await push([promoteOp(R, 'R renamed')])

    expect(mechanism(bDelete)).toEqual(NO_CONFLICT_NO_FAILURE)
    expect(bDelete).toMatchObject(ACKNOWLEDGED)
    expect(mechanism(bPromote)).toEqual(NO_CONFLICT_NO_FAILURE)
    expect(bPromote).toMatchObject(ACKNOWLEDGED)

    expect(await liveDefaults()).toEqual([R])
    const rAfter = await profileRow(R)
    expect(rAfter?.name).toBe('R renamed')
    expect(rAfter?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime())
    const qAfter = await profileRow(Q)
    expect(qAfter?.isDefault).toBe(false)
    expect(qAfter?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime())
  })

  it('two devices, the SAME survivor: every op succeeds, one default', async () => {
    await push([deleteOp('userProfile', P)])
    await push([promoteOp(Q, 'Q')])

    expect(await push([deleteOp('userProfile', P)])).toMatchObject(ACKNOWLEDGED)
    expect(await push([promoteOp(Q, 'Q')])).toMatchObject(ACKNOWLEDGED)

    expect(await liveDefaults()).toEqual([Q])
  })

  it('the accepted cost: a stale isDefault:true for a LIVE profile takes the seat, and one default remains', async () => {
    // Last promotion wins: never zero defaults, never two.
    const result = await push([promoteOp(R, 'R')])

    expect(result).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([R])

    expect(await push([promoteOp(P, 'Main')])).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([P])
    expect(await push([promoteOp(Q, 'Q')])).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([Q])
  })

  it('a promotion whose target was deleted in between rolls back: the default stays put, not zero', async () => {
    // P is the newest profile: if the demotion stayed committed, the repair would seat R and this fails.
    await db
      .update(userProfiles)
      .set({ createdAt: new Date('2021-01-01') })
      .where(eq(userProfiles.id, P))
    await db.update(userProfiles).set({ isDeleted: true }).where(eq(userProfiles.id, Q))
    const { spy, limit } = stubSelectsAsLive(2, Q)

    try {
      const result = await push([promoteOp(Q, 'Q')])

      expect(limit).toHaveBeenCalledTimes(2)
      // Not permanent: the device's next pull drops it (the tombstone beats its baseVersion).
      expect(mechanism(result)).toEqual({ conflictTypes: [], failedCount: 1, rejections: [] })
    } finally {
      spy.mockRestore()
    }
    expect(await liveDefaults()).toEqual([P])
    expect((await profileRow(Q))?.isDefault).toBe(false)
  })

  it('CONTROL — the seat holder re-sending its own isDefault:true (a rename) keeps the seat', async () => {
    const result = await push([promoteOp(P, 'Main renamed')])

    expect(result).toMatchObject(ACKNOWLEDGED)
    expect(await liveDefaults()).toEqual([P])
    expect((await profileRow(P))?.name).toBe('Main renamed')
  })

  it("CONTROL — a promotion never touches another user's default", async () => {
    await push([promoteOp(R, 'R')])

    const [theirs] = await db.select().from(userProfiles).where(eq(userProfiles.id, OTHER_PROFILE))
    expect(theirs?.isDefault).toBe(true)
  })
})
