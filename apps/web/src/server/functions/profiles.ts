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
import { userProfiles, users } from '@budget-planner/db/src/schema'
import type { Request } from '@tanstack/start'
import { and, eq, neq } from 'drizzle-orm'
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

    const userId = sessionResult.data.userId

    const profiles = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
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

    const userId = sessionResult.data.userId

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.id, profileId), eq(userProfiles.userId, userId)))
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

    const userId = sessionResult.data.userId

    // Validate input
    if (!input.id) {
      return {
        success: false,
        error: 'Profile ID is required',
      }
    }

    // Check if profile exists and belongs to user
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.id, input.id), eq(userProfiles.userId, userId)))
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
            neq(userProfiles.id, input.id) // Exclude current profile
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
        updatedAt: new Date().toISOString(),
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

    const userId = sessionResult.data.userId

    // Check if profile exists and belongs to user
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.id, profileId), eq(userProfiles.userId, userId)))
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

    // Check if this is the user's last profile
    const profileCount = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId))

    if (profileCount.length <= 1) {
      return {
        success: false,
        error: 'Cannot delete the last profile. Create a new profile first.',
      }
    }

    // Delete the profile (cascade will delete related financial data)
    // Wrap in transaction to ensure atomicity
    await db.transaction(async (tx) => {
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
