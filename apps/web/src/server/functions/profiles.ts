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
  currency?: string
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
 * Delete a profile
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

    // Prevent deletion of default profile
    if (existingProfile.isDefault) {
      return {
        success: false,
        error: 'Cannot delete the default profile',
      }
    }

    // Check if this is the user's last profile. Exclude soft-deleted tombstones
    // (Story 4-18) so the limit/last-profile check counts only live profiles.
    const profileCount = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

    if (profileCount.length <= 1) {
      return {
        success: false,
        error: 'Cannot delete the last profile. Create a new profile first.',
      }
    }

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
 */
export async function createDefaultProfileForUser(userId: string): Promise<ApiResult<UserProfile>> {
  try {
    // Check if user already has profiles
    const existingProfiles = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))

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

    // Create default profile
    const [defaultProfile] = await db
      .insert(userProfiles)
      .values({
        userId,
        name: 'Main Profile',
        description: 'Your primary financial profile',
        currency: userCurrency,
        isDefault: true,
      } as NewUserProfile)
      .returning()

    return {
      success: true,
      data: defaultProfile,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create default profile',
    }
  }
}
