/**
 * Goes over HTTP rather than importing the server functions, which would pull
 * `@budget-planner/db` (server-only) into the client bundle.
 */

import type {
	ProcessOperationResult,
	ServerChange,
	SyncOperation,
} from '@budget-planner/core/sync/types'

export async function fetchServerChanges(
	since: number | null,
	limit = 100,
	profileId?: string
): Promise<ServerChange[]> {
	return (await fetchServerChangesWithMeta(since, limit, profileId)).changes
}

export async function fetchServerChangesWithMeta(
	since: number | null,
	limit = 100,
	profileId?: string
): Promise<{ changes: ServerChange[]; profileIds: string[] | undefined }> {
	const params = new URLSearchParams()
	if (since !== null) {
		params.set('since', String(since))
	}
	params.set('limit', String(limit))

	const headers: Record<string, string> = {}
	if (profileId) {
		headers['x-profile-id'] = profileId
	}

	const response = await fetch(`/api/sync/changes?${params.toString()}`, {
		method: 'GET',
		headers,
	})

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}))
		throw new Error(errorData.error || 'Failed to fetch server changes')
	}

	const result: {
		success: boolean
		changes?: ServerChange[]
		profileIds?: unknown
		error?: string
	} = await response.json()

	if (!result.success) {
		throw new Error(result.error || 'Failed to fetch server changes')
	}

	const profileIds =
		Array.isArray(result.profileIds) && result.profileIds.every((id) => typeof id === 'string')
			? (result.profileIds as string[])
			: undefined
	return { changes: result.changes ?? [], profileIds }
}

type BatchSyncResponseLite = {
	success: boolean
	processedCount: number
	failedCount: number
	conflictCount: number
	error?: string
	rejections?: { operationId: string; reason: string }[]
	refusal?: string
}

/** Mirrors core's PERMANENT_REJECT_STATUS_CODES, which core does not export. */
const PERMANENT_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 422])

/**
 * Must send exactly one op per request: a whole-request refusal is permanent, so batching would
 * let one bad op drop its valid neighbours.
 */
export async function sendSyncOperation(operation: SyncOperation): Promise<ProcessOperationResult> {
	let response: Response
	try {
		response = await fetch('/api/sync/batch', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				operations: [operation],
				clientTimestamp: Date.now(),
				deviceId: operation.deviceId,
			}),
		})
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Network error',
			retryable: true,
		}
	}

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string
			refusal?: string
		}
		// Pass on a permanent status only when the body proves the sync server refused: a proxy 404 or a
		// bad-JSON 400 would otherwise drop the op (and delete a create from this device).
		const serverRefused = errorData.refusal === 'invalid-request'
		const withheld = PERMANENT_HTTP_STATUSES.has(response.status) && !serverRefused
		// A 413 is a verdict on the op only because each request carries one op; remove this mapping
		// if this function ever batches.
		if (response.status === 413 && errorData.refusal === 'too-large') {
			return {
				success: false,
				error: errorData.error || 'Request too large',
				retryable: false,
				statusCode: 422,
			}
		}
		return {
			success: false,
			error: errorData.error || `Sync request failed (${response.status})`,
			retryable: response.status === 429 || response.status >= 500,
			...(withheld ? {} : { statusCode: response.status }),
		}
	}

	const result = (await response.json().catch(() => null)) as BatchSyncResponseLite | null
	if (!result) {
		return { success: false, error: 'Malformed sync response', retryable: true }
	}

	if (result.success && result.processedCount >= 1) {
		return { success: true }
	}
	if (result.conflictCount > 0) {
		return { success: false, conflict: true }
	}
	const rejection = result.rejections?.find((r) => r.operationId === operation.id)
	if (result.failedCount > 0 && rejection) {
		return {
			success: false,
			error: `Refused by the server (${rejection.reason})`,
			retryable: false,
			statusCode: 422,
		}
	}
	// No proof of permanence: non-retryable without a status code, which core keeps queued.
	if (result.failedCount > 0) {
		return { success: false, error: result.error || 'Operation failed on server', retryable: false }
	}
	// processedCount 0 means nothing was persisted; treat it as transient rather than dropping the op.
	return {
		success: false,
		error: result.error || 'Unexpected sync response (nothing processed)',
		retryable: true,
	}
}
