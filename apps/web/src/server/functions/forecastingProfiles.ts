/**
 * Forecasting Profiles Server Functions
 *
 * Server-side CRUD operations for premium forecasting profiles.
 * Only available for paid tier users (subscriptionStatus 'active' or 'lifetime').
 *
 * ⚠️ Since story 83.1 (FR136) the three functions the app uses,
 * `getForecastingProfiles`, `createForecastingProfile` and
 * `deleteForecastingProfile`, are USER-SCOPED CORES: they take a `userId` the
 * caller has already authenticated and authorised, and `routes/api/forecasts.ts`
 * is that caller (session → 503/401, premium → 403). They report a refusal with a
 * `reason` the route maps to a status. They used to take the `Request`, and the
 * page `import()`ed this module in the BROWSER, which bundled `pg` into the client
 * and failed there on `Buffer` (story 80.1 Fact R). Never import this module from
 * client code; call the route (`lib/forecasting/forecast-api.ts`).
 *
 * The remaining request-taking functions below (`getForecastingProfileById`,
 * `updateForecastingProfile`, `setDefaultForecastingProfile`) have no caller.
 *
 * Architecture: TanStack Start Server Functions
 * Database: Drizzle ORM with DanubeData PostgreSQL (Germany - EU)
 * Data Sovereignty: All paid tier data stored in DanubeData EU (NFR1, NFR2)
 */

import { db } from '@budget-planner/db'
import type { ForecastingProfile, NewForecastingProfile } from '@budget-planner/db'
import { forecastingProfiles, userProfiles } from '@budget-planner/db/src/schema'
import { type SQL, and, desc, eq, inArray, ne } from 'drizzle-orm'
import { getCurrentUserSession } from '../api/auth/paddle'
import type { ApiResult } from '../api/auth/paddle'
import { type DbTx, lockUserProfileSet } from '../api/profile-set-lock'

/** Where a read or write runs: autocommit on `db`, or inside a transaction. */
type Executor = typeof db | DbTx

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

/**
 * Why a core refused (story 83.1): `routes/api/forecasts.ts` maps it to 400 / 404
 * / 409. A failure with NO reason is unexpected and becomes a 500 whose message
 * is fixed, so `error` there may carry internal detail for the log.
 */
export type ForecastFailureReason = 'invalid-input' | 'not-found' | 'conflict'

/** A core's result. `error` of a reasoned failure is shown to the user verbatim. */
export type ForecastResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; reason?: ForecastFailureReason }

const PROFILE_REFUSAL = 'Invalid profile ID or profile does not belong to current user'

// ============================================================================
// Helper Functions
// ============================================================================

const isJsonObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validate that scenarioData is a JSON OBJECT (or a string holding one)
 */
function validateScenarioData(data: unknown): string {
  // Only accept a plain object or a string that is already a JSON object. Anything
  // else is rejected (throws) rather than stored, so the database can never hold
  // malformed scenarioData — a corrupt row would otherwise crash the client when
  // the saved-forecast list deserializes and renders it.
  //
  // ⚠️ An OBJECT, not merely valid JSON (story 83.1 code review): `"null"`, `"1"`
  // or `[]` are valid JSON, and were stored; the page's `mapToSavedForecast` then
  // hides such a row, which still holds its name, so the next save of that name
  // got a 409 for a forecast the user cannot see or delete.
  if (typeof data === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      throw new Error('scenarioData must be valid JSON')
    }
    if (!isJsonObject(parsed)) {
      throw new Error('scenarioData must be a JSON object')
    }
    return data
  }

  if (isJsonObject(data)) {
    return JSON.stringify(data)
  }

  throw new Error('scenarioData must be a JSON object or a valid JSON string')
}

/**
 * Validate that a profile belongs to the current user
 */
async function validateProfileOwnership(
  profileId: string,
  userId: string,
  executor: Executor = db
): Promise<boolean> {
  const [profile] = await executor
    .select({ id: userProfiles.id })
    .from(userProfiles)
    // A soft-deleted profile (Story 4-18) is not a valid ownership target.
    .where(
      and(
        eq(userProfiles.id, profileId),
        eq(userProfiles.userId, userId),
        eq(userProfiles.isDeleted, false)
      )
    )
    .limit(1)

  return profile !== undefined
}

/**
 * Ensure only one default profile per user/profile combination
 */
async function ensureSingleDefault(
  userId: string,
  profileId: string,
  excludeId?: number,
  executor: Executor = db
): Promise<void> {
  await executor
    .update(forecastingProfiles)
    .set({ isDefault: false })
    .where(
      and(
        eq(forecastingProfiles.userId, userId),
        eq(forecastingProfiles.profileId, profileId),
        excludeId ? ne(forecastingProfiles.id, excludeId) : undefined
      )
    )
}

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505) so callers can
 * return a friendly message instead of the raw driver error text.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Create a new forecasting profile for `userId`.
 *
 * The caller has authenticated `userId` and checked premium access
 * (`routes/api/forecasts.ts`, story 83.1). The input checks come first and touch
 * no row; a refusal carries `reason: 'invalid-input'`.
 *
 * The write runs in ONE transaction behind the per-user lock
 * (`lockUserProfileSet`, `server/api/profile-set-lock.ts`), so a forecast can
 * never be left under a profile another device just deleted (story 80.1, FR131,
 * triage M6). See the comment at the transaction. Reached from the browser
 * through `POST /api/forecasts` since story 83.1.
 */
export async function createForecastingProfile(
  userId: string,
  input: CreateForecastingProfileInput
): Promise<ForecastResult<ForecastingProfileOutput>> {
  try {
    // Validate input
    if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
      return {
        success: false,
        error: 'Profile name is required',
        reason: 'invalid-input',
      }
    }

    if (input.name.length > 255) {
      return {
        success: false,
        error: 'Profile name must be 255 characters or less',
        reason: 'invalid-input',
      }
    }

    // Validate and stringify scenarioData BEFORE the transaction: it touches no
    // row. Its throw is a refusal of the INPUT (400), not an unexpected failure,
    // so it is caught here and not by the outer catch.
    let scenarioDataString: string
    try {
      scenarioDataString = validateScenarioData(input.scenarioData)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'scenarioData is invalid',
        reason: 'invalid-input',
      }
    }

    // ⚠️⚠️ ONE transaction, behind the per-user lock (story 80.1, FR131). The
    // ownership check used to run in autocommit before an unguarded INSERT, so a
    // profile cascade from another device (`deleteProfileWithChildren` in
    // `server/api/sync.ts`, which HARD-deletes this table's rows for the
    // profile) could commit in between and leave a forecast under a tombstoned
    // profile: FR122(2)'s orphan class, on a writer outside the sync push. The
    // foreign key does not stop it: it takes only `KEY SHARE` on the profile row,
    // which the cascade's UPDATE does not conflict with.
    //
    // Now the lock, the liveness check, the default reset, the INSERT and the
    // name lookup commit together. The save either commits before the cascade
    // (which then deletes it) or waits for it and sees the tombstone. See
    // `lockUserProfileSet` for why the lock is `'share'` and why the check is a
    // separate statement after it. The same pattern as `createProfileScopedEntity`.
    //
    // ⚠️ No autocommit pre-check before it: the one inside is authoritative, and
    // a second copy outside would only be a check nothing can observe.
    //
    // ⚠️ It also makes a FAILED save atomic: the default reset used to commit on
    // its own, so a default save refused by the unique name index left the
    // profile with no default forecast (MEASURED on `9144e0a`, story 80.1).
    //
    // Reached from the browser through `POST /api/forecasts` (story 83.1). Until
    // then the page imported this module client-side and the import failed on
    // `Buffer`, so this transaction never ran in production (story 80.1 Fact R).
    const created = await db.transaction(async (tx) => {
      await lockUserProfileSet(tx, userId, 'share')
      if (!(await validateProfileOwnership(input.profileId, userId, tx))) {
        // Returned, not thrown: nothing was written, so the empty transaction
        // commits.
        return null
      }

      // Handle isDefault flag: only one default per user/profile
      if (input.isDefault) {
        await ensureSingleDefault(userId, input.profileId, undefined, tx)
      }

      // A unique violation here THROWS, which rolls the default reset back and
      // reaches `isUniqueViolation` in the catch below.
      const [newProfile] = await tx
        .insert(forecastingProfiles)
        .values({
          userId,
          profileId: input.profileId,
          name: input.name.trim(),
          description: input.description?.trim(),
          scenarioData: scenarioDataString,
          version: input.version || 1,
          isDefault: input.isDefault || false,
        } as NewForecastingProfile)
        .returning()

      // Get the profile name for the output
      const [userProfile] = await tx
        .select({ name: userProfiles.name })
        .from(userProfiles)
        .where(eq(userProfiles.id, input.profileId))
        .limit(1)

      return { newProfile, profileName: userProfile?.name }
    })

    if (!created) {
      return { success: false, error: PROFILE_REFUSAL, reason: 'not-found' }
    }
    const { newProfile } = created

    // ⚠️ `.returning()` yields an array, so the destructured row is
    // possibly-undefined. Without this guard, spreading `undefined` produced a
    // "success" payload carrying only `profileName` — a malformed row the caller
    // would have taken at face value. A write that returns nothing is a failure.
    if (!newProfile) {
      return { success: false, error: 'Failed to create forecasting profile' }
    }

    return {
      success: true,
      data: {
        ...newProfile,
        profileName: created.profileName,
      },
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        success: false,
        error: 'A forecast with this name already exists for this profile.',
        reason: 'conflict',
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create forecasting profile',
    }
  }
}

/**
 * Get all forecasting profiles of `userId`, or of one of its live profiles.
 *
 * The caller has authenticated `userId` and checked premium access
 * (`routes/api/forecasts.ts`, story 83.1).
 */
export async function getForecastingProfiles(
  userId: string,
  profileId?: string
): Promise<ForecastResult<ForecastingProfileOutput[]>> {
  try {
    // Build the where condition once. Filter by profileId if provided.
    let whereCondition: SQL | undefined = eq(forecastingProfiles.userId, userId)
    if (profileId) {
      const profileOwned = await validateProfileOwnership(profileId, userId)
      if (!profileOwned) {
        return { success: false, error: PROFILE_REFUSAL, reason: 'not-found' }
      }
      whereCondition = and(
        eq(forecastingProfiles.userId, userId),
        eq(forecastingProfiles.profileId, profileId)
      )
    }

    // Order by createdAt descending
    const profiles = await db
      .select()
      .from(forecastingProfiles)
      .where(whereCondition)
      .orderBy(desc(forecastingProfiles.createdAt))

    // Get profile names for each forecasting profile
    const profileIds = [...new Set(profiles.map((p) => p.profileId))]
    const profileNames =
      profileIds.length > 0
        ? await db
            .select({ id: userProfiles.id, name: userProfiles.name })
            .from(userProfiles)
            .where(and(eq(userProfiles.userId, userId), inArray(userProfiles.id, profileIds)))
        : []

    const profileNameMap = new Map(profileNames.map((p) => [p.id, p.name]))

    const output: ForecastingProfileOutput[] = profiles.map((profile) => ({
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
      .where(and(eq(forecastingProfiles.id, id), eq(forecastingProfiles.userId, user.userId)))
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
      .where(and(eq(forecastingProfiles.id, input.id), eq(forecastingProfiles.userId, user.userId)))
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
        // ⚠️ `new Date()`, not `.toISOString()`. The column is
        // `timestamp('updatedAt')` (`packages/db/src/schema.ts`), and drizzle's date
        // mapper calls `.toISOString()` on the value it is given — so handing it a
        // STRING throws at runtime. Every other `.set()` in the codebase passes a
        // `Date` (e.g. `server/api/sync.ts:698,826`); these were the odd
        // ones out.
        updatedAt: new Date(),
      })
      .where(eq(forecastingProfiles.id, input.id))
      .returning()

    // Get the profile name
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, existingProfile.profileId))
      .limit(1)

    // ⚠️ `.returning()` yields an array, so the destructured row is
    // possibly-undefined. Without this guard, spreading `undefined` produced a
    // "success" payload carrying only `profileName` — a malformed row the caller
    // would have taken at face value. A write that returns nothing is a failure.
    if (!updatedProfile) {
      return { success: false, error: 'Failed to update forecasting profile' }
    }

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
 * Delete one of `userId`'s forecasting profiles.
 *
 * The caller has authenticated `userId` and checked premium access
 * (`routes/api/forecasts.ts`, story 83.1).
 */
export async function deleteForecastingProfile(
  userId: string,
  id: number
): Promise<ForecastResult<null>> {
  try {
    // Delete the profile
    const result = await db
      .delete(forecastingProfiles)
      .where(and(eq(forecastingProfiles.id, id), eq(forecastingProfiles.userId, userId)))

    if (result.rowCount === 0) {
      return {
        success: false,
        error: 'Forecasting profile not found or access denied',
        reason: 'not-found',
      }
    }

    return { success: true, data: null }
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
      .where(and(eq(forecastingProfiles.id, id), eq(forecastingProfiles.userId, user.userId)))
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
      // See the note above: a timestamp column needs a Date, not a string.
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(forecastingProfiles.id, id))
      .returning()

    // Get the profile name
    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, profile.profileId))
      .limit(1)

    // ⚠️ `.returning()` yields an array, so the destructured row is
    // possibly-undefined. Without this guard, spreading `undefined` produced a
    // "success" payload carrying only `profileName` — a malformed row the caller
    // would have taken at face value. A write that returns nothing is a failure.
    if (!updatedProfile) {
      return { success: false, error: 'Failed to update forecasting profile' }
    }

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
