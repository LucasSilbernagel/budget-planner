// @vitest-environment node
/**
 * Paddle webhook against REAL PostgreSQL (Story 5-19, AC-7).
 *
 * ⚠️ WHY THIS FILE EXISTS. The sibling `paddle.test.ts` does
 * `vi.mock('drizzle-orm', …)`, which makes every `.where()` in it a no-op. Two
 * load-bearing guarantees were therefore asserted NOWHERE: that an update
 * matches by `customer_id`, and that the `setWhere` race guard stops a lifetime
 * row being downgraded. A wrong conflict `target`, a missing `setWhere`, or a
 * `set` payload that downgrades a lifetime row left all 28 of those tests
 * green. (Match-by-customer and the unique constraints are covered here now;
 * the `setWhere` guard is NOT — see the warning below.)
 *
 * That is the same failure shape 5-3's review #3 found by positive control: its
 * four regression tests for the email-ordering HIGH were VACUOUS, because the
 * fixture could not produce the input the regression needed. A regression test
 * whose fixture cannot produce the failing input is a green light bolted to a
 * dead bulb.
 *
 * So everything here runs against PGlite with the full migration chain applied
 * — same harness as `server/api/__tests__/sync-push-pull-roundtrip.db.test.ts`.
 * `drizzle-orm` is NOT mocked. Every assertion below reads the row back.
 *
 * ⚠️ WHAT THIS FILE STILL CANNOT PROVE, stated so nobody infers otherwise: the
 * `setWhere` no-downgrade guard on the `onConflictDoUpdate` path. That branch
 * runs only when a CONCURRENT insert wins the race, and PGlite is a single
 * in-process connection — so no test here reaches it. Positive control during
 * code review: deleting `setWhere` leaves all 53 tests green. The guarantee
 * rests on the SQL predicate being read correctly, not on a test.
 *
 * POSITIVE CONTROLS — each recorded in the story's Dev Agent Record. For every
 * guard added by 5-19, the guard was deliberately broken and the test watched
 * go red before the guard was restored.
 */

import crypto from 'crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const { getPaddleConfig, assertPaddleProductionConfig, fetchPaddleCustomerEmail, captureError } =
  vi.hoisted(() => ({
    getPaddleConfig: vi.fn(),
    assertPaddleProductionConfig: vi.fn(),
    fetchPaddleCustomerEmail: vi.fn(),
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
vi.mock('@budget-planner/config', () => ({ getPaddleConfig, assertPaddleProductionConfig }))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))

import { createDefaultProfileForUser } from '@/server/functions/profiles'
import { paddleAdjustments, paddleWebhookEvents, userProfiles, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { POST } from '../paddle'

const MIGRATIONS = new URL('../../../../../../../packages/db/migrations/', import.meta.url)

const SECRET = 'pdl_ntfset_test_secret'
const LIFETIME_PRICE = 'pri_lifetime_99'
const ANNUAL_PRICE = 'pri_annual_39'
/** The €99 lifetime price in the currency's lowest unit, as Paddle sends it. */
const LIFETIME_TOTAL = '9900'

let pg: PGlite
let db: ReturnType<typeof drizzle>
let eventCounter = 0

function nextEventId(): string {
  eventCounter++
  return `evt_${eventCounter}`
}

/** An ISO timestamp `minutesFromBase` minutes after a fixed base. */
const BASE_TIME = Date.parse('2026-09-16T12:00:00.000Z')
function at(minutesFromBase: number): string {
  return new Date(BASE_TIME + minutesFromBase * 60_000).toISOString()
}

function signedRequest(payloadObj: unknown): Request {
  const body = JSON.stringify(payloadObj)
  const ts = Math.floor(Date.now() / 1000)
  const h1 = crypto.createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')
  return new Request('https://app.test/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'paddle-signature': `ts=${ts};h1=${h1}`, 'content-type': 'application/json' },
    body,
  })
}

/** POST a signed event, defaulting the envelope fields 5-19 depends on. */
function post(event: {
  event_type: string
  occurred_at?: string
  event_id?: string
  data: Record<string, unknown>
}) {
  return POST({
    request: signedRequest({
      event_id: event.event_id ?? nextEventId(),
      occurred_at: event.occurred_at ?? at(0),
      event_type: event.event_type,
      data: event.data,
    }),
  })
}

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'subscription.updated',
    data: { customer_id: 'ctm_1', status: 'active', ...overrides },
  }
}

function lifetimeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'transaction.completed',
    data: {
      id: 'txn_lifetime_1',
      customer_id: 'ctm_1',
      status: 'completed',
      items: [{ price: { id: LIFETIME_PRICE } }],
      details: { totals: { grand_total: LIFETIME_TOTAL } },
      ...overrides,
    },
  }
}

function adjustmentEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'adjustment.created',
    data: {
      id: 'adj_1',
      customer_id: 'ctm_1',
      action: 'refund',
      transaction_id: 'txn_lifetime_1',
      totals: { total: LIFETIME_TOTAL },
      ...overrides,
    },
  }
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: 'buyer@example.test',
      paddleId: 'ctm_1',
      subscriptionStatus: 'free',
      ...overrides,
    } as never)
    .returning()
  return row
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
  vi.clearAllMocks()
  getPaddleConfig.mockReturnValue({
    environment: 'sandbox' as const,
    apiKey: 'pdl_sdbx_key',
    clientToken: 'test_client_token',
    webhookSecret: SECRET,
    webhookMaxAgeSeconds: 300,
    apiBaseUrl: 'https://sandbox-api.paddle.com',
    annualPriceId: ANNUAL_PRICE,
    lifetimePriceId: LIFETIME_PRICE,
    isConfigured: true,
  })
  fetchPaddleCustomerEmail.mockResolvedValue(undefined)
  await db.delete(userProfiles)
  await db.delete(paddleWebhookEvents)
  await db.delete(paddleAdjustments)
  await db.delete(users)
})

describe('webhook against real PostgreSQL — the guarantees the mocked suite cannot prove', () => {
  it('matches the UPDATE by customer_id, touching only that user (AC-7)', async () => {
    // POSITIVE CONTROL: dropping `.where(eq(users.paddleId, customerId))` from
    // the update in `handleSubscriptionStatusUpdate` turns the OTHER user's
    // status to 'active' and this test goes red. Under the mocked suite the
    // same break stays green, because `.where()` there is a no-op.
    await seedUser({ paddleId: 'ctm_1', email: 'one@example.test' })
    await seedUser({ paddleId: 'ctm_2', email: 'two@example.test' })

    const res = await post(subscriptionEvent({ customer_id: 'ctm_1', status: 'active' }))
    expect(res.status).toBe(200)

    const [target] = await readUser('ctm_1')
    const [bystander] = await readUser('ctm_2')
    expect(target.subscriptionStatus).toBe('active')
    expect(bystander.subscriptionStatus).toBe('free')
  })

  it('NEVER downgrades a lifetime buyer on a subscription event (AC-1 guard kept)', async () => {
    await seedUser({ subscriptionStatus: 'lifetime' })

    const res = await post(subscriptionEvent({ status: 'canceled' }))

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
  })
})

describe('AC-2 — idempotency and ordering', () => {
  it('ignores a duplicate delivery of the same event id', async () => {
    await seedUser({ subscriptionStatus: 'free' })
    const eventId = 'evt_duplicate'

    const first = await post({
      ...subscriptionEvent({ status: 'active' }),
      event_id: eventId,
      occurred_at: at(1),
    })
    expect(first.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')

    // The SAME event id, but carrying a contradictory payload. If dedup were
    // absent this would be applied and the status would flip.
    const replay = await post({
      event_type: 'subscription.canceled',
      data: { customer_id: 'ctm_1', status: 'canceled' },
      event_id: eventId,
      occurred_at: at(2),
    })

    expect(replay.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')
    // Exactly one row in the event log — the claim is the dedup mechanism.
    const logged = await db.select().from(paddleWebhookEvents)
    expect(logged).toHaveLength(1)
  })

  it('a LATE retry of an older event does not overwrite a newer entitlement state', async () => {
    // The concrete failure from deferred-work review #2: `subscription.updated
    // {active}` hits a DB blip and 500s; Paddle retries it minutes later, after
    // `subscription.canceled` has already been processed; the cancelled user is
    // silently re-granted Premium.
    await seedUser({ subscriptionStatus: 'active' })

    const cancel = await post({
      event_type: 'subscription.canceled',
      data: { customer_id: 'ctm_1', status: 'canceled' },
      occurred_at: at(10),
    })
    expect(cancel.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

    // A DIFFERENT event id (so dedup cannot be what saves us) carrying an
    // OLDER occurred_at.
    const lateRetry = await post(subscriptionEvent({ status: 'active' }))
    expect(lateRetry.status).toBe(200)

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('canceled')
  })

  it('a late retry of the ORIGINAL purchase does not re-grant lifetime after a refund', async () => {
    // ⚠️ Added because a positive control found the lifetime path's ordering
    // guard was covered by NOTHING: disabling it left the whole suite green.
    // This is the case that makes gating the GRANT matter — before AC-1 there
    // was no way to lose lifetime, so re-applying a grant was harmless. Now a
    // refunded buyer whose original `transaction.completed` is retried would
    // silently get their permanent entitlement back.
    await seedUser({ subscriptionStatus: 'free' })

    await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

    await post({
      ...adjustmentEvent({ action: 'chargeback' }),
      event_id: 'evt_chargeback',
      occurred_at: at(5),
    })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

    // Paddle retries the original grant — new delivery id, ORIGINAL timestamp.
    const lateRetry = await post({
      ...lifetimeEvent({}),
      event_id: 'evt_grant_retry',
      occurred_at: at(1),
    })

    expect(lateRetry.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
  })

  it('applies events that genuinely are newer', async () => {
    // The complement of the test above: proves the ordering guard is not
    // simply refusing everything, which would make the assertion above pass
    // for the wrong reason.
    await seedUser({ subscriptionStatus: 'free' })

    await post(subscriptionEvent({ status: 'active' }))
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')

    await post({
      event_type: 'subscription.canceled',
      data: { customer_id: 'ctm_1', status: 'canceled' },
      occurred_at: at(5),
    })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
  })
})

describe('AC-3 — identity reconciliation', () => {
  it('RE-KEYS an unentitled existing account to the new Paddle customer', async () => {
    await seedUser({ paddleId: 'ctm_old', email: 'buyer@example.test', subscriptionStatus: 'free' })
    fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

    const res = await post(subscriptionEvent({ customer_id: 'ctm_new', status: 'active' }))

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_new')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.email).toBe('buyer@example.test')
    // Re-keyed, NOT duplicated.
    const all = await db.select().from(users)
    expect(all).toHaveLength(1)
  })

  it('REFUSES to adopt an entitled account, with a terminal 200 rather than a 500 retry storm', async () => {
    // Before 5-19 this raised `users_email_unique`, the catch returned
    // ok:false, the route 500'd, and Paddle retried its full schedule forever
    // — the entitlement never granted and the log filling up. The refusal is
    // deliberate: Paddle verifies payment, not email ownership, so adopting
    // here would let a €39 checkout take over someone else's live account.
    await seedUser({
      paddleId: 'ctm_victim',
      email: 'buyer@example.test',
      subscriptionStatus: 'active',
    })
    fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

    const res = await post(subscriptionEvent({ customer_id: 'ctm_attacker', status: 'active' }))

    // Terminal: Paddle must STOP retrying.
    expect(res.status).toBe(200)
    // The victim's row is untouched and still theirs.
    const [victim] = await readUser('ctm_victim')
    expect(victim.subscriptionStatus).toBe('active')
    expect(victim.email).toBe('buyer@example.test')
    // No account was created for the new customer id.
    expect(await readUser('ctm_attacker')).toHaveLength(0)
    expect(captureError).toHaveBeenCalled()
  })

  it('refuses to adopt a LIFETIME account too', async () => {
    await seedUser({
      paddleId: 'ctm_victim',
      email: 'buyer@example.test',
      subscriptionStatus: 'lifetime',
    })
    fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

    const res = await post(lifetimeEvent({ customer_id: 'ctm_attacker' }))

    expect(res.status).toBe(200)
    expect((await readUser('ctm_victim'))[0].subscriptionStatus).toBe('lifetime')
    expect(await readUser('ctm_attacker')).toHaveLength(0)
  })
})

describe('AC-1 — refunds, chargebacks and disputes', () => {
  async function grantLifetime() {
    await seedUser({ subscriptionStatus: 'free' })
    await post(lifetimeEvent({}))
    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
    expect(row.lifetimeGrantTotal).toBe(9900)
    return row
  }

  it('a FULL refund revokes the lifetime grant', async () => {
    await grantLifetime()

    const res = await post({
      ...adjustmentEvent({ totals: { total: '9900' } }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('canceled')
  })

  it('a PARTIAL refund does NOT revoke access', async () => {
    await grantLifetime()

    const res = await post({ ...adjustmentEvent({ totals: { total: '500' } }), occurred_at: at(5) })

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
    // The partial is recorded in the ledger, so repeated partials can add up.
    const ledger = await db.select().from(paddleAdjustments)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].total).toBe(500)
  })

  it('partial refunds that ADD UP to the full price do revoke', async () => {
    await grantLifetime()

    await post({
      ...adjustmentEvent({ id: 'adj_a', totals: { total: '5000' } }),
      occurred_at: at(5),
    })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

    await post({
      ...adjustmentEvent({ id: 'adj_b', totals: { total: '4900' } }),
      occurred_at: at(6),
    })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('canceled')
  })

  it('a CHARGEBACK revokes regardless of amount', async () => {
    await grantLifetime()

    const res = await post({
      ...adjustmentEvent({ action: 'chargeback', totals: { total: '1' } }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
  })

  it('a chargeback_warning ALERTS but leaves access intact', async () => {
    // Deliberate: a dispute that is later won then needs no restore path.
    await grantLifetime()

    const res = await post({
      ...adjustmentEvent({ action: 'chargeback_warning' }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
    expect(captureError).toHaveBeenCalled()
  })

  it('a credit adjustment changes nothing', async () => {
    await grantLifetime()

    await post({ ...adjustmentEvent({ action: 'credit' }), occurred_at: at(5) })

    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
  })

  it('revocation PIERCES the no-downgrade guard that used to block it', async () => {
    // The guard at `handleSubscriptionStatusUpdate` refuses to move a lifetime
    // row by any subscription path — which is exactly why a refund could never
    // be corrected before this story. Proving revocation still lands on a
    // lifetime row is the point.
    await grantLifetime()
    await post({ ...adjustmentEvent({ action: 'chargeback' }), occurred_at: at(5) })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')
  })
})

describe('AC-4 — exactly one default profile', () => {
  it('THE DATABASE refuses a second default profile — this is the AC-4 guarantee', async () => {
    // AC-4 asks for a DB-level guarantee, "not a read-then-write check", and
    // this is the test that proves it. It inserts directly, bypassing the
    // application entirely, so it fails if and only if the partial unique index
    // from migration 0017 is absent.
    //
    // POSITIVE CONTROL (recorded in the story): `DROP INDEX
    // "userProfiles_one_default_per_user"` before the second insert and this
    // test goes green-to-red — the duplicate is accepted, which is precisely
    // the production state that made a new buyer's data appear to vanish.
    const user = await seedUser({ subscriptionStatus: 'lifetime' })
    await db
      .insert(userProfiles)
      .values({ userId: user.id, name: 'Main Profile', isDefault: true } as never)

    await expect(
      db
        .insert(userProfiles)
        .values({ userId: user.id, name: 'Second Default', isDefault: true } as never)
    ).rejects.toThrow()
  })

  it('two deliveries for one new buyer leave exactly ONE default profile', async () => {
    // One lifetime purchase emits BOTH `transaction.paid` and
    // `transaction.completed`, and the handler accepts both.
    //
    // ⚠️ THIS TEST DOES NOT PROVE THE RACE IS CLOSED, AND MUST NOT BE READ AS
    // DOING SO. PGlite is a single in-process connection, so `Promise.all` here
    // SERIALIZES: the second delivery finds the user already created and
    // returns before `ensureDefaultProfile` is ever reached. A positive control
    // confirmed exactly that — removing `onConflictDoNothing()` from
    // `createDefaultProfileForUser` left an earlier version of this test GREEN.
    // It was a green light bolted to a dead bulb, and it is kept only as an
    // end-to-end shape check. The actual concurrency guarantee is the unique
    // index, proven by the test above.
    fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test')

    await Promise.all([
      post({ ...lifetimeEvent({}), event_id: 'evt_paid', occurred_at: at(1) }),
      post({
        ...lifetimeEvent({}),
        event_type: 'transaction.paid',
        event_id: 'evt_completed',
        occurred_at: at(2),
      }),
    ])

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')

    const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, row.id))
    expect(profiles).toHaveLength(1)
    expect(profiles[0].isDefault).toBe(true)
  })

  it('createDefaultProfileForUser provisions exactly one profile, and is idempotent', async () => {
    // Calls the REAL function — an earlier version of this test only NAMED it in
    // the title and re-issued a raw insert instead, which code review caught.
    const user = await seedUser({ subscriptionStatus: 'lifetime' })

    const first = await createDefaultProfileForUser(user.id)
    expect(first.success).toBe(true)
    const second = await createDefaultProfileForUser(user.id)
    expect(second.success).toBe(true)

    const profiles = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id))
    expect(profiles).toHaveLength(1)
    expect(profiles[0].isDefault).toBe(true)
    expect(second.data?.id).toBe(profiles[0].id)
  })

  it('the race-loser read-back never returns a tombstoned profile', async () => {
    // The `onConflictDoNothing` fallback reads the winner's row back. The
    // partial index excludes tombstones, so the read-back must too — otherwise
    // a soft-deleted default can be handed back as the live one.
    const user = await seedUser({ subscriptionStatus: 'lifetime' })
    await db.insert(userProfiles).values({
      userId: user.id,
      name: 'Tombstoned Default',
      isDefault: true,
      isDeleted: true,
    } as never)

    const result = await createDefaultProfileForUser(user.id)

    expect(result.success).toBe(true)
    expect(result.data?.isDeleted).not.toBe(true)
    expect(result.data?.name).toBe('Main Profile')
  })

  it('a tombstoned default does not block creating a new one', async () => {
    const user = await seedUser({ subscriptionStatus: 'lifetime' })
    await db.insert(userProfiles).values({
      userId: user.id,
      name: 'Old Main',
      isDefault: true,
      isDeleted: true,
    } as never)

    await expect(
      db
        .insert(userProfiles)
        .values({ userId: user.id, name: 'New Main', isDefault: true } as never)
    ).resolves.toBeDefined()
  })
})

describe('AC-8 — lower-severity correctness', () => {
  it('does NOT overwrite a chosen display currency with the billing currency on renewal', async () => {
    // `users.currency` is a DISPLAY preference that seeds new profiles; Paddle's
    // `currency_code` is the BILLING currency, IP-detected at checkout. A user
    // who deliberately chose EUR must not be flipped to USD by paying from a
    // trip abroad.
    await seedUser({ subscriptionStatus: 'active', currency: 'EUR' })

    await post(subscriptionEvent({ status: 'active', currency_code: 'USD' }))

    expect((await readUser('ctm_1'))[0].currency).toBe('EUR')
  })

  it('DOES set the currency when first creating the user', async () => {
    // The complement: insert-only must still mean "on insert".
    fetchPaddleCustomerEmail.mockResolvedValue('new@example.test')

    await post(
      subscriptionEvent({ customer_id: 'ctm_new', status: 'active', currency_code: 'USD' })
    )

    expect((await readUser('ctm_new'))[0].currency).toBe('USD')
  })

  it('refuses to grant lifetime on a ZERO-VALUE transaction carrying the lifetime price', async () => {
    // A 100%-discount or otherwise non-collecting transaction must not mint a
    // permanent €99 entitlement — which, combined with the refund gap this
    // story closes, previously had no path back at all.
    await seedUser({ subscriptionStatus: 'free' })

    const res = await post(lifetimeEvent({ details: { totals: { grand_total: '0' } } }))

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
  })

  it('refuses to grant lifetime on a transaction that is not in a collected state', async () => {
    await seedUser({ subscriptionStatus: 'free' })

    const res = await post(lifetimeEvent({ status: 'canceled' }))

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
  })

  it('records the transaction id and total on a real grant', async () => {
    await seedUser({ subscriptionStatus: 'free' })

    await post(lifetimeEvent({}))

    const [row] = await readUser('ctm_1')
    expect(row.lifetimeTransactionId).toBe('txn_lifetime_1')
    expect(row.lifetimeGrantTotal).toBe(9900)
  })
})

describe('review fixes — retry, duplicate adjustments and unrelated chargebacks', () => {
  it('a delivery that FAILS releases its event claim, so the retry still grants', async () => {
    // ⚠️ THE REGRESSION THIS FILE MOST NEEDED AND DID NOT HAVE. `runGuarded`
    // rolled back only on a THROW, but every handled failure RETURNS
    // `{ok:false}` — so the transaction committed, the claim persisted, the
    // route returned 500 for Paddle to retry, and the retry was then dismissed
    // as a duplicate. Measured before the fix: claim rows 1, retry 200, users 0
    // — the buyer paid and never got an account.
    fetchPaddleCustomerEmail.mockResolvedValue(undefined) // Paddle API blip

    const first = await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })
    expect(first.status).toBe(500)
    // The claim must NOT have survived the rollback.
    expect(await db.select().from(paddleWebhookEvents)).toHaveLength(0)
    expect(await db.select().from(users)).toHaveLength(0)

    fetchPaddleCustomerEmail.mockResolvedValue('buyer@example.test') // recovered
    const retry = await post({ ...lifetimeEvent({}), event_id: 'evt_grant', occurred_at: at(1) })

    expect(retry.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
  })

  it('a genuinely duplicate delivery still keeps its claim', async () => {
    // The complement: rollback-on-failure must not have weakened dedup.
    await seedUser({ subscriptionStatus: 'free' })
    await post({
      ...subscriptionEvent({ status: 'active' }),
      event_id: 'evt_d',
      occurred_at: at(1),
    })
    expect(await db.select().from(paddleWebhookEvents)).toHaveLength(1)

    await post({
      event_type: 'subscription.canceled',
      data: { customer_id: 'ctm_1', status: 'canceled' },
      event_id: 'evt_d',
      occurred_at: at(2),
    })

    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('active')
    expect(await db.select().from(paddleWebhookEvents)).toHaveLength(1)
  })

  it('`adjustment.created` + `adjustment.updated` for ONE adjustment count ONCE', async () => {
    // Two deliveries, two event ids, one adjustment. Delivery-level dedup does
    // not collapse them, so an accumulator keyed on the customer counted a €50
    // partial twice and revoked a half-refunded €99 grant.
    await seedUser({ subscriptionStatus: 'free' })
    await post({ ...lifetimeEvent({}), event_id: 'evt_g', occurred_at: at(1) })

    await post({
      ...adjustmentEvent({ id: 'adj_same', totals: { total: '5000' } }),
      event_id: 'evt_adj_created',
      occurred_at: at(5),
    })
    await post({
      event_type: 'adjustment.updated',
      data: {
        id: 'adj_same',
        customer_id: 'ctm_1',
        action: 'refund',
        transaction_id: 'txn_lifetime_1',
        totals: { total: '5000' },
      },
      event_id: 'evt_adj_updated',
      occurred_at: at(6),
    })

    // Half refunded, so access is RETAINED.
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
    expect(await db.select().from(paddleAdjustments)).toHaveLength(1)
  })

  it('a chargeback on an UNRELATED transaction does not revoke the grant', async () => {
    // Decision D2: revoke only when the chargeback concerns the granting
    // transaction; anything else alerts for manual judgement.
    await seedUser({ subscriptionStatus: 'free' })
    await post({ ...lifetimeEvent({}), event_id: 'evt_g2', occurred_at: at(1) })

    const res = await post({
      ...adjustmentEvent({
        id: 'adj_other',
        action: 'chargeback',
        transaction_id: 'txn_some_annual_invoice',
        totals: { total: '100' },
      }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
    expect(captureError).toHaveBeenCalled()
  })

  it('an adjustment for an unknown customer RETRIES rather than being swallowed', async () => {
    // Returning a terminal 200 erased the refund permanently: the grant would
    // then land, pass the (absent) watermark, and mint permanent Premium for a
    // customer who had already been refunded.
    const res = await post({
      ...adjustmentEvent({ customer_id: 'ctm_unknown' }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(500)
    expect(await db.select().from(paddleWebhookEvents)).toHaveLength(0)
  })

  it('refuses to grant lifetime when the transaction carries NO usable total', async () => {
    // Previously the zero-value guard was skipped when the total was absent, so
    // the grant landed with a NULL grant total — and every refund path then
    // treats that as unjudgeable, making the entitlement irrevocable.
    await seedUser({ subscriptionStatus: 'free' })

    const res = await post(lifetimeEvent({ details: { totals: {} } }))

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('free')
  })

  it('a re-purchase does not inherit the previous grant refunds', async () => {
    // The old in-place counter survived across grants, so a €1 refund on a
    // fresh €99 purchase revoked it. The ledger is keyed per transaction.
    await seedUser({ subscriptionStatus: 'free' })
    await post({ ...lifetimeEvent({}), event_id: 'evt_g3', occurred_at: at(1) })
    await post({
      ...adjustmentEvent({ id: 'adj_full', totals: { total: '9900' } }),
      occurred_at: at(2),
    })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('canceled')

    // Buys again, new transaction id.
    await post({
      ...lifetimeEvent({ id: 'txn_lifetime_2' }),
      event_id: 'evt_g4',
      occurred_at: at(10),
    })
    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')

    // A €1 goodwill refund against the NEW transaction must not revoke.
    await post({
      ...adjustmentEvent({
        id: 'adj_small',
        transaction_id: 'txn_lifetime_2',
        totals: { total: '100' },
      }),
      occurred_at: at(11),
    })

    expect((await readUser('ctm_1'))[0].subscriptionStatus).toBe('lifetime')
  })
})
