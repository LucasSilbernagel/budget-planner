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

export const FORECASTS_PREMIUM_ERROR =
  'Premium feature: Please upgrade to access forecasting profile management'

export const MAX_FORECAST_BODY_BYTES = 256 * 1024

export const INVALID_REQUEST_ERROR = 'Invalid request'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT4_MAX = 2_147_483_647

/** Every answer is user-specific, refusals included, so none may be cached. */
function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** PostgreSQL text cannot hold NUL (22021); refused here as a 400, not a 500. */
const hasNul = (value: string) => value.includes('\u0000')

const invalidRequest = () => json({ success: false, error: INVALID_REQUEST_ERROR }, { status: 400 })

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

function parseSharedFields(body: Record<string, unknown>): UpdateForecastingProfileInput | null {
  const { name, description, scenarioData, version } = body
  // A missing name falls through to the core's own message; a wrong type is a malformed request.
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

function parseCreateInput(body: unknown): CreateForecastingProfileInput | null {
  if (!isRecord(body)) return null
  const { profileId, isDefault } = body
  if (typeof profileId !== 'string' || !UUID_PATTERN.test(profileId)) return null
  if (isDefault !== undefined && typeof isDefault !== 'boolean') return null
  const shared = parseSharedFields(body)
  if (!shared) return null
  return { ...shared, profileId, ...(isDefault === undefined ? {} : { isDefault }) }
}

/** `profileId` and `isDefault` in a PUT body are never read. */
function parseUpdateInput(body: unknown): UpdateForecastingProfileInput | null {
  if (!isRecord(body)) return null
  return parseSharedFields(body)
}

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
  // Only an absent parameter lists every profile's forecasts.
  if (profileParam !== null) {
    // A non-UUID reaching the `uuid` column is a PostgreSQL 22P02, i.e. a 500.
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
