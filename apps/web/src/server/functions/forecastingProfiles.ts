/**
 * User-scoped cores: callers have already authenticated `userId` and checked premium.
 * Never import from client code: it bundles `pg` into the browser.
 */

import type { ForecastingProfile, NewForecastingProfile } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import { forecastingProfiles, userProfiles } from '@budget-planner/db/src/schema'
import { and, desc, eq, inArray, ne, type SQL } from 'drizzle-orm'
import { type DbTx, lockUserProfileSet } from '../api/profile-set-lock'

type Executor = typeof db | DbTx

export interface CreateForecastingProfileInput {
	name: string
	description?: string
	scenarioData: unknown
	version?: number
	isDefault?: boolean
	profileId: string
}

/**
 * Full replace: an absent description clears it, an absent version keeps it. No
 * profileId/isDefault, so an update can't move a forecast or change the default.
 */
export interface UpdateForecastingProfileInput {
	name: string
	description?: string
	scenarioData: unknown
	version?: number
}

export interface ForecastingProfileOutput extends ForecastingProfile {
	profileName?: string
}

/** A failure with no reason becomes a fixed-message 500, so its `error` may carry internal detail. */
type ForecastFailureReason = 'invalid-input' | 'not-found' | 'conflict'

/** `error` of a reasoned failure is shown to the user verbatim. */
export type ForecastResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; reason?: ForecastFailureReason }

const PROFILE_REFUSAL = 'Invalid profile ID or profile does not belong to current user'

const isJsonObject = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

function validateScenarioData(data: unknown): string {
	// A JSON object, not merely valid JSON: a stored "null" or [] row is hidden by the
	// client yet still holds its name, blocking later saves under that name.
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

async function validateProfileOwnership(
	profileId: string,
	userId: string,
	executor: Executor = db
): Promise<boolean> {
	const [profile] = await executor
		.select({ id: userProfiles.id })
		.from(userProfiles)
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

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === '23505'
	)
}

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

const FORECAST_GONE_ERROR =
	'This forecast was deleted, so it was not saved. Save again to keep it as a new forecast.'

export async function createForecastingProfile(
	userId: string,
	input: CreateForecastingProfileInput
): Promise<ForecastResult<ForecastingProfileOutput>> {
	try {
		const checked = checkForecastInput(input)
		if (!checked.ok) return checked.refusal
		const { scenarioDataString } = checked

		// One transaction behind the per-user lock, so another device's profile cascade can't
		// commit between the ownership check and the INSERT (the FK only takes KEY SHARE).
		const created = await db.transaction(async (tx) => {
			await lockUserProfileSet(tx, userId, 'share')
			if (!(await validateProfileOwnership(input.profileId, userId, tx))) {
				// Returned, not thrown: nothing was written, so the empty transaction commits.
				return null
			}

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

export async function getForecastingProfiles(
	userId: string,
	profileId?: string
): Promise<ForecastResult<ForecastingProfileOutput[]>> {
	try {
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

		const profiles = await db
			.select()
			.from(forecastingProfiles)
			.where(whereCondition)
			.orderBy(desc(forecastingProfiles.createdAt))

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
 * One statement, no lock: it changes no profileId so it can't orphan, and a missing
 * or foreign forecast are the same 404 (no existence oracle).
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
				// `null`, never `undefined`: drizzle drops undefined keys from `.set()`.
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

export async function deleteForecastingProfile(
	userId: string,
	id: number
): Promise<ForecastResult<null>> {
	try {
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
