// @vitest-environment node
/**
 * DB-backed sync round trip: push on one device, pull on another.
 *
 * Every other test touching `processBatchSync` / `getSyncChanges` mocks the
 * database, which is how a push path that could not write a single
 * profile-scoped row shipped green: `syncOperationSchema` stripped `profileId`,
 * every INSERT violated `profileId NOT NULL`, and a second device signed in to an
 * empty account. This runs both halves against real PostgreSQL (PGlite, with the
 * full migration chain applied) so that class of defect cannot pass again.
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
import { getSyncChanges, processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const PROFILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAID = { id: USER_A, subscriptionStatus: 'lifetime' } as const

let pg: PGlite
let db: ReturnType<typeof drizzle>
let rowCounter = 0

function nextRowId(): string {
  rowCounter++
  return `cccccccc-cccc-4ccc-8ccc-${String(rowCounter).padStart(12, '0')}`
}

function incomeCreate(entityId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `op-${entityId}`,
    type: 'create' as const,
    entityType: 'incomeSource' as const,
    entityId,
    data: { name: 'Salary', amount: 500_000, frequency: 'monthly', sortOrder: 0, userId: USER_A },
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER_A,
    profileId: PROFILE_A,
    ...overrides,
  }
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
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

  await db.insert(users).values([
    { id: USER_A, email: 'a@example.test', paddleId: 'ctm_a', subscriptionStatus: 'lifetime' },
    { id: USER_B, email: 'b@example.test', paddleId: 'ctm_b', subscriptionStatus: 'lifetime' },
  ])
  await db.insert(userProfiles).values([
    { id: PROFILE_A, userId: USER_A, name: 'Main Profile', isDefault: true },
    { id: PROFILE_B, userId: USER_B, name: 'Main Profile', isDefault: true },
  ])
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  await db.delete(incomeSources)
})

describe('sync push → pull round trip (real PostgreSQL)', () => {
  it('a row pushed from one device is pulled by another, under the SAME id and profile', async () => {
    const rowId = nextRowId()
    const result = await push([incomeCreate(rowId)])

    expect(result).toMatchObject({ success: true, processedCount: 1, failedCount: 0 })

    // "Second device": a fresh full-snapshot pull for the same user + profile.
    const changes = await getSyncChanges(USER_A, null, 100, PROFILE_A)
    const income = changes.filter((c) => c.entityType === 'incomeSource')
    expect(income).toHaveLength(1)
    expect(income[0]?.entityId).toBe(rowId)
    expect(income[0]?.data).toMatchObject({
      id: rowId,
      userId: USER_A,
      profileId: PROFILE_A,
      name: 'Salary',
      amount: 500_000,
    })
  })

  it('an update and a delete of a pushed row apply to that same row', async () => {
    const rowId = nextRowId()
    await push([incomeCreate(rowId)])

    const update = await push([
      {
        ...incomeCreate(rowId),
        id: `op-update-${rowId}`,
        type: 'update',
        data: { name: 'Raise', amount: 600_000, frequency: 'monthly', userId: USER_A },
      },
    ])
    expect(update).toMatchObject({ success: true, processedCount: 1 })
    const [updated] = await db.select().from(incomeSources).where(eq(incomeSources.id, rowId))
    expect(updated).toMatchObject({ name: 'Raise', amount: 600_000 })

    const del = await push([
      {
        ...incomeCreate(rowId),
        id: `op-delete-${rowId}`,
        type: 'delete',
        data: { userId: USER_A },
      },
    ])
    expect(del).toMatchObject({ success: true, processedCount: 1 })
    const [deleted] = await db.select().from(incomeSources).where(eq(incomeSources.id, rowId))
    expect(deleted?.isDeleted).toBe(true)
  })

  it('re-sending an already-applied create is acknowledged, not a conflict, and inserts nothing twice', async () => {
    const rowId = nextRowId()
    await push([incomeCreate(rowId)])
    const replay = await push([incomeCreate(rowId)])

    expect(replay).toMatchObject({ success: true, processedCount: 1, conflictCount: 0 })
    const rows = await db.select().from(incomeSources).where(eq(incomeSources.id, rowId))
    expect(rows).toHaveLength(1)
  })

  it("rejects a create into another user's profile", async () => {
    const rowId = nextRowId()
    const result = await push([incomeCreate(rowId, { profileId: PROFILE_B })])

    expect(result).toMatchObject({ success: false, processedCount: 0, failedCount: 1 })
    expect(await db.select().from(incomeSources)).toHaveLength(0)
  })

  it('rejects a profile-scoped create with no profileId', async () => {
    const rowId = nextRowId()
    const result = await push([incomeCreate(rowId, { profileId: undefined })])

    expect(result).toMatchObject({ success: false, failedCount: 1 })
    expect(await db.select().from(incomeSources)).toHaveLength(0)
  })

  it('an update cannot re-home a row via data.userId / data.profileId', async () => {
    const rowId = nextRowId()
    await push([incomeCreate(rowId)])

    await push([
      {
        ...incomeCreate(rowId),
        id: `op-hijack-${rowId}`,
        type: 'update',
        data: {
          name: 'Salary',
          amount: 1,
          frequency: 'monthly',
          userId: USER_B,
          profileId: PROFILE_B,
        },
      },
    ])
    const [row] = await db.select().from(incomeSources).where(eq(incomeSources.id, rowId))
    expect(row).toMatchObject({ userId: USER_A, profileId: PROFILE_A })
  })
})
