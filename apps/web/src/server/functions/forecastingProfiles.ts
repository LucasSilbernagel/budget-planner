/**
 * Forecasting Profiles Server Functions
 * 
 * Server-side CRUD operations for premium forecasting profiles.
 * Only available for paid tier users (subscriptionStatus === 'active').
 * 
 * Architecture: TanStack Start Server Functions
 * Database: Drizzle ORM with DanubeData PostgreSQL (Germany - EU)
 * Data Sovereignty: All paid tier data stored in DanubeData EU (NFR1, NFR2)
 */

import { db } from '@budget-planner/db'
import { forecastingProfiles, userProfiles } from '@budget-planner/db/src/schema'
import { eq, and, desc, orderBy } from 'drizzle-orm'
import type { ForecastingProfile, NewForecastingProfile, UserProfile } from '@budget-planner/db'
import { getCurrentUserSession } from '../api/auth/paddle'
import type { ApiResult } from '../api/auth/paddle'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Input type for creating a forecasting profile
 */
export interface CreateForecastingProfileInput {
  name: string
  description?: string
  scenarioData: unknown // Will be validated as JSON string
  version?: number
  isDefault?: boolean
  profileId: string // UUID of the user profile this forecast belongs to
}

/**
 * Input type for updating a forecasting profile
 */
export interface UpdateForecastingProfileInput {
  id: number
  name?: string
  description?: string
  scenarioData?: unknown // Will be validated as JSON string
  version?: number
  isDefault?: boolean
}

/**
 * Output type for forecasting profile with additional metadata
 */
export interface ForecastingProfileOutput extends ForecastingProfile {
  profileName?: string // Name of the associated user profile
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate that scenarioData is valid JSON (or a string that can be JSON.stringify'd)
 */
function validateScenarioData(data: unknown): string {
  if (typeof data === 'string') {
    // Already a string - validate it's valid JSON by trying to parse it
    try {
      JSON.parse(data)
      return data
    } catch {
      // If it's not valid JSON, we'll still store it as a string
      // but this might indicate data corruption
      console.warn('ScenarioData is not valid JSON, but storing as string')
      return data
    }
  }
  
  // If it's an object, stringify it
  if (typeof data === 'object' && data !== null) {
    return JSON.stringify(data)
  }
  
  // For other types, convert to string
  return String(data)
}

/**
 * Validate that a profile belongs to the current user
 */
async function validateProfileOwnership(
  profileId: string,
  userId: string
): Promise<boolean> {
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(and(
      eq(userProfiles.id, profileId),
      eq(userProfiles.userId, userId)
    ))
    .limit(1)
  
  return profile !== undefined
}

/**
 * Ensure only one default profile per user/profile combination
 */
async function ensureSingleDefault(
  userId: string,
  profileId: string,
  excludeId?: number
): Promise<void> {
  await db
    .update(forecastingProfiles)
    .set({ isDefault: false })
    .where(and(
      eq(forecastingProfiles.userId, userId),
      eq(forecastingProfiles.profileId, profileId),
      excludeId ? ne(forecastingProfiles.id, excludeId) : undefined
    ))
}

// Helper for NOT EQUALS - Drizzle doesn't have a built-in ne function
function ne(column: any, value: any) {
  return { column, op: '!=' as const, value }
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Create a new forecasting profile
 * Requires premium access (subscriptionStatus === 'active')
 */
export async function createForecastingProfile(
  request: Request,
  input: CreateForecastingProfileInput
): Promise<ApiResult<ForecastingProfileOutput>> {
  try {
    // Check authentication and premium access
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required for premium features',
      }
    }
    
    // Check premium access
    if (user.subscriptionStatus !== 'active') {
      return {
        success: false,
        error: 'Premium feature: Please upgrade to access forecasting profile management',
      }
    }
    
    // Validate input
    if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
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
    
    // Validate that the profile belongs to the current user
    const profileOwned = await validateProfileOwnership(input.profileId, user.userId)
    if (!profileOwned) {
      return {
        success: false,
        error: 'Invalid profile ID or profile does not belong to current user',
      }
    }
    
    // Handle isDefault flag
    if (input.isDefault) {
      // Ensure only one default per user/profile
      await ensureSingleDefault(user.userId, input.profileId)
    }
    
    // Validate and stringify scenarioData
    const scenarioDataString = validateScenarioData(input.scenarioData)
    
    // Create the forecasting profile
    const [newProfile] = await db
      .insert(forecastingProfiles)
      .values({
        userId: user.userId,
        profileId: input.profileId,
        name: input.name.trim(),
        description: input.description?.trim(),
        scenarioData: scenarioDataString,
        version: input.version || 1,
        isDefault: input.isDefault || false,
      } as NewForecastingProfile)
      .returning()
    
    // Get the profile name for the output
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, input.profileId))
      .limit(1)
    
    return {
      success: true,
      data: {
        ...newProfile,
        profileName: userProfile?.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create forecasting profile',
    }
  }
}

/**
 * Get all forecasting profiles for the current user
 * Requires authentication
 */
export async function getForecastingProfiles(
  request: Request,
  profileId?: string
): Promise<ApiResult<ForecastingProfileOutput[]>> {
  try {
    // Check authentication
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }
    
    // Build query
    let query = db
      .select()
      .from(forecastingProfiles)
      .where(eq(forecastingProfiles.userId, user.userId))
    
    // Filter by profileId if provided
    if (profileId) {
      const profileOwned = await validateProfileOwnership(profileId, user.userId)
      if (!profileOwned) {
        return {
          success: false,
          error: 'Invalid profile ID or profile does not belong to current user',
        }
      }
      query = query.where(and(
        eq(forecastingProfiles.userId, user.userId),
        eq(forecastingProfiles.profileId, profileId)
      ))
    }
    
    // Order by createdAt descending
    const profiles = await query.orderBy(desc(forecastingProfiles.createdAt))
    
    // Get profile names for each forecasting profile
    const profileIds = [...new Set(profiles.map(p => p.profileId))]
    const profileNames = await db
      .select({ id: userProfiles.id, name: userProfiles.name })
      .from(userProfiles)
      .where(and(
        eq(userProfiles.userId, user.userId),
        profileIds.length > 0 ? { id: { in: profileIds } } : undefined
      ))
    
    const profileNameMap = new Map(profileNames.map(p => [p.id, p.name]))
    
    const output: ForecastingProfileOutput[] = profiles.map(profile => ({
      ...profile,
      profileName: profileNameMap.get(profile.profileId),
    }))
    
    return {
      success: true,
      data: output,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get forecasting profiles',
    }
  }
}

/**
 * Get a single forecasting profile by ID
 * Requires authentication and ownership validation
 */
export async function getForecastingProfileById(
  request: Request,
  id: number
): Promise<ApiResult<ForecastingProfileOutput>> {
  try {
    // Check authentication
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }
    
    // Get the profile
    const [profile] = await db
      .select()
      .from(forecastingProfiles)
      .where(and(
        eq(forecastingProfiles.id, id),
        eq(forecastingProfiles.userId, user.userId)
      ))
      .limit(1)
    
    if (!profile) {
      return {
        success: false,
        error: 'Forecasting profile not found or access denied',
      }
    }
    
    // Get the profile name
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, profile.profileId))
      .limit(1)
    
    return {
      success: true,
      data: {
        ...profile,
        profileName: userProfile?.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get forecasting profile',
    }
  }
}

/**
 * Update a forecasting profile
 * Requires authentication and ownership validation
 */
export async function updateForecastingProfile(
  request: Request,
  input: UpdateForecastingProfileInput
): Promise<ApiResult<ForecastingProfileOutput>> {
  try {
    // Check authentication
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }
    
    // Get the existing profile to validate ownership
    const [existingProfile] = await db
      .select()
      .from(forecastingProfiles)
      .where(and(
        eq(forecastingProfiles.id, input.id),
        eq(forecastingProfiles.userId, user.userId)
      ))
      .limit(1)
    
    if (!existingProfile) {
      return {
        success: false,
        error: 'Forecasting profile not found or access denied',
      }
    }
    
    // Handle isDefault flag
    if (input.isDefault !== undefined && input.isDefault) {
      // Ensure only one default per user/profile
      await ensureSingleDefault(user.userId, existingProfile.profileId, input.id)
    }
    
    // Validate and stringify scenarioData if provided
    let scenarioDataString = existingProfile.scenarioData
    if (input.scenarioData !== undefined) {
      scenarioDataString = validateScenarioData(input.scenarioData)
    }
    
    // Update the profile
    const [updatedProfile] = await db
      .update(forecastingProfiles)
      .set({
        name: input.name?.trim() ?? existingProfile.name,
        description: input.description?.trim(),
        scenarioData: scenarioDataString,
        version: input.version ?? existingProfile.version,
        isDefault: input.isDefault ?? existingProfile.isDefault,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(forecastingProfiles.id, input.id))
      .returning()
    
    // Get the profile name
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, existingProfile.profileId))
      .limit(1)
    
    return {
      success: true,
      data: {
        ...updatedProfile,
        profileName: userProfile?.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update forecasting profile',
    }
  }
}

/**
 * Delete a forecasting profile
 * Requires authentication and ownership validation
 */
export async function deleteForecastingProfile(
  request: Request,
  id: number
): Promise<ApiResult<void>> {
  try {
    // Check authentication
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }
    
    // Delete the profile
    const result = await db
      .delete(forecastingProfiles)
      .where(and(
        eq(forecastingProfiles.id, id),
        eq(forecastingProfiles.userId, user.userId)
      ))
    
    if (result.rowCount === 0) {
      return {
        success: false,
        error: 'Forecasting profile not found or access denied',
      }
    }
    
    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete forecasting profile',
    }
  }
}

/**
 * Set a forecasting profile as default for the user/profile combination
 * Requires authentication and ownership validation
 */
export async function setDefaultForecastingProfile(
  request: Request,
  id: number
): Promise<ApiResult<ForecastingProfileOutput>> {
  try {
    // Check authentication
    const userResult = await getCurrentUserSession(request)
    
    if (!userResult.success) {
      return {
        success: false,
        error: userResult.error || 'Authentication check failed',
      }
    }
    
    const user = userResult.data
    
    if (!user) {
      return {
        success: false,
        error: 'Authentication required',
      }
    }
    
    // Get the profile to validate ownership and get profileId
    const [profile] = await db
      .select()
      .from(forecastingProfiles)
      .where(and(
        eq(forecastingProfiles.id, id),
        eq(forecastingProfiles.userId, user.userId)
      ))
      .limit(1)
    
    if (!profile) {
      return {
        success: false,
        error: 'Forecasting profile not found or access denied',
      }
    }
    
    // Ensure only one default per user/profile
    await ensureSingleDefault(user.userId, profile.profileId, id)
    
    // Set this profile as default
    const [updatedProfile] = await db
      .update(forecastingProfiles)
      .set({ isDefault: true, updatedAt: new Date().toISOString() })
      .where(eq(forecastingProfiles.id, id))
      .returning()
    
    // Get the profile name
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, profile.profileId))
      .limit(1)
    
    return {
      success: true,
      data: {
        ...updatedProfile,
        profileName: userProfile?.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set default forecasting profile',
    }
  }
}
