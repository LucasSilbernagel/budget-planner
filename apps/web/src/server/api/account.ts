// A hard DELETE, not the `isDeleted` sync tombstone: the tombstone leaves the values in the
// database, so it does not satisfy erasure.

import { getPaddleConfig } from '@budget-planner/config'
import { db } from '@budget-planner/db'
import {
	balanceTracking,
	categories,
	expenses,
	forecastingProfiles,
	incomeSources,
	loginTokens,
	rateLimits,
	retirementPlans,
	savingsGoals,
	userProfiles,
	users,
} from '@budget-planner/db/src/schema'
import { and, eq, sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { cancelActiveSubscriptionsForCustomer } from '../paddle/subscription-api'
import { normalizeEmail } from './auth/email'
import { getCurrentUserSession } from './auth/paddle'

export interface DeleteAccountResult {
	success: boolean
	reason?: 'unauthenticated' | 'error'
	error?: string
}

// The user id comes only from the signed session, never the body.
export async function deleteUserAccount(request: Request): Promise<DeleteAccountResult> {
	const sessionResult = await getCurrentUserSession(request)
	if (!sessionResult.success) {
		return {
			success: false,
			reason: 'error',
			error: sessionResult.error ?? 'Failed to resolve session',
		}
	}
	const session = sessionResult.data
	if (!session) {
		return { success: false, reason: 'unauthenticated' }
	}

	const { userId, paddleId, email } = session

	try {
		// Paddle is Merchant of Record: deleting our row does not stop billing. Never blocks erasure.
		await cancelPaddleSubscriptionBestEffort(paddleId)

		await db.transaction((tx) => eraseAccountRows(tx, { userId, email }))

		return { success: true }
	} catch (error) {
		logger.error('Account deletion failed', { error })
		return {
			success: false,
			reason: 'error',
			error: error instanceof Error ? error.message : 'Failed to delete account',
		}
	}
}

export type AccountTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Locks the users row first so erasure and the retention purge cannot deadlock. No Paddle call:
// during a purge, Paddle's subscription.canceled webhook would re-create the row.
export async function eraseAccountRows(
	tx: AccountTx,
	{ userId, email }: { userId: string; email: string }
): Promise<void> {
	await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`)

	// Every FK is RESTRICT, so children go before parents; `categories` is both a parent and a child here.
	// `rateLimits` is deleted twice: by userId and by email subject.
	await tx.delete(forecastingProfiles).where(eq(forecastingProfiles.userId, userId))
	await tx.delete(incomeSources).where(eq(incomeSources.userId, userId))
	await tx.delete(expenses).where(eq(expenses.userId, userId))
	await tx.delete(categories).where(eq(categories.userId, userId))
	await tx.delete(savingsGoals).where(eq(savingsGoals.userId, userId))
	await tx.delete(balanceTracking).where(eq(balanceTracking.userId, userId))
	await tx.delete(retirementPlans).where(eq(retirementPlans.userId, userId))
	await tx.delete(loginTokens).where(eq(loginTokens.userId, userId))
	await tx.delete(rateLimits).where(eq(rateLimits.userId, userId))
	// The magic-link throttle has a NULL userId; it is keyed by the normalized email subject.
	await tx
		.delete(rateLimits)
		.where(and(eq(rateLimits.scope, 'email'), eq(rateLimits.subject, normalizeEmail(email))))
	await tx.delete(userProfiles).where(eq(userProfiles.userId, userId))
	await tx.delete(users).where(eq(users.id, userId))
}

// A hard ceiling for the whole cancel step: a slow Paddle must not stall erasure past a platform timeout.
const CANCEL_STEP_TIMEOUT_MS = 8000

async function cancelPaddleSubscriptionBestEffort(paddleId: string): Promise<void> {
	try {
		const paddleConfig = getPaddleConfig()
		if (!paddleConfig.isConfigured) {
			logger.warn('Account deletion: Paddle not configured — skipping subscription cancellation.', {
				paddleId,
			})
			return
		}

		const timedOut = Symbol('paddle-cancel-timeout')
		let timer: ReturnType<typeof setTimeout> | undefined
		const result = await Promise.race([
			cancelActiveSubscriptionsForCustomer(paddleId),
			new Promise<typeof timedOut>((resolve) => {
				timer = setTimeout(() => resolve(timedOut), CANCEL_STEP_TIMEOUT_MS)
			}),
		])
		clearTimeout(timer)
		if (result === timedOut) {
			logger.error(
				'Account deletion: Paddle cancel step exceeded its deadline — proceeding with erasure regardless',
				{ paddleId }
			)
		}
	} catch (error) {
		logger.error('Account deletion: best-effort Paddle cancel failed (continuing with erasure)', {
			error,
		})
	}
}
