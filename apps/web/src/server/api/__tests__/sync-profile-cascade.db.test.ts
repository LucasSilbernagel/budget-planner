// @vitest-environment node
/**
 * Deleting a profile destroys the rows it owns — through the LIVE push path,
 * against real PostgreSQL (story 66.3, FR104, AC-8).
 *
 * ⚠️⚠️ WHY A REAL DATABASE. This story's whole claim is about what survives in
 * six tables after one operation. A `.toSQL()` assertion or a mocked `db` would
 * prove only that the code intends those statements — story 65.2's AC-5 is on
 * record for exactly that gap, and story 63.2's review found that the path it
 * called "the real one" had no real-database test at all. PGlite runs actual
 * Postgres in-process, so the FKs, the partial unique index and the enum types
 * are the real ones.
 *
 * Harness (PGlite + full migration chain via a `vi.hoisted` holder) copied from
 * `sync-profile-default.db.test.ts`.
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

import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
  incomeSources,
  savingsGoals,
  userProfiles,
  users,
} from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { getSyncChanges, processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '22222222-2222-4222-8222-222222222222'
const P_KEEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const P_DOOM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PAID = { id: USER, subscriptionStatus: 'lifetime' } as const

/** Row ids, `<table letter>-<profile>`. */
const R = {
  incomeKeep: '10000000-0000-4000-8000-000000000001',
  incomeDoom: '10000000-0000-4000-8000-000000000002',
  expenseDoom: '20000000-0000-4000-8000-000000000002',
  categoryDoom: '30000000-0000-4000-8000-000000000002',
  savingsDoom: '40000000-0000-4000-8000-000000000002',
  balanceDoom: '50000000-0000-4000-8000-000000000002',
}

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
    // ⚠️ Even a DELETE needs `data: { userId }`, and ONE invalid operation fails
    // the ENTIRE batch with `processedCount: 0` (see sync-profile-default).
    data: { userId: USER },
    ...overrides,
  }
}

function pushDelete(profileId: string) {
  return processBatchSync(
    {
      operations: [op({ type: 'delete', entityType: 'userProfile', entityId: profileId })],
      clientTimestamp: Date.now(),
      deviceId: 'device-1',
    } as never,
    PAID
  )
}

/** Live (non-tombstoned) ids in one child table, for either profile. */
async function liveIds(table: typeof incomeSources | typeof expenses | typeof categories) {
  const rows = await db
    .select({ id: table.id, profileId: table.profileId })
    .from(table)
    .where(and(eq(table.userId, USER), eq(table.isDeleted, false)))
  return rows.map((r) => r.id)
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
    email: 'cascade@example.test',
    paddleId: 'ctm_cascade',
    subscriptionStatus: 'lifetime',
  })
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

/**
 * Both profiles get rows so every assertion has a CONTROL: "the doomed rows are
 * gone" is worth nothing without "and the survivor's are not". Deletion order
 * mirrors the FK order — children before parents — because these are HARD
 * deletes, unlike the cascade under test.
 */
beforeEach(async () => {
  await db.delete(forecastingProfiles).where(eq(forecastingProfiles.userId, USER))
  await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
  await db.delete(expenses).where(eq(expenses.userId, USER))
  await db.delete(categories).where(eq(categories.userId, USER))
  await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
  await db.delete(balanceTracking).where(eq(balanceTracking.userId, USER))
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))

  await db.insert(userProfiles).values([
    { id: P_KEEP, userId: USER, name: 'Main Profile', isDefault: true },
    { id: P_DOOM, userId: USER, name: 'Business', isDefault: false },
  ])
  await db.insert(incomeSources).values([
    {
      id: R.incomeKeep,
      userId: USER,
      profileId: P_KEEP,
      name: 'Salary',
      amount: 500_000,
      frequency: 'monthly',
    },
    {
      id: R.incomeDoom,
      userId: USER,
      profileId: P_DOOM,
      name: 'Consulting',
      amount: 200_000,
      frequency: 'monthly',
    },
  ])
  await db
    .insert(categories)
    .values([
      { id: R.categoryDoom, userId: USER, profileId: P_DOOM, name: 'Software', kind: 'expense' },
    ])
  await db.insert(expenses).values([
    // Categorised deliberately: `expenses.categoryId -> categories.id` is the FK
    // that makes a HARD delete of categories fail, so this row is what proves the
    // tombstone cascade is not quietly relying on the children being empty.
    {
      id: R.expenseDoom,
      userId: USER,
      profileId: P_DOOM,
      name: 'Office',
      amount: 90_000,
      frequency: 'monthly',
      categoryId: R.categoryDoom,
    },
  ])
  await db.insert(savingsGoals).values([
    {
      id: R.savingsDoom,
      userId: USER,
      profileId: P_DOOM,
      name: 'Tax pot',
      currentBalance: 10_000,
    },
  ])
  await db.insert(balanceTracking).values([
    {
      id: R.balanceDoom,
      userId: USER,
      profileId: P_DOOM,
      type: 'investment',
      name: 'ISA',
      currentBalance: 1_000,
    },
  ])
  await db.insert(forecastingProfiles).values([
    { userId: USER, profileId: P_DOOM, name: 'Doomed scenario', scenarioData: '{}' },
    { userId: USER, profileId: P_KEEP, name: 'Surviving scenario', scenarioData: '{}' },
  ])
})

describe('the server cascade (AC-4, AC-9)', () => {
  it('tombstones the deleted profile and all five syncable child tables', async () => {
    const result = await pushDelete(P_DOOM)
    expect(result.success).toBe(true)

    for (const table of [incomeSources, expenses, categories, savingsGoals, balanceTracking]) {
      const rows = await db
        .select({ id: table.id, isDeleted: table.isDeleted })
        .from(table)
        .where(and(eq(table.userId, USER), eq(table.profileId, P_DOOM)))
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.isDeleted)).toBe(true)
    }

    const [profile] = await db
      .select({ isDeleted: userProfiles.isDeleted })
      .from(userProfiles)
      .where(eq(userProfiles.id, P_DOOM))
    expect(profile?.isDeleted).toBe(true)
  })

  /**
   * ⚠️ AC-9. `forecastingProfiles` is profile-scoped and LIVE, but it is absent
   * from `entityTableMap`, so no push can express an operation on it — it can
   * only be reached as a consequence of the profile delete. It also has NO
   * `isDeleted` column, so it is the one child that is HARD-deleted.
   */
  it('HARD-deletes the deleted profile’s saved forecasts, keeping the survivor’s', async () => {
    await pushDelete(P_DOOM)

    const rows = await db
      .select({ profileId: forecastingProfiles.profileId })
      .from(forecastingProfiles)
      .where(eq(forecastingProfiles.userId, USER))
    expect(rows.map((r) => r.profileId)).toEqual([P_KEEP])
  })

  /**
   * ⚠⚠ THE DEFAULT PROFILE, which every other case in this file avoided — all of
   * them seeded `P_DOOM` as `isDefault: false` (code review). Story 63.2 made the
   * default deletable and it is the ORDINARY case, so the cascade needs to be
   * proven against it: the partial unique index
   * `userProfiles_one_default_per_user (userId) WHERE isDefault AND NOT isDeleted`
   * makes the default a genuinely different row to tombstone, and
   * `ensureUserHasDefaultProfile` must then repair the empty default set.
   */
  it('cascades the DEFAULT profile and leaves exactly one live default behind', async () => {
    // Swap the roles: the doomed profile is now the default.
    await db.update(userProfiles).set({ isDefault: false }).where(eq(userProfiles.id, P_KEEP))
    await db.update(userProfiles).set({ isDefault: true }).where(eq(userProfiles.id, P_DOOM))

    const result = await pushDelete(P_DOOM)
    expect(result.success).toBe(true)

    const live = await db
      .select({ id: userProfiles.id, isDefault: userProfiles.isDefault })
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, USER), eq(userProfiles.isDeleted, false)))
    expect(live.map((p) => p.id)).toEqual([P_KEEP])
    // The post-batch repair promoted the survivor rather than leaving none.
    expect(live.filter((p) => p.isDefault)).toHaveLength(1)

    // The cascade still ran for the default's children.
    const rows = await db
      .select({ isDeleted: incomeSources.isDeleted })
      .from(incomeSources)
      .where(eq(incomeSources.profileId, P_DOOM))
    expect(rows.every((r) => r.isDeleted)).toBe(true)
  })

  it('leaves the SURVIVING profile’s rows completely untouched', async () => {
    await pushDelete(P_DOOM)

    expect(await liveIds(incomeSources)).toEqual([R.incomeKeep])
    const [keeper] = await db
      .select({ isDeleted: userProfiles.isDeleted, isDefault: userProfiles.isDefault })
      .from(userProfiles)
      .where(eq(userProfiles.id, P_KEEP))
    expect(keeper).toEqual({ isDeleted: false, isDefault: true })
  })

  /**
   * ⚠️ A DECLINED delete must destroy nothing. The cascade runs only AFTER the
   * last-profile check, so declining has to leave every child row live — the
   * failure mode this guards is a cascade that ran FIRST and declined second,
   * which would destroy the data and then not delete the profile. Ordering, not
   * the envelope, is what this test is about.
   *
   * ⚠️ This does NOT prove the transaction rolls back a PARTIAL cascade; nothing
   * here can provoke a mid-cascade failure against a real schema, and claiming
   * otherwise would be the kind of overstatement this repo keeps catching. The
   * atomicity rests on the single `db.transaction` in `deleteProfileWithChildren`.
   */
  it('destroys NOTHING when the delete is declined as unsatisfiable', async () => {
    // Children first — these are HARD deletes against live FKs.
    await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
    await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
    await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

    const result = await pushDelete(P_DOOM)

    // ⚠️ ACKNOWLEDGED (see the last-profile block below for why the envelope says
    // success), but the cascade sits AFTER the check, so nothing was destroyed.
    expect(result.success).toBe(true)
    const rows = await db
      .select({ isDeleted: incomeSources.isDeleted })
      .from(incomeSources)
      .where(eq(incomeSources.profileId, P_DOOM))
    expect(rows.every((r) => !r.isDeleted)).toBe(true)
    const [profile] = await db
      .select({ isDeleted: userProfiles.isDeleted })
      .from(userProfiles)
      .where(eq(userProfiles.id, P_DOOM))
    expect(profile?.isDeleted).toBe(false)
  })
})

describe('the last-profile refusal on the live push path (AC-3)', () => {
  /**
   * ⚠⚠ THE INVARIANT IS "NEVER ZERO PROFILES", NOT "THE ENVELOPE SAYS FAILED",
   * and the two come apart here (code review, Lucas's call). The op is
   * ACKNOWLEDGED while the profile stays LIVE.
   *
   * The first version returned `{success:false}`, which reads as the stricter
   * choice and is the more dangerous one: a `{success:false}` in a 200 envelope
   * carries no http status, so core files it under `unclassifiedFailedOperations`
   * (`synchronization.ts:1103`) and `:1185-1194` KEEPS IT QUEUED — the op replays
   * forever, `failedCount > 0` on every sync, and the circuit breaker opens,
   * killing all sync for that account. Acknowledging drains the queue; the next
   * pull carries the real profile list and corrects the client.
   *
   * Both halves are asserted together on purpose: acknowledgement WITHOUT the
   * liveness check would pass against code that simply deleted the last profile.
   */
  it('ACKNOWLEDGES an unsatisfiable last-profile delete while keeping the profile live', async () => {
    await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
    await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
    await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

    const result = await pushDelete(P_DOOM)

    // Acknowledged, so the client queue drains instead of wedging.
    expect(result.success).toBe(true)
    expect(result.failedOperationIds).toHaveLength(0)

    // ...and the invariant AC-3 exists for still holds: the profile is LIVE.
    const [profile] = await db
      .select({ isDeleted: userProfiles.isDeleted })
      .from(userProfiles)
      .where(eq(userProfiles.id, P_DOOM))
    expect(profile?.isDeleted).toBe(false)
  })

  /**
   * ⚠️ THE SELF-HEAL PRECONDITION. Because the profile stays live, the next pull
   * delivers it as an ordinary `userProfile` change; `applyServerChanges` sets
   * `appliedProfile`, `reconcileActiveProfile` repoints off the id the client
   * deleted locally, and `useSync.ts:647` resets the pull cursor on that change —
   * so a full snapshot restores the rows the stale client destroyed. This test
   * pins the SERVER half of that chain (the profile is still pullable); the
   * client half is covered in `applyServerChanges.test.ts`.
   */
  it('still delivers the kept-alive profile to a pulling client', async () => {
    await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
    await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
    await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

    await pushDelete(P_DOOM)
    const changes = await getSyncChanges(USER, null, 100, P_DOOM)

    const profileChange = changes.find(
      (c) => c.entityType === 'userProfile' && c.entityId === P_DOOM
    )
    expect(profileChange).toBeDefined()
    expect(profileChange?.isDeleted).toBe(false)
    // And its children were never swept, so the snapshot pull restores them.
    expect(changes.some((c) => c.entityId === R.incomeDoom)).toBe(true)
  })

  /**
   * ⚠️ POSITIVE CONTROL. Without it the refusal above is indistinguishable from
   * "this push never worked" — the same batch shape succeeds while a second
   * profile is live.
   */
  it('allows the SAME delete while a second profile is live', async () => {
    const result = await pushDelete(P_DOOM)
    expect(result.success).toBe(true)
  })

  /**
   * ⚠️ The refusal is scoped to `userProfile`. A last-profile account must still
   * be able to delete an ordinary row, or the guard would freeze every deletion
   * for a single-profile user.
   */
  it('does NOT refuse an ordinary child delete for a single-profile user', async () => {
    await db.delete(forecastingProfiles).where(eq(forecastingProfiles.profileId, P_KEEP))
    await db.delete(incomeSources).where(eq(incomeSources.profileId, P_KEEP))
    await db.delete(userProfiles).where(eq(userProfiles.id, P_KEEP))

    const result = await processBatchSync(
      {
        operations: [
          op({
            type: 'delete',
            entityType: 'incomeSource',
            entityId: R.incomeDoom,
            profileId: P_DOOM,
          }),
        ],
        clientTimestamp: Date.now(),
        deviceId: 'device-1',
      } as never,
      PAID
    )

    expect(result.success).toBe(true)
  })
})

describe('what a SECOND device pulls afterwards (AC-8)', () => {
  /**
   * ⚠️⚠️ THE KNOWN RESIDUE, PINNED RATHER THAN HIDDEN. `getSyncChanges` filters
   * every child table by the CLIENT's active `profileId` (strict
   * `eq(table.profileId, profileId)`), so a second device sitting on P_KEEP
   * receives the PROFILE tombstone and NONE of the child tombstones — and once
   * the profile row is gone it can never make P_DOOM active to ask for them.
   *
   * Story 66.3 closes this LOCALLY instead: `applyServerChanges` runs the same
   * cascade when it applies a `userProfile` tombstone, so the second device
   * destroys its own copies without ever needing the child rows. This test pins
   * the server-side shape so a future change to `getSyncChanges` is a deliberate
   * decision and not a surprise.
   */
  it('delivers the profile tombstone but NOT the child tombstones', async () => {
    await pushDelete(P_DOOM)

    const changes = await getSyncChanges(USER, null, 100, P_KEEP)

    const profileChange = changes.find(
      (c) => c.entityType === 'userProfile' && c.entityId === P_DOOM
    )
    expect(profileChange?.isDeleted).toBe(true)
    expect(changes.some((c) => c.entityId === R.incomeDoom)).toBe(false)
    expect(changes.some((c) => c.entityId === R.expenseDoom)).toBe(false)
  })

  it('still delivers the surviving profile’s own rows', async () => {
    await pushDelete(P_DOOM)

    const changes = await getSyncChanges(USER, null, 100, P_KEEP)
    expect(changes.some((c) => c.entityId === R.incomeKeep)).toBe(true)
  })
})
