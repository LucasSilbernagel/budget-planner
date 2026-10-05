/**
 * The forecasting page's transport to the server (story 83.1, FR136).
 *
 * ⚠️⚠️ Same-origin `fetch` to `/api/profiles` and `/api/forecasts`, and nothing
 * else. The page used to `import()` `server/functions/*` here in the browser;
 * those modules bundled `pg`, the chunk failed with `Buffer is not defined`, and
 * no forecast ever reached the server (story 80.1 Fact R). Only TYPES may come
 * from `server/` (they are erased); `scripts/check-client-bundle.mjs` fails the
 * build gate if server code reaches `dist/client` again.
 *
 * Every function resolves to the route's `ApiResult` body, for ANY status: the
 * page shows a failed save's `error` verbatim, so the server's message is the
 * user's message. A body that is not a JSON `ApiResult` (a proxy's HTML error
 * page, an empty 502) becomes `{ success: false, error: <fallback> }`.
 * ⚠️ A NETWORK failure is not caught here: it rejects, and the page's `catch`
 * arms (the profile `error` arm, the save's thrown-message arm) depend on that.
 *
 * The session cookie travels on its own (`fetch` sends same-origin cookies by
 * default); nothing here names a user.
 */

import type { ApiResult } from '../../server/api/result'
import type {
  CreateForecastingProfileInput,
  ForecastingProfileOutput,
  UpdateForecastingProfileInput,
} from '../../server/functions/forecastingProfiles'

/**
 * A saved forecast as it arrives over JSON: the timestamp columns are ISO
 * strings, not the `Date`s drizzle returns on the server.
 */
export type ForecastWire = Omit<ForecastingProfileOutput, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}

/** The fields of a profile the forecasting page reads. */
export interface ProfileWire {
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
  // A non-OK status is a failure whatever the body claims.
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

/**
 * Save over one saved forecast: `PUT /api/forecasts?id=` (story 97.1, FR157).
 * It also returns the HTTP `status`: a `404` means the forecast is gone (deleted
 * on another device), and the page then stops treating it as the save target.
 */
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
