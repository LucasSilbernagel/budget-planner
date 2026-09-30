// @vitest-environment node
/**
 * A sync operation the database can NEVER accept leaves the queue — proven
 * through the whole live chain (story 75.1, FR119, AC-8).
 *
 * Real core `SynchronizationService` → real `sendSyncOperation` → real
 * `/api/sync/batch` handler → real `processBatchSync` → real PostgreSQL (PGlite,
 * full migration chain). Only the session lookup and the rate limiter are stubbed.
 *
 * ⚠️⚠️ WHY THE WHOLE CHAIN. The defect lives in the SEAMS: the database raises a
 * `23514`, the server collapses it into a 200 envelope with no status, the client
 * maps that to `retryable:false` with no `statusCode`, and core files it under
 * `unclassifiedFailedOperations` and KEEPS IT QUEUED — replayed every cycle until
 * the circuit breaker stops all sync for the account. A test of any one layer can
 * be green while the chain deadlocks.
 *
 * ⚠️ The bad op is written into the persisted queue DIRECTLY. The client queue
 * gate (`syncOperationDataSchema`, story 66.5) refuses `currentBalance: -1` for a
 * savings goal, so it can only arrive from a queue written before that gate — or a
 * gate that a future change loosens. This test is about what the SERVER and the
 * transport do once such an op exists, which is exactly the shape the queue-gate
 * defer (`deferred-work.md`, 66.5 review) records.
 *
 * ⚠️ `localStorage` comes from a JSDOM window: the node environment has none,
 * on every Node (`src/test/webstorage.ts`).
 *
 * ⚠️ Every test asserts that a request REACHED the route (`served`). Without that
 * positive anchor, an offline service — which sends nothing — satisfies every
 * "stays queued" assertion here, and did so on this file's first run.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/server/rate-limit/db-window', () => ({
  checkDbRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const USER = '33333333-3333-4333-8333-333333333333'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { logger } from '@/lib/logger'
import { POST as batchPOST } from '@/routes/api/sync/batch'
import { processBatchSync } from '@/server/api/sync'
import { createSynchronizationService } from '@budget-planner/core/sync'
import type { SyncOperation } from '@budget-planner/core/sync'
import { categories, incomeSources, savingsGoals, userProfiles, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import { JSDOM } from 'jsdom'
import { sendSyncOperation } from '../../../features/api/client'

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const PROFILE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const GOAL = '40000000-0000-4000-8000-0000000000a1'
const QUEUE_KEY = `bp-sync-queue-${USER}`

let pg: PGlite
let db: ReturnType<typeof drizzle>
let dom: JSDOM
let service: ReturnType<typeof createSynchronizationService> | undefined
/** Every response the route served, so a test can read what went over the wire. */
const served: { status: number; body: string }[] = []

/**
 * Route a `fetch` to the real handler, the way a BROWSER would send it.
 *
 * ⚠️ `content-length` is set HERE (story 79.3). A browser sends it for a string
 * body, but undici's `new Request(url, { body })` does not put it on the Request
 * (MEASURED on Node 26: `headers.get('content-length')` is `null`), and
 * `sendSyncOperation` sets none. Without it the route's size guard is never
 * reached and a "413" test here is vacuous.
 */
async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  if (url.pathname !== '/api/sync/batch') throw new Error(`unrouted fetch ${url}`)
  const headers = new Headers(init?.headers)
  if (typeof init?.body === 'string') {
    headers.set('content-length', String(new TextEncoder().encode(init.body).byteLength))
  }
  const response = await batchPOST({ request: new Request(url, { ...init, headers }) })
  const body = await response.clone().text()
  served.push({ status: response.status, body })
  return response
}

function queuedOp(overrides: Partial<SyncOperation>): SyncOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'update',
    entityType: 'savingsGoal',
    entityId: GOAL,
    data: { userId: USER, name: 'Emergency fund', currentBalance: -1 },
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    profileId: PROFILE,
    ...overrides,
  } as SyncOperation
}

/** Seed the persisted queue as a previous page load would have left it. */
function seedQueue(ops: SyncOperation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
}

function persistedQueueIds(): string[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]).map((op) => op.id) : []
}

async function startService() {
  service = createSynchronizationService(USER, {
    autoSync: false,
    processOperation: sendSyncOperation,
    profileId: PROFILE,
  })
  await service.initialize()
  return service
}

beforeAll(async () => {
  pg = new PGlite()
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(resolve(MIGRATIONS, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await pg.exec(statement)
      }
    }
  }
  db = drizzle(pg)
  holder.db = db
  await db.insert(users).values({
    id: USER,
    email: 'chain@example.test',
    paddleId: 'ctm_chain',
    subscriptionStatus: 'lifetime',
  })
  await db.insert(userProfiles).values({ id: PROFILE, userId: USER, name: 'Main', isDefault: true })

  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  vi.stubGlobal('localStorage', dom.window.localStorage)
  // ⚠️ Node has a global `navigator` WITHOUT `onLine`, so the service reads
  // `isOnline: undefined` and sends NOTHING — every op stays queued and a
  // "stays queued" assertion goes green or red for the wrong reason. The first
  // RED run of this file did exactly that. JSDOM's navigator reports online.
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('fetch', routeFetch)
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

beforeEach(async () => {
  localStorage.clear()
  served.length = 0
  await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
  await db.delete(categories).where(eq(categories.userId, USER))
  await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
  await db.insert(savingsGoals).values({
    id: GOAL,
    userId: USER,
    profileId: PROFILE,
    name: 'Emergency fund',
    currentBalance: 1000,
  } as never)
})

afterEach(() => {
  service?.destroy()
  service = undefined
})

describe('a never-acceptable op leaves the queue (story 75.1)', () => {
  it('drops an update the database refuses with a CHECK violation (23514)', async () => {
    const bad = queuedOp({})
    seedQueue([bad])
    const sync = await startService()

    await sync.forceSync()

    expect(served.map((r) => r.status)).toEqual([200])
    // The server really did refuse it — the row is untouched.
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
    expect(row?.currentBalance).toBe(1000)

    // THE CLAIM: the op is gone from the PERSISTED queue (what a reload sees) and
    // recorded as rejected, rather than replayed every cycle.
    expect(persistedQueueIds()).not.toContain(bad.id)
    expect(sync.getState().pendingOperations.map((op) => op.id)).not.toContain(bad.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
  })

  it('does not put the driver message, table or constraint name on the wire (AC-6)', async () => {
    seedQueue([queuedOp({})])
    const sync = await startService()
    await sync.forceSync()

    expect(served).toHaveLength(1)
    const wire = served[0]?.body ?? ''
    expect(wire).not.toMatch(/savingsGoals_currentBalance_non_negative/)
    expect(wire).not.toMatch(/violates check constraint/)
    expect(wire).not.toMatch(/"savingsGoals"/)
  })

  it('CONTROL — keeps an op whose failure depends on ordering (23503, category not synced yet)', async () => {
    const income = queuedOp({
      type: 'create',
      entityType: 'incomeSource',
      entityId: '10000000-0000-4000-8000-0000000000a2',
      data: {
        userId: USER,
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
        // A category whose own create has not reached the server yet.
        categoryId: '30000000-0000-4000-8000-0000000000a3',
      },
    })
    seedQueue([income])
    const sync = await startService()

    await sync.forceSync()

    // Positive anchor: the server really saw it and really refused it.
    expect(served.map((r) => r.status)).toEqual([200])
    expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({ failedCount: 1 })
    // Refused today, but it can succeed once the category lands: it must STAY.
    expect(persistedQueueIds()).toContain(income.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).not.toContain(income.id)
  })

  it('CONTROL — keeps an op whose failure is transient (40001), exactly as before 75.1 (plus an empty `rejections`)', async () => {
    // A serialization failure on the UPDATE itself. It can succeed on replay, so it
    // must stay queued — and must NOT become "retryable" either: a retryable op
    // leaves the persisted queue for an in-memory retry and is lost past the
    // budget or on reload (FR120, story 75.3).
    const update = vi.spyOn(db, 'update').mockImplementationOnce(() => {
      throw Object.assign(new Error('could not serialize access'), { code: '40001' })
    })
    const op = queuedOp({ data: { userId: USER, name: 'Emergency fund', currentBalance: 5 } })
    seedQueue([op])
    const sync = await startService()

    let updateCalls = 0
    try {
      await sync.forceSync()
      // Read BEFORE `mockRestore`, which also clears the recorded calls.
      updateCalls = update.mock.calls.length
    } finally {
      update.mockRestore()
    }

    // Positive anchor: the transient error really fired on the server's UPDATE.
    expect(updateCalls).toBe(1)
    expect(served.map((r) => r.status)).toEqual([200])
    const envelope = JSON.parse(served[0]?.body ?? '{}')
    expect(envelope).toMatchObject({ failedCount: 1, rejections: [] })
    expect(persistedQueueIds()).toContain(op.id)
    expect(sync.getState().rejectedOperations.map((o) => o.id)).not.toContain(op.id)
    expect(sync.getState().failedOperations.map((o) => o.id)).not.toContain(op.id)
  })

  it('KEEPS an op whose conflict CHECK fails transiently (40001) — a failure, not a conflict (story 79.3)', async () => {
    // Before 79.3 `checkConflict`'s existence SELECT swallowed the error as "row
    // absent", so this update was an `update-delete` CONFLICT: kept for ever and,
    // since core counts a conflict as a successful attempt, never escalated to
    // the user (79.2). A failure is kept too, and IS escalated.
    let fired = 0
    const select = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      fired++
      throw Object.assign(new Error('could not serialize access'), { code: '40001' })
    })
    const op = queuedOp({ data: { userId: USER, name: 'Emergency fund', currentBalance: 5 } })
    seedQueue([op])
    const sync = await startService()
    vi.mocked(logger.error).mockClear()

    try {
      await sync.forceSync()
    } finally {
      select.mockRestore()
    }
    // ...and it fired inside `checkConflict`, not in some other SELECT.
    expect(vi.mocked(logger.error).mock.calls.map((call) => call[0])).toContain(
      '[Conflict Check Error]'
    )

    // Positive anchors: the stub fired once, on the server, and the route answered.
    expect(fired).toBe(1)
    expect(served.map((r) => r.status)).toEqual([200])
    expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({
      failedCount: 1,
      conflictCount: 0,
      conflicts: [],
      rejections: [],
      status: 'FAILED',
    })
    // Not applied.
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
    expect(row?.currentBalance).toBe(1000)
    // THE CLAIM: kept in the persisted queue, in none of the terminal buckets.
    expect(persistedQueueIds()).toContain(op.id)
    expect(sync.getState().conflictOperations.map((o) => o.id)).not.toContain(op.id)
    expect(sync.getState().rejectedOperations.map((o) => o.id)).not.toContain(op.id)
  })

  it('drops an op whose payload fails the server schema (request-level, HTTP 400)', async () => {
    const bad = queuedOp({
      type: 'create',
      entityType: 'incomeSource',
      entityId: '10000000-0000-4000-8000-0000000000a4',
      // Non-integer cents: the server schema is `z.number().int()`.
      data: { userId: USER, name: 'Salary', amount: 1.5, frequency: 'monthly' },
    })
    seedQueue([bad])
    const sync = await startService()

    await sync.forceSync()

    expect(served[0]?.status).toBe(400)
    expect(persistedQueueIds()).not.toContain(bad.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
  })

  it('drops an op whose request is over the size limit (HTTP 413 + `too-large`, story 79.3)', async () => {
    // An op over the route's 512 KiB limit needs an unbounded EXTRA key: the per-entity schemas bound every
    // declared string but do not strip undeclared keys (see the 34.1a comment in
    // `server/api/sync.ts`). An old or corrupt queue, or a future field.
    const huge = queuedOp({
      data: {
        userId: USER,
        name: 'Emergency fund',
        currentBalance: 5,
        notes: 'x'.repeat(1_100_000),
      },
    })
    seedQueue([huge])
    const sync = await startService()
    const handedOn: string[][] = []
    sync.onOperationsRejected((ops) => handedOn.push(ops.map((op) => op.id)))

    await sync.forceSync()

    // Positive anchor FIRST: the route's own size guard answered, not a later arm.
    expect(served.map((r) => r.status)).toEqual([413])
    expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({ refusal: 'too-large' })
    // The server wrote nothing.
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
    expect(row?.currentBalance).toBe(1000)
    // THE CLAIM: it left the persisted queue and was handed on as rejected.
    expect(persistedQueueIds()).not.toContain(huge.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(huge.id)
    // ...to the path that names and reverts it (`lib/sync/refusedEdits.ts`).
    expect(handedOn).toEqual([[huge.id]])
  })

  it("KEEPS an op whose userId is not the session user (HTTP 401) — it may be another account's edit", async () => {
    // Code review (story 75.1): the session cookie is shared across tabs while
    // `useSync` reads its userId once at mount, so a tab can push account A's
    // queue under account B's cookie. The story first answered 422 here, which
    // DELETED A's genuine edits. 401 is auth-blocked in core: kept queued.
    const other = '44444444-4444-4444-8444-444444444444'
    const foreign = queuedOp({
      userId: other,
      data: { userId: other, name: 'x', currentBalance: 5 },
    })
    seedQueue([foreign])
    const sync = await startService()

    await sync.forceSync()

    expect(served[0]?.status).toBe(401)
    expect(persistedQueueIds()).toContain(foreign.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).not.toContain(foreign.id)
  })

  it("drops a refused CREATE together with the row's queued follow-up (code review D1)", async () => {
    // Without D1 the update is answered `update-delete` for a row that never
    // reached the server — a conflict, never removed — and the deadlock returns.
    const goal = '40000000-0000-4000-8000-0000000000b1'
    const create = queuedOp({
      type: 'create',
      entityId: goal,
      data: { userId: USER, name: 'New goal', currentBalance: -1 },
    })
    const followUp = queuedOp({
      id: 'op-follow-up',
      entityId: goal,
      data: { userId: USER, name: 'New goal', currentBalance: 10 },
      timestamp: create.timestamp + 1,
    })
    seedQueue([create, followUp])
    const sync = await startService()

    await sync.forceSync()

    expect(served.length).toBeGreaterThanOrEqual(1)
    expect(persistedQueueIds()).toEqual([])
    expect(
      sync
        .getState()
        .rejectedOperations.map((op) => op.id)
        .sort()
    ).toEqual([create.id, followUp.id].sort())
    expect(sync.getState().conflictOperations.map((op) => op.id)).not.toContain(followUp.id)
  })
})

describe('processBatchSync classification (story 75.1, AC-1/AC-3)', () => {
  function push(op: SyncOperation) {
    return processBatchSync(
      { operations: [op], clientTimestamp: Date.now(), deviceId: 'device-1' },
      { id: USER, subscriptionStatus: 'lifetime' }
    )
  }

  it('reports a 23514 as a rejection with reason `constraint`, and still counts it failed', async () => {
    const op = queuedOp({})
    const result = await push(op)
    expect(result).toMatchObject({
      failedCount: 1,
      failedOperationIds: [op.id],
      rejections: [{ operationId: op.id, reason: 'constraint' }],
    })
  })

  it('does NOT reject a 23505 — a unique violation can clear once its paired op lands', async () => {
    // A second LIVE category of the same name and kind: the index
    // `categories_userId_profileId_kind_name_live_unique` is on `lower(name)`
    // (migration 0012), so `groceries` collides with `Groceries`. It refuses it now, but the
    // same create succeeds once the first row's rename or delete arrives.
    // ⚠️ Until story 80.2 this used a second DEFAULT profile create. That create
    // is now accepted as NON-default (decision D1,
    // `server/api/__tests__/sync-profile-create-default.db.test.ts`), so it no
    // longer produces a 23505.
    const first = '30000000-0000-4000-8000-0000000000c1'
    const second = '30000000-0000-4000-8000-0000000000c2'
    const categoryCreate = (entityId: string, name: string) =>
      queuedOp({
        type: 'create',
        entityType: 'category',
        entityId,
        data: { userId: USER, name, kind: 'expense' },
      })
    expect(await push(categoryCreate(first, 'Groceries'))).toMatchObject({
      processedCount: 1,
      failedCount: 0,
    })

    const op = categoryCreate(second, 'groceries')
    const result = await push(op)
    expect(result).toMatchObject({ failedCount: 1, failedOperationIds: [op.id], rejections: [] })

    // Positive control: the SAME op under another name is accepted, so the failure
    // above really was the live-name unique index and not some other fault in
    // the payload.
    const accepted = await push({ ...op, id: `${op.id}-b`, data: { ...op.data, name: 'Rent' } })
    expect(accepted).toMatchObject({ processedCount: 1, failedCount: 0 })
  })

  it('refuses a non-uuid entityId at the REQUEST level (it used to become a permanent conflict)', async () => {
    // Before 75.1 this reached `checkConflict`, whose SELECT raised 22P02 and
    // became a conflict — never removed client-side. (Since 79.3 a failed check
    // is a kept-queued failure, but a non-uuid id never gets that far.)
    const op = queuedOp({ entityId: 'not-a-uuid' })
    const result = await push(op)
    expect(result).toMatchObject({ refusal: 'invalid-request', conflictCount: 0 })
    // Refused for the uuid rule on `entityId`, not for some other payload fault.
    expect(result.error).toMatch(/"entityId"/)
    expect(result.error).toMatch(/Invalid uuid/)
  })

  it('does NOT reject "Profile not found" — the profile may still be syncing (the ops of a deleted profile are dropped by the pull, story 76.2)', async () => {
    // A CREATE, so `checkConflict` passes and `applyOperation` reaches the profile
    // check (an UPDATE would be reported as an update-delete conflict first).
    const op = queuedOp({
      type: 'create',
      entityType: 'incomeSource',
      entityId: '10000000-0000-4000-8000-0000000000a5',
      profileId: '99999999-9999-4999-8999-999999999999',
      data: { userId: USER, name: 'Salary', amount: 500000, frequency: 'monthly' },
    })
    const result = await push(op)
    expect(result).toMatchObject({ failedCount: 1, failedOperationIds: [op.id], rejections: [] })
  })
})
