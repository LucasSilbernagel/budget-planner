// @vitest-environment node
/**
 * Profile deletion through the LIVE path: `processBatchSync`, against real
 * PostgreSQL (story 63.2 code review).
 *
 * ⚠️⚠️ WHY THIS FILE EXISTS. Story 63.2's own headline is that
 * `server/functions/profiles.ts:deleteProfile` has ZERO production callers and
 * that a real deletion travels store -> `syncEntityDelete`/`syncEntityUpdate` ->
 * the sync push. The story then proved its promotion against (a) a fake bridge
 * handle that only records calls, and (b) a PGlite test of the function nothing
 * calls. **All three review layers pointed at the same hole: the path the story
 * says is the real one had no test against a real database.** That is the exact
 * shape of the `profileId`-stripping defect this repo already shipped green
 * once — a mocked suite agreeing with itself.
 *
 * Harness (PGlite + full migration chain via a `vi.hoisted` holder) copied from
 * `sync-push-pull-roundtrip.db.test.ts`.
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

import { userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { processBatchSync } from '../sync'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

const USER = '11111111-1111-4111-8111-111111111111'
const P_DEFAULT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const P_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
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
    // ⚠️ Even a DELETE needs `data: { userId }` ("Delete operations require
    // userId in data"), and ONE operation that fails validation fails the
    // ENTIRE batch — `processedCount: 0`, empty `failedOperationIds`, and a
    // `status: 'FAILED'` whose cause is only in `error`. Getting this wrong made
    // all four tests fail in a way that read as a defect in the code under test.
    data: { userId: USER },
    ...overrides,
  }
}

/** The exact payload shape `syncBridge.toServerPayload` builds for a profile. */
function profilePayload(name: string, isDefault: boolean) {
  return { name, isDefault, currency: 'NONE', userId: USER }
}

function push(operations: unknown[]) {
  return processBatchSync(
    { operations, clientTimestamp: Date.now(), deviceId: 'device-1' } as never,
    PAID
  )
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
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
  await db.insert(userProfiles).values([
    { id: P_DEFAULT, userId: USER, name: 'Main Profile', isDefault: true },
    { id: P_OTHER, userId: USER, name: 'Business', isDefault: false },
  ])
})

describe('the delete + promote pair the store queues (story 63.2)', () => {
  it('applies both and leaves exactly one live default', async () => {
    const result = await push([
      op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_OTHER,
        data: profilePayload('Business', true),
      }),
    ])

    expect(result.success).toBe(true)
    const live = await liveProfiles()
    expect(live.map((p) => p.id)).toEqual([P_OTHER])
    expect(live.filter((p) => p.isDefault)).toHaveLength(1)
  })

  /**
   * ⚠️ ORDER NO LONGER MATTERS (story 76.1, decision D1 — Lucas, 2026-09-28).
   *
   * This test used to be "REJECTS the promotion if it arrives before the
   * tombstone": `userProfiles_one_default_per_user` refused a promotion while the
   * old default was still live, and the post-batch repair then picked a default.
   * Story 76.1 measured what that cost on the LIVE path, where the client sends
   * one op per request: the repair after the lone tombstone gives the seat to the
   * OLDEST survivor, so the device's own promotion hit the index and stayed
   * queued for ever. A promotion now DEMOTES the current default in the same
   * transaction (`promoteProfile` in `sync.ts`), so the reversed batch applies in
   * full and keeps the successor the device chose.
   */
  it('applies the promotion even if it arrives before the tombstone — no op fails', async () => {
    const result = await push([
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_OTHER,
        data: profilePayload('Business', true),
      }),
      op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
    ])

    // The discriminating assertions: before story 76.1 the promotion failed here.
    expect(result.success).toBe(true)
    expect(result.failedOperationIds).toEqual([])
    // ⚠️ Not discriminating with two profiles — P_OTHER is also the repair's
    // pick. "Keeps the chosen successor" is proven where the survivor is NOT the
    // oldest: `sync-delete-idempotent.db.test.ts`, the one-device promotion test.
    const live = await liveProfiles()
    expect(live.map((p) => p.id)).toEqual([P_OTHER])
    expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
  })
})

describe('a stale device cannot demote the only live default (code review HIGH)', () => {
  /**
   * ⚠️⚠️ THE DEFECT THIS PINS, reproduced against real PostgreSQL before it was
   * fixed. Device A deletes the default; the server promotes Business. Device B
   * has NOT pulled — a push does not pull first — so its copy of Business still
   * says `isDefault: false`. B renames Business. `syncBridge` sends `isDefault`
   * on every profile update, `updateEntity` spreads it into `.set()`, and
   * `checkConflict`'s update arm only tests existence. So an ordinary RENAME
   * cleared the flag and the account was left with ZERO live defaults — with
   * the push reporting success.
   *
   * That is silent corruption, not an error: every consumer resolves the
   * default as `find(p => p.isDefault) ?? data[0]`, so each device then falls
   * back to an arbitrary profile.
   */
  it('keeps the flag when a stale rename re-sends isDefault:false', async () => {
    // Device A's deletion, already applied.
    await push([
      op({ type: 'delete', entityType: 'userProfile', entityId: P_DEFAULT }),
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_OTHER,
        data: profilePayload('Business', true),
      }),
    ])

    // Device B, which never pulled, renames the same profile.
    const stale = await push([
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_OTHER,
        data: profilePayload('Consulting', false),
      }),
    ])

    expect(stale.success).toBe(true)
    const live = await liveProfiles()
    // The rename landed...
    expect(live.map((p) => p.name)).toEqual(['Consulting'])
    // ...and the account still has a default. Before the fix this was [].
    expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
  })

  /**
   * ⚠️ POSITIVE CONTROL. The guard must not weld the flag on: a demotion is
   * still honoured whenever another live profile already carries it, which is
   * what a genuine "make that other one the default" sequence looks like.
   * Without this test the guard could be `if (isDefault === false) ignore it`
   * and every assertion above would still pass.
   */
  it('still honours a demotion when another live profile is already default', async () => {
    const result = await push([
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_DEFAULT,
        data: profilePayload('Main Profile', false),
      }),
      op({
        type: 'update',
        entityType: 'userProfile',
        entityId: P_OTHER,
        data: profilePayload('Business', true),
      }),
    ])

    expect(result.success).toBe(true)
    const live = await liveProfiles()
    expect(live.filter((p) => p.isDefault).map((p) => p.id)).toEqual([P_OTHER])
  })
})
