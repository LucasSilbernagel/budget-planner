/**
 * Same-origin fetch only: importing `server/` modules here bundled `pg` into the client.
 * Network failures reject on purpose; the page's catch arms depend on it.
 */

import type { ApiResult } from '../../server/api/result'
import type {
	CreateForecastingProfileInput,
	ForecastingProfileOutput,
	UpdateForecastingProfileInput,
} from '../../server/functions/forecastingProfiles'

export type ForecastWire = Omit<ForecastingProfileOutput, 'createdAt' | 'updatedAt'> & {
	createdAt: string
	updatedAt: string
}

export type ProfileWire = {
	id: string
	isDefault: boolean
	name?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

async function readResult<T>(response: Response, fallback: string): Promise<ApiResult<T>> {
	let body: unknown
	try {
		body = await response.json()
	} catch {
		return { success: false, error: fallback }
	}
	if (!isRecord(body) || typeof body['success'] !== 'boolean') {
		return { success: false, error: fallback }
	}
	const error = typeof body['error'] === 'string' ? body['error'] : undefined
	if (!response.ok || body['success'] === false) {
		return { success: false, error: error ?? fallback }
	}
	return body as unknown as ApiResult<T>
}

const JSON_ACCEPT = { Accept: 'application/json' }

export async function fetchProfiles(): Promise<ApiResult<ProfileWire[]>> {
	const response = await fetch('/api/profiles', { headers: JSON_ACCEPT })
	return readResult<ProfileWire[]>(response, 'Failed to load profiles')
}

export async function fetchForecasts(profileId?: string): Promise<ApiResult<ForecastWire[]>> {
	const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''
	const response = await fetch(`/api/forecasts${query}`, { headers: JSON_ACCEPT })
	return readResult<ForecastWire[]>(response, 'Failed to load forecasts')
}

export async function saveForecast(
	input: CreateForecastingProfileInput
): Promise<ApiResult<ForecastWire>> {
	const response = await fetch('/api/forecasts', {
		method: 'POST',
		headers: { ...JSON_ACCEPT, 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	})
	return readResult<ForecastWire>(response, 'Failed to save forecast')
}

/** A 404 means the forecast was deleted on another device. */
export async function updateForecast(
	id: string,
	input: UpdateForecastingProfileInput
): Promise<ApiResult<ForecastWire> & { status: number }> {
	const response = await fetch(`/api/forecasts?id=${encodeURIComponent(id)}`, {
		method: 'PUT',
		headers: { ...JSON_ACCEPT, 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	})
	return {
		...(await readResult<ForecastWire>(response, 'Failed to save forecast')),
		status: response.status,
	}
}

export async function deleteForecast(id: string): Promise<ApiResult<void>> {
	const response = await fetch(`/api/forecasts?id=${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: JSON_ACCEPT,
	})
	return readResult<void>(response, 'Failed to delete forecast')
}
