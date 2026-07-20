/**
 * Paddle webhook — lifetime-entitlement tests (story 25-2, AC-3 + code-review 2026-07-20).
 *
 * The €99 one-time lifetime purchase arrives as a `transaction.completed` event
 * (NOT a `subscription_*` event) and is persisted as the first-class permanent
 * status `'lifetime'`. These tests pin:
 *   - a lifetime-priced transaction persists `subscriptionStatus: 'lifetime'`
 *     (direct `price_id`, line-item, underscore-variant, and MULTI-item shapes);
 *   - the price match trims whitespace on the configured id;
 *   - a transaction for any OTHER price (annual renewal invoice) is ignored;
 *   - it fails closed when `PADDLE_LIFETIME_PRICE_ID` is not configured;
 *   - a grant that persists NOTHING returns HTTP 500 (Paddle retries) — no silent loss;
 *   - a currency-less payload does NOT clobber an existing user's currency;
 *   - a `subscription_cancelled` NEVER downgrades a `'lifetime'` buyer;
 *   - a forged signature is rejected (401);
 *   - the pre-existing `subscription_created` path still activates Premium (regression).
 */

import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPaddleConfig, transaction, setSpy, insertValuesSpy } = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  transaction: vi.fn(),
  setSpy: vi.fn(),
  insertValuesSpy: vi.fn(),
}))

vi.mock('@budget-planner/config', () => ({ getPaddleConfig }))
vi.mock('@budget-planner/db', () => ({
  db: { transaction },
  currencyEnum: { enumValues: ['NONE', 'USD', 'EUR'] },
}))
vi.mock('@budget-planner/db/src/schema', () => ({ users: {} }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError: vi.fn() }))

import { POST } from '../paddle'

const SECRET = 'test-webhook-secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'

/**
 * A tx stub covering both DB access patterns:
 *  - `handleLifetimePurchase` update-first: `.update().set().where()` → { rowCount }
 *  - `handleSubscriptionStatusUpdate` select-first: `.select().from().where().limit()`
 * `existingStatus = null` models "user does not exist yet" (update rowCount 0 / empty select).
 */
function makeTx({ existingStatus = 'free' }: { existingStatus?: string | null } = {}) {
  const rowCount = existingStatus === null ? 0 : 1
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(existingStatus === null ? [] : [{ status: existingStatus }]),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        setSpy(values)
        return { where: () => Promise.resolve({ rowCount }) }
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertValuesSpy(values)
        return Promise.resolve()
      },
    }),
  }
}

/** Build a POST Request carrying a VALID Paddle signature for the given payload. */
function signedRequest(payloadObj: unknown): Request {
  const body = JSON.stringify(payloadObj)
  const ts = '1700000000'
  const hmac = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')
  return new Request('https://app.test/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'paddle-signature': `v1,${ts},${hmac}`, 'content-type': 'application/json' },
    body,
  })
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'sandbox',
    vendorId: '1',
    apiKey: 'k',
    publicKey: 'p',
    webhookSecret: SECRET,
    annualPriceId: ANNUAL_PRICE,
    lifetimePriceId: LIFETIME_PRICE,
    isConfigured: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPaddleConfig.mockReturnValue(config())
  transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
    cb(makeTx({ existingStatus: 'free' }))
  )
})

describe('POST /api/webhooks/paddle — lifetime purchase (AC-3)', () => {
  it('persists subscriptionStatus="lifetime" for a lifetime line-item transaction', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          user_id: 'ctm_1',
          email: 'buyer@example.com',
          currency_code: 'EUR',
          items: [{ price_id: LIFETIME_PRICE }],
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith({ subscriptionStatus: 'lifetime', currency: 'EUR' })
  })

  it('also reads the price from a direct price_id field', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_2', email: 'b@example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
  })

  it('accepts the underscore event-name variant (transaction_completed)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction_completed',
        data: { user_id: 'ctm_3', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
  })

  it('grants when the lifetime item is NOT the first line item (multi-item bundle)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          user_id: 'ctm_4',
          email: 'c@example.com',
          items: [{ price_id: ANNUAL_PRICE }, { price_id: LIFETIME_PRICE }],
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
  })

  it('trims whitespace on the configured lifetime price id before matching', async () => {
    getPaddleConfig.mockReturnValue(config({ lifetimePriceId: `  ${LIFETIME_PRICE}\n` }))
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_5', email: 'd@example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
  })

  it('creates a new user as "lifetime" when none exists yet (insert path)', async () => {
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_new', email: 'new@example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'lifetime', email: 'new@example.com' })
    )
  })

  it("does NOT overwrite an existing user's currency when the payload omits currency", async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_6', email: 'e@example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    // Exact object: currency key must be ABSENT so the stored currency is preserved.
    expect(setSpy).toHaveBeenCalledWith({ subscriptionStatus: 'lifetime' })
  })

  it('ignores a transaction for a NON-lifetime price (annual renewal invoice)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_1', items: [{ price_id: ANNUAL_PRICE }] },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('fails closed when PADDLE_LIFETIME_PRICE_ID is not configured', async () => {
    getPaddleConfig.mockReturnValue(config({ lifetimePriceId: undefined }))
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_1', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('returns 500 (Paddle retries) when the grant persists nothing — no silent loss', async () => {
    // Unknown user (rowCount 0) with no email → handleLifetimePurchase writes nothing.
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { user_id: 'ctm_noemail', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })

  it('rejects a lifetime transaction with a forged signature (401, no entitlement)', async () => {
    const body = JSON.stringify({
      event_type: 'transaction.completed',
      data: { user_id: 'ctm_1', price_id: LIFETIME_PRICE },
    })
    const req = new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'paddle-signature': 'v1,1700000000,deadbeef' },
      body,
    })

    const res = await POST({ request: req })

    expect(res.status).toBe(401)
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/paddle — subscription path (regression + no-downgrade)', () => {
  it('still activates Premium on subscription_created for an existing user', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription_created',
        data: { user_id: 'ctm_1', status: 'active', email: 'sub@example.com' },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'active' }))
  })

  it('NEVER downgrades a lifetime buyer when their subscription is cancelled', async () => {
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: 'lifetime' }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription_cancelled',
        data: { user_id: 'ctm_lifer', status: 'canceled', email: 'lifer@example.com' },
      }),
    })

    expect(res.status).toBe(200)
    // The lifetime row is left untouched — no update, no insert.
    expect(setSpy).not.toHaveBeenCalled()
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })
})
