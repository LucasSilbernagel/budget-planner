// @vitest-environment node
/**
 * Survivors and deletions are asserted in the same sweep so neither passes vacuously. PGlite
 * can't produce real lock contention; the beforePurgeLock seam simulates the interleaving.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
const { sendRetentionNoticeEmail, captureError } = vi.hoisted(() => ({
  sendRetentionNoticeEmail: vi.fn(),
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
vi.mock('@/server/email/mailer', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sendRetentionNoticeEmail }
})
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))
// The purge never calls Paddle.
vi.mock('@/server/paddle/subscription-api', () => ({
  cancelActiveSubscriptionsForCustomer: vi.fn(() => {
    throw new Error('the retention purge must never call Paddle')
  }),
}))

import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
  incomeSources,
  jobRuns,
  loginTokens,
  paddleWebhookEvents,
  rateLimits,
  retirementPlans,
  savingsGoals,
  userProfiles,
  users,
} from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { STALE_AFTER_MS, runRetentionBackstopIfStale } from '../backstop'
import { RETENTION_JOB, runRetentionSweep } from '../sweep'

const MIGRATIONS = new URL('../../../../../../packages/db/migrations/', import.meta.url)

/** A fixed "now" AFTER 29 Feb 2028, so a 365-day implementation is a day early. */
const NOW = Date.parse('2028-10-01T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function monthsAgo(months: number, extraMs = 0): number {
  const d = new Date(NOW)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.getTime() + extraMs
}

let pg: PGlite
let db: ReturnType<typeof drizzle>
let seq = 0

type Status = 'free' | 'active' | 'past_due' | 'canceled' | 'lifetime'

async function seedAccount(opts: {
  label: string
  status: Status
  accessEndedAt: number | null
  retentionNoticeSentAt?: number | null
}): Promise<{ userId: string; email: string; paddleId: string }> {
  seq++
  const email = `${opts.label}-${seq}@example.test`
  const paddleId = `ctm_${opts.label}_${seq}`
  const [user] = await db
    .insert(users)
    .values({
      email,
      paddleId,
      subscriptionStatus: opts.status,
      accessEndedAt: opts.accessEndedAt,
      retentionNoticeSentAt: opts.retentionNoticeSentAt ?? null,
    })
    .returning({ id: users.id })
  const userId = user.id
  const [profile] = await db
    .insert(userProfiles)
    .values({ userId, name: 'Main Profile', isDefault: true })
    .returning({ id: userProfiles.id })
  const profileId = profile.id
  const [category] = await db
    .insert(categories)
    .values({ userId, profileId, name: 'Groceries', kind: 'expense' })
    .returning({ id: categories.id })
  await db
    .insert(incomeSources)
    .values({ userId, profileId, name: 'Salary', amount: 500_000, frequency: 'monthly' })
  await db.insert(expenses).values({
    userId,
    profileId,
    name: 'Food',
    amount: 40_000,
    frequency: 'monthly',
    categoryId: category.id,
  })
  await db.insert(savingsGoals).values({ userId, profileId, name: 'Pot', currentBalance: 1_000 })
  await db
    .insert(balanceTracking)
    .values({ userId, profileId, type: 'investment', name: 'ISA', currentBalance: 1_000 })
  await db
    .insert(forecastingProfiles)
    .values({ userId, profileId, name: 'Plan', scenarioData: '{}' })
  await db.insert(retirementPlans).values({ id: userId, userId, plan: { currentAgeInput: '40' } })
  await db.insert(loginTokens).values({
    userId,
    tokenHash: String(seq).padStart(64, '0'),
    expiresAt: new Date(NOW + DAY),
  })
  await db.insert(rateLimits).values([
    { userId, scope: 'sync', subject: userId, requestCount: 1 },
    { userId: null, scope: 'email', subject: email, requestCount: 1 },
  ])
  await db
    .insert(paddleWebhookEvents)
    .values({ eventId: `evt_${seq}`, eventType: 'subscription.canceled', customerId: paddleId })
  return { userId, email, paddleId }
}

async function footprint(account: { userId: string; email: string; paddleId: string }) {
  const count = async (rows: Promise<unknown[]>) => (await rows).length
  return {
    users: await count(db.select().from(users).where(eq(users.id, account.userId))),
    userProfiles: await count(
      db.select().from(userProfiles).where(eq(userProfiles.userId, account.userId))
    ),
    categories: await count(
      db.select().from(categories).where(eq(categories.userId, account.userId))
    ),
    incomeSources: await count(
      db.select().from(incomeSources).where(eq(incomeSources.userId, account.userId))
    ),
    expenses: await count(db.select().from(expenses).where(eq(expenses.userId, account.userId))),
    savingsGoals: await count(
      db.select().from(savingsGoals).where(eq(savingsGoals.userId, account.userId))
    ),
    balanceTracking: await count(
      db.select().from(balanceTracking).where(eq(balanceTracking.userId, account.userId))
    ),
    forecastingProfiles: await count(
      db.select().from(forecastingProfiles).where(eq(forecastingProfiles.userId, account.userId))
    ),
    retirementPlans: await count(
      db.select().from(retirementPlans).where(eq(retirementPlans.userId, account.userId))
    ),
    loginTokens: await count(
      db.select().from(loginTokens).where(eq(loginTokens.userId, account.userId))
    ),
    syncBucket: await count(
      db.select().from(rateLimits).where(eq(rateLimits.userId, account.userId))
    ),
    emailBucket: await count(
      db.select().from(rateLimits).where(eq(rateLimits.subject, account.email))
    ),
    webhookEvents: await count(
      db
        .select()
        .from(paddleWebhookEvents)
        .where(eq(paddleWebhookEvents.customerId, account.paddleId))
    ),
  }
}

const INTACT = {
  users: 1,
  userProfiles: 1,
  categories: 1,
  incomeSources: 1,
  expenses: 1,
  savingsGoals: 1,
  balanceTracking: 1,
  forecastingProfiles: 1,
  retirementPlans: 1,
  loginTokens: 1,
  syncBucket: 1,
  emailBucket: 1,
  webhookEvents: 1,
}

/** The webhook log is kept for replay dedup. */
const ERASED = {
  users: 0,
  userProfiles: 0,
  categories: 0,
  incomeSources: 0,
  expenses: 0,
  savingsGoals: 0,
  balanceTracking: 0,
  forecastingProfiles: 0,
  retirementPlans: 0,
  loginTokens: 0,
  syncBucket: 0,
  emailBucket: 0,
  webhookEvents: 1,
}

async function readUser(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId))
  return row
}

async function readJob() {
  const [row] = await db.select().from(jobRuns).where(eq(jobRuns.name, RETENTION_JOB))
  return row
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
  sendRetentionNoticeEmail.mockResolvedValue('msg-1')
  await db.delete(forecastingProfiles)
  await db.delete(retirementPlans)
  await db.delete(incomeSources)
  await db.delete(expenses)
  await db.delete(categories)
  await db.delete(savingsGoals)
  await db.delete(balanceTracking)
  await db.delete(loginTokens)
  await db.delete(rateLimits)
  await db.delete(userProfiles)
  await db.delete(paddleWebhookEvents)
  await db.delete(users)
  await db.update(jobRuns).set({ leaseUntil: null, lastCompletedAt: null })
})

describe('survival first — paying and not-yet-due accounts survive a sweep that deletes the eligible', () => {
  it('keeps every entitled and not-yet-due account whole, and erases exactly the eligible ones', async () => {
    const longAgo = monthsAgo(24)
    const oldNotice = NOW - 60 * DAY
    // The entitled rows carry an OLD clock and an OLD notice on purpose: the
    // only thing standing between them and deletion is their STATUS.
    const lifetime = await seedAccount({
      label: 'lifetime',
      status: 'lifetime',
      accessEndedAt: longAgo,
      retentionNoticeSentAt: oldNotice,
    })
    const active = await seedAccount({
      label: 'active',
      status: 'active',
      accessEndedAt: longAgo,
      retentionNoticeSentAt: oldNotice,
    })
    const pastDue = await seedAccount({
      label: 'pastdue',
      status: 'past_due',
      accessEndedAt: longAgo,
      retentionNoticeSentAt: oldNotice,
    })
    const notYet = await seedAccount({
      label: 'notyet',
      status: 'canceled',
      accessEndedAt: monthsAgo(11),
      retentionNoticeSentAt: oldNotice,
    })
    // 12 calendar months end one minute after NOW; 365 days ended yesterday.
    const calendarEdge = await seedAccount({
      label: 'edge',
      status: 'canceled',
      accessEndedAt: monthsAgo(12, 60_000),
      retentionNoticeSentAt: oldNotice,
    })
    const noNotice = await seedAccount({
      label: 'nonotice',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
    })
    const freshNotice = await seedAccount({
      label: 'freshnotice',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 10 * DAY,
    })
    const staleLapseNotice = await seedAccount({
      label: 'stalelapse',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: monthsAgo(20),
    })
    const eligibleCanceled = await seedAccount({
      label: 'gone',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: oldNotice,
    })
    const eligiblePaused = await seedAccount({
      label: 'gonepaused',
      status: 'free',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: oldNotice,
    })

    const result = await runRetentionSweep({ now: NOW })

    for (const survivor of [
      lifetime,
      active,
      pastDue,
      notYet,
      calendarEdge,
      noNotice,
      freshNotice,
      staleLapseNotice,
    ]) {
      expect(await footprint(survivor), survivor.email).toEqual(INTACT)
    }
    expect(await footprint(eligibleCanceled)).toEqual(ERASED)
    expect(await footprint(eligiblePaused)).toEqual(ERASED)
    expect(result).toMatchObject({ purged: 2, purgeFailures: 0 })
  })
})

describe('the warning email (AC-4, D2)', () => {
  it('emails a lapsed account once its deletion is 30 days away, and stamps the notice', async () => {
    const due = await seedAccount({
      label: 'due',
      status: 'canceled',
      accessEndedAt: monthsAgo(12, 15 * DAY),
    })

    const result = await runRetentionSweep({ now: NOW })

    expect(result).toMatchObject({ noticesDue: 1, noticesSent: 1, noticeFailures: 0, purged: 0 })
    expect(sendRetentionNoticeEmail).toHaveBeenCalledTimes(1)
    // The purge needs a 30-day-old notice, so the promised date is always NOW + 30 days.
    expect(sendRetentionNoticeEmail).toHaveBeenCalledWith(due.email, {
      deletionDate: '31 October 2028',
    })
    expect((await readUser(due.userId)).retentionNoticeSentAt).toBe(NOW)
  })

  it('does not email an account more than 30 days from its deadline, or any entitled account', async () => {
    await seedAccount({ label: 'early', status: 'canceled', accessEndedAt: monthsAgo(10) })
    await seedAccount({ label: 'life', status: 'lifetime', accessEndedAt: monthsAgo(24) })
    await seedAccount({ label: 'act', status: 'active', accessEndedAt: monthsAgo(24) })
    await seedAccount({ label: 'pd', status: 'past_due', accessEndedAt: monthsAgo(24) })
    await seedAccount({ label: 'noclock', status: 'canceled', accessEndedAt: null })

    const result = await runRetentionSweep({ now: NOW })

    expect(result.noticesDue).toBe(0)
    expect(sendRetentionNoticeEmail).not.toHaveBeenCalled()
  })

  it('does not email twice for the same lapse', async () => {
    await seedAccount({
      label: 'once',
      status: 'canceled',
      accessEndedAt: monthsAgo(12, 15 * DAY),
      retentionNoticeSentAt: NOW - DAY,
    })

    await runRetentionSweep({ now: NOW })

    expect(sendRetentionNoticeEmail).not.toHaveBeenCalled()
  })

  it('a failed send records NO notice, so the account cannot be deleted without one', async () => {
    const due = await seedAccount({
      label: 'bounce',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
    })
    sendRetentionNoticeEmail.mockRejectedValue(new Error('Email provider returned 503'))

    const result = await runRetentionSweep({ now: NOW })

    expect(result).toMatchObject({ noticesSent: 0, noticeFailures: 1, purged: 0 })
    expect((await readUser(due.userId)).retentionNoticeSentAt).toBeNull()
    expect(captureError).toHaveBeenCalled()
  })
})

describe('end to end: notice, then deletion no earlier than 30 days later', () => {
  it('a notice sent late pushes deletion back; it happens on the 30th day, not before', async () => {
    const account = await seedAccount({
      label: 'e2e',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
    })

    // Day 0: past 12 months but never warned → warn, do not delete.
    await runRetentionSweep({ now: NOW })
    expect((await footprint(account)).users).toBe(1)
    expect(sendRetentionNoticeEmail).toHaveBeenCalledTimes(1)

    // Day 29: still inside the notice period.
    await runRetentionSweep({ now: NOW + 29 * DAY })
    expect(await footprint(account)).toEqual(INTACT)

    // Day 30: deleted.
    const result = await runRetentionSweep({ now: NOW + 30 * DAY })
    expect(result.purged).toBe(1)
    expect(await footprint(account)).toEqual(ERASED)
    expect(sendRetentionNoticeEmail).toHaveBeenCalledTimes(1)
  })
})

describe('re-check under the lock (AC-6) — SIMULATED interleaving', () => {
  it('a customer who resubscribes between candidate selection and the purge SURVIVES', async () => {
    const account = await seedAccount({
      label: 'resub',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    const result = await runRetentionSweep({
      now: NOW,
      // What the webhook's UPDATE does on `subscription.activated`.
      beforePurgeLock: async (userId) => {
        await db
          .update(users)
          .set({ subscriptionStatus: 'active', accessEndedAt: null, retentionNoticeSentAt: null })
          .where(eq(users.id, userId))
      },
    })

    expect(result).toMatchObject({ purgesDue: 1, purged: 0, purgesSkipped: 1 })
    expect(await footprint(account)).toEqual(INTACT)
  })
})

describe('single-flight lease and success heartbeat', () => {
  it('a held lease makes a second sweep skip without touching anything', async () => {
    await db
      .update(jobRuns)
      .set({ leaseUntil: NOW + 60_000 })
      .where(eq(jobRuns.name, RETENTION_JOB))
    const account = await seedAccount({
      label: 'held',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    const result = await runRetentionSweep({ now: NOW })

    expect(result.skipped).toBe('lease-held')
    expect(await footprint(account)).toEqual(INTACT)
    expect((await readJob()).lastCompletedAt).toBeNull()
  })

  it('an EXPIRED lease (a run that died) is reclaimed', async () => {
    await db
      .update(jobRuns)
      .set({ leaseUntil: NOW - 1 })
      .where(eq(jobRuns.name, RETENTION_JOB))

    const result = await runRetentionSweep({ now: NOW })

    expect(result.skipped).toBeUndefined()
    expect(await readJob()).toMatchObject({ leaseUntil: null, lastCompletedAt: NOW })
  })

  it('a run with a per-account failure still COMPLETES — one refused address is not a stopped schedule', async () => {
    await seedAccount({ label: 'fail', status: 'canceled', accessEndedAt: monthsAgo(13) })
    sendRetentionNoticeEmail.mockRejectedValue(new Error('down'))

    const result = await runRetentionSweep({ now: NOW })

    expect(result.noticeFailures).toBe(1)
    expect(await readJob()).toMatchObject({ leaseUntil: null, lastCompletedAt: NOW })
  })

  it('re-seeds its own jobRuns row if it is missing', async () => {
    await db.delete(jobRuns)

    const result = await runRetentionSweep({ now: NOW })

    expect(result.skipped).toBeUndefined()
    expect((await readJob()).lastCompletedAt).toBe(NOW)
  })
})

describe('dry run', () => {
  it('counts what it would do and writes nothing', async () => {
    const toNotice = await seedAccount({
      label: 'dn',
      status: 'canceled',
      accessEndedAt: monthsAgo(12, 15 * DAY),
    })
    const toPurge = await seedAccount({
      label: 'dp',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    const result = await runRetentionSweep({ now: NOW, dryRun: true })

    expect(result).toMatchObject({
      dryRun: true,
      noticesDue: 1,
      purgesDue: 1,
      noticesSent: 0,
      purged: 0,
    })
    expect(sendRetentionNoticeEmail).not.toHaveBeenCalled()
    expect((await readUser(toNotice.userId)).retentionNoticeSentAt).toBeNull()
    expect(await footprint(toPurge)).toEqual(INTACT)
    expect(await readJob()).toMatchObject({ leaseUntil: null, lastCompletedAt: null })
  })
})

describe('in-app backstop (D1) — runs only when the scheduled sweep has stopped', () => {
  it('does nothing while the last successful run is fresh', async () => {
    await db
      .update(jobRuns)
      .set({ lastCompletedAt: NOW - DAY })
      .where(eq(jobRuns.name, RETENTION_JOB))
    const account = await seedAccount({
      label: 'fresh',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    expect(await runRetentionBackstopIfStale(NOW)).toBe('fresh')
    expect(await footprint(account)).toEqual(INTACT)
  })

  it('sweeps when the last success is older than the stale threshold', async () => {
    await db
      .update(jobRuns)
      .set({ lastCompletedAt: NOW - STALE_AFTER_MS - 1 })
      .where(eq(jobRuns.name, RETENTION_JOB))
    const account = await seedAccount({
      label: 'stale',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    expect(await runRetentionBackstopIfStale(NOW)).toBe('ran')
    expect(await footprint(account)).toEqual(ERASED)
    expect((await readJob()).lastCompletedAt).toBe(NOW)
  })

  it('stays UNARMED until a first run completes — a fresh deploy waits for the dry run and the workflow', async () => {
    const account = await seedAccount({
      label: 'unarmed',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    expect(await runRetentionBackstopIfStale(NOW)).toBe('unarmed')
    expect(await footprint(account)).toEqual(INTACT)
  })
})

describe('code review 73.2 fixes', () => {
  it('dry-run counts are TOTALS, not capped by the batch limit', async () => {
    for (let i = 0; i < 3; i++) {
      await seedAccount({
        label: `backlog${i}`,
        status: 'canceled',
        accessEndedAt: monthsAgo(13),
        retentionNoticeSentAt: NOW - 60 * DAY,
      })
    }

    const result = await runRetentionSweep({ now: NOW, dryRun: true, purgeLimit: 1 })

    expect(result.purgesDue).toBe(3)
  })

  it('a refused address rotates to the back: the next account is still warned', async () => {
    // Two due accounts, batch of ONE. The older one's address is refused.
    const refused = await seedAccount({
      label: 'refused',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
    })
    const next = await seedAccount({
      label: 'next',
      status: 'canceled',
      accessEndedAt: monthsAgo(12, 5 * DAY),
    })
    sendRetentionNoticeEmail.mockImplementation(async (to: string) => {
      if (to === refused.email) throw new Error('Email provider returned 400')
      return 'ok'
    })

    await runRetentionSweep({ now: NOW, noticeLimit: 1 })
    await runRetentionSweep({ now: NOW + DAY, noticeLimit: 1 })

    expect(sendRetentionNoticeEmail.mock.calls.map((c) => c[0])).toEqual([
      refused.email,
      next.email,
    ])
    expect((await readUser(next.userId)).retentionNoticeSentAt).toBe(NOW + DAY)
    expect((await readUser(refused.userId)).retentionNoticeSentAt).toBeNull()
    await runRetentionSweep({ now: NOW + 400 * DAY })
    expect((await footprint(refused)).users).toBe(1)
  })

  it('starts a missing clock at now (a lapse written by the old image between migrate and deploy)', async () => {
    const orphan = await seedAccount({ label: 'orphan', status: 'canceled', accessEndedAt: null })
    const entitled = await seedAccount({ label: 'ent', status: 'active', accessEndedAt: null })

    const result = await runRetentionSweep({ now: NOW })

    expect(result.clocksStarted).toBe(1)
    expect((await readUser(orphan.userId)).accessEndedAt).toBe(NOW)
    expect((await readUser(entitled.userId)).accessEndedAt).toBeNull()
  })

  it('does not count a notice whose row regained access before it was recorded', async () => {
    await seedAccount({ label: 'resubmid', status: 'canceled', accessEndedAt: monthsAgo(13) })
    sendRetentionNoticeEmail.mockImplementation(async () => {
      // The customer pays again while the email is in flight.
      await db.update(users).set({ subscriptionStatus: 'active', accessEndedAt: null })
      return 'ok'
    })

    const result = await runRetentionSweep({ now: NOW })

    expect(result).toMatchObject({ noticesSent: 0, noticeFailures: 0 })
  })

  it('an exhausted run budget stops starting new accounts and says so', async () => {
    const account = await seedAccount({
      label: 'budget',
      status: 'canceled',
      accessEndedAt: monthsAgo(13),
      retentionNoticeSentAt: NOW - 60 * DAY,
    })

    const result = await runRetentionSweep({ now: NOW, runBudgetMs: 0 })

    expect(result).toMatchObject({ truncated: true, purged: 0, purgesDue: 1 })
    expect(await footprint(account)).toEqual(INTACT)
  })
})
