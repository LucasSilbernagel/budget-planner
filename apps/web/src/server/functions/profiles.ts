import { lockUserProfileSet } from '@/server/api/profile-set-lock'
import { db } from '@budget-planner/db'
import type { NewUserProfile, UserProfile } from '@budget-planner/db'
import { userProfiles, users } from '@budget-planner/db/src/schema'
import { and, eq } from 'drizzle-orm'
import type { ApiResult } from '../api/auth/paddle'

export async function getProfiles(userId: string): Promise<ApiResult<UserProfile[]>> {
  try {
    const profiles = await db
      .select()
      .from(userProfiles)
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
 * Race-safe via the partial unique index plus onConflictDoNothing (Paddle can deliver
 * paid and completed concurrently). The write runs under the per-user writer lock.
 */
export async function createDefaultProfileForUser(userId: string): Promise<ApiResult<UserProfile>> {
  try {
    // Lock-free fast path, since this runs on every pull. The isDeleted filter is
    // load-bearing and matches the partial unique index.
    const existingProfiles = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

    if (existingProfiles.length > 0) {
      return {
        success: true,
        data: existingProfiles[0],
      }
    }

    // Every statement uses `tx`: an autocommit `db` query here would wait on PGlite's
    // single connection and run outside the lock on PostgreSQL.
    return await db.transaction(async (tx): Promise<ApiResult<UserProfile>> => {
      await lockUserProfileSet(tx, userId, 'no key update')

      // Re-check under the lock: another writer may have committed since the fast path.
      const [liveProfile] = await tx
        .select()
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
        .limit(1)
      if (liveProfile) {
        return { success: true, data: liveProfile }
      }

      const [user] = await tx
        .select({ currency: users.currency })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      const userCurrency = user?.currency || 'NONE'

      // onConflictDoNothing absorbs a concurrent insert by an unlocked writer.
      const [defaultProfile] = await tx
        .insert(userProfiles)
        .values({
          userId,
          name: 'Main Profile',
          description: 'Your primary financial profile',
          currency: userCurrency,
          isDefault: true,
          // Stamped after the lock: the column default now() is the transaction start,
          // and an earlier stamp could let a pull cursor skip this profile.
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

      // Lost the race: read back the winner's row rather than report a failure.
      const [existingDefault] = await tx
        .select()
        .from(userProfiles)
        .where(
          and(
            eq(userProfiles.userId, userId),
            eq(userProfiles.isDefault, true),
            // Tombstones excluded, matching the partial unique index.
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
