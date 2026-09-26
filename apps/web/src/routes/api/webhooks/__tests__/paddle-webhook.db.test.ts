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
const {
  getPaddleConfig,
  assertPaddleProductionConfig,
  fetchPaddleCustomerEmail,
  captureError,
  sendMagicLinkEmail,
} = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  assertPaddleProductionConfig: vi.fn(),
  fetchPaddleCustomerEmail: vi.fn(),
  captureError: vi.fn(),
  // Story 68.1, AC-2: the lockout is only proven closed by driving
  // `requestMagicLink` itself, so the mailer is the observation point.
  sendMagicLinkEmail: vi.fn(),
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
  // Story 70.1, AC-9: the label is proven through a REAL signed session, so
  // `signSession` / `verifySession` need a secret.
  getSessionSecret: () => 'story-70-1-session-secret-at-least-32-chars',
}))
vi.mock('@/server/paddle/customer-api', () => ({ fetchPaddleCustomerEmail }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))
vi.mock('@/server/email/mailer', () => ({ sendMagicLinkEmail }))

import { planLabel } from '@/lib/account/plan-label'
import { requestMagicLink } from '@/server/api/auth/magic-link'
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { signSession } from '@/server/api/auth/session'
import { createDefaultProfileForUser } from '@/server/functions/profiles'
import {
  loginTokens,
  paddleAdjustments,
  paddleWebhookEvents,
  userProfiles,
  users,
} from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { POST, entitlementWatermarkGuard } from '../paddle'

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
  // Story 68.1: BEFORE `users` — `loginTokens.userId` references it.
  await db.delete(loginTokens)
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

/**
 * Story 68.1 — a Paddle email change propagates to the account (FR107).
 *
 * ⚠️ WHY THESE LIVE HERE AND NOT IN `paddle.test.ts`: that file mocks
 * `drizzle-orm`, which makes every `.where()` a no-op. Every assertion below
 * depends on a `where` clause selecting the right row — the collision lookup,
 * the watermark read, the update target — so written there they would pass
 * against code that matched the wrong row, or every row.
 *
 * Decisions this pins, both taken by the product owner on 2026-09-25:
 *  - D1: a collision REFUSES UNCONDITIONALLY. Story 5-19's
 *    `reconcileEmailCollision` re-keys an UNENTITLED colliding row, which is
 *    correct there (a first-seen customer is being INSERTED, so exactly one row
 *    survives) and wrong here (both rows already exist, so freeing the address
 *    means destroying a second ledger).
 *  - D2: ordering runs on a SEPARATE `users.emailUpdatedAt` watermark.
 */
describe('Story 68.1 — customer.updated moves the login email', () => {
  function customerUpdatedEvent(overrides: Record<string, unknown> = {}) {
    return {
      event_type: 'customer.updated',
      data: {
        // ⚠️ The customer id is `data.id` on this event family. There is NO
        // `data.customer_id` on a `customer.*` payload — verified against
        // Paddle's published schema, which pins `data.id` to `^ctm_[a-z\d]{26}$`
        // and lists it as required.
        id: 'ctm_1',
        name: 'Jo Brown-Anderson',
        email: 'new@example.test',
        locale: 'en',
        status: 'active',
        marketing_consent: false,
        ...overrides,
      },
    }
  }

  it('moves users.email to the new address and stamps emailUpdatedAt (AC-1)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.email).toBe('new@example.test')
    expect(row.emailUpdatedAt).toBe(BASE_TIME + 5 * 60_000)
  })

  it('moves ONLY that user, leaving every bystander untouched (AC-1)', async () => {
    // ⚠️ ADDED AFTER A POSITIVE CONTROL CAUGHT ITS ABSENCE. Deleting the
    // UPDATE's row predicate — which would rewrite EVERY user's email to the
    // incoming address — left every other test in this FILE green (49 of them
    // at the time; this story contributes 17). Every successful-update case had
    // exactly one user, and every case with two users refused before reaching
    // the UPDATE, so the suite could not see it. The sibling subscription test
    // one describe block up ('matches the UPDATE by customer_id, touching only
    // that user') is the same guard for the same reason; this story needed its
    // own and did not have one.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({ paddleId: 'ctm_2', email: 'bystander@example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
    const [bystander] = await readUser('ctm_2')
    expect(bystander.email).toBe('bystander@example.test')
    expect(bystander.emailUpdatedAt).toBeNull()
  })

  it('normalizes the incoming address before storing it (AC-1)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    // Whitespace-padded and mixed case. `normalizeEmail` runs BEFORE
    // `isValidEmail` (the email.ts contract), so this must be ACCEPTED and
    // stored canonically — not rejected for its untrimmed shape.
    await post({
      ...customerUpdatedEvent({ email: '  NEW@Example.TEST  ' }),
      occurred_at: at(5),
    })

    expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
  })

  it('closes the lockout: a magic link works at the NEW address and NOT the old (AC-2)', async () => {
    // ⚠️ The assertion that actually matters. Reading the row back proves the
    // column changed; it does NOT prove the user can get in, because
    // `requestMagicLink` matches on `lower(email)` AND `isDeleted = false` and
    // is a SILENT no-op for a miss. So this drives the real function against the
    // same database the webhook just wrote.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    await requestMagicLink('new@example.test', 'https://app.test')
    expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
    expect(sendMagicLinkEmail.mock.calls[0][0]).toBe('new@example.test')

    sendMagicLinkEmail.mockClear()
    await requestMagicLink('old@example.test', 'https://app.test')
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  it('REFUSES when the address belongs to an ENTITLED account (AC-3)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({
      paddleId: 'ctm_other',
      email: 'new@example.test',
      subscriptionStatus: 'lifetime',
    })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    // Terminal 200: the decision will never change on its own, so a 500 would
    // be a retry storm.
    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
    expect((await readUser('ctm_other'))[0].email).toBe('new@example.test')
    expect(captureError).toHaveBeenCalled()
  })

  it('REFUSES when the address belongs to a FREE account too — D1 is unconditional (AC-3)', async () => {
    // ⚠️ THIS is the test that distinguishes D1 from story 5-19's asymmetric
    // rule. Under 5-19's policy an unentitled colliding row is ADOPTABLE, so a
    // suite that only covered the entitled case would pass against the wrong
    // behaviour. Here the refusal must hold whatever the other row's status is,
    // because freeing the address would mean destroying that account's ledger.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({
      paddleId: 'ctm_other',
      email: 'new@example.test',
      subscriptionStatus: 'free',
    })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
    expect((await readUser('ctm_other'))[0].email).toBe('new@example.test')
    expect(captureError).toHaveBeenCalled()
  })

  it('REFUSES when the colliding row is soft-deleted — the tombstone is not a licence (AC-6)', async () => {
    // ⚠️ MEASURED AND RECORDED: nothing in this product sets
    // `users.isDeleted = true`. Every write to `users` is
    // `webhooks/paddle.ts:277/362/514/772` plus `auth/paddle.ts:114`; none sets
    // it true, and `:277` CLEARS it. Account erasure is a HARD DELETE, and the
    // sync tombstones target profile-child tables, never `users`. So this
    // fixture builds the row DIRECTLY because no code path produces it. This is
    // a guard over an unreachable state, not a scenario a user reaches — it
    // exists because four readers filter on the column and a future writer must
    // not find a hole here.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({ paddleId: 'ctm_other', email: 'new@example.test', isDeleted: true })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
    expect(captureError).toHaveBeenCalled()
  })

  it('a repeat of an address we already hold is not read as a collision (AC-3, AC-7)', async () => {
    // ⚠️ RENAMED AFTER A POSITIVE CONTROL. This does NOT exercise the
    // `collision.id !== ours.id` conjunct: the already-equal early return fires
    // before the collision lookup runs, so what is proven here is that early
    // return. The conjunct is covered instead by the legacy mixed-case test
    // above, which became reachable once the lookup moved to `lower(email)`.
    await seedUser({ paddleId: 'ctm_1', email: 'new@example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
    expect(captureError).not.toHaveBeenCalled()
  })

  it('ignores a replayed OLDER event arriving after a newer one (AC-5)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    // B (newer) is delivered first, then A (older) is retried afterwards —
    // arrival order is exactly what cannot be trusted.
    await post({
      ...customerUpdatedEvent({ email: 'b@example.test' }),
      event_id: 'evt_b',
      occurred_at: at(20),
    })
    await post({
      ...customerUpdatedEvent({ email: 'a@example.test' }),
      event_id: 'evt_a',
      occurred_at: at(10),
    })

    expect((await readUser('ctm_1'))[0].email).toBe('b@example.test')
  })

  it('rejects an equal timestamp, matching the strictly-newer contract (AC-5)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    await post({
      ...customerUpdatedEvent({ email: 'first@example.test' }),
      event_id: 'evt_1',
      occurred_at: at(10),
    })
    await post({
      ...customerUpdatedEvent({ email: 'second@example.test' }),
      event_id: 'evt_2',
      occurred_at: at(10),
    })

    expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')
  })

  it('⚠️ does NOT advance entitlementUpdatedAt, so a later billing event still applies (D2)', async () => {
    // ⚠️⚠️ THE MOST IMPORTANT TEST IN THIS STORY. If the handler wrote
    // `entitlementUpdatedAt` instead of (or as well as) `emailUpdatedAt`, the
    // email change would raise the entitlement watermark, and the
    // `subscription.updated` below — which carries an EARLIER `occurred_at`,
    // as a real retry easily can — would be judged stale and DROPPED. The user
    // would change their email and silently lose the entitlement they pay for.
    // Nothing that exercises the email path alone can see this.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test', subscriptionStatus: 'free' })

    await post({ ...customerUpdatedEvent(), event_id: 'evt_email', occurred_at: at(50) })

    const [afterEmail] = await readUser('ctm_1')
    expect(afterEmail.email).toBe('new@example.test')
    expect(afterEmail.emailUpdatedAt).toBe(BASE_TIME + 50 * 60_000)
    expect(afterEmail.entitlementUpdatedAt).toBeNull()

    await post({
      ...subscriptionEvent({ customer_id: 'ctm_1', status: 'active' }),
      event_id: 'evt_sub',
      occurred_at: at(10),
    })

    const [afterSub] = await readUser('ctm_1')
    expect(afterSub.subscriptionStatus).toBe('active')
    expect(afterSub.email).toBe('new@example.test')
  })

  it('dismisses a duplicate delivery through the existing claim (AC-4)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    await post({
      ...customerUpdatedEvent({ email: 'first@example.test' }),
      event_id: 'evt_same',
      occurred_at: at(10),
    })
    // Same event id, later timestamp, different address: if the claim were not
    // doing the work, the watermark would let this through.
    await post({
      ...customerUpdatedEvent({ email: 'second@example.test' }),
      event_id: 'evt_same',
      occurred_at: at(20),
    })

    expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')
    const claims = await db.select().from(paddleWebhookEvents)
    expect(claims).toHaveLength(1)
  })

  it('leaves the address alone but STILL ADVANCES the watermark (AC-7, AC-5)', async () => {
    // ⚠️ THIS TEST PINNED A REAL DEFECT AND WAS REWRITTEN AT REVIEW. It used to
    // assert `emailUpdatedAt` **toBeNull** — "don't churn the row" — which is
    // the wrong contract and made the suite defend the bug. A no-op event
    // (name / locale / marketing_consent, by far the commonest
    // `customer.updated`) must still record that we have SEEN it, or a
    // genuinely older event delivered afterwards is judged fresher than NULL.
    // See the regression test below for the sequence that broke.
    await seedUser({ paddleId: 'ctm_1', email: 'new@example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    const [row] = await readUser('ctm_1')
    expect(row.email).toBe('new@example.test')
    expect(row.emailUpdatedAt).toBe(BASE_TIME + 5 * 60_000)
  })

  it('⚠️ REGRESSION: a no-op event must not let a later OLDER event resurrect a dead address', async () => {
    // ⚠️⚠️ THE DEFECT THE REVIEW FOUND, and the 49 tests written before it could
    // not see. Paddle's history: t=10 → `b@`, t=15 → `a@`, t=20 a name-only
    // change (email still `a@`). Delivery order 20, 15, 10 — arrival order is
    // precisely what this whole mechanism exists to distrust.
    //
    // Before the fix the two no-op events returned without stamping, so the
    // watermark stayed NULL, the t=10 event was judged "fresher than nothing",
    // and the row ended on `b@` — an address Paddle had ABANDONED. The user
    // types `a@`, matches nothing, and is locked out: the exact failure this
    // story exists to close, reintroduced by the story itself.
    await seedUser({ paddleId: 'ctm_1', email: 'a@example.test' })

    await post({
      ...customerUpdatedEvent({ email: 'a@example.test', name: 'Renamed' }),
      event_id: 'evt_t20',
      occurred_at: at(20),
    })
    await post({
      ...customerUpdatedEvent({ email: 'a@example.test' }),
      event_id: 'evt_t15',
      occurred_at: at(15),
    })
    await post({
      ...customerUpdatedEvent({ email: 'b@example.test' }),
      event_id: 'evt_t10',
      occurred_at: at(10),
    })

    const [row] = await readUser('ctm_1')
    expect(row.email).toBe('a@example.test')
    expect(row.emailUpdatedAt).toBe(BASE_TIME + 20 * 60_000)
  })

  it('normalizes a LEGACY mixed-case row of our own instead of refusing it (AC-3)', async () => {
    // ⚠️ ADDED AT REVIEW, and it only became reachable at review. Once the
    // collision lookup moved to `lower(email)` to match the login predicate,
    // our OWN legacy un-normalized row starts matching it: the equality early
    // return does not fire (the strings differ by case), so the
    // `collision.id !== ours.id` conjunct is what stops us refusing the
    // account's own self-normalization. That conjunct was provably INERT under
    // the old exact-match lookup.
    await seedUser({ paddleId: 'ctm_1', email: 'New@Example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('new@example.test')
    expect(captureError).not.toHaveBeenCalled()
  })

  it('REFUSES a collision with another account stored in a DIFFERENT CASE (AC-3)', async () => {
    // ⚠️ ADDED AFTER CONTROL C10 STAYED GREEN. The legacy-normalization test
    // above does NOT discriminate the `lower(email)` lookup — it uses our OWN
    // row, which passes under an exact match too. This is the case that bites:
    // the colliding row belongs to SOMEONE ELSE and is stored mixed-case.
    //
    // Under the old exact `eq(email)` the collision is invisible, the UPDATE
    // succeeds, and `users_email_unique` allows it because varchar equality is
    // case-sensitive — leaving two rows that differ only by case. Login matches
    // on `lower(email)` with `.limit(1)` and NO `ORDER BY`, so it would then
    // mint a magic link for an arbitrary one of two accounts.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({ paddleId: 'ctm_other', email: 'New@Example.test' })

    const res = await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(res.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
    expect((await readUser('ctm_other'))[0].email).toBe('New@Example.test')
    expect(captureError).toHaveBeenCalled()
  })

  it('invalidates pending magic links when the address moves', async () => {
    // A link minted for the OLD mailbox is keyed on `userId`, so it would still
    // sign into this account after the move. Decided 2026-09-25 to close that
    // window; `loginTokens` are not sessions, so D3's "do not revoke" does not
    // cover them.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await requestMagicLink('old@example.test', 'https://app.test')
    expect(await db.select().from(loginTokens)).toHaveLength(1)

    await post({ ...customerUpdatedEvent(), occurred_at: at(5) })

    expect(await db.select().from(loginTokens)).toHaveLength(0)
  })

  it('stamps the watermark even when it REFUSES, so an older address cannot follow', async () => {
    // Without this, a refused NEWER event leaves no trace and an older
    // intermediate address is applied afterwards — stranding the account on an
    // address Paddle no longer holds.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })
    await seedUser({ paddleId: 'ctm_other', email: 'taken@example.test' })

    await post({
      ...customerUpdatedEvent({ email: 'taken@example.test' }),
      event_id: 'evt_refused',
      occurred_at: at(20),
    })
    expect((await readUser('ctm_1'))[0].emailUpdatedAt).toBe(BASE_TIME + 20 * 60_000)

    await post({
      ...customerUpdatedEvent({ email: 'older@example.test' }),
      event_id: 'evt_older',
      occurred_at: at(10),
    })

    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
  })

  it('does not create an account for a customer we have never seen (AC-7)', async () => {
    // ADR-003: the subscription and transaction paths are the ONLY
    // account-creation paths. A `customer.*` event must never mint a user.
    const res = await post({
      ...customerUpdatedEvent({ id: 'ctm_unknown' }),
      occurred_at: at(5),
    })

    expect(res.status).toBe(200)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('does not read an archived customer as an entitlement change (AC-7)', async () => {
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test', subscriptionStatus: 'active' })

    await post({
      ...customerUpdatedEvent({ status: 'archived' }),
      occurred_at: at(5),
    })

    const [row] = await readUser('ctm_1')
    expect(row.email).toBe('new@example.test')
    expect(row.subscriptionStatus).toBe('active')
  })

  it('does not poison dedup when the envelope carries no event_id (AC-8)', async () => {
    // ⚠️ `eventId = event.event_id ?? data.id` (paddle.ts). On `customer.*`,
    // `data.id` is the `ctm_…` CUSTOMER id — the same value on every customer
    // event for that customer, forever — and `paddleWebhookEvents.eventId` is
    // the PRIMARY KEY. Letting the fallback through would claim `ctm_1` once
    // and then dismiss every later customer event for that customer as a
    // duplicate, permanently.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    const first = await POST({
      request: signedRequest({
        occurred_at: at(10),
        event_type: 'customer.updated',
        data: { id: 'ctm_1', email: 'first@example.test', status: 'active' },
      }),
    })
    expect(first.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('first@example.test')

    const second = await POST({
      request: signedRequest({
        occurred_at: at(20),
        event_type: 'customer.updated',
        data: { id: 'ctm_1', email: 'second@example.test', status: 'active' },
      }),
    })
    expect(second.status).toBe(200)
    // The one that matters: a SECOND idless customer event is still processed.
    expect((await readUser('ctm_1'))[0].email).toBe('second@example.test')
  })

  it('answers 200, not a 500, when the address is unusable (AC-9)', async () => {
    // Retrying an identical payload can never make it valid, so this is the
    // opposite of the subscription path's `{ok:false}` → 500, which retries
    // because the email may yet resolve via the customer API.
    // ⚠️ RENAMED AT REVIEW: this proves "200, not 500". It CANNOT observe
    // `terminal: true` — nothing in the codebase reads that field (13 write
    // sites, zero readers), so a plain `{ ok: true }` is indistinguishable here.
    await seedUser({ paddleId: 'ctm_1', email: 'old@example.test' })

    const unusable = ['', 'not-an-email', `${'a'.repeat(250)}@example.test`]
    for (const [i, email] of unusable.entries()) {
      const res = await post({
        event_type: 'customer.updated',
        event_id: `evt_bad_${i}`,
        occurred_at: at(5 + i),
        data: { id: 'ctm_1', status: 'active', email },
      })
      expect(res.status).toBe(200)
      expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
    }

    // ... and with the field absent entirely.
    const missing = await post({
      event_type: 'customer.updated',
      event_id: 'evt_bad_missing',
      occurred_at: at(9),
      data: { id: 'ctm_1', status: 'active' },
    })
    expect(missing.status).toBe(200)
    expect((await readUser('ctm_1'))[0].email).toBe('old@example.test')
  })
})

describe('Story 70.1 — Settings names the plan the user bought', () => {
  /**
   * A `subscription.created` shaped as Paddle sends it: the TOP-LEVEL
   * `billing_cycle` (required on the subscription entity — the field the
   * webhook reads) AND a line item whose price carries its own. The item-level
   * one is present so a handler that read `items[0].price.billing_cycle`
   * instead would still see a cycle — the top-level one is the contract.
   */
  function subscriptionCreated(
    customerId: string,
    email: string,
    cycle: { interval: string; frequency: number } | undefined
  ) {
    return {
      event_type: 'subscription.created',
      data: {
        id: `sub_${customerId}`,
        customer_id: customerId,
        status: 'active',
        email,
        currency_code: 'EUR',
        ...(cycle ? { billing_cycle: cycle } : {}),
        items: [
          {
            status: 'active',
            quantity: 1,
            recurring: true,
            price: {
              id: cycle?.interval === 'year' ? ANNUAL_PRICE : 'pri_monthly_599',
              ...(cycle ? { billing_cycle: cycle } : {}),
            },
          },
        ],
      },
    }
  }

  /** Resolve the user's session exactly as `/api/auth/me` does, from a signed cookie. */
  async function sessionFor(paddleId: string) {
    const [row] = await readUser(paddleId)
    const token = signSession({ userId: row.id, paddleId: row.paddleId, email: row.email })
    const result = await getCurrentUserSession(
      new Request('https://app.test/api/auth/me', {
        headers: { cookie: `session=${encodeURIComponent(token)}` },
      })
    )
    if (!result.success || !result.data) throw new Error('session did not resolve')
    return result.data
  }

  function labelOf(session: Awaited<ReturnType<typeof sessionFor>>): string {
    // Read through a widened view so this file still RUNS against a server that
    // predates the field (the RED leg of AC-9): absent reads as unknown.
    const { billingInterval } = session as { billingInterval?: 'month' | 'year' | null }
    return planLabel(session.subscriptionStatus, billingInterval)
  }

  it('a monthly and an annual subscriber render DIFFERENT labels, end to end (AC-9)', async () => {
    await post({
      ...subscriptionCreated('ctm_monthly', 'monthly@example.test', {
        interval: 'month',
        frequency: 1,
      }),
      occurred_at: at(1),
    })
    await post({
      ...subscriptionCreated('ctm_annual', 'annual@example.test', {
        interval: 'year',
        frequency: 1,
      }),
      occurred_at: at(1),
    })

    const monthly = labelOf(await sessionFor('ctm_monthly'))
    const annual = labelOf(await sessionFor('ctm_annual'))

    expect({ monthly, annual }).toEqual({ monthly: 'Monthly Plan', annual: 'Annual Plan' })
  })

  const MONTH = { interval: 'month', frequency: 1 }
  const YEAR = { interval: 'year', frequency: 1 }

  it('drops a STALE event whole: an older monthly event cannot overwrite a newer annual one (AC-7)', async () => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(10) })
    // Paddle retries and reorders; this older delivery arrives second.
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', MONTH), occurred_at: at(5) })

    const [row] = await readUser('ctm_1')
    expect(row.billingInterval).toBe('year')
    expect(row.entitlementUpdatedAt).toBe(BASE_TIME + 10 * 60_000)
  })

  it('follows a plan SWITCH: monthly then a newer annual event ends annual (AC-7)', async () => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', MONTH), occurred_at: at(0) })
    await post({
      event_type: 'subscription.updated',
      data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
      occurred_at: at(10),
    })

    expect((await readUser('ctm_1'))[0].billingInterval).toBe('year')
  })

  it('leaves the stored cadence alone when an event states NO billing_cycle (absent ≠ changed)', async () => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
    // `subscriptionEvent()` carries no billing_cycle.
    await post({ ...subscriptionEvent({ status: 'past_due' }), occurred_at: at(5) })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('past_due')
    expect(row.billingInterval).toBe('year')
  })

  it('records a cadence this product does not sell as NULL, never a guessed plan (AC-2)', async () => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
    // Twelve months is a year in duration, but it is not a plan we sell.
    await post({
      event_type: 'subscription.updated',
      data: {
        customer_id: 'ctm_1',
        status: 'active',
        billing_cycle: { interval: 'month', frequency: 12 },
      },
      occurred_at: at(5),
    })

    const [row] = await readUser('ctm_1')
    expect(row.billingInterval).toBeNull()
    expect(planLabel(row.subscriptionStatus, row.billingInterval)).toBe('Active')
  })

  // ⚠️ HONEST SCOPE (Story 70.1 review). The two first-seen tests below pin the
  // OUTCOME, not the INSERT's `?? null`: the column is nullable with no default,
  // so deleting that expression leaves both green. What they do catch is a
  // first-seen row being given a WRONG cadence (a guessed or a leaked one).
  // The first uses a payload Paddle cannot send (`billing_cycle` is required),
  // kept as the defensive case; the second is the reachable one.
  it('stores NULL for a first-seen subscriber whose payload states no cycle', async () => {
    await post({
      ...subscriptionCreated('ctm_1', 'buyer@example.test', undefined),
      occurred_at: at(0),
    })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.billingInterval).toBeNull()
  })

  it('stores NULL, not a guess, for a first-seen subscriber on a cadence we do not sell', async () => {
    await post({
      ...subscriptionCreated('ctm_1', 'buyer@example.test', { interval: 'month', frequency: 12 }),
      occurred_at: at(0),
    })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.billingInterval).toBeNull()
  })

  it.each([
    ['an explicit null', null],
    ['an upper-case interval', { interval: 'YEAR', frequency: 1 }],
  ])('treats %s billing_cycle as MALFORMED (null), not absent (review, AC-2)', async (_, cycle) => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
    await post({
      event_type: 'subscription.updated',
      data: { customer_id: 'ctm_1', status: 'active', billing_cycle: cycle },
      occurred_at: at(5),
    })

    // Absent would have PRESERVED 'year'; malformed degrades to "Active".
    expect((await readUser('ctm_1'))[0].billingInterval).toBeNull()
  })

  describe('entitlementWatermarkGuard — the in-statement ordering predicate (review)', () => {
    // The route cannot reach the race this closes: PGlite is one connection, so
    // two deliveries never interleave between the pre-read and the UPDATE. This
    // drives the predicate itself against the real schema, which is what makes
    // the loser of such a race match no row.
    async function guardedUpdate(occurredAtMinutes: number) {
      const occurredAt = BASE_TIME + occurredAtMinutes * 60_000
      return db
        .update(users)
        .set({ billingInterval: 'month', entitlementUpdatedAt: occurredAt })
        .where(entitlementWatermarkGuard('ctm_1', occurredAt))
        .returning({ id: users.id })
    }

    it('matches NO row for an event older than the stored watermark', async () => {
      await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })

      expect(await guardedUpdate(5)).toHaveLength(0)
      const [row] = await readUser('ctm_1')
      expect(row.billingInterval).toBe('year')
      expect(row.entitlementUpdatedAt).toBe(BASE_TIME + 10 * 60_000)
    })

    it('matches NO row for an event at EXACTLY the watermark (strictly newer only)', async () => {
      await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })
      expect(await guardedUpdate(10)).toHaveLength(0)
    })

    it('matches the row for a newer event, and when no watermark is set yet', async () => {
      await seedUser({ billingInterval: 'year', entitlementUpdatedAt: BASE_TIME + 10 * 60_000 })
      expect(await guardedUpdate(15)).toHaveLength(1)
      expect((await readUser('ctm_1'))[0].billingInterval).toBe('month')

      await seedUser({ paddleId: 'ctm_2', email: 'other@example.test' })
      const fresh = await db
        .update(users)
        .set({ billingInterval: 'year' })
        .where(entitlementWatermarkGuard('ctm_2', BASE_TIME))
        .returning({ id: users.id })
      expect(fresh).toHaveLength(1)
    })

    it('matches ONLY the named customer', async () => {
      await seedUser({ paddleId: 'ctm_2', email: 'other@example.test', billingInterval: 'year' })
      await seedUser({ billingInterval: 'year' })

      expect(await guardedUpdate(5)).toHaveLength(1)
      expect((await readUser('ctm_2'))[0].billingInterval).toBe('year')
    })
  })

  it("writes the cadence for ONLY the event's customer, leaving a bystander untouched", async () => {
    await seedUser({
      paddleId: 'ctm_2',
      email: 'bystander@example.test',
      subscriptionStatus: 'active',
      billingInterval: 'month',
    })
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
    await post({
      event_type: 'subscription.updated',
      data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
      occurred_at: at(5),
    })

    expect((await readUser('ctm_2'))[0].billingInterval).toBe('month')
  })

  it('a lifetime grant clears a previous subscription cadence and labels as Lifetime Plan', async () => {
    await post({ ...subscriptionCreated('ctm_1', 'buyer@example.test', YEAR), occurred_at: at(0) })
    await post({ ...lifetimeEvent(), occurred_at: at(5) })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
    expect(row.billingInterval).toBeNull()
    expect(labelOf(await sessionFor('ctm_1'))).toBe('Lifetime Plan')
  })

  it('a subscription event for a LIFETIME buyer writes nothing, cadence included', async () => {
    await seedUser({ subscriptionStatus: 'lifetime', entitlementUpdatedAt: BASE_TIME })
    await post({
      event_type: 'subscription.updated',
      data: { customer_id: 'ctm_1', status: 'active', billing_cycle: YEAR },
      occurred_at: at(10),
    })

    const [row] = await readUser('ctm_1')
    expect(row.subscriptionStatus).toBe('lifetime')
    expect(row.billingInterval).toBeNull()
  })

  describe('re-key (reconcileEmailCollision) — the path that gets forgotten (AC-10)', () => {
    async function seedLapsedAnnual() {
      // A lapsed annual subscriber under an OLD Paddle customer id.
      await seedUser({
        paddleId: 'ctm_old',
        email: 'returning@example.test',
        subscriptionStatus: 'canceled',
        billingInterval: 'year',
        entitlementUpdatedAt: BASE_TIME,
      })
    }

    it("writes the NEW customer's cadence onto the adopted row", async () => {
      await seedLapsedAnnual()
      await post({
        ...subscriptionCreated('ctm_new', 'returning@example.test', MONTH),
        occurred_at: at(10),
      })

      const [row] = await readUser('ctm_new')
      expect(row.email).toBe('returning@example.test')
      expect(row.subscriptionStatus).toBe('active')
      expect(row.billingInterval).toBe('month')
      expect(labelOf(await sessionFor('ctm_new'))).toBe('Monthly Plan')
    })

    it("clears the PREVIOUS customer's cadence when the new payload states none", async () => {
      await seedLapsedAnnual()
      await post({
        ...subscriptionCreated('ctm_new', 'returning@example.test', undefined),
        occurred_at: at(10),
      })

      const [row] = await readUser('ctm_new')
      expect(row.subscriptionStatus).toBe('active')
      // NOT 'year' — that belonged to ctm_old's subscription, and would show a
      // monthly re-subscriber "Annual Plan".
      expect(row.billingInterval).toBeNull()
      expect(labelOf(await sessionFor('ctm_new'))).toBe('Active')
    })

    it('clears it on a lifetime re-key too', async () => {
      await seedLapsedAnnual()
      await post({
        ...lifetimeEvent({ customer_id: 'ctm_new', email: 'returning@example.test' }),
        occurred_at: at(10),
      })

      const [row] = await readUser('ctm_new')
      expect(row.subscriptionStatus).toBe('lifetime')
      expect(row.billingInterval).toBeNull()
    })
  })
})
