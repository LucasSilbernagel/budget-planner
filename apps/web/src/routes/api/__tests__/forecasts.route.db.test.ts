// @vitest-environment node
/**
 * `/api/forecasts` on a real PostgreSQL (PGlite, the migration chain) (story 83.1,
 * FR136, AC-1).
 *
 * The handlers are called directly with real `Request`s. Only the session
 * resolver is mocked; everything after it (the premium gate, parsing, the cores
 * with 80.1's transaction, the SQL) is the shipped code. Each D4 row that can
 * occur for a handler has a case, with the database state asserted, not just the
 * status: a refused write must leave no row.
 *
 * ⚠️ undici's `new Request(url, { body })` sets NO `content-length` (story 79.3,
 * MEASURED), so `post()` sets it by hand; without it the 413 guard is never reached.
 */

import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get db() {
      return holder.db
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/server/api/auth/paddle', () => ({ getCurrentUserSession: vi.fn() }))

import { logger } from '@/lib/logger'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { forecastingProfiles, userProfiles, users } from '@budget-planner/db'
import { migratedPglite } from '../../../test/pglite-migrated'
import {
  DELETE,
  FORECASTS_PREMIUM_ERROR,
  GET,
  INVALID_REQUEST_ERROR,
  MAX_FORECAST_BODY_BYTES,
  POST,
} from '../forecasts'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BASE = 'https://app.test/api/forecasts'
const REFUSAL = 'Invalid profile ID or profile does not belong to current user'

let pg: PGlite
let db: ReturnType<typeof drizzle>

const sessionMock = getCurrentUserSession as unknown as ReturnType<typeof vi.fn>

function signedIn(subscriptionStatus: string, userId = USER) {
  sessionMock.mockResolvedValue({
    success: true,
    data: {
      userId,
      email: 'a@example.test',
      paddleId: 'ctm_a',
      subscriptionStatus,
      currency: 'NONE',
      billingInterval: null,
      isAuthenticated: true,
    },
  })
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request(BASE, {
    method: 'POST',
    body: text,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(text).byteLength),
      ...headers,
    },
  })
}

const get = (query = '') => new Request(`${BASE}${query}`)
const del = (query: string) => new Request(`${BASE}${query}`, { method: 'DELETE' })

function aSave(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Plan A',
    scenarioData: { scenario: { name: 'Plan A' }, result: { summary: {} }, inputs: {} },
    profileId: P,
    ...overrides,
  }
}

async function rows() {
  return db
    .select({
      id: forecastingProfiles.id,
      userId: forecastingProfiles.userId,
      profileId: forecastingProfiles.profileId,
      name: forecastingProfiles.name,
    })
    .from(forecastingProfiles)
}

async function insertForecast(userId: string, profileId: string, name: string) {
  const [row] = await db
    .insert(forecastingProfiles)
    .values({ userId, profileId, name, scenarioData: '{}' })
    .returning({ id: forecastingProfiles.id })
  if (!row) throw new Error('fixture insert returned no row')
  return row.id
}

beforeAll(async () => {
  pg = await migratedPglite()
  db = drizzle(pg)
  holder.db = db
  await db.insert(users).values([
    { id: USER, email: 'a@example.test', paddleId: 'ctm_a', subscriptionStatus: 'active' },
    { id: OTHER, email: 'b@example.test', paddleId: 'ctm_b', subscriptionStatus: 'active' },
  ])
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  vi.clearAllMocks()
  holder.db = db
  await db.delete(forecastingProfiles)
  await db.delete(userProfiles)
  await db.insert(userProfiles).values([
    { id: P, userId: USER, name: 'Main', isDefault: true },
    { id: DEAD, userId: USER, name: 'Gone', isDefault: false, isDeleted: true },
    { id: OTHER_P, userId: OTHER, name: 'Theirs', isDefault: true },
  ])
  signedIn('active')
})

describe('the session and premium gate, on every method', () => {
  const handlers = [
    ['GET', () => GET({ request: get() })],
    ['POST', () => POST({ request: post(aSave()) })],
    ['DELETE', () => DELETE({ request: del('?id=1') })],
  ] as const

  it.each(handlers)(
    '%s: an unresolvable session is 503, not 401 (an outage is not a sign-out)',
    async (_m, call) => {
      sessionMock.mockResolvedValue({ success: false, error: 'DATABASE_URL is not configured.' })
      const res = await call()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toEqual({
        success: false,
        error: 'Your session could not be checked. Try again in a moment.',
      })
      // The resolver's own text (driver detail) never reaches the client.
      expect(JSON.stringify(body)).not.toContain('DATABASE_URL')
    }
  )

  it.each(handlers)('%s: no session is 401', async (_m, call) => {
    sessionMock.mockResolvedValue({ success: true, data: null })
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: 'Authentication required' })
  })

  describe.each(['free', 'past_due', 'canceled'])('a %s status', (status) => {
    it.each(handlers)(
      '%s: is 403 with the premium message, and writes nothing',
      async (_m, call) => {
        signedIn(status)
        const res = await call()
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ success: false, error: FORECASTS_PREMIUM_ERROR })
        expect(await rows()).toEqual([])
      }
    )
  })

  it('a lifetime status is let through (positive control for the 403s)', async () => {
    signedIn('lifetime')
    expect((await GET({ request: get() })).status).toBe(200)
  })
})

describe('GET /api/forecasts', () => {
  it("lists the caller's forecasts only, newest first, with ISO dates and the profile name", async () => {
    await insertForecast(USER, P, 'First')
    await new Promise((r) => setTimeout(r, 5))
    await insertForecast(USER, P, 'Second')
    await insertForecast(OTHER, OTHER_P, 'Not yours')

    const res = await GET({ request: get() })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown>[] }
    expect(body.success).toBe(true)
    expect(body.data.map((f) => f['name'])).toEqual(['Second', 'First'])
    expect(body.data.every((f) => f['userId'] === USER && f['profileName'] === 'Main')).toBe(true)
    expect(body.data[0]?.['createdAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('scopes to ?profileId when given', async () => {
    await insertForecast(USER, P, 'Under P')
    const res = await GET({ request: get(`?profileId=${P}`) })
    const body = (await res.json()) as { data: { name: string }[] }
    expect(body.data.map((f) => f.name)).toEqual(['Under P'])
  })

  it('answers 404 for a deleted or foreign profile', async () => {
    for (const profileId of [DEAD, OTHER_P]) {
      const res = await GET({ request: get(`?profileId=${profileId}`) })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ success: false, error: REFUSAL })
    }
  })

  it.each(['?profileId=not-a-uuid', '?profileId='])(
    '%s is a 400: a PRESENT profileId is validated, an empty one included',
    async (query) => {
      const res = await GET({ request: get(query) })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ success: false, error: INVALID_REQUEST_ERROR })
    }
  )

  it.each([
    ['503', () => sessionMock.mockResolvedValue({ success: false, error: 'x' }), ''],
    ['401', () => sessionMock.mockResolvedValue({ success: true, data: null }), ''],
    ['403', () => signedIn('free'), ''],
    ['400', () => {}, '?profileId=nope'],
    ['404', () => {}, `?profileId=${DEAD}`],
  ])('a %s answer is not cacheable either', async (status, arrange, query) => {
    arrange()
    const res = await GET({ request: get(query) })
    expect(String(res.status)).toBe(status)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('an unexpected failure is a 500 with a fixed message; the detail goes to the log', async () => {
    holder.db = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'select') throw new Error('connection reset by peer')
        return Reflect.get(target, prop, receiver)
      },
    })
    const res = await GET({ request: get() })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load forecasts' })
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('[api/forecasts] GET failed', {
      error: 'connection reset by peer',
    })
  })
})

describe('POST /api/forecasts', () => {
  it("saves under the caller's live profile through the transactional core, and returns the row", async () => {
    const res = await POST({ request: post(aSave()) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> }
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({
      name: 'Plan A',
      profileId: P,
      userId: USER,
      profileName: 'Main',
    })
    expect(JSON.parse(String(body.data['scenarioData']))).toEqual(aSave().scenarioData)
    expect(await rows()).toEqual([
      { id: body.data['id'], userId: USER, profileId: P, name: 'Plan A' },
    ])
  })

  it('takes the owner from the session, never from the body', async () => {
    const res = await POST({ request: post(aSave({ userId: OTHER })) })
    expect(res.status).toBe(200)
    expect((await rows()).map((r) => r.userId)).toEqual([USER])
  })

  it("refuses another user's profile and a deleted profile with 404, and writes nothing", async () => {
    for (const profileId of [OTHER_P, DEAD]) {
      const res = await POST({ request: post(aSave({ profileId })) })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ success: false, error: REFUSAL })
    }
    expect(await rows()).toEqual([])
  })

  it('a duplicate name is a 409 with the friendly message, and no second row', async () => {
    expect((await POST({ request: post(aSave()) })).status).toBe(200)
    const res = await POST({ request: post(aSave()) })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      success: false,
      error: 'A forecast with this name already exists for this profile.',
    })
    expect(await rows()).toHaveLength(1)
  })

  it.each([
    ['an empty name', aSave({ name: '   ' }), 'Profile name is required'],
    ['a missing name', aSave({ name: undefined }), 'Profile name is required'],
    [
      'a 256-character name',
      aSave({ name: 'x'.repeat(256) }),
      'Profile name must be 255 characters or less',
    ],
    [
      'scenarioData that is a number',
      aSave({ scenarioData: 42 }),
      'scenarioData must be a JSON object or a valid JSON string',
    ],
    [
      'scenarioData that is a malformed JSON string',
      aSave({ scenarioData: '{nope' }),
      'scenarioData must be valid JSON',
    ],
    // Valid JSON but not an object: stored, then hidden by the page while still
    // holding its name (story 83.1 code review).
    ['scenarioData "null"', aSave({ scenarioData: 'null' }), 'scenarioData must be a JSON object'],
    ['scenarioData "1"', aSave({ scenarioData: '1' }), 'scenarioData must be a JSON object'],
    ['scenarioData "[]"', aSave({ scenarioData: '[]' }), 'scenarioData must be a JSON object'],
    [
      'scenarioData that is an array',
      aSave({ scenarioData: [] }),
      'scenarioData must be a JSON object or a valid JSON string',
    ],
  ])('%s is a 400 with the existing message, and writes nothing', async (_label, body, error) => {
    const res = await POST({ request: post(body) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error })
    expect(await rows()).toEqual([])
  })

  it.each([
    ['a body that is not JSON', '{not json'],
    ['a JSON array', [aSave()]],
    ['a missing profileId', aSave({ profileId: undefined })],
    ['a profileId that is not a UUID', aSave({ profileId: 'profile-1' })],
    ['a non-boolean isDefault', aSave({ isDefault: 'yes' })],
    ['a non-string description', aSave({ description: 7 })],
    ['a fractional version', aSave({ version: 1.5 })],
    ['no scenarioData', aSave({ scenarioData: undefined })],
    ['a name that is not a string', aSave({ name: 42 })],
    // PostgreSQL text cannot hold NUL (22021): it used to reach the column as a 500.
    ['a NUL in the name', aSave({ name: 'Plan\u0000A' })],
    ['a NUL in the description', aSave({ description: 'x\u0000y' })],
  ])('%s is a 400 "Invalid request", and writes nothing', async (_label, body) => {
    const res = await POST({ request: post(body) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: INVALID_REQUEST_ERROR })
    expect(await rows()).toEqual([])
  })

  it('refuses a body over the cap with 413 BEFORE parsing it', async () => {
    // Not JSON at all: had the handler parsed it, the answer would be a 400.
    const res = await POST({
      request: post('{not json', { 'content-length': String(MAX_FORECAST_BODY_BYTES + 1) }),
    })
    expect(res.status).toBe(413)
    expect(await rows()).toEqual([])
  })

  it('accepts a body exactly at the cap boundary by length (the cap is exclusive)', async () => {
    // The header is the one the check reads; the body is a normal save.
    const res = await POST({
      request: post(aSave(), { 'content-length': String(MAX_FORECAST_BODY_BYTES) }),
    })
    expect(res.status).toBe(200)
    expect(await rows()).toHaveLength(1)
  })

  it('an unexpected failure is a 500 with a fixed message, no row, and the detail only in the log', async () => {
    holder.db = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') throw new Error('connection reset by peer')
        return Reflect.get(target, prop, receiver)
      },
    })
    const res = await POST({ request: post(aSave()) })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to save forecast' })
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('[api/forecasts] POST failed', {
      error: 'connection reset by peer',
    })
    holder.db = db
    expect(await rows()).toEqual([])
  })
})

describe('DELETE /api/forecasts', () => {
  it("deletes the caller's forecast", async () => {
    const id = await insertForecast(USER, P, 'Doomed')
    const res = await DELETE({ request: del(`?id=${id}`) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(await rows()).toEqual([])
  })

  it("answers 404 for another user's forecast, which survives", async () => {
    const id = await insertForecast(OTHER, OTHER_P, 'Theirs')
    const res = await DELETE({ request: del(`?id=${id}`) })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      success: false,
      error: 'Forecasting profile not found or access denied',
    })
    expect((await rows()).map((r) => r.id)).toEqual([id])
  })

  it('an unexpected failure is a 500 with a fixed message; the detail goes to the log', async () => {
    const id = await insertForecast(USER, P, 'Kept')
    holder.db = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete') throw new Error('connection reset by peer')
        return Reflect.get(target, prop, receiver)
      },
    })
    const res = await DELETE({ request: del(`?id=${id}`) })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to delete forecast' })
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('[api/forecasts] DELETE failed', {
      error: 'connection reset by peer',
    })
  })

  it('answers 404 for an id that does not exist', async () => {
    expect((await DELETE({ request: del('?id=999') })).status).toBe(404)
  })

  it.each([
    '',
    '?id=',
    '?id=abc',
    '?id=0',
    '?id=-1',
    '?id=1.5',
    '?id=01',
    '?id=2147483648',
    '?id=1e3',
  ])('%s is a 400 "Invalid request"', async (query) => {
    const res = await DELETE({ request: del(query) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ success: false, error: INVALID_REQUEST_ERROR })
  })

  it('accepts the largest int4 id (404 here, not 400)', async () => {
    expect((await DELETE({ request: del('?id=2147483647') })).status).toBe(404)
  })
})
