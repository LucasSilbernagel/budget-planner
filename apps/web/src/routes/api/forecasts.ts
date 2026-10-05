/**
 * Saved forecasts (story 83.1, FR136).
 *
 * TanStack Start server route (file-route `server.handlers`).
 *
 * Endpoints:
 *   GET    /api/forecasts[?profileId=<uuid>]  list (all, or one profile's)
 *   POST   /api/forecasts                     save a new one (JSON body, below)
 *   PUT    /api/forecasts?id=<int>            save over one (story 97.1, FR157)
 *   DELETE /api/forecasts?id=<int>            delete one
 *
 * ⚠️ Why this route exists: the forecasting page used to call
 * `server/functions/forecastingProfiles.ts` through a CLIENT-side `import()`. Those
 * are plain functions, not a server boundary, so Vite bundled them with `pg` into
 * the browser, where the chunk failed to import (`ReferenceError: Buffer is not
 * defined`, story 80.1 Fact R) and no forecast ever reached the server. The
 * functions are now user-scoped cores this route calls.
 *
 * The caller is taken from the session cookie, never from the body or query
 * (`server/api/auth/require-premium.ts`: 503 / 401 / 403). The rest of the status
 * mapping (FR136, D4):
 *   400 malformed request, or an input the core refuses (its message is kept)
 *   404 profile or forecast not found for this user
 *   409 duplicate forecast name for the profile
 *   413 body over MAX_FORECAST_BODY_BYTES (by content-length)
 *   500 anything else, with a fixed message; the detail goes to the log only
 * Every body keeps the `ApiResult` shape: `{ success, data? }` / `{ success, error }`.
 *
 * Not rate-limited (the sync routes are): logged in `deferred-work.md` by 83.1.
 */

import { logger } from '@/lib/logger'
import { requirePremiumSession } from '@/server/api/auth/require-premium'
import {
  type CreateForecastingProfileInput,
  type ForecastResult,
  type UpdateForecastingProfileInput,
  createForecastingProfile,
  deleteForecastingProfile,
  getForecastingProfiles,
  updateForecastingProfile,
} from '@/server/functions/forecastingProfiles'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/** The existing 403 text of the forecast functions. */
export const FORECASTS_PREMIUM_ERROR =
  'Premium feature: Please upgrade to access forecasting profile management'

/**
 * POST body cap (FR136, D5). A save is one scenario plus its computed result;
 * the largest the builder can produce is recorded in story 83.1 and this is at
 * least 4× that. Like `sync/batch.ts`, it is enforced on `content-length`.
 */
export const MAX_FORECAST_BODY_BYTES = 256 * 1024

export const INVALID_REQUEST_ERROR = 'Invalid request'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** `forecastingProfiles.id` is a `serial`, i.e. a positive int4. */
const INT4_MAX = 2_147_483_647

/**
 * Every GET answer is user-specific, its refusals included (D4), so none may be
 * stored by a cache on the way.
 */
function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** PostgreSQL text cannot hold NUL (22021); refused here as a 400, not a 500. */
const hasNul = (value: string) => value.includes('\u0000')

const invalidRequest = () => json({ success: false, error: INVALID_REQUEST_ERROR }, { status: 400 })

/** Map a core's refusal to its status; anything unexplained is a 500 with `fallback`. */
function failureResponse(
  result: Extract<ForecastResult<unknown>, { success: false }>,
  fallback: string,
  context: string
): Response {
  switch (result.reason) {
    case 'invalid-input':
      return json({ success: false, error: result.error }, { status: 400 })
    case 'not-found':
      return json({ success: false, error: result.error }, { status: 404 })
    case 'conflict':
      return json({ success: false, error: result.error }, { status: 409 })
    default:
      logger.error(`[api/forecasts] ${context} failed`, { error: result.error })
      return json({ success: false, error: fallback }, { status: 500 })
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The fields a create and an update share, taken field by field from the parsed
 * body (nothing is spread through). `null` = the body is not a valid request.
 * `name` is passed on as a string either way, so a missing name gets the core's
 * own message ("Profile name is required").
 */
function parseSharedFields(body: Record<string, unknown>): UpdateForecastingProfileInput | null {
  const { name, description, scenarioData, version } = body
  // A MISSING name falls through to the core's own message; a name of the wrong
  // TYPE is a malformed request.
  if (name !== undefined && typeof name !== 'string') return null
  if (typeof name === 'string' && hasNul(name)) return null
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return null
  }
  if (typeof description === 'string' && hasNul(description)) return null
  if (
    version !== undefined &&
    !(
      typeof version === 'number' &&
      Number.isInteger(version) &&
      version >= 1 &&
      version <= INT4_MAX
    )
  ) {
    return null
  }
  if (scenarioData === undefined) return null
  return {
    name: typeof name === 'string' ? name : '',
    ...(typeof description === 'string' ? { description } : {}),
    scenarioData,
    ...(version === undefined ? {} : { version }),
  }
}

/** The create input: the shared fields, plus `profileId` and `isDefault`. */
function parseCreateInput(body: unknown): CreateForecastingProfileInput | null {
  if (!isRecord(body)) return null
  const { profileId, isDefault } = body
  if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId)) return null
  if (isDefault !== undefined && typeof isDefault !== 'boolean') return null
  const shared = parseSharedFields(body)
  if (!shared) return null
  return { ...shared, profileId, ...(isDefault === undefined ? {} : { isDefault }) }
}

/**
 * The update input: the shared fields ONLY (story 97.1). `profileId` and
 * `isDefault` in a PUT body are never read, so an update cannot move a forecast
 * to another profile or change the default flag.
 */
function parseUpdateInput(body: unknown): UpdateForecastingProfileInput | null {
  if (!isRecord(body)) return null
  return parseSharedFields(body)
}

/** `?id=<int>` of a DELETE or PUT: a positive int4, else `null` (a 400). */
function parseForecastId(request: Request): number | null {
  const idParam = new URL(request.url).searchParams.get('id') ?? ''
  const id = /^[1-9]\d{0,9}$/.test(idParam) ? Number(idParam) : Number.NaN
  return id <= INT4_MAX ? id : null
}

const tooLarge = (request: Request): boolean => {
  const contentLength = request.headers.get('content-length')
  return Boolean(contentLength && Number.parseInt(contentLength, 10) > MAX_FORECAST_BODY_BYTES)
}

const requestTooLarge = () => json({ success: false, error: 'Request too large' }, { status: 413 })

export const GET = async ({ request }: { request: Request }): Promise<Response> =>
  noStore(await listForecasts(request))

async function listForecasts(request: Request): Promise<Response> {
  const gate = await requirePremiumSession(request, FORECASTS_PREMIUM_ERROR)
  if (!gate.ok) return gate.response

  const profileParam = new URL(request.url).searchParams.get('profileId')
  let profileId: string | undefined
  // Present means validated, an empty value included: only an ABSENT parameter
  // lists every profile's forecasts.
  if (profileParam !== null) {
    // ⚠️ A non-UUID reaching the `uuid` column is a PostgreSQL 22P02, i.e. a 500.
    if (!UUID_PATTERN.test(profileParam)) return invalidRequest()
    profileId = profileParam
  }

  const result = await getForecastingProfiles(gate.user.userId, profileId)
  if (!result.success) return failureResponse(result, 'Failed to load forecasts', 'GET')
  return json({ success: true, data: result.data })
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const gate = await requirePremiumSession(request, FORECASTS_PREMIUM_ERROR)
  if (!gate.ok) return gate.response

  if (tooLarge(request)) return requestTooLarge()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalidRequest()
  }
  const input = parseCreateInput(body)
  if (!input) return invalidRequest()

  const result = await createForecastingProfile(gate.user.userId, input)
  if (!result.success) return failureResponse(result, 'Failed to save forecast', 'POST')
  return json({ success: true, data: result.data })
}

export const DELETE = async ({ request }: { request: Request }): Promise<Response> => {
  const gate = await requirePremiumSession(request, FORECASTS_PREMIUM_ERROR)
  if (!gate.ok) return gate.response

  const id = parseForecastId(request)
  if (id === null) return invalidRequest()

  const result = await deleteForecastingProfile(gate.user.userId, id)
  if (!result.success) return failureResponse(result, 'Failed to delete forecast', 'DELETE')
  return json({ success: true })
}

/**
 * Save over one of the caller's forecasts (story 97.1, FR157). Same gate, id rule,
 * cap and status mapping as the other methods; a foreign or missing id is a 404.
 */
export const PUT = async ({ request }: { request: Request }): Promise<Response> => {
  const gate = await requirePremiumSession(request, FORECASTS_PREMIUM_ERROR)
  if (!gate.ok) return gate.response

  const id = parseForecastId(request)
  if (id === null) return invalidRequest()

  if (tooLarge(request)) return requestTooLarge()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalidRequest()
  }
  const input = parseUpdateInput(body)
  if (!input) return invalidRequest()

  const result = await updateForecastingProfile(gate.user.userId, id, input)
  if (!result.success) return failureResponse(result, 'Failed to save forecast', 'PUT')
  return json({ success: true, data: result.data })
}

export const Route = createFileRoute('/api/forecasts')({
  server: {
    handlers: {
      GET,
      POST,
      PUT,
      DELETE,
    },
  },
})
