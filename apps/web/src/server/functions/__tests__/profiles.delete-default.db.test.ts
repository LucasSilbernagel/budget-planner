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

import { userProfiles, users } from '@budget-planner/db'
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
