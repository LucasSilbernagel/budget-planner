// @vitest-environment node
/**
 * Paddle webhook replayed on PADDLE-GENERATED payloads (story 94.1, FR152).
 *
 * The sibling `paddle-webhook.db.test.ts` proves the handler's guarantees on
 * payloads WE wrote. This file is a different claim: every fixture under
 * `fixtures/paddle-sandbox/` is the JSON Paddle itself produced in the SANDBOX
 * account (read back from `GET /notifications/{id}` → `payload`, or from a
 * simulation run's events), scrubbed of personal data and otherwise untouched.
 * See `fixtures/paddle-sandbox/MANIFEST.md` for each fixture's provenance.
 *
 * Harness: same as the sibling file (PGlite + the full committed migration
 * chain, `drizzle-orm` NOT mocked, every outcome read back from the DB). The
 * only differences:
 * - each fixture is POSTed as the RAW BYTES read from disk, signed over those
 *   bytes (never a re-serialization, so Biome's JSON formatting cannot matter);
 * - the customer-API lookup can run FOR REAL against a stubbed `fetch` that
 *   returns Paddle's captured `GET /customers/{id}` response (`useRealLookup`).
 */

import crypto from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const lookup = vi.hoisted(() => ({
  /** When true, the REAL `fetchPaddleCustomerEmail` runs (against stubbed `fetch`). */
  useReal: false,
  stub: null as unknown as (customerId: string) => Promise<string | undefined>,
}))
const { getPaddleConfig, assertPaddleProductionConfig, captureError } = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  assertPaddleProductionConfig: vi.fn(),
  captureError: vi.fn(),
}))

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get db() {
      return holder.db
    },
  }
})
vi.mock('@budget-planner/config', () => ({
  getPaddleConfig,
  assertPaddleProductionConfig,
  getSessionSecret: () => 'story-94-1-session-secret-at-least-32-chars',
  getSiteUrl: () => 'https://app.test',
}))
vi.mock('@/server/paddle/customer-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/paddle/customer-api')>()
  return {
    fetchPaddleCustomerEmail: (customerId: string) =>
      lookup.useReal ? actual.fetchPaddleCustomerEmail(customerId) : lookup.stub(customerId),
  }
})
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))
vi.mock('@/server/email/mailer', () => ({ sendMagicLinkEmail: vi.fn() }))
vi.mock('@/server/paddle/subscription-api', () => ({
  cancelActiveSubscriptionsForCustomer: vi.fn(),
}))
vi.mock('@/server/retention/backstop', () => ({ maybeRunRetentionBackstop: vi.fn() }))

import {
  loginTokens,
  paddleAdjustments,
  paddleWebhookEvents,
  rateLimits,
  userProfiles,
  users,
} from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { POST } from '../paddle'

const MIGRATIONS = new URL('../../../../../../../packages/db/migrations/', import.meta.url)
const FIXTURES = new URL('fixtures/paddle-sandbox/', import.meta.url)

const SECRET = 'pdl_ntfset_test_secret'
/** The sandbox catalog (5-3 change log 2026-09-11; re-read 2026-10-04, story 94.1 Task 1.1). */
const SANDBOX_ANNUAL_PRICE = 'pri_01m292p4a2eb5653a5aqwfz35k'
const SANDBOX_LIFETIME_PRICE = 'pri_01m292p4qkt0xa4d6zb89pjr7p'
const SANDBOX_API = 'https://sandbox-api.paddle.com'

let pg: PGlite
let db: ReturnType<typeof drizzle>

const fixturesPresent = existsSync(fileURLToPath(FIXTURES))

/** The fixture's bytes exactly as committed. */
function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')
}

function fixtureNames(): string[] {
  return fixturesPresent ? readdirSync(fileURLToPath(FIXTURES)).sort() : []
}

/** POST raw bytes, signed `ts=<now>;h1=HMAC(secret, ts:raw)` like Paddle does. */
function postRaw(raw: string) {
  const ts = Math.floor(Date.now() / 1000)
  const h1 = crypto.createHmac('sha256', SECRET).update(`${ts}:${raw}`).digest('hex')
  return POST({
    request: new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
      body: raw,
    }),
  })
}

/** Replay a committed fixture through the real handler. */
function replay(name: string) {
  return postRaw(readFixture(name))
}

/**
 * Stub `fetch` so the REAL customer lookup reads the captured
 * `GET /customers/{id}` response. Returns the spy so a test can assert the only
 * call was the expected URL (no real network, ever).
 */
function stubCustomerApi(responses: Record<string, string>) {
  lookup.useReal = true
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    const id = url.startsWith(`${SANDBOX_API}/customers/`)
      ? decodeURIComponent(url.slice(`${SANDBOX_API}/customers/`.length))
      : undefined
    if (id && responses[id] !== undefined) {
      return new Response(responses[id], {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  })
}

function readUser(paddleId: string) {
  return db.select().from(users).where(eq(users.paddleId, paddleId))
}

beforeAll(async () => {
  pg = new PGlite()
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('meta/_journal.json', MIGRATIONS)), 'utf8')
  ) as { entries: { idx: number; tag: string }[] }
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(fileURLToPath(new URL(`${entry.tag}.sql`, MIGRATIONS)), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await pg.exec(statement)
    }
  }
  db = drizzle(pg)
  holder.db = db
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  lookup.useReal = false
  lookup.stub = async () => undefined
  getPaddleConfig.mockReturnValue({
    environment: 'sandbox' as const,
    apiKey: 'pdl_sdbx_test_key',
    clientToken: 'test_client_token',
    webhookSecret: SECRET,
    webhookMaxAgeSeconds: 300,
    apiBaseUrl: SANDBOX_API,
    annualPriceId: SANDBOX_ANNUAL_PRICE,
    lifetimePriceId: SANDBOX_LIFETIME_PRICE,
    isConfigured: true,
  })
  await db.delete(userProfiles)
  await db.delete(paddleWebhookEvents)
  await db.delete(paddleAdjustments)
  await db.delete(loginTokens)
  await db.delete(rateLimits)
  await db.delete(users)
})

// The replay cases (AC 4, AC 5), the scrub guard (AC 3) and the coverage guard
// (AC 2) need the captured fixtures, which do not exist until the sandbox
// capture (story 94.1 Tasks 2-3) has run. They are written against Paddle's
// real payloads only — never against a shape we guessed.
describe.skipIf(!fixturesPresent)('Paddle sandbox payloads through the real handler', () => {
  it.todo('AC 4: annual subscription.created for a first-seen buyer creates an active row')
  it.todo('AC 5: hazards 5-19 fixed, on real payloads')
  it.todo('AC 3: no fixture carries a real address, key, secret or client token')
  it.todo('AC 2: every handled branch has a fixture or is marked NOT CAPTURED')
})

// Referenced by the cases above once fixtures land; kept exported-in-scope so
// the harness is type-checked now.
void replay
void fixtureNames
void stubCustomerApi
void readUser
void expect
