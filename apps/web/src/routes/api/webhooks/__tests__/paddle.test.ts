/**
 * Paddle Billing webhook tests.
 *
 * Story 5-3 reconciled the handler from the invented Paddle Classic scheme
 * (`v1,{ts},{hmac}` over `ts.body`, `subscription_created` event names,
 * `data.user_id`) to Paddle Billing:
 *   - signature: `Paddle-Signature: ts=<unix>;h1=<hex>`, HMAC-SHA256 over `ts:rawBody`;
 *   - a timestamp-freshness window rejects replays;
 *   - events: any `subscription.*` (status-driven) + `transaction.completed`;
 *   - the buyer is `data.customer_id`; the email is resolved from the payload or,
 *     failing that, the Billing customer API.
 *
 * The 25-2 lifetime-entitlement guarantees are re-pinned under the new scheme:
 *   - a lifetime-priced transaction persists `subscriptionStatus: 'lifetime'`;
 *   - a transaction for any other price (annual renewal invoice) is ignored;
 *   - it fails closed when `PADDLE_LIFETIME_PRICE_ID` is unset;
 *   - a grant that persists nothing returns HTTP 500 (Paddle retries);
 *   - a currency-less payload does NOT clobber an existing user's currency;
 *   - `subscription.canceled` NEVER downgrades a `'lifetime'` buyer;
 *   - a forged / stale signature is rejected (401).
 */

import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getPaddleConfig,
  assertPaddleProductionConfig,
  fetchPaddleCustomerEmail,
  createDefaultProfileForUser,
  transaction,
  setSpy,
  insertValuesSpy,
} = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  assertPaddleProductionConfig: vi.fn(),
  fetchPaddleCustomerEmail: vi.fn(),
  createDefaultProfileForUser: vi.fn(),
  transaction: vi.fn(),
  setSpy: vi.fn(),
  insertValuesSpy: vi.fn(),
}))

vi.mock('@budget-planner/config', () => ({ getPaddleConfig, assertPaddleProductionConfig }))
vi.mock('@budget-planner/db', () => ({
  db: { transaction },
  currencyEnum: { enumValues: ['NONE', 'USD', 'EUR'] },
}))
vi.mock('@budget-planner/db/src/schema', () => ({
  users: { paddleId: 'paddleId', id: 'id', subscriptionStatus: 'subscriptionStatus' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), sql: vi.fn(() => 'sql-fragment') }))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/server/functions/profiles', () => ({ createDefaultProfileForUser }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError: vi.fn() }))

import { POST } from '../paddle'

const SECRET = 'pdl_ntfset_test_secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'

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
        return {
          // handleLifetimePurchase / handleSubscriptionStatusUpdate insert path:
          // .values().onConflictDoUpdate().returning() → [{ id }]
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([{ id: 'new-user-id' }]),
          }),
        }
      },
    }),
  }
}

/** Build a POST Request carrying a VALID, FRESH Paddle Billing signature. */
function signedRequest(payloadObj: unknown, opts: { ts?: number; secret?: string } = {}): Request {
  const body = JSON.stringify(payloadObj)
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const h1 = crypto
    .createHmac('sha256', opts.secret ?? SECRET)
    .update(`${ts}:${body}`)
    .digest('hex')
  return new Request('https://app.test/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
    body,
  })
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'sandbox' as const,
    apiKey: 'pdl_sdbx_key',
    clientToken: 'test_client_token',
    webhookSecret: SECRET,
    webhookMaxAgeSeconds: 300,
    apiBaseUrl: 'https://sandbox-api.paddle.com',
    annualPriceId: ANNUAL_PRICE,
    lifetimePriceId: LIFETIME_PRICE,
    isConfigured: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPaddleConfig.mockReturnValue(config())
  fetchPaddleCustomerEmail.mockResolvedValue(undefined)
  createDefaultProfileForUser.mockResolvedValue({ success: true, data: {} })
  transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
    cb(makeTx({ existingStatus: 'free' }))
  )
})

describe('POST /api/webhooks/paddle — signature verification (AC-4)', () => {
  it('accepts a valid, fresh Billing signature', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_1', status: 'active', email: 'a@example.com' },
      }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a tampered h1 (401)', async () => {
    const body = JSON.stringify({
      event_type: 'subscription.created',
      data: { customer_id: 'ctm_1', status: 'active' },
    })
    const ts = Math.floor(Date.now() / 1000)
    const req = new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=deadbeefdeadbeef` },
      body,
    })
    const res = await POST({ request: req })
    expect(res.status).toBe(401)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp outside the freshness window (401)', async () => {
    const res = await POST({
      request: signedRequest(
        { event_type: 'subscription.created', data: { customer_id: 'ctm_1', status: 'active' } },
        { ts: Math.floor(Date.now() / 1000) - 3600 }
      ),
    })
    expect(res.status).toBe(401)
  })

  it('accepts when ANY of multiple h1 values matches (Paddle secret rotation)', async () => {
    const body = JSON.stringify({
      event_type: 'subscription.created',
      data: { customer_id: 'ctm_1', status: 'active', email: 'a@example.com' },
    })
    const ts = Math.floor(Date.now() / 1000)
    const good = crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')
    const req = new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      // old (wrong) secret first, then the current one — the loop must not stop at the first
      headers: {
        'paddle-signature': `ts=${ts};h1=${'0'.repeat(64)};h1=${good}`,
        'content-type': 'application/json',
      },
      body,
    })
    const res = await POST({ request: req })
    expect(res.status).toBe(200)
  })

  it('rejects a missing signature header (401)', async () => {
    const res = await POST({
      request: new Request('https://app.test/api/webhooks/paddle', {
        method: 'POST',
        body: JSON.stringify({ event_type: 'subscription.created', data: {} }),
      }),
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/webhooks/paddle — lifetime purchase (AC-3, story 25-2)', () => {
  it('persists subscriptionStatus="lifetime" for a lifetime line-item transaction', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          customer_id: 'ctm_1',
          email: 'buyer@example.com',
          currency_code: 'EUR',
          items: [{ price: { id: LIFETIME_PRICE } }],
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
        data: { customer_id: 'ctm_2', email: 'b@example.com', price_id: LIFETIME_PRICE },
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
          customer_id: 'ctm_4',
          email: 'c@example.com',
          items: [{ price: { id: ANNUAL_PRICE } }, { price: { id: LIFETIME_PRICE } }],
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
        data: { customer_id: 'ctm_5', email: 'd@example.com', price_id: LIFETIME_PRICE },
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
        data: { customer_id: 'ctm_new', email: 'New@Example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    // Stored email is normalized (lower-cased) — Story 5-3 shared canonicalization.
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'lifetime', email: 'new@example.com' })
    )
  })

  it('resolves the buyer email from the Billing customer API when the payload omits it', async () => {
    fetchPaddleCustomerEmail.mockResolvedValue('resolved@example.com')
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { customer_id: 'ctm_api', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(fetchPaddleCustomerEmail).toHaveBeenCalledWith('ctm_api')
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'resolved@example.com' })
    )
  })

  it("does NOT overwrite an existing user's currency when the payload omits currency", async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { customer_id: 'ctm_6', email: 'e@example.com', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith({ subscriptionStatus: 'lifetime' })
  })

  it('ignores a transaction for a NON-lifetime price (annual renewal invoice)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { customer_id: 'ctm_1', items: [{ price: { id: ANNUAL_PRICE } }] },
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
        data: { customer_id: 'ctm_1', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('returns 500 (Paddle retries) when the grant persists nothing — no silent loss', async () => {
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: { customer_id: 'ctm_noemail', price_id: LIFETIME_PRICE },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/paddle — subscription path (regression + no-downgrade)', () => {
  it('activates Premium on subscription.created for an existing user', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_1', status: 'active', email: 'sub@example.com' },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'active' }))
  })

  it('maps subscription.updated status=past_due to past_due', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.updated',
        data: { customer_id: 'ctm_1', status: 'past_due' },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'past_due' }))
  })

  it('NEVER downgrades a lifetime buyer when their subscription is canceled', async () => {
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: 'lifetime' }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.canceled',
        data: { customer_id: 'ctm_lifer', status: 'canceled', email: 'lifer@example.com' },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).not.toHaveBeenCalled()
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })

  it('returns 500 (Paddle retries) when a first-seen subscriber has no resolvable email', async () => {
    // Billing subscription payloads carry no inline email; the customer API is down.
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_new_sub', status: 'active' },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })

  it('returns 500 (Paddle retries) when the subscription transaction throws', async () => {
    transaction.mockRejectedValue(new Error('deadlock'))
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.updated',
        data: { customer_id: 'ctm_1', status: 'canceled', email: 'x@example.com' },
      }),
    })
    expect(res.status).toBe(500)
  })

  it('creates a default profile for a first-seen subscriber (sole account-creation path)', async () => {
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_fresh', status: 'active', email: 'fresh@example.com' },
      }),
    })

    expect(res.status).toBe(200)
    expect(insertValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'active', email: 'fresh@example.com' })
    )
    expect(createDefaultProfileForUser).toHaveBeenCalledWith('new-user-id')
  })

  it('does NOT create a profile for an existing subscriber (match by customer_id)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.updated',
        data: { customer_id: 'ctm_1', status: 'active' },
      }),
    })

    expect(res.status).toBe(200)
    expect(createDefaultProfileForUser).not.toHaveBeenCalled()
  })

  it('a failed default-profile creation does not fail the webhook (non-fatal)', async () => {
    createDefaultProfileForUser.mockResolvedValue({ success: false, error: 'db down' })
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_np', status: 'active', email: 'np@example.com' },
      }),
    })

    expect(res.status).toBe(200)
  })
})
