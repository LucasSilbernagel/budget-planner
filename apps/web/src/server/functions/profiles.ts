/**
 * Profile Server Functions
 *
 * Server functions for managing user profiles in the Budget Planner application.
 * Handles profile CRUD operations for paid tier users.
 *
 * Architecture: TanStack Start Server Functions
 * Database: Drizzle ORM with DanubeData PostgreSQL (Germany - EU only)
 * Authentication: Requires valid user session via Paddle
 */

import type { Currency } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import type { NewUserProfile, UserProfile } from '@budget-planner/db'
import { categories, userProfiles, users } from '@budget-planner/db/src/schema'
import { and, eq, ne } from 'drizzle-orm'
import { getCurrentUserSession } from '../api/auth/paddle'
import type { ApiResult } from '../api/auth/paddle'

// Type definitions for API requests
// Note: These extend the base ApiResult from paddle auth for consistency
export interface CreateProfileInput {
  name: string
  description?: string
  // ⚠️ The `userProfiles.currency` column is `currencyEnum`
  // (`packages/db/src/schema.ts:333`), so a bare `string` let any value reach a
  // `.set()` on it — must be the `Currency` union.
  currency?: Currency
}

export interface UpdateProfileInput extends Partial<CreateProfileInput> {
  id: string // Changed from number to string (UUID)
}

/**
 * Create a new profile for the current user
 */
export async function createProfile(
  request: Request,
  input: CreateProfileInput
): Promise<ApiResult<UserProfile>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

    // Validate input
    if (!input.name || typeof input.name !== 'string') {
      return {
        success: false,
        error: 'Profile name is required',
      }
    }

    if (input.name.length > 255) {
      return {
        success: false,
        error: 'Profile name must be 255 characters or less',
      }
    }

    // Check if user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)

    if (!user) {
      return {
        success: false,
        error: 'User not found',
      }
    }

    // Check if this would be the user's first profile
    const existingProfiles = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))

    // Create the profile
    const isDefault = existingProfiles.length === 0

    const [newProfile] = await db
      .insert(userProfiles)
      .values({
        userId: user.id,
        name: input.name,
        description: input.description,
        currency: input.currency || user.currency || 'NONE',
        isDefault,
      } as NewUserProfile)
      .returning()

    return {
      success: true,
      data: newProfile,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create profile',
    }
  }
}

/**
 * Get all profiles for the current user
 */
export async function getProfiles(request: Request): Promise<ApiResult<UserProfile[]>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

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
 * Get a specific profile by ID
 */
export async function getProfile(
  request: Request,
  profileId: string
): Promise<ApiResult<UserProfile>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.id, profileId),
          eq(userProfiles.userId, userId),
          eq(userProfiles.isDeleted, false)
        )
      )
      .limit(1)

    if (!profile) {
      return {
        success: false,
        error: 'Profile not found or not authorized',
      }
    }

    return {
      success: true,
      data: profile,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch profile',
    }
  }
}

/**
 * Update an existing profile
 */
export async function updateProfile(
  request: Request,
  input: UpdateProfileInput
): Promise<ApiResult<UserProfile>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

    // Validate input
    if (!input.id) {
      return {
        success: false,
        error: 'Profile ID is required',
      }
    }

    // Check if profile exists and belongs to user (and is not a tombstone — 4-18)
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.id, input.id),
          eq(userProfiles.userId, userId),
          eq(userProfiles.isDeleted, false)
        )
      )
      .limit(1)

    if (!existingProfile) {
      return {
        success: false,
        error: 'Profile not found or not authorized',
      }
    }

    // Check if trying to change to a duplicate name
    if (input.name) {
      const duplicateCheck = await db
        .select()
        .from(userProfiles)
        .where(
          and(
            eq(userProfiles.name, input.name),
            eq(userProfiles.userId, userId),
            ne(userProfiles.id, input.id) // Exclude current profile
          )
        )
        .limit(1)

      if (duplicateCheck.length > 0) {
        return {
          success: false,
          error: 'A profile with this name already exists',
        }
      }
    }

    // Update the profile
    const [updatedProfile] = await db
      .update(userProfiles)
      .set({
        name: input.name,
        description: input.description,
        currency: input.currency,
        // ⚠️ `new Date()`, not `.toISOString()`. The column is
        // `timestamp('updatedAt')` (`packages/db/src/schema.ts`), and drizzle's date
        // mapper calls `.toISOString()` on the value it is given — so handing it a
        // STRING throws at runtime. Every other `.set()` in the codebase passes a
        // `Date` (e.g. `api/data/financialData.ts:223,272,402`); these were the odd
        // ones out.
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, input.id))
      .returning()

    return {
      success: true,
      data: updatedProfile,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update profile',
    }
  }
}

/**
 * Delete a profile.
 *
 * ⚠️⚠️ THIS FUNCTION HAS NO PRODUCTION CALLER, and that is not a claim about
 * what "should" call it — story 63.2 measured it with an IMPORT grep
 * (`grep -rn "functions/profiles'" apps/web/src`), which returns only
 * `getProfiles` (`routes/forecasting.tsx`) and `createDefaultProfileForUser`
 * (`routes/api/webhooks/paddle.ts`, `routes/api/sync/changes.ts`).
 *
 * ⚠️ That grep pattern is the RECORD of how the claim was checked, not a
 * complete one: `functions/profiles'` cannot see a relative import such as
 * `from './profiles'`, which is how the tests in this directory import it. To
 * re-check, use `grep -rnE "from ['\"](\.\./|\./)+(server/functions/)?profiles"`
 * as well. The conclusion is unchanged — production importers are the three
 * above — but the method as written would miss a future sibling module. A user's
 * deletion travels `components/profiles/profile-list.tsx` ->
 * `stores/profileStore.ts:removeProfile` -> `syncEntityDelete` -> the sync push,
 * which SOFT-deletes (`server/api/sync.ts:681-710`) and enforces neither the
 * default nor the last-profile rule.
 *
 * ⚠️ It is kept, not deleted: it is an authorisation boundary with a live
 * premium-gate test, and it is where a non-sync deletion path would land. A
 * WRONG guard left in an unreached boundary is a bug the next caller inherits —
 * which is why story 63.2 relaxed the default rule here as well as in the store,
 * rather than leaving the two to disagree.
 *
 * ⚠️ Unlike the sync path this performs a HARD delete of the profile row.
 */
export async function deleteProfile(request: Request, profileId: string): Promise<ApiResult<void>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

    // Check if profile exists and belongs to user (and is not a tombstone — 4-18)
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.id, profileId),
          eq(userProfiles.userId, userId),
          eq(userProfiles.isDeleted, false)
        )
      )
      .limit(1)

    if (!existingProfile) {
      return {
        success: false,
        error: 'Profile not found or not authorized',
      }
    }

    // ⚠️ Story 63.2 (FR97) REMOVED the default-profile refusal that stood here.
    // The default is deletable whenever another live profile exists; a survivor
    // is promoted below so the account is never left with zero defaults.

    // Check if this is the user's last profile. Exclude soft-deleted tombstones
    // (Story 4-18) so the limit/last-profile check counts only live profiles.
    const profileCount = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

    // ⚠️ UNCHANGED by story 63.2, deliberately. Relaxing the default rule does
    // not relax this one: a user with no profile at all has nowhere to put data.
    if (profileCount.length <= 1) {
      return {
        success: false,
        error: 'Cannot delete the last profile. Create a new profile first.',
      }
    }

    // ⚠️ The server has no notion of the client's ACTIVE profile, so it cannot
    // make the store's choice and does not try: it promotes the oldest surviving
    // profile. When the deletion arrives through the normal client path the
    // store has already promoted the active one and queued that update, so this
    // is the fallback for a caller with no such context.
    //
    // ⚠️ The successor is selected INSIDE the transaction below, not from the
    // `profileCount` snapshot above (code review). Choosing it out here let a
    // concurrent deletion of that same profile turn the promotion into an
    // `UPDATE ... WHERE id = <gone>` that matches zero rows while the
    // transaction still committed — leaving the account with no default at all.

    // ⚠️ THERE IS NO CASCADE. Every FK in this schema is `ON DELETE no action`
    // (correction by code review 30.4a — this comment previously claimed
    // "cascade will delete related financial data", which has never been true).
    // Children must be deleted explicitly, parent last, or Postgres raises
    // 23503 and the raw driver message is returned to the UI.
    //
    // `categories` is deleted here because Story 30.4a made it a profile-scoped
    // child: without this, deleting a profile that owns nothing but categories
    // — a case that worked before this story — now fails.
    //
    // ⚠️ The other profile-scoped children (incomeSources, expenses,
    // savingsGoals, balanceTracking, forecastingProfiles) are NOT deleted here.
    // That gap PRE-DATES this story: deleting a profile holding any of them has
    // always failed on the FK. Recorded in deferred-work.md rather than fixed
    // in a review pass, because "delete a profile" silently destroying its
    // financial data is a product decision, not a defect fix.
    // Wrap in transaction to ensure atomicity
    await db.transaction(async (tx) => {
      await tx.delete(categories).where(eq(categories.profileId, profileId))
      await tx.delete(userProfiles).where(eq(userProfiles.id, profileId))

      // ⚠️⚠️ ORDER IS A DATABASE CONSTRAINT (story 63.2). Migration 0017's
      // `userProfiles_one_default_per_user` is UNIQUE on (userId) WHERE
      // isDefault AND NOT isDeleted, so the successor can only be flagged once
      // the old default's row is gone. Promote before the delete and this
      // transaction aborts on a unique violation.
      if (existingProfile.isDefault) {
        // Re-read inside the transaction, excluding tombstones, so a profile
        // deleted concurrently cannot be "promoted" into a no-op update.
        const survivors = await tx
          .select({ id: userProfiles.id, createdAt: userProfiles.createdAt })
          .from(userProfiles)
          .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

        // ⚠️ `createdAt` alone is NOT a total order: `createDefaultProfileForUser`
        // can write profiles inside one transaction, so ties are real and "the
        // oldest" would otherwise mean "whatever the planner returned first".
        // The `id` tiebreak makes the choice reproducible — matching the repair
        // in `server/api/sync.ts`.
        const successor = [...survivors].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
        )[0]

        if (!successor) {
          // Unreachable given the last-profile guard above, but a promotion that
          // silently finds nobody is exactly the failure this story exists to
          // remove — so it fails loudly and rolls the deletion back.
          throw new Error('Cannot delete the default profile: no surviving profile to promote')
        }

        await tx
          .update(userProfiles)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(and(eq(userProfiles.id, successor.id), eq(userProfiles.userId, userId)))
      }
    })

    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete profile',
    }
  }
}

/**
 * Set a profile as the default
 */
export async function setDefaultProfile(
  request: Request,
  profileId: string
): Promise<ApiResult<void>> {
  try {
    // Extract userId from authenticated session
    const sessionResult = await getCurrentUserSession(request)

    if (!sessionResult.success || !sessionResult.data) {
      return {
        success: false,
        error: sessionResult.error || 'Authentication required',
      }
    }

    // Premium tier boundary (Story 13-3, AC-2): custom profiles is a Premium
    // feature, so a non-active subscription is denied at the server boundary —
    // mirroring forecastingProfiles.ts / financial.ts — not merely hidden in the UI.
    if (
      sessionResult.data.subscriptionStatus !== 'active' &&
      sessionResult.data.subscriptionStatus !== 'lifetime'
    ) {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to manage custom profiles',
      }
    }

    const userId = sessionResult.data.userId

    // First, unset default flag from all profiles
    await db.update(userProfiles).set({ isDefault: false }).where(eq(userProfiles.userId, userId))

    // Then set the specified profile as default
    await db
      .update(userProfiles)
      .set({ isDefault: true })
      .where(and(eq(userProfiles.id, profileId), eq(userProfiles.userId, userId)))

    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set default profile',
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
 * back the winner's row. The pre-check remains as a cheap fast path for the
 * common (already-provisioned) case, not as the guarantee.
 */
export async function createDefaultProfileForUser(userId: string): Promise<ApiResult<UserProfile>> {
  try {
    // Fast path: user already has a LIVE profile.
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

    // Get user's currency preference
    const [user] = await db
      .select({ currency: users.currency })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    const userCurrency = user?.currency || 'NONE'

    // Create default profile. `onConflictDoNothing` absorbs the concurrent
    // insert: the index covers (userId) WHERE isDefault AND NOT isDeleted, so a
    // second caller for the same brand-new user writes nothing.
    const [defaultProfile] = await db
      .insert(userProfiles)
      .values({
        userId,
        name: 'Main Profile',
        description: 'Your primary financial profile',
        currency: userCurrency,
        isDefault: true,
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
    const [existingDefault] = await db
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create default profile',
    }
  }
}
