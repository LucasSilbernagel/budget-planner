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
  captureError,
  transaction,
  setSpy,
  insertValuesSpy,
  dbHasUser,
} = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  assertPaddleProductionConfig: vi.fn(),
  fetchPaddleCustomerEmail: vi.fn(),
  createDefaultProfileForUser: vi.fn(),
  captureError: vi.fn(),
  transaction: vi.fn(),
  setSpy: vi.fn(),
  insertValuesSpy: vi.fn(),
  dbHasUser: { value: true },
}))

vi.mock('@budget-planner/config', () => ({ getPaddleConfig, assertPaddleProductionConfig }))
vi.mock('@budget-planner/db', () => ({
  // `select` backs the PRE-TRANSACTION existence check that decides whether the
  // buyer's email needs resolving (Story 5-19 review moved that Paddle HTTP
  // round trip out of the transaction). `dbHasUser` drives it.
  db: {
    transaction,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbHasUser.value ? [{ id: 'existing-user-id' }] : []),
        }),
      }),
    }),
  },
  currencyEnum: { enumValues: ['NONE', 'USD', 'EUR'] },
}))
vi.mock('@budget-planner/db/src/schema', () => ({
  users: {
    paddleId: 'paddleId',
    id: 'id',
    email: 'email',
    subscriptionStatus: 'subscriptionStatus',
    isDeleted: 'isDeleted',
    entitlementUpdatedAt: 'entitlementUpdatedAt',
    lifetimeTransactionId: 'lifetimeTransactionId',
    lifetimeGrantTotal: 'lifetimeGrantTotal',
    lifetimeRefundedTotal: 'lifetimeRefundedTotal',
  },
  paddleWebhookEvents: { __table: 'paddleWebhookEvents', eventId: 'eventId' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), sql: vi.fn(() => 'sql-fragment') }))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/server/functions/profiles', () => ({ createDefaultProfileForUser }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))

import { POST } from '../paddle'

const SECRET = 'pdl_ntfset_test_secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'
const MONTHLY_PRICE = 'pri_monthly_599'

/**
 * A stand-in transaction.
 *
 * ⚠️ This fixture proves ROUTING and PAYLOAD SHAPE only — which handler an
 * event reaches, and what it asks the DB to write. It cannot prove that a
 * `.where()` actually matches, because `drizzle-orm` is mocked above. The
 * guarantees that depend on real SQL — match-by-customer, the unique
 * constraints, dedup and ordering — are covered against real PostgreSQL in
 * `paddle-webhook.db.test.ts` (Story 5-19, AC-7). Do not add a guarantee of
 * that kind here and believe it.
 *
 * ⚠️ ONE GUARANTEE IS COVERED BY NEITHER SUITE, AND SAYING SO IS THE POINT: the
 * `setWhere` no-downgrade race guard on the `onConflictDoUpdate` path. That
 * branch only executes when a CONCURRENT insert wins the race, and PGlite is a
 * single in-process connection, so the db suite cannot reach it either.
 * Verified by positive control during code review: deleting `setWhere`
 * entirely leaves all 53 tests across both suites green. An earlier version of
 * this comment claimed the db suite covered it. It does not.
 */
function makeTx({ existingStatus = 'free' }: { existingStatus?: string | null } = {}) {
  const rowCount = existingStatus === null ? 0 : 1
  const selectedRow = existingStatus === null ? undefined : { status: existingStatus }
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectedRow ? [selectedRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        setSpy(values)
        return { where: () => Promise.resolve({ rowCount }) }
      },
    }),
    insert: (table: unknown) => {
      const isEventClaim = (table as { __table?: string })?.__table === 'paddleWebhookEvents'
      return {
        values: (values: unknown) => {
          if (isEventClaim) {
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([{ eventId: 'evt_1' }]),
              }),
            }
          }
          insertValuesSpy(values)
          return {
            // handleLifetimePurchase / handleSubscriptionStatusUpdate insert path:
            // .values().onConflictDoUpdate().returning() → [{ id }]
            onConflictDoUpdate: () => ({
              returning: () => Promise.resolve([{ id: 'new-user-id' }]),
            }),
          }
        },
      }
    },
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
    monthlyPriceId: MONTHLY_PRICE,
    annualPriceId: ANNUAL_PRICE,
    lifetimePriceId: LIFETIME_PRICE,
    isConfigured: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: the customer already exists, so the pre-transaction email lookup
  // short-circuits. Tests exercising the first-seen-buyer path set this false.
  dbHasUser.value = true
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

  it('rejects a tampered h1 — same length as a real HMAC, wrong value (401)', async () => {
    // A short (8-byte) h1 is rejected by the length pre-check before the HMAC
    // ever runs, which would let a broken `verifyWebhookSignature` pass this
    // test unnoticed. Use a full 64-hex-char (32-byte) WRONG value so the
    // comparison actually reaches `crypto.timingSafeEqual`.
    const body = JSON.stringify({
      event_type: 'subscription.created',
      data: { customer_id: 'ctm_1', status: 'active' },
    })
    const ts = Math.floor(Date.now() / 1000)
    const wrongButRightLength = '0'.repeat(64)
    const req = new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=${wrongButRightLength}` },
      body,
    })
    const res = await POST({ request: req })
    expect(res.status).toBe(401)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a validly-formed signature computed over a DIFFERENT body', async () => {
    // Proves the HMAC actually binds to the delivered body, not just to `ts`
    // and a well-formed-looking `h1`.
    const signedForOtherBody = signedRequest({
      event_type: 'subscription.created',
      data: { customer_id: 'ctm_1', status: 'active' },
    })
    const ts = signedForOtherBody.headers.get('paddle-signature')?.match(/ts=(\d+)/)?.[1]
    const req = new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: {
        'paddle-signature': signedForOtherBody.headers.get('paddle-signature') ?? '',
        'content-type': 'application/json',
      },
      // Same ts/signature, but a body that was never signed.
      body: JSON.stringify({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_ATTACKER', status: 'active' },
      }),
    })
    expect(ts).toBeDefined()
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
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_1',
          email: 'buyer@example.com',
          currency_code: 'EUR',
          items: [{ price: { id: LIFETIME_PRICE } }],
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    // ⚠️ `currency` is deliberately ABSENT (Story 5-19, AC-8). It used to be
    // written here, which meant a renewal billed from another country silently
    // flipped the user's chosen DISPLAY currency — the two are different
    // things. It is insert-only now, asserted below.
    expect(setSpy).toHaveBeenCalledWith({
      subscriptionStatus: 'lifetime',
      entitlementUpdatedAt: expect.any(Number),
      // Recorded at grant time so a later refund can be judged full vs partial
      // (AC-1). A grant with no usable total is now REFUSED outright, so this
      // field is always present on a successful lifetime write.
      lifetimeGrantTotal: 9900,
    })
  })

  it('also reads the price from a direct price_id field', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_2',
          email: 'b@example.com',
          price_id: LIFETIME_PRICE,
        },
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
          details: { totals: { grand_total: '9900' } },
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
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_5',
          email: 'd@example.com',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'lifetime' }))
  })

  it('creates a new user as "lifetime" when none exists yet (insert path)', async () => {
    dbHasUser.value = false
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_new',
          email: 'New@Example.com',
          price_id: LIFETIME_PRICE,
        },
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
    dbHasUser.value = false
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_api',
          price_id: LIFETIME_PRICE,
        },
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
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_6',
          email: 'e@example.com',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith({
      subscriptionStatus: 'lifetime',
      entitlementUpdatedAt: expect.any(Number),
      // Recorded at grant time so a later refund can be judged full vs partial
      // (AC-1). A grant with no usable total is now REFUSED outright, so this
      // field is always present on a successful lifetime write.
      lifetimeGrantTotal: 9900,
    })
  })

  it('ignores a transaction for a NON-lifetime price (annual renewal invoice)', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_1',
          items: [{ price: { id: ANNUAL_PRICE } }],
        },
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
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_1',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('returns 500 (Paddle retries) when the grant persists nothing — no silent loss', async () => {
    dbHasUser.value = false
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_noemail',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
    expect(captureError).toHaveBeenCalled()
  })

  it('grants lifetime for an EXISTING subscriber without ever resolving email — the update path needs it for nothing', async () => {
    // Regression: email validity used to be checked BEFORE the existing-user
    // check, so a malformed API-returned address could 500-loop a real
    // subscriber's status update forever, even though the update never
    // touches email at all.
    //
    // A follow-up review pass (2026-09-15 #3) sharpened the fix further:
    // email is now resolved LAZILY, only inside the no-existing-row branch —
    // so an existing subscriber's update no longer even PAYS FOR the
    // customer-API round trip, let alone gets blocked by its result. Setting
    // the mock to a malformed value proves it: if it were called, the OLD
    // (pre-laziness) validation-ordering fix would still have accepted it,
    // so the only way this test can distinguish behavior is the call-count
    // assertion below.
    fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_1',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(200)
    // Exact match, not `objectContaining` — proves email is NOT written on
    // the update path, not merely that status is.
    expect(setSpy).toHaveBeenCalledWith({
      subscriptionStatus: 'lifetime',
      entitlementUpdatedAt: expect.any(Number),
      // Recorded at grant time so a later refund can be judged full vs partial
      // (AC-1). A grant with no usable total is now REFUSED outright, so this
      // field is always present on a successful lifetime write.
      lifetimeGrantTotal: 9900,
    })
    expect(fetchPaddleCustomerEmail).not.toHaveBeenCalled()
  })

  it('still fails closed for a first-seen buyer whose resolved email is malformed', async () => {
    dbHasUser.value = false
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          details: { totals: { grand_total: '9900' } },
          customer_id: 'ctm_bademail',
          price_id: LIFETIME_PRICE,
        },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
    expect(captureError).toHaveBeenCalled()
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

  // ── Story 5-20, AC-1: the monthly plan flows the SUBSCRIPTION path ───────
  //
  // ⚠️ READ THE NAMES LITERALLY. Code review found the first drafts overclaimed:
  // the `subscription.*` dispatch never reads `items[].price.id`, so the two
  // subscription tests below would stay green with this whole story reverted, and
  // substituting any string for MONTHLY_PRICE changes nothing. They pin that the
  // path is price-AGNOSTIC — which is the property that makes monthly safe — not
  // anything monthly-specific. The `transaction.completed` test is the one that
  // carries real weight: it fails if the lifetime match ever widens.
  //
  // ⚠️ AC-1 is explicit that this must be PROVEN BY TEST, not reasoned through.
  // The reasoning is sound — subscriptions resolve via
  // `mapWebhookSubscriptionStatus` and never consult a price id, while the
  // lifetime grant is a different event (`transaction.completed`) matched
  // against `PADDLE_LIFETIME_PRICE_ID` — but "the two paths do not overlap" is
  // exactly the kind of claim that is cheap to assert and expensive to be wrong
  // about: being wrong means handing a €5.99/mo buyer a permanent entitlement.

  it('routes a monthly-priced subscription.created down the price-AGNOSTIC subscription path', async () => {
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: {
          customer_id: 'ctm_monthly',
          status: 'active',
          email: 'monthly@example.com',
          // A real Billing subscription payload carries its price on the items.
          items: [{ price: { id: MONTHLY_PRICE } }],
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'active' }))
    // The mis-grant this guards: 'lifetime' must appear nowhere in what was written.
    expect(setSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'lifetime' })
    )
  })

  it('does NOT treat a monthly transaction.completed as a lifetime purchase', async () => {
    // The lifetime grant keys off the LIFETIME price id specifically. A monthly
    // subscription's first invoice also arrives as `transaction.completed`, so
    // this is the event where a sloppy "any completed transaction = lifetime"
    // match would actually fire.
    const res = await POST({
      request: signedRequest({
        event_type: 'transaction.completed',
        data: {
          // ⚠️ A REAL, POSITIVE grand_total (€5.99 in the lowest unit) is
          // essential to this test's validity. Without it the handler refuses
          // at the LATER AC-8 "no usable grand_total" guard, so the test would
          // pass whether or not the price-id match works — which is exactly how
          // the first draft of it came out vacuous. With a valid total, the
          // price-id mismatch is the ONLY thing standing between this payload
          // and a permanent entitlement.
          details: { totals: { grand_total: '599' } },
          customer_id: 'ctm_monthly',
          items: [{ price: { id: MONTHLY_PRICE } }],
        },
      }),
    })

    expect(res.status).toBe(200)
    // ⚠️ Asserted as "never even opened a transaction", matching the sibling
    // annual-renewal test above — NOT as "was not written with status
    // 'lifetime'". The weaker form was VACUOUS: this story's positive control
    // granted lifetime to every price id and the weak assertion stayed green,
    // reproducing story 5.3's four-vacuous-webhook-tests finding exactly.
    expect(transaction).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
    expect(insertValuesSpy).not.toHaveBeenCalled()
  })

  it('downgrades on cancellation for any non-lifetime row, monthly included', async () => {
    // The mirror of the no-downgrade guard: that guard protects `lifetime`
    // rows specifically. A monthly subscriber who cancels must still lose
    // access — if the guard were widened to everyone, cancellation would
    // become a no-op and churned subscribers would keep Premium for free.
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.canceled',
        data: {
          customer_id: 'ctm_monthly',
          status: 'canceled',
          items: [{ price: { id: MONTHLY_PRICE } }],
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ subscriptionStatus: 'canceled' }))
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
    dbHasUser.value = false
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
    expect(captureError).toHaveBeenCalled()
  })

  it('updates an EXISTING subscriber without ever resolving email — the update path needs it for nothing', async () => {
    // Regression: email validity used to be checked BEFORE the existing-user
    // check, so a malformed API-returned address could 500-loop a real
    // subscriber's `subscription.canceled` forever — access never revoked.
    //
    // A follow-up review pass (2026-09-15 #3) sharpened the fix further:
    // email is now resolved LAZILY, only inside the no-existing-row branch —
    // an existing subscriber's status update no longer pays for the
    // customer-API round trip at all, closing the "still calls it eagerly"
    // finding from that same review.
    fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.canceled',
        data: { customer_id: 'ctm_1', status: 'canceled' },
      }),
    })

    expect(res.status).toBe(200)
    // Exact match, not `objectContaining` — proves email is NOT written on
    // the update path, not merely that status is.
    expect(setSpy).toHaveBeenCalledWith({
      subscriptionStatus: 'canceled',
      entitlementUpdatedAt: expect.any(Number),
    })
    expect(fetchPaddleCustomerEmail).not.toHaveBeenCalled()
  })

  it('still fails closed for a first-seen subscriber whose resolved email is malformed', async () => {
    dbHasUser.value = false
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx({ existingStatus: null }))
    )
    fetchPaddleCustomerEmail.mockResolvedValue('not-an-email')
    const res = await POST({
      request: signedRequest({
        event_type: 'subscription.created',
        data: { customer_id: 'ctm_bademail_sub', status: 'active' },
      }),
    })

    expect(res.status).toBe(500)
    expect(insertValuesSpy).not.toHaveBeenCalled()
    expect(captureError).toHaveBeenCalled()
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
    dbHasUser.value = false
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
    dbHasUser.value = false
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
