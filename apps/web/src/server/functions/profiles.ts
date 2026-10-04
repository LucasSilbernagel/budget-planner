/**
 * Profile server functions.
 *
 * What is left here is two user-scoped cores, both called by server code that
 * has already authenticated the user: `getProfiles` (the premium-gated
 * `routes/api/profiles.ts`) and `createDefaultProfileForUser` (the pull
 * backfill `routes/api/sync/changes.ts` and the Paddle webhook).
 *
 * Profile create, update and delete are NOT here: a user's profile writes all
 * travel the client store -> the sync push (`server/api/sync.ts`). The unused
 * request-taking `getProfile` / `updateProfile` / `deleteProfile` (no production
 * importer, story 63.2) were deleted by story 93.1, after `createProfile` /
 * `setDefaultProfile` went the same way in story 92.1.
 *
 * Database: Drizzle ORM with DanubeData PostgreSQL (Germany - EU only)
 */

import { lockUserProfileSet } from '@/server/api/profile-set-lock'
import { db } from '@budget-planner/db'
import type { NewUserProfile, UserProfile } from '@budget-planner/db'
import { userProfiles, users } from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import type { ApiResult } from '../api/auth/paddle'

/**
 * Get the live profiles of `userId`, oldest first.
 *
 * ⚠️ A USER-SCOPED CORE since story 83.1 (FR136): the caller has authenticated
 * `userId` and checked premium access, and `routes/api/profiles.ts` is that caller
 * (the premium tier boundary of story 13-3, AC-2, is enforced there now). It used
 * to take the `Request`, and the forecasting page `import()`ed it in the BROWSER,
 * which bundled `pg` into the client and failed on `Buffer` (story 80.1 Fact R).
 */
export async function getProfiles(userId: string): Promise<ApiResult<UserProfile[]>> {
  try {
    const profiles = await db
      .select()
      .from(userProfiles)
      // Exclude soft-deleted tombstones (Story 4-18): a profile deleted on
      // another device via sync must not resurface here.
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
      .orderBy(userProfiles.createdAt)

    return {
      success: true,
      data: profiles,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch profiles',
    }
  }
}

/**
 * Auto-create default profile for a new user
 * This should be called when a user is created
 *
 * ⚠️ RACE-SAFE AT THE DATABASE LEVEL (Story 5-19, AC-4). The check-then-insert
 * below is NOT sufficient on its own and never was: one lifetime purchase emits
 * BOTH `transaction.paid` and `transaction.completed`, the webhook accepts both,
 * and processed concurrently they both saw zero rows here and both inserted —
 * leaving two "Main Profile" rows with `isDefault: true`, after which
 * profile-scoped reads pick arbitrarily and the buyer's data appears to vanish
 * between requests. The docblock used to claim this function was "idempotent";
 * that held for SERIAL calls only, which is not the case it was cited for.
 *
 * What makes it safe is the partial unique index
 * `userProfiles_one_default_per_user` (migration 0017) plus the
 * `onConflictDoNothing` below: the loser of the race inserts nothing and reads
 * back the winner's row. The index is still the guarantee.
 *
 * ⚠️ Since story 80.2 (FR130(2)) the WRITE runs in a transaction whose first
 * statement is the per-user writer lock (`lockUserProfileSet`, `'no key
 * update'`), with the "no live profile" check re-run under it. That orders this
 * writer against the post-batch default repair, promotions and sync profile
 * creates, which take the same lock; before it, the repair could read "no
 * default", lose the seat to this insert and 23505 after its batch committed.
 * Every live-path writer of the seat is now locked, so the conflict below is no
 * longer reachable from them. `onConflictDoNothing` and the read-back stay as
 * defence in depth: the unlocked writers they also guarded, `createProfile` and
 * `setDefaultProfile` (no production importer), were deleted by story 92.1.
 *
 * The first SELECT is a lock-free, READ-ONLY fast path (decision D2): this runs
 * on every pull, and a lock there would make every pull conflict with the
 * `FOR SHARE` of every child create of the user.
 */
export async function createDefaultProfileForUser(userId: string): Promise<ApiResult<UserProfile>> {
  try {
    // Fast path: user already has a LIVE profile. Read-only and lock-free (D2).
    // Safe in the SKIP direction: once a user has a live profile, no sync path
    // can take them to zero (the last-profile rule runs under the same lock), and
    // erasure/purge delete the `users` row too, so an insert would fail its FK.
    // ⚠️ `isDeleted` filter is load-bearing — code review. Without it a user
    // whose only profile is a tombstone is reported as already provisioned, and
    // the tombstone is handed back as their default profile. It also matches
    // the partial unique index, which excludes tombstones.
    const existingProfiles = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

    if (existingProfiles.length > 0) {
      // User already has profiles
      return {
        success: true,
        data: existingProfiles[0],
      }
    }

    // ⚠️ EVERY statement below uses `tx`: an autocommit `db` query issued while
    // this transaction is open waits for it on a single connection (PGlite), and
    // on PostgreSQL it would run outside the lock.
    return await db.transaction(async (tx): Promise<ApiResult<UserProfile>> => {
      await lockUserProfileSet(tx, userId, 'no key update')

      // Re-check under the lock: another writer may have committed a profile
      // since the fast path read.
      const [liveProfile] = await tx
        .select()
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
        .limit(1)
      if (liveProfile) {
        return { success: true, data: liveProfile }
      }

      // Get user's currency preference
      const [user] = await tx
        .select({ currency: users.currency })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      const userCurrency = user?.currency || 'NONE'

      // Create default profile. `onConflictDoNothing` absorbs a concurrent insert
      // by an unlocked writer (see the docblock): the index covers (userId) WHERE
      // isDefault AND NOT isDeleted, so a second insert writes nothing.
      const [defaultProfile] = await tx
        .insert(userProfiles)
        .values({
          userId,
          name: 'Main Profile',
          description: 'Your primary financial profile',
          currency: userCurrency,
          isDefault: true,
          // Stamped here, AFTER the lock (code review 80.2): the column default
          // `now()` is the TRANSACTION start, before the lock wait, and a row of
          // the user committed during the wait could move a device's pull cursor
          // (`updatedAt > since`) past this profile. `createEntity` stamps the same.
          updatedAt: new Date(),
        } as NewUserProfile)
        .onConflictDoNothing()
        .returning()

      if (defaultProfile) {
        return {
          success: true,
          data: defaultProfile,
        }
      }

      // Lost the race: the winner's row is committed, so read it back rather than
      // reporting a failure the caller would log as a provisioning error.
      const [existingDefault] = await tx
        .select()
        .from(userProfiles)
        .where(
          and(
            eq(userProfiles.userId, userId),
            eq(userProfiles.isDefault, true),
            // Tombstones excluded, matching the partial unique index this
            // read-back complements — `(userId) WHERE isDefault AND NOT
            // isDeleted`. Without it a soft-deleted default could be returned as
            // the caller's live default profile.
            eq(userProfiles.isDeleted, false)
          )
        )
        .limit(1)

      if (existingDefault) {
        return {
          success: true,
          data: existingDefault,
        }
      }

      return {
        success: false,
        error: 'Failed to create default profile',
      }
    })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create default profile',
    }
  }
}
