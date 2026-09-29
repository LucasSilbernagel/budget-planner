// @vitest-environment node
/**
 * Two server-side causes of a permanently queued edit (story 79.3, FR130.3 and
 * FR130.4), against real PostgreSQL (PGlite, full migration chain).
 *
 * 1. The post-batch default REPAIR (`ensureUserHasDefaultProfile`) used to throw
 *    out of `processBatchSync` AFTER the op's own write had committed: the route
 *    answered 500 for an edit that had landed. A try/catch alone would turn that
 *    into a SILENT zero-default account (the 500 was also what made the client
 *    replay the op and re-run the repair), so a later batch with no `userProfile`
 *    op now repairs too, gated by a lock-free precheck.
 * 2. A transient error in `checkConflict`'s SELECT used to be reported as a
 *    CONFLICT (`update-delete` through `entityExists`, which swallowed the error,
 *    or `server-check-failed` from the catch). A conflict is kept queued for ever
 *    and 79.2 never escalates it. It is now a FAILURE: kept queued, escalated.
 *
 * Harness (PGlite + a `vi.hoisted` db holder) copied from
 * `sync-profile-default.db.test.ts`. `@/lib/logger` is mocked so its calls can be
 * asserted.
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

const USER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { logger } from '@/lib/logger'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { incomeSources, userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

/** The current default. Created LAST, so it is not the repair's pick. */
const P_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
/** The OLDEST live profile: the repair's pick. */
const P_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INCOME = '10000000-0000-4000-8000-0000000000c1'
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
    data: { userId: USER },
    ...overrides,
  }
}

/** 63.2's case 1: a stale device re-sends `isDefault: false` for the default. */
function staleDemotionOfA() {
  return op({
    type: 'update',
    entityType: 'userProfile',
    entityId: P_A,
    data: { name: 'Main Profile', isDefault: false, currency: 'NONE', userId: USER },
  })
}

function incomeCreate() {
  return op({
    type: 'create',
    entityType: 'incomeSource',
    entityId: INCOME,
    profileId: P_B,
    data: { userId: USER, name: 'Salary', amount: 500000, frequency: 'monthly' },
  })
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
}

async function liveDefaults(): Promise<string[]> {
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

async function profileRow(id: string) {
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.id, id))
  return row
}

/**
 * Make the NEXT `db.transaction` throw, and count how often the stub fired.
 *
 * ⚠️ The count comes from the stub itself, not from `spy.mock.calls`: the spy
 * also records every real transaction after it (code review 76.1).
 */
function failNextTransaction(error: Error) {
  let fired = 0
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
    fired++
    throw error
  })
  return { spy, fired: () => fired }
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
    email: 'repair@example.test',
    paddleId: 'ctm_repair',
    subscriptionStatus: 'lifetime',
  })
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  vi.mocked(logger.error).mockClear()
  await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
  await db.insert(userProfiles).values([
    {
      id: P_B,
      userId: USER,
      name: 'Business',
      isDefault: false,
      createdAt: new Date('2021-01-01'),
    },
    {
      id: P_A,
      userId: USER,
      name: 'Main Profile',
      isDefault: true,
      createdAt: new Date('2022-01-01'),
    },
  ])
})

describe('a failed default repair is not a 500 (AC-2)', () => {
  it('resolves, reports the committed op as processed, and logs the repair error', async () => {
    const { spy, fired } = failNextTransaction(new Error('deadlock detected'))

    let result: Awaited<ReturnType<typeof push>> | undefined
    try {
      result = await push([staleDemotionOfA()])
    } finally {
      spy.mockRestore()
    }

    // Positive anchor: the stub was consumed, and by the REPAIR — the demotion is a
    // plain `updateEntity` (no transaction), so the first transaction is the repair's.
    expect(fired()).toBe(1)
    // The op's own write landed before the repair failed.
    expect((await profileRow(P_A))?.isDefault).toBe(false)

    expect(result).toMatchObject({
      success: true,
      processedCount: 1,
      failedCount: 0,
      conflictCount: 0,
      status: 'COMPLETED',
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      userId: USER,
      error: 'deadlock detected',
    })
    // The failure left the account with no default: what AC-3 must heal.
    expect(await liveDefaults()).toEqual([])
  })

  it('the route answers 200, not 500', async () => {
    const { spy, fired } = failNextTransaction(new Error('deadlock detected'))

    let response: Response | undefined
    try {
      response = await batchPOST({
        request: new Request('https://app.test/api/sync/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [staleDemotionOfA()],
            clientTimestamp: Date.now(),
            deviceId: 'device-1',
          }),
        }),
      })
    } finally {
      spy.mockRestore()
    }

    expect(fired()).toBe(1)
    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({ processedCount: 1, failedCount: 0 })
  })
})

describe('a later batch retries the repair (AC-3)', () => {
  it('a batch with NO userProfile op hands the empty seat to the oldest live profile', async () => {
    const { spy, fired } = failNextTransaction(new Error('deadlock detected'))
    try {
      await push([staleDemotionOfA()])
    } finally {
      spy.mockRestore()
    }
    expect(fired()).toBe(1)
    expect(await liveDefaults()).toEqual([])

    const result = await push([incomeCreate()])

    expect(result).toMatchObject({ processedCount: 1, failedCount: 0 })
    // P_B is the OLDEST live profile, not the previous default: a repair picked it.
    expect(await liveDefaults()).toEqual([P_B])
  })

  it('CONTROL — an account that has a default opens no repair transaction', async () => {
    // An UPDATE of a child row is a plain `updateEntity`: it opens no transaction of
    // its own, so ANY transaction here would be the repair's.
    await db.insert(incomeSources).values({
      id: INCOME,
      userId: USER,
      profileId: P_B,
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
    } as never)
    const spy = vi.spyOn(db, 'transaction')

    let transactions = -1
    try {
      const result = await push([
        op({
          type: 'update',
          entityType: 'incomeSource',
          entityId: INCOME,
          profileId: P_B,
          data: { userId: USER, name: 'Salary 2', amount: 500000, frequency: 'monthly' },
        }),
      ])
      transactions = spy.mock.calls.length
      expect(result).toMatchObject({ processedCount: 1, failedCount: 0 })
    } finally {
      spy.mockRestore()
    }

    expect(transactions).toBe(0)
    // A precheck that THREW would also open no transaction (the catch swallows it).
    expect(logger.error).not.toHaveBeenCalled()
    expect(await liveDefaults()).toEqual([P_A])
  })
})

describe('a transient checkConflict error is a FAILURE, not a conflict (AC-4)', () => {
  /** Make the FIRST `db.select` — `checkConflict`'s existence check — throw. */
  function failFirstSelect() {
    let fired = 0
    const spy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      fired++
      throw Object.assign(new Error('could not serialize access'), { code: '40001' })
    })
    return { spy, fired: () => fired }
  }

  it('an UPDATE is FAILED, with no conflict and no rejection, and is not applied', async () => {
    const { spy, fired } = failFirstSelect()

    let result: Awaited<ReturnType<typeof push>> | undefined
    try {
      result = await push([
        op({
          type: 'update',
          entityType: 'userProfile',
          entityId: P_B,
          data: { name: 'Renamed', isDefault: false, currency: 'NONE', userId: USER },
        }),
      ])
    } finally {
      spy.mockRestore()
    }

    expect(fired()).toBe(1)
    // ...and it fired inside `checkConflict`, not in some other SELECT.
    expect(vi.mocked(logger.error).mock.calls.map((call) => call[0])).toContain(
      '[Conflict Check Error]'
    )
    expect(result).toMatchObject({
      success: false,
      processedCount: 0,
      failedCount: 1,
      conflictCount: 0,
      conflicts: [],
      rejections: [],
      status: 'FAILED',
    })
    expect(result?.failedOperationIds).toHaveLength(1)
    // `applyOperation` was never reached: the row is unchanged.
    expect((await profileRow(P_B))?.name).toBe('Business')
  })

  it.each(['create', 'delete'] as const)('a %s is FAILED too, and is not applied', async (type) => {
    if (type === 'delete') {
      await db.insert(incomeSources).values({
        id: INCOME,
        userId: USER,
        profileId: P_B,
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
      } as never)
    }
    const { spy, fired } = failFirstSelect()

    let result: Awaited<ReturnType<typeof push>> | undefined
    try {
      result = await push([
        type === 'create'
          ? incomeCreate()
          : op({ type: 'delete', entityType: 'incomeSource', entityId: INCOME, profileId: P_B }),
      ])
    } finally {
      spy.mockRestore()
    }

    expect(fired()).toBe(1)
    // ...and it fired inside `checkConflict`, not in some other SELECT.
    expect(vi.mocked(logger.error).mock.calls.map((call) => call[0])).toContain(
      '[Conflict Check Error]'
    )
    expect(result).toMatchObject({
      failedCount: 1,
      conflictCount: 0,
      conflicts: [],
      rejections: [],
      status: 'FAILED',
    })
    const [row] = await db.select().from(incomeSources).where(eq(incomeSources.id, INCOME))
    if (type === 'create') expect(row).toBeUndefined()
    else expect(row?.isDeleted).toBe(false)
  })

  it('CONTROL — a genuine update-delete is still a conflict (PARTIAL)', async () => {
    const result = await push([
      op({
        type: 'update',
        entityType: 'incomeSource',
        entityId: INCOME,
        profileId: P_B,
        data: { userId: USER, name: 'Salary', amount: 500000, frequency: 'monthly' },
      }),
    ])

    expect(result).toMatchObject({
      failedCount: 0,
      conflictCount: 1,
      status: 'PARTIAL',
    })
    expect(result.conflicts.map((c) => c.conflictType)).toEqual(['update-delete'])
  })
})
