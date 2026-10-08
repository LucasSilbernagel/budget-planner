/**
 * Forecasting Profiles Server Functions
 *
 * Server-side CRUD operations for premium forecasting profiles.
 * Only available for paid tier users (subscriptionStatus 'active' or 'lifetime').
 *
 * ⚠️ Since story 83.1 (FR136) the functions the app uses,
 * `getForecastingProfiles`, `createForecastingProfile`, `updateForecastingProfile`
 * (story 97.1, FR157) and `deleteForecastingProfile`, are USER-SCOPED CORES: they
 * take a `userId` the
 * caller has already authenticated and authorised, and `routes/api/forecasts.ts`
 * is that caller (session → 503/401, premium → 403). They report a refusal with a
 * `reason` the route maps to a status. They used to take the `Request`, and the
 * page `import()`ed this module in the BROWSER, which bundled `pg` into the client
 * and failed there on `Buffer` (story 80.1 Fact R). Never import this module from
 * client code; call the route (`lib/forecasting/forecast-api.ts`).
 *
 * The two remaining request-taking functions below (`getForecastingProfileById`,
 * `setDefaultForecastingProfile`) have no caller.
 *
 * Architecture: TanStack Start Server Functions
 * Database: Drizzle ORM with DanubeData PostgreSQL (Germany - EU)
 * Data Sovereignty: All paid tier data stored in DanubeData EU (NFR1, NFR2)
 */

import { db } from '@budget-planner/db'
import type { ForecastingProfile, NewForecastingProfile } from '@budget-planner/db'
import { forecastingProfiles, userProfiles } from '@budget-planner/db/src/schema'
import { type SQL, and, desc, eq, inArray, ne } from 'drizzle-orm'
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
 * Input for updating one of the user's forecasts (story 97.1, FR157: `PUT
 * /api/forecasts?id=`). A FULL replace of the editable fields: an absent
 * `description` clears it, an absent `version` keeps the stored one.
 *
 * ⚠️ No `id` (it travels in the URL), no `profileId` and no `isDefault`: an update
 * can neither move a forecast to another profile nor change the default flag.
 */
export interface UpdateForecastingProfileInput {
  name: string
  description?: string
  scenarioData: unknown // Will be validated as JSON string
  version?: number
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
type ForecastFailureReason = 'invalid-input' | 'not-found' | 'conflict'

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

/**
 * The input checks create and update share (story 97.1: one rule, one place).
 * They touch no row. A refusal carries `reason: 'invalid-input'`; otherwise the
 * stringified `scenarioData`.
 */
function checkForecastInput(input: {
  name: string
  scenarioData: unknown
}): { ok: true; scenarioDataString: string } | { ok: false; refusal: ForecastResult<never> } {
  if (!input.name || typeof input.name !== 'string' || input.name.trim() === '') {
    return {
      ok: false,
      refusal: { success: false, error: 'Profile name is required', reason: 'invalid-input' },
    }
  }

  if (input.name.length > 255) {
    return {
      ok: false,
      refusal: {
        success: false,
        error: 'Profile name must be 255 characters or less',
        reason: 'invalid-input',
      },
    }
  }

  // Its throw is a refusal of the INPUT (400), not an unexpected failure.
  try {
    return { ok: true, scenarioDataString: validateScenarioData(input.scenarioData) }
  } catch (error) {
    return {
      ok: false,
      refusal: {
        success: false,
        error: error instanceof Error ? error.message : 'scenarioData is invalid',
        reason: 'invalid-input',
      },
    }
  }
}

const DUPLICATE_NAME_ERROR = 'A forecast with this name already exists for this profile.'

/** The 404 text of an update whose forecast is gone (story 97.1, D3). */
const FORECAST_GONE_ERROR =
  'This forecast was deleted, so it was not saved. Save again to keep it as a new forecast.'

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
    // Validate the input (and stringify scenarioData) BEFORE the transaction: it
    // touches no row.
    const checked = checkForecastInput(input)
    if (!checked.ok) return checked.refusal
    const { scenarioDataString } = checked

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
      return { success: false, error: DUPLICATE_NAME_ERROR, reason: 'conflict' }
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
 * Update one of `userId`'s forecasts in place (story 97.1, FR157: `PUT
 * /api/forecasts?id=`).
 *
 * The caller has authenticated `userId` and checked premium access
 * (`routes/api/forecasts.ts`). A FULL replace of name, description and
 * scenarioData (`UpdateForecastingProfileInput`); `profileId`, `isDefault`,
 * `createdAt` and the owner never change.
 *
 * ONE statement, `UPDATE … WHERE id AND userId RETURNING`: a forecast that does
 * not exist and one owned by another user are the same 404 (no existence
 * oracle, as DELETE). It takes no `lockUserProfileSet`: it changes no
 * `profileId`, so it cannot leave an orphan, and a profile cascade that
 * hard-deletes the row either runs first (0 rows → 404) or waits on this row
 * lock and deletes the updated row. A rename onto another forecast's name trips
 * the unique index (23505) → the same `conflict` as create, and nothing changes.
 */
export async function updateForecastingProfile(
  userId: string,
  id: number,
  input: UpdateForecastingProfileInput
): Promise<ForecastResult<ForecastingProfileOutput>> {
  try {
    const checked = checkForecastInput(input)
    if (!checked.ok) return checked.refusal

    const [updated] = await db
      .update(forecastingProfiles)
      .set({
        name: input.name.trim(),
        // ⚠️ `null`, never `undefined`: drizzle DROPS undefined keys from `.set()`
        // (`mapUpdateSet`), so a cleared description would silently survive.
        description: input.description?.trim() ?? null,
        scenarioData: checked.scenarioDataString,
        // Absent → the key is left out → the stored version stays.
        ...(input.version === undefined ? {} : { version: input.version }),
        // A Date, never a string: drizzle's timestamp mapper calls `.toISOString()`.
        updatedAt: new Date(),
      })
      .where(and(eq(forecastingProfiles.id, id), eq(forecastingProfiles.userId, userId)))
      .returning()

    if (!updated) {
      return { success: false, error: FORECAST_GONE_ERROR, reason: 'not-found' }
    }

    const [userProfile] = await db
      .select({ name: userProfiles.name })
      .from(userProfiles)
      .where(eq(userProfiles.id, updated.profileId))
      .limit(1)

    return { success: true, data: { ...updated, profileName: userProfile?.name } }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { success: false, error: DUPLICATE_NAME_ERROR, reason: 'conflict' }
    }
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
