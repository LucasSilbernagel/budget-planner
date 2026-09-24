// @vitest-environment node
/**
 * Deleting the default profile promotes a survivor, against REAL PostgreSQL
 * (story 63.2, FR97, AC-3).
 *
 * ⚠️⚠️ WHY THIS LAYER EXISTS AT ALL. Every other test of this code mocks the
 * database, and the constraint that makes this story hard lives ONLY in the
 * database: migration 0017's
 * `userProfiles_one_default_per_user UNIQUE (userId) WHERE isDefault AND NOT isDeleted`.
 * Against a Drizzle stub, promoting before deleting and promoting after deleting
 * are indistinguishable — both "succeed". A mocked suite is exactly how the
 * `profileId`-stripping push defect once shipped green.
 *
 * The harness (PGlite + the full migration chain via a `vi.hoisted` holder) is
 * copied from `server/api/__tests__/sync-push-pull-roundtrip.db.test.ts`.
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

vi.mock('../../api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

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
import { getCurrentUserSession } from '../../api/auth/paddle'
import { deleteProfile } from '../profiles'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P_DEFAULT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P_SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const P_THIRD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let pg: PGlite
let db: ReturnType<typeof drizzle>

const request = new Request('https://example.test/profiles')

function signedInAsPaid(): void {
  vi.mocked(getCurrentUserSession).mockResolvedValue({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime' },
  } as never)
}

async function liveProfiles() {
  return db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, USER), eq(userProfiles.isDeleted, false)))
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
  vi.clearAllMocks()
  signedInAsPaid()
  // Children first — every FK here is `ON DELETE no action`, so the profile rows
  // cannot go while anything references them (story 66.3 added child rows to
  // this file).
  await db.delete(forecastingProfiles).where(eq(forecastingProfiles.userId, USER))
  await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
  await db.delete(expenses).where(eq(expenses.userId, USER))
  await db.delete(categories).where(eq(categories.userId, USER))
  await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
  await db.delete(balanceTracking).where(eq(balanceTracking.userId, USER))
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
  await db.insert(userProfiles).values([
    {
      id: P_DEFAULT,
      userId: USER,
      name: 'Main Profile',
      isDefault: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: P_SECOND,
      userId: USER,
      name: 'Business',
      isDefault: false,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    },
    {
      id: P_THIRD,
      userId: USER,
      name: 'Side Project',
      isDefault: false,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    },
  ])
})

describe('the partial unique index is real in this database', () => {
  /**
   * ⚠️ POSITIVE CONTROL FOR THE WHOLE FILE. Every assertion below is only worth
   * something if the index is actually enforced here — a migration chain that
   * silently failed to create it would make the "promotion succeeds" tests pass
   * for the wrong reason. This proves a second live default is rejected, which
   * is also exactly what a promote-before-delete ordering would attempt.
   */
  it('rejects a second live default for the same user', async () => {
    await expect(
      db.update(userProfiles).set({ isDefault: true }).where(eq(userProfiles.id, P_SECOND))
    ).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('deleteProfile on the DEFAULT profile (story 63.2)', () => {
  it('deletes it and promotes exactly one survivor', async () => {
    const result = await deleteProfile(request, P_DEFAULT)

    expect(result.success).toBe(true)
    const live = await liveProfiles()
    expect(live.map((p) => p.id).sort()).toEqual([P_SECOND, P_THIRD].sort())
    expect(live.filter((p) => p.isDefault)).toHaveLength(1)
    // The server has no notion of the client's ACTIVE profile, so it promotes
    // the OLDEST survivor — deterministically, not arbitrarily.
    expect(live.find((p) => p.isDefault)?.id).toBe(P_SECOND)
  })

  it('leaves the account with a resolvable default for `find(p => p.isDefault)`', async () => {
    const result = await deleteProfile(request, P_DEFAULT)

    // ⚠️ THESE TWO LINES ARE WHAT MAKE THE TEST DISCRIMINATING (code review).
    // Without them it was same-outcome: `find(isDefault)` is equally defined
    // when NOTHING was deleted, so the test stayed green at baseline AND under
    // the promote-before-delete mutation, where the transaction aborts and the
    // old default simply survives. Assert the deletion happened first.
    expect(result.success).toBe(true)
    const live = await liveProfiles()
    expect(live.map((p) => p.id)).not.toContain(P_DEFAULT)
    // ⚠️ The shape every consumer uses (`routes/forecasting.tsx:296`,
    // `lib/sync/applyServerChanges.ts:182`) is `find(isDefault) ?? data[0]` — a
    // fallback that yields the WRONG profile rather than an error, so "no
    // default" is silent corruption, not a crash. This asserts the `find` half
    // resolves on its own.
    expect(live.find((p) => p.isDefault)).toBeDefined()
  })

  it('still refuses the last profile, default or not', async () => {
    await db.delete(userProfiles).where(eq(userProfiles.id, P_SECOND))
    await db.delete(userProfiles).where(eq(userProfiles.id, P_THIRD))

    const result = await deleteProfile(request, P_DEFAULT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/last profile/i)
    expect(await liveProfiles()).toHaveLength(1)
  })

  it('promotes nothing when a NON-default profile is deleted', async () => {
    const result = await deleteProfile(request, P_SECOND)

    expect(result.success).toBe(true)
    const live = await liveProfiles()
    expect(live.find((p) => p.isDefault)?.id).toBe(P_DEFAULT)
    expect(live.filter((p) => p.isDefault)).toHaveLength(1)
  })
})

/**
 * The full child cascade (story 66.3, FR104, AC-5).
 *
 * ⚠️⚠️ BEFORE 66.3 THIS FUNCTION WAS BROKEN TWICE OVER and no test said so,
 * because every existing case here deletes a profile that owns NOTHING. The
 * `userProfiles` delete violated each child's `profileId` FK, and the
 * `categories` delete violated `incomeSources.categoryId`/`expenses.categoryId`
 * for any categorised row. Removing the six new `tx.delete` lines in
 * `deleteProfile` turns these red and leaves the rest of the file green.
 *
 * ⚠️ This function still has ZERO production callers — a user's deletion travels
 * the store and the sync push (`server/api/__tests__/sync-profile-cascade.db.test.ts`
 * is that path's proof). It is tested because a WRONG guard left in an unreached
 * authorisation boundary is a bug the next caller inherits.
 */
describe('deleteProfile destroys the profile’s children (story 66.3, AC-5)', () => {
  const CAT_SECOND = 'e0000000-0000-4000-8000-000000000001'
  const INCOME_SECOND = 'e0000000-0000-4000-8000-000000000002'
  const EXPENSE_SECOND = 'e0000000-0000-4000-8000-000000000003'
  const INCOME_THIRD = 'e0000000-0000-4000-8000-000000000004'

  beforeEach(async () => {
    await db
      .insert(categories)
      .values([
        { id: CAT_SECOND, userId: USER, profileId: P_SECOND, name: 'Software', kind: 'expense' },
      ])
    await db.insert(incomeSources).values([
      {
        id: INCOME_SECOND,
        userId: USER,
        profileId: P_SECOND,
        name: 'Consulting',
        amount: 100_000,
        frequency: 'monthly',
      },
      {
        id: INCOME_THIRD,
        userId: USER,
        profileId: P_THIRD,
        name: 'Royalties',
        amount: 5_000,
        frequency: 'annually',
      },
    ])
    await db.insert(expenses).values([
      {
        id: EXPENSE_SECOND,
        userId: USER,
        profileId: P_SECOND,
        name: 'Office',
        amount: 90_000,
        frequency: 'monthly',
        // ⚠️ Categorised on purpose: this is the FK that made the old
        // `categories`-only delete fail.
        categoryId: CAT_SECOND,
      },
    ])
    await db
      .insert(savingsGoals)
      .values([{ userId: USER, profileId: P_SECOND, name: 'Tax pot', currentBalance: 10_000 }])
    await db.insert(balanceTracking).values([
      {
        userId: USER,
        profileId: P_SECOND,
        type: 'investment',
        name: 'ISA',
        currentBalance: 1_000,
      },
    ])
    await db
      .insert(forecastingProfiles)
      .values([{ userId: USER, profileId: P_SECOND, name: 'Scenario', scenarioData: '{}' }])
  })

  it('succeeds for a profile that owns rows in all six child tables', async () => {
    const result = await deleteProfile(request, P_SECOND)

    expect(result.success).toBe(true)
    expect((await liveProfiles()).map((p) => p.id).sort()).toEqual([P_DEFAULT, P_THIRD].sort())
  })

  it('removes every child row of the deleted profile', async () => {
    await deleteProfile(request, P_SECOND)

    for (const table of [
      incomeSources,
      expenses,
      categories,
      savingsGoals,
      balanceTracking,
      forecastingProfiles,
    ]) {
      const rows = await db.select().from(table).where(eq(table.profileId, P_SECOND))
      expect(rows).toEqual([])
    }
  })

  it('leaves another profile’s rows alone', async () => {
    await deleteProfile(request, P_SECOND)

    const rows = await db
      .select({ id: incomeSources.id })
      .from(incomeSources)
      .where(eq(incomeSources.profileId, P_THIRD))
    expect(rows.map((r) => r.id)).toEqual([INCOME_THIRD])
  })

  /**
   * ⚠️ AC-5's second half. A genuine, reachable 23503: nothing stops an income
   * row in profile B from citing a category owned by profile A, so deleting A
   * removes a category B still references. The user must get a fixed string, not
   * the driver's constraint name.
   */
  it('returns a GENERIC message when the delete fails, never the driver text', async () => {
    await db
      .update(incomeSources)
      .set({ categoryId: CAT_SECOND })
      .where(eq(incomeSources.id, INCOME_THIRD))

    const result = await deleteProfile(request, P_SECOND)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to delete profile')
    // The things that must NOT reach a user.
    expect(result.error).not.toContain('constraint')
    expect(result.error).not.toContain('incomeSources')
    // And the deletion rolled back rather than half-applying.
    expect((await liveProfiles()).map((p) => p.id)).toContain(P_SECOND)
  })
})
